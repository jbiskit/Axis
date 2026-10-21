//! Read-only Defender for Office 365 / EOP policy reviews through the Exchange
//! Online admin API (`adminapi/beta/{tenant}/InvokeCommand`), the endpoint
//! Exchange PowerShell v3 and the Defender portal use. Not part of Graph.
//!
//! The UI only passes a review kind. Cmdlets are fixed here and must be `Get-`.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::auth::decode_access_token_claims;
use crate::graph::GraphError;
use crate::inventory::InventoryList;

const ADMIN_API_BASE: &str = "https://outlook.office365.com/adminapi/beta";
const MAX_PAGES: usize = 20;

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

fn request_error(status: u16, message: impl Into<String>) -> GraphError {
    GraphError::Request {
        status,
        code: None,
        message: message.into(),
        permission_related: status == 401 || status == 403,
    }
}

/// Runs one allowlisted `Get-` cmdlet and returns every row across pages.
async fn invoke_get(
    access_token: &str,
    tenant_id: &str,
    cmdlet: &str,
    parameters: Value,
) -> Result<Vec<Value>, GraphError> {
    if !cmdlet.starts_with("Get-") {
        return Err(request_error(400, format!("{cmdlet} is not a read cmdlet.")));
    }
    let client = reqwest::Client::new();
    let mut url = format!("{ADMIN_API_BASE}/{}/InvokeCommand", urlencoding::encode(tenant_id));
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
        let response = request.send().await?;
        let status = response.status();
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
            if status.as_u16() == 401 {
                // An empty 401 means the token itself was refused; show what it carried.
                let claims = decode_access_token_claims(access_token);
                message = format!(
                    "{message} [POST {url}; token aud: {}; scp: {}; anchor: {}; WWW-Authenticate: {}]",
                    claims.aud.as_deref().unwrap_or("none"),
                    claims.scp.as_deref().unwrap_or("none"),
                    anchor.as_deref().unwrap_or("none"),
                    challenge.as_deref().unwrap_or("none"),
                );
            }
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
        "mdo:presetPolicies" => preset_rules(access_token, tenant_id).await?,
        "mdo:allowBlock" => allow_block_items(access_token, tenant_id).await?,
        _ => {
            let spec = spec_for(kind).ok_or_else(|| request_error(400, format!("Unknown review kind: {kind}")))?;
            let policies = invoke_get(access_token, tenant_id, spec.policy, json!({})).await?;
            match spec.rule {
                Some((rule_cmdlet, link)) => {
                    let rules = invoke_get(access_token, tenant_id, rule_cmdlet, json!({})).await?;
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
        for mut row in invoke_get(access_token, tenant_id, cmdlet, json!({})).await? {
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
