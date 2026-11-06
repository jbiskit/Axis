//! Read-only Defender for Office 365 / EOP policy reviews through the Exchange
//! Online admin API (`adminapi/beta/{tenant}/InvokeCommand`), the endpoint
//! Exchange PowerShell v3 and the Defender portal use. Not part of Graph.
//!
//! Purview (`purview:` kinds) uses the same InvokeCommand shape on the Security &
//! Compliance PowerShell host, with its own token.
//!
//! The UI only passes a review kind. Cmdlets are fixed here and must be `Get-`.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::auth::decode_access_token_claims;
use crate::graph::GraphError;
use crate::inventory::InventoryList;

const ADMIN_API_BASE: &str = "https://outlook.office365.com/adminapi/beta";
/// Security & Compliance PowerShell REST host. It usually redirects to a regional host.
const COMPLIANCE_API_BASE: &str = "https://ps.compliance.protection.outlook.com/adminapi/beta";
const MAX_PAGES: usize = 20;
const MAX_REDIRECTS: usize = 5;

/// A policy cmdlet, and the rule cmdlet that scopes it (`rule_link` is the rule
/// property naming its policy). Default policies have no rule and apply to everyone.
struct ReviewSpec {
    policy: &'static str,
    rule: Option<(&'static str, &'static str)>,
}

fn spec_for(kind: &str) -> Option<ReviewSpec> {
    let (policy, rule) = match kind {
        "mdo:antiPhish" => ("Get-AntiPhishPolicy", Some(("Get-AntiPhishRule", "AntiPhishPolicy"))),
        "mdo:antiSpam" => (
            "Get-HostedContentFilterPolicy",
            Some(("Get-HostedContentFilterRule", "HostedContentFilterPolicy")),
        ),
        "mdo:outboundSpam" => (
            "Get-HostedOutboundSpamFilterPolicy",
            Some(("Get-HostedOutboundSpamFilterRule", "HostedOutboundSpamFilterPolicy")),
        ),
        "mdo:antiMalware" => ("Get-MalwareFilterPolicy", Some(("Get-MalwareFilterRule", "MalwareFilterPolicy"))),
        "mdo:safeLinks" => ("Get-SafeLinksPolicy", Some(("Get-SafeLinksRule", "SafeLinksPolicy"))),
        "mdo:safeAttachments" => (
            "Get-SafeAttachmentPolicy",
            Some(("Get-SafeAttachmentRule", "SafeAttachmentPolicy")),
        ),
        "mdo:atpGlobal" => ("Get-AtpPolicyForO365", None),
        "mdo:quarantine" => ("Get-QuarantinePolicy", None),
        "mdo:dkim" => ("Get-DkimSigningConfig", None),
        _ => return None,
    };
    Some(ReviewSpec { policy, rule })
}

pub fn is_exchange_review_kind(kind: &str) -> bool {
    kind.starts_with("mdo:")
}

/// Purview kinds read from Security & Compliance PowerShell; they need `get_compliance_token`.
pub fn is_compliance_review_kind(kind: &str) -> bool {
    kind.starts_with("purview:")
}

/// Security & Compliance redirects to its regional host on :446, which times out from
/// client networks; the same host answers on 443.
fn without_port_446(location: &str) -> String {
    match reqwest::Url::parse(location) {
        Ok(mut parsed) if parsed.port() == Some(446) => {
            let _ = parsed.set_port(None);
            parsed.to_string()
        }
        _ => location.to_string(),
    }
}

/// reqwest's top-level message ("error sending request") hides the cause; include every source.
fn error_chain(error: &dyn std::error::Error) -> String {
    let mut parts = vec![error.to_string()];
    let mut source = error.source();
    while let Some(cause) = source {
        parts.push(cause.to_string());
        source = cause.source();
    }
    parts.join(": ")
}

/// Redirects are only followed to Microsoft's own admin hosts, so the bearer token never leaves them.
fn trusted_admin_host(url: &str) -> bool {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_ascii_lowercase))
        .is_some_and(|host| host.ends_with(".protection.outlook.com") || host == "outlook.office365.com")
}

fn request_error(status: u16, message: impl Into<String>) -> GraphError {
    GraphError::Request {
        status,
        code: None,
        message: message.into(),
        permission_related: status == 401 || status == 403,
    }
}

/// Runs one allowlisted `Get-` cmdlet against `base` and returns every row across pages.
async fn invoke_get(
    base: &str,
    access_token: &str,
    tenant_id: &str,
    cmdlet: &str,
    parameters: Value,
) -> Result<Vec<Value>, GraphError> {
    if !cmdlet.starts_with("Get-") {
        return Err(request_error(400, format!("{cmdlet} is not a read cmdlet.")));
    }
    // reqwest drops Authorization on cross-host redirects; follow them here instead.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("Axis/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .build()?;
    let mut url = format!("{base}/{}/InvokeCommand", urlencoding::encode(tenant_id));
    let mut hops: Vec<String> = Vec::new();
    let body = json!({ "CmdletInput": { "CmdletName": cmdlet, "Parameters": parameters } });
    let anchor = decode_access_token_claims(access_token)
        .upn
        .map(|upn| format!("UPN:{upn}"));
    let mut rows = Vec::new();
    for _ in 0..MAX_PAGES {
        let mut request = client
            .post(&url)
            .bearer_auth(access_token)
            .header("Prefer", "odata.maxpagesize=1000")
            .json(&body);
        if let Some(anchor) = &anchor {
            request = request.header("X-AnchorMailbox", anchor);
        }
        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                let status = if error.is_timeout() { 504 } else { 502 };
                return Err(request_error(
                    status,
                    format!(
                        "{cmdlet}: {} [POST {url}; hops: {}]",
                        error_chain(&error),
                        if hops.is_empty() { "none".to_string() } else { hops.join(", ") },
                    ),
                ));
            }
        };
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string)
                .unwrap_or_default();
            hops.push(format!("{} -> {location}", status.as_u16()));
            if hops.len() > MAX_REDIRECTS || !trusted_admin_host(&location) {
                return Err(request_error(
                    status.as_u16(),
                    format!("{cmdlet}: redirect not followed [POST {url}; hops: {}]", hops.join(", ")),
                ));
            }
            url = without_port_446(&location);
            continue;
        }
        let challenge = response
            .headers()
            .get(reqwest::header::WWW_AUTHENTICATE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let text = response.text().await?;
        if !status.is_success() {
            let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            let mut message = parsed["error"]["message"]
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| text.chars().take(400).collect());
            let claims = decode_access_token_claims(access_token);
            // Request path, hops and token contents, so a refusal can be diagnosed from the message.
            message = format!(
                "{message} [POST {url}; hops: {}; token aud: {}; scp: {}; anchor: {}; WWW-Authenticate: {}]",
                if hops.is_empty() { "none".to_string() } else { hops.join(", ") },
                claims.aud.as_deref().unwrap_or("none"),
                claims.scp.as_deref().unwrap_or("none"),
                anchor.as_deref().unwrap_or("none"),
                challenge.as_deref().unwrap_or("none"),
            );
            return Err(request_error(status.as_u16(), format!("{cmdlet}: {message}")));
        }
        let page: Value = serde_json::from_str(&text)?;
        if let Some(values) = page["value"].as_array() {
            rows.extend(values.iter().map(clean));
        }
        match page["@odata.nextLink"].as_str() {
            Some(next) => url = next.to_string(),
            None => break,
        }
    }
    Ok(rows)
}

/// Drops OData type annotations and Exchange directory plumbing the review never shows.
fn clean(row: &Value) -> Value {
    const NOISE: &[&str] = &[
        "DistinguishedName",
        "ObjectCategory",
        "ObjectClass",
        "OrganizationId",
        "OrganizationalUnitRoot",
        "OriginatingServer",
        "ExchangeVersion",
        "DirectoryObjectVersion",
        "IsValid",
        "ObjectState",
    ];
    let Some(object) = row.as_object() else {
        return row.clone();
    };
    let kept: Map<String, Value> = object
        .iter()
        .filter(|(key, _)| !key.contains("@data.type") && !key.contains("@odata.type") && !NOISE.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    Value::Object(kept)
}

fn text(row: &Value, key: &str) -> Option<String> {
    row.get(key).and_then(Value::as_str).filter(|value| !value.is_empty()).map(str::to_string)
}

/// Stable row id for the review list and inspector.
fn with_id(mut row: Value) -> Value {
    let id = text(&row, "Guid")
        .or_else(|| text(&row, "ExchangeObjectId"))
        .or_else(|| text(&row, "Identity"))
        .or_else(|| text(&row, "Name"));
    if let (Some(id), Some(object)) = (id, row.as_object_mut()) {
        object.insert("id".into(), Value::String(id));
    }
    row
}

pub async fn fetch_exchange_review_objects(
    access_token: &str,
    tenant_id: &str,
    kind: &str,
) -> Result<InventoryList<Value>, GraphError> {
    let rows = match kind {
        "purview:label" => sensitivity_labels(access_token, tenant_id).await?,
        "mdo:presetPolicies" => preset_rules(access_token, tenant_id).await?,
        "mdo:allowBlock" => allow_block_items(access_token, tenant_id).await?,
        _ => {
            let spec = spec_for(kind).ok_or_else(|| request_error(400, format!("Unknown review kind: {kind}")))?;
            let policies = invoke_get(ADMIN_API_BASE, access_token, tenant_id, spec.policy, json!({})).await?;
            match spec.rule {
                Some((rule_cmdlet, link)) => {
                    let rules = invoke_get(ADMIN_API_BASE, access_token, tenant_id, rule_cmdlet, json!({})).await?;
                    join_rules(policies, rules, link)
                }
                None => policies,
            }
        }
    };
    Ok(InventoryList::from_items(rows.into_iter().map(with_id).collect()))
}

/// Puts each policy's rule under `rule` (who it applies to, priority, on/off).
fn join_rules(policies: Vec<Value>, rules: Vec<Value>, link: &str) -> Vec<Value> {
    let mut by_policy: HashMap<String, Value> = HashMap::new();
    for rule in rules {
        if let Some(name) = text(&rule, link) {
            by_policy.insert(name.to_lowercase(), rule);
        }
    }
    policies
        .into_iter()
        .map(|mut policy| {
            let name = text(&policy, "Name").or_else(|| text(&policy, "Identity")).unwrap_or_default();
            if let (Some(rule), Some(object)) = (by_policy.remove(&name.to_lowercase()), policy.as_object_mut()) {
                object.insert("rule".into(), rule);
            }
            policy
        })
        .collect()
}

/// Standard / Strict preset policies are rules only; EOP and Defender halves are separate cmdlets.
async fn preset_rules(access_token: &str, tenant_id: &str) -> Result<Vec<Value>, GraphError> {
    let mut rows = Vec::new();
    for (cmdlet, layer) in [
        ("Get-EOPProtectionPolicyRule", "Exchange Online Protection"),
        ("Get-ATPProtectionPolicyRule", "Defender for Office 365"),
    ] {
        for mut row in invoke_get(ADMIN_API_BASE, access_token, tenant_id, cmdlet, json!({})).await? {
            if let Some(object) = row.as_object_mut() {
                object.insert("ProtectionLayer".into(), Value::String(layer.into()));
            }
            rows.push(row);
        }
    }
    Ok(rows)
}

/// Tenant Allow/Block List: one call per list type; the cmdlet requires `-ListType`.
async fn allow_block_items(access_token: &str, tenant_id: &str) -> Result<Vec<Value>, GraphError> {
    let mut rows = Vec::new();
    for list_type in ["Sender", "Url", "FileHash"] {
        for mut row in invoke_get(
            ADMIN_API_BASE,
            access_token,
            tenant_id,
            "Get-TenantAllowBlockListItems",
            json!({ "ListType": list_type }),
        )
        .await?
        {
            if let Some(object) = row.as_object_mut() {
                object.insert("ListType".into(), Value::String(list_type.into()));
            }
            rows.push(row);
        }
    }
    Ok(rows)
}

/// One row for the inspector, from the same joined list the review page shows.
pub async fn fetch_exchange_review_object(
    access_token: &str,
    tenant_id: &str,
    kind: &str,
    id: &str,
) -> Result<Value, GraphError> {
    fetch_exchange_review_objects(access_token, tenant_id, kind)
        .await?
        .items
        .into_iter()
        .find(|row| row["id"].as_str() == Some(id))
        .ok_or_else(|| request_error(404, format!("{id} was not found.")))
}

/// Every sensitivity label in the tenant (Get-Label), including parent label groups.
/// `LabelActions` arrive as JSON strings and `Settings` as Key/Value lists; both are unpacked.
async fn sensitivity_labels(access_token: &str, tenant_id: &str) -> Result<Vec<Value>, GraphError> {
    let rows = invoke_get(COMPLIANCE_API_BASE, access_token, tenant_id, "Get-Label", json!({})).await?;
    Ok(rows.into_iter().map(unpack_label).collect())
}

fn key_values(list: &Value) -> Value {
    let map: Map<String, Value> = list
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| Some((text(entry, "Key")?, entry.get("Value").cloned().unwrap_or(Value::Null))))
        .collect();
    Value::Object(map)
}

fn unpack_label(mut row: Value) -> Value {
    let Some(object) = row.as_object_mut() else {
        return row;
    };
    if let Some(settings) = object.get("Settings").map(key_values) {
        object.insert("Settings".into(), settings);
    }
    if let Some(actions) = object.get("LabelActions").and_then(Value::as_array).cloned() {
        let parsed: Vec<Value> = actions
            .iter()
            .map(|action| {
                let mut action = action
                    .as_str()
                    .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                    .unwrap_or_else(|| action.clone());
                if let Some(settings) = action.get("Settings").map(key_values) {
                    action["Settings"] = settings;
                }
                action
            })
            .collect();
        object.insert("LabelActions".into(), Value::Array(parsed));
    }
    row
}
