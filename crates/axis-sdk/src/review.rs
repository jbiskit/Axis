//! Read-only policy reviews outside Intune (Entra, Purview).
//!
//! Rows come back as raw Graph JSON; the UI summarises them per kind, and the
//! inspector reads one object through `fetch_graph_object_detail`.

use std::collections::HashMap;

use futures::stream::{self, StreamExt};
use serde::Deserialize;
use serde_json::Value;

use crate::graph::{GraphClient, GraphError};
use crate::inventory::{InventoryList, INVENTORY_LIST_MAX};

const NAME_LOOKUP_CONCURRENCY: usize = 8;

/// Object ids a review page wants named. Conditional Access stores role
/// *template* ids and application *app* ids, not object ids.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReviewReferences {
    pub users: Vec<String>,
    pub groups: Vec<String>,
    pub roles: Vec<String>,
    pub apps: Vec<String>,
    pub locations: Vec<String>,
}

fn is_guid(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn field(row: &Value, key: &str) -> Option<String> {
    row.get(key).and_then(Value::as_str).filter(|text| !text.is_empty()).map(str::to_string)
}

/// id → display name. Ids that can't be read (deleted, or no permission) are
/// left out and the UI shows the raw id.
pub async fn resolve_review_names(access_token: &str, refs: ReviewReferences) -> HashMap<String, String> {
    let client = GraphClient::new();
    let mut names = HashMap::new();
    let lists = [
        (!refs.roles.is_empty(), "/roleManagement/directory/roleDefinitions?$select=displayName,templateId", "templateId"),
        (!refs.locations.is_empty(), "/identity/conditionalAccess/namedLocations?$select=id,displayName", "id"),
    ];
    for (wanted, path, key) in lists {
        if !wanted {
            continue;
        }
        if let Ok(rows) = client.fetch_all_pages::<Value>(access_token, path, "beta", 5000).await {
            names.extend(rows.iter().filter_map(|row| Some((field(row, key)?, field(row, "displayName")?))));
        }
    }
    let guids = |ids: Vec<String>| ids.into_iter().filter(|id| is_guid(id));
    let lookups = guids(refs.users)
        .map(|id| { let path = format!("/users/{id}?$select=displayName,userPrincipalName"); (id, path) })
        .chain(guids(refs.groups).map(|id| { let path = format!("/groups/{id}?$select=displayName"); (id, path) }))
        .chain(guids(refs.apps).map(|id| { let path = format!("/servicePrincipals(appId='{id}')?$select=displayName"); (id, path) }));
    let resolved: Vec<Option<(String, String)>> = stream::iter(lookups)
        .map(|(id, path)| {
            let client = &client;
            async move {
                let row = client.fetch_plain::<Value>(access_token, &path, "beta").await.ok()?;
                let name = field(&row, "displayName")?;
                let name = match field(&row, "userPrincipalName") {
                    Some(upn) if upn != name => format!("{name} ({upn})"),
                    _ => name,
                };
                Some((id, name))
            }
        })
        .buffer_unordered(NAME_LOOKUP_CONCURRENCY)
        .collect()
        .await;
    names.extend(resolved.into_iter().flatten());
    names
}

/// Graph collection for each review kind. Kinds are fixed here so the UI never passes a path.
pub(crate) fn collection_path(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "conditionalAccessPolicy" => "/identity/conditionalAccess/policies",
        "namedLocation" => "/identity/conditionalAccess/namedLocations",
        // Delegated calls only see labels published to the signed-in user; the
        // org-wide /security/... list needs application permission.
        "sensitivityLabel" => "/me/security/informationProtection/sensitivityLabels",
        "retentionLabel" => "/security/labels/retentionLabels",
        "secureScoreControl" => "/security/secureScoreControlProfiles",
        "authRegistration" => "/reports/authenticationMethods/userRegistrationDetails",
        "authMethodConfig" => "/policies/authenticationMethodsPolicy/authenticationMethodConfigurations",
        "endpointSecurityPolicy" => "/deviceManagement/configurationPolicies",
        _ => return None,
    })
}

pub async fn fetch_review_objects(
    access_token: &str,
    kind: &str,
) -> Result<InventoryList<Value>, GraphError> {
    let items = match kind {
        "secureScoreControl" => secure_score_controls(access_token).await?,
        "endpointSecurityPolicy" => endpoint_security_policies(access_token).await?,
        "defenderDevice" => defender_devices(access_token).await?,
        // The configurations collection can't be listed (400), only read by id; the policy embeds them.
        "authMethodConfig" => GraphClient::new()
            .fetch_plain::<Value>(access_token, "/policies/authenticationMethodsPolicy", "beta")
            .await?["authenticationMethodConfigurations"]
            .as_array()
            .cloned()
            .unwrap_or_default(),
        _ => {
            let path = collection_path(kind).ok_or_else(|| unknown_kind(kind))?;
            GraphClient::new()
                .fetch_all_pages(access_token, path, "beta", INVENTORY_LIST_MAX + 1)
                .await?
        }
    };
    Ok(InventoryList::from_items(items))
}

fn unknown_kind(kind: &str) -> GraphError {
    GraphError::Request {
        status: 400,
        code: None,
        message: format!("Unknown review kind: {kind}"),
        permission_related: false,
    }
}

/// Review kinds whose rows have no Graph object to GET; the inspector shows the list row.
pub fn is_row_only_review_kind(kind: &str) -> bool {
    kind == "defenderDevice"
}

pub async fn fetch_review_row(access_token: &str, kind: &str, id: &str) -> Result<Value, GraphError> {
    fetch_review_objects(access_token, kind)
        .await?
        .items
        .into_iter()
        .find(|row| row["id"].as_str() == Some(id))
        .ok_or_else(|| GraphError::Request {
            status: 404,
            code: None,
            message: format!("{id} was not found."),
            permission_related: false,
        })
}

/// Control profiles with this tenant's latest score for each, under `current`.
/// Only controls in the latest `controlScores` count toward the tenant's maximum
/// (others are deprecated or for services the tenant doesn't have), so the rest are left out.
async fn secure_score_controls(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let client = GraphClient::new();
    let profiles: Vec<Value> = client
        .fetch_all_pages(access_token, "/security/secureScoreControlProfiles", "beta", 2000)
        .await?;
    let latest: Vec<Value> = client
        .fetch_plain::<crate::graph::GraphCollection<Value>>(access_token, "/security/secureScores?$top=1", "beta")
        .await?
        .value;
    let mut current: HashMap<String, Value> = latest
        .first()
        .and_then(|score| score["controlScores"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|control| Some((field(control, "controlName")?, control.clone())))
        .collect();
    Ok(profiles
        .into_iter()
        .filter_map(|mut profile| {
            let score = current.remove(&field(&profile, "id")?)?;
            profile.as_object_mut()?.insert("current".into(), score);
            Some(profile)
        })
        .collect())
}

/// Endpoint security policies (Settings Catalog families `endpointSecurity*`). Policies made in
/// the Defender portal live here too; `technologies` and `creationSource` say where they came from.
async fn endpoint_security_policies(access_token: &str) -> Result<Vec<Value>, GraphError> {
    let rows: Vec<Value> = GraphClient::new()
        .fetch_all_pages(
            access_token,
            "/deviceManagement/configurationPolicies?$select=id,name,description,platforms,technologies,creationSource,isAssigned,lastModifiedDateTime,roleScopeTagIds,templateReference",
            "beta",
            INVENTORY_LIST_MAX + 1,
        )
        .await?;
    Ok(rows
        .into_iter()
        .filter(|row| {
            row["templateReference"]["templateFamily"]
                .as_str()
                .is_some_and(|family| family.starts_with("endpointSecurity"))
        })
        .collect())
}

/// True when an enabled subscription has an enabled service plan starting with one of `prefixes`.
async fn has_service_plan(access_token: &str, prefixes: &[&str]) -> Result<bool, GraphError> {
    let skus: Vec<Value> = GraphClient::new()
        .fetch_all_pages(access_token, "/subscribedSkus?$select=capabilityStatus,servicePlans", "beta", 500)
        .await?;
    Ok(skus.iter().filter(|sku| sku["capabilityStatus"] == "Enabled").any(|sku| {
        sku["servicePlans"].as_array().into_iter().flatten().any(|plan| {
            plan["provisioningStatus"] != "Disabled"
                && plan["servicePlanName"]
                    .as_str()
                    .is_some_and(|name| prefixes.iter().any(|prefix| name.starts_with(prefix)))
        })
    }))
}

/// Latest DeviceInfo row per Defender for Endpoint device, through advanced hunting
/// (a Graph token, unlike the WindowsDefenderATP API). Hunting keeps 30 days.
async fn defender_devices(access_token: &str) -> Result<Vec<Value>, GraphError> {
    // Without Defender for Endpoint the DeviceInfo table doesn't exist and hunting answers a bare 400.
    if !has_service_plan(access_token, &["WINDEFATP", "MDE_"]).await? {
        return Err(GraphError::Request {
            status: 403,
            code: Some("NotLicensed".into()),
            message: "This tenant has no Defender for Endpoint licence (WINDEFATP or MDE service plan), so there is no device inventory to read.".into(),
            permission_related: false,
        });
    }
    const QUERY: &str = "DeviceInfo
| where Timestamp > ago(30d)
| summarize arg_max(Timestamp, *) by DeviceId
| project DeviceId, DeviceName, OSPlatform, OSVersion, OSBuild, OnboardingStatus, SensorHealthState, ExposureLevel, DeviceType, DeviceCategory, JoinType, AadDeviceId, MachineGroup, PublicIP, LoggedOnUsers, LastSeen = Timestamp
| order by DeviceName asc";
    let response: Value = GraphClient::new()
        .post(access_token, "/security/runHuntingQuery", "v1.0", &serde_json::json!({ "Query": QUERY }))
        .await?;
    Ok(response["results"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|mut row| {
            if let (Some(id), Some(object)) = (field(&row, "DeviceId"), row.as_object_mut()) {
                object.insert("id".into(), Value::String(id));
            }
            row
        })
        .take(INVENTORY_LIST_MAX + 1)
        .collect())
}
