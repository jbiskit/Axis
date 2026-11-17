//! Read-only MCP server (stdio) over the Axis SDK, reusing the Axis desktop sign-in like `axis-probe`.
//!
//!   claude mcp add axis -- <path>\axis-mcp.exe
//!
//! Proof of concept: hand-rolled JSON-RPC, one request at a time, reads only.

use axis_sdk::{decode_access_token_claims, AuthManager, GraphClient, GraphError, StoredSignInOutcome};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

const REVIEW_KINDS: &[&str] = &[
    "androidEnrollmentProfile", "appConfig", "appCredential", "appleEnrollmentProfile", "assignmentFailure",
    "assignmentFilter", "authMethodConfig", "authRegistration", "authStrength", "brandingProfile", "caTemplate",
    "conditionalAccessPolicy", "customRole", "defenderDevice", "deviceCategory", "endpointSecurityPolicy",
    "intuneConnector", "intuneRole", "namedLocation", "notificationTemplate", "pimRoleSetting", "retentionLabel",
    "roleAssignment", "secureScoreControl", "sensitivityLabel", "tenantSetting", "termsAndConditions", "updateAlert",
    "user", "entraDevice", "servicePlan",
];
// shortcut: large lists are cut at this many characters; add paging/filters if models need whole tenants.
const MAX_TEXT: usize = 200_000;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let auth = AuthManager::detached();
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(request) = serde_json::from_str::<Value>(&line) else { continue };
        let Some(id) = request.get("id").cloned() else { continue }; // notifications need no reply
        let params = &request["params"];
        let reply = match request["method"].as_str().unwrap_or_default() {
            "initialize" => Ok(json!({
                "protocolVersion": params["protocolVersion"].as_str().unwrap_or("2025-06-18"),
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "axis", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "Read-only access to the tenant signed in with the Axis desktop app (Microsoft Graph beta, Intune reports, Defender hunting, Axis review lists).",
            })),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": tools() })),
            "tools/call" => Ok(call(&auth, params["name"].as_str().unwrap_or_default(), &params["arguments"]).await),
            other => Err(json!({ "code": -32601, "message": format!("Method not found: {other}") })),
        };
        let message = match reply {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
        };
        let _ = writeln!(stdout, "{message}");
        let _ = stdout.flush();
    }
}

fn tools() -> Value {
    let none = json!({ "type": "object", "properties": {} });
    json!([
        { "name": "sign_ins", "description": "Saved Axis sign-ins (tenant, account, read-only or admin) and which one these tools use. Selecting one here never changes the Axis app.", "inputSchema": none },
        { "name": "use_sign_in", "description": "Use a saved sign-in (client_id from sign_ins) for the following tool calls in this session only.",
          "inputSchema": { "type": "object", "properties": { "client_id": { "type": "string" } }, "required": ["client_id"] } },
        { "name": "whoami", "description": "Signed-in account, tenant id and granted Graph scopes.", "inputSchema": none },
        { "name": "graph_get", "description": "GET any Microsoft Graph path, e.g. /beta/deviceManagement/deviceConfigurations?$top=5. Prefer /beta.",
          "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] } },
        { "name": "hunt", "description": "Run a Defender advanced hunting KQL query (read-only).",
          "inputSchema": { "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] } },
        { "name": "intune_report", "description": "Run an Intune reports get* action, e.g. getConfigurationPolicyNonComplianceReport, with an optional JSON body.",
          "inputSchema": { "type": "object", "properties": { "name": { "type": "string" }, "body": { "type": "object" } }, "required": ["name"] } },
        { "name": "list_review", "description": "List the objects behind an Axis review page (Entra, Purview, Defender, Intune admin).",
          "inputSchema": { "type": "object", "properties": { "kind": { "type": "string", "enum": REVIEW_KINDS } }, "required": ["kind"] } },
        { "name": "conditional_access_coverage", "description": "Enabled users each Conditional Access policy reaches, and users no enabled (MFA) policy covers.", "inputSchema": none },
    ])
}

async fn call(auth: &AuthManager, name: &str, args: &Value) -> Value {
    let result = match name {
        "sign_ins" => {
            let active = auth.session_client_id().await;
            let rows: Vec<Value> = auth
                .list_stored_sign_ins()
                .await
                .into_iter()
                .map(|saved| {
                    let selected = active.as_deref().is_some_and(|id| id.eq_ignore_ascii_case(&saved.client_id));
                    let mut row = json!(saved);
                    row["selected"] = json!(selected);
                    row
                })
                .collect();
            Ok(json!(rows))
        }
        "use_sign_in" => match args["client_id"].as_str() {
            Some(client_id) => select(auth, client_id.trim()).await,
            None => Err("Missing `client_id`.".into()),
        },
        _ => match token(auth).await {
            Ok(token) => run(&token, name, args).await,
            Err(message) => Err(message),
        },
    };
    match result {
        Ok(value) => {
            let mut text = serde_json::to_string_pretty(&value).unwrap_or_default();
            if text.len() > MAX_TEXT {
                let cut = (0..=MAX_TEXT).rev().find(|i| text.is_char_boundary(*i)).unwrap_or(0);
                text.truncate(cut);
                text.push_str("\n… truncated; narrow the request ($select, $filter, $top).");
            }
            json!({ "content": [{ "type": "text", "text": text }] })
        }
        Err(message) => json!({ "content": [{ "type": "text", "text": message }], "isError": true }),
    }
}

async fn run(token: &str, name: &str, args: &Value) -> Result<Value, String> {
    let arg = |key: &str| args[key].as_str().map(str::trim).filter(|value| !value.is_empty()).ok_or(format!("Missing `{key}`."));
    let client = GraphClient::new();
    match name {
        "whoami" => {
            let claims = decode_access_token_claims(token);
            Ok(json!({ "name": claims.name, "upn": claims.upn, "tid": claims.tid, "scp": claims.scp }))
        }
        "graph_get" => {
            let target = arg("path")?.trim_start_matches('/');
            let (version, path) = target.split_once('/').unwrap_or((target, ""));
            if version != "beta" && version != "v1.0" {
                return Err("Path must start with /beta/ or /v1.0/.".into());
            }
            client.fetch_plain::<Value>(token, &format!("/{path}"), version).await.map_err(describe)
        }
        "hunt" => client
            .post::<Value>(token, "/security/runHuntingQuery", "v1.0", &json!({ "Query": arg("query")? }))
            .await
            .map_err(describe),
        // Same guard as axis-probe: only get* report reads, never export jobs or writes.
        "intune_report" => {
            let report = arg("name")?;
            if !(report.starts_with("get") || report == "cachedReportConfigurations") || !report.chars().all(|c| c.is_ascii_alphanumeric()) {
                return Err("Only get<Name> report actions are allowed.".into());
            }
            let body = if args["body"].is_object() { args["body"].clone() } else { json!({}) };
            client.post::<Value>(token, &format!("/deviceManagement/reports/{report}"), "beta", &body).await.map_err(describe)
        }
        "list_review" => axis_sdk::fetch_review_objects(token, arg("kind")?)
            .await
            .map(|list| json!(list))
            .map_err(describe),
        "conditional_access_coverage" => axis_sdk::fetch_conditional_access_coverage(token)
            .await
            .map(|coverage| json!(coverage))
            .map_err(describe),
        other => Err(format!("Unknown tool: {other}")),
    }
}

/// The detached manager never changes the app's active sign-in. Until `use_sign_in` picks one,
/// it uses the sign-in the app used last.
async fn token(auth: &AuthManager) -> Result<String, String> {
    if !auth.is_signed_in().await {
        let saved = auth.list_stored_sign_ins().await.into_iter().next().ok_or("No stored Axis sign-in. Sign in with Axis first.")?;
        select(auth, &saved.client_id).await?;
    }
    match auth.get_session_token().await {
        Ok(Some(tokens)) => Ok(tokens.access_token),
        Ok(None) => Err("This saved sign-in needs the browser. Sign in to it once in Axis.".into()),
        Err(error) => Err(error.to_string()),
    }
}

async fn select(auth: &AuthManager, client_id: &str) -> Result<Value, String> {
    match auth.use_stored_sign_in(client_id).await.map_err(|error| error.to_string())? {
        StoredSignInOutcome::NeedsBrowser { .. } => Err("This saved sign-in needs the browser. Sign in to it once in Axis.".into()),
        outcome => Ok(json!(outcome)),
    }
}

fn describe(error: GraphError) -> String {
    match &error {
        GraphError::Request { code: Some(code), .. } => format!("{error} [code: {code}]"),
        _ => error.to_string(),
    }
}
