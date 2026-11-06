//! Read-only Graph probe that reuses the Axis desktop sign-in from the credential store.
//! For checking endpoints, scopes and response shapes before building a feature.
//!
//!   axis-probe scopes
//!   axis-probe GET /beta/deviceManagement/deviceConfigurations?$top=5
//!   axis-probe HUNT "DeviceInfo | take 5"
//!
//! Only GET is allowed, plus advanced hunting (a read sent as POST).

use axis_sdk::{decode_access_token_claims, AuthManager, GraphClient};
use serde_json::{json, Value};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(command) = args.first().map(|value| value.to_ascii_uppercase()) else {
        return fail("usage: axis-probe scopes | GET /<v1.0|beta>/<path> | HUNT \"<kql>\"");
    };
    let auth = AuthManager::new();
    // Axis may be set to start signed out; resume its last stored sign-in and put that back after.
    let started_signed_out = matches!(auth.get_session_token().await, Ok(None));
    if started_signed_out {
        let Some(saved) = auth.list_stored_sign_ins().await.into_iter().next() else {
            return fail("No stored Axis sign-in. Sign in with Axis first.");
        };
        if let Err(error) = auth.use_stored_sign_in(&saved.client_id).await {
            return fail(&error.to_string());
        }
    }
    let token = auth.get_session_token().await;
    if started_signed_out {
        axis_sdk::mark_signed_out();
    }
    let token = match token {
        Ok(Some(tokens)) => tokens.access_token,
        Ok(None) => return fail("The stored Axis sign-in needs the browser. Sign in with Axis first."),
        Err(error) => return fail(&error.to_string()),
    };
    let client = GraphClient::new();
    let result = match (command.as_str(), args.get(1)) {
        ("SCOPES", _) => {
            let claims = decode_access_token_claims(&token);
            Ok(json!({ "name": claims.name, "upn": claims.upn, "tid": claims.tid, "aud": claims.aud, "scp": claims.scp }))
        }
        ("GET", Some(target)) => {
            let target = target.trim_start_matches('/');
            let (version, path) = target.split_once('/').unwrap_or((target, ""));
            if version != "beta" && version != "v1.0" {
                return fail("Path must start with /beta/ or /v1.0/.");
            }
            client.fetch_plain::<Value>(&token, &format!("/{path}"), version).await
        }
        ("HUNT", Some(query)) => {
            client
                .post::<Value>(&token, "/security/runHuntingQuery", "v1.0", &json!({ "Query": query }))
                .await
        }
        // Intune report reads are POSTs; only `get*` report actions, never export jobs or writes.
        ("REPORT", Some(name)) if name.starts_with("get") && name.chars().all(|c| c.is_ascii_alphanumeric()) => {
            let body: Value = match args.get(2).map(|raw| serde_json::from_str(raw)) {
                Some(Ok(body)) => body,
                Some(Err(error)) => return fail(&format!("Report body is not JSON: {error}")),
                None => json!({}),
            };
            client
                .post::<Value>(&token, &format!("/deviceManagement/reports/{name}"), "beta", &body)
                .await
        }
        _ => return fail("Only scopes, GET, HUNT and REPORT get<Name> are allowed."),
    };
    match result {
        Ok(value) => println!("{}", serde_json::to_string_pretty(&value).unwrap_or_default()),
        Err(error) => fail(&format!("{error} [code: {:?}]", error_code(&error))),
    }
}

fn error_code(error: &axis_sdk::GraphError) -> Option<String> {
    match error {
        axis_sdk::GraphError::Request { code, .. } => code.clone(),
        _ => None,
    }
}

fn fail(message: &str) {
    eprintln!("{message}");
    std::process::exit(1);
}
