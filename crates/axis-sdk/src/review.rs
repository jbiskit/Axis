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
        _ => return None,
    })
}

pub async fn fetch_review_objects(
    access_token: &str,
    kind: &str,
) -> Result<InventoryList<Value>, GraphError> {
    let path = collection_path(kind).ok_or_else(|| GraphError::Request {
        status: 400,
        code: None,
        message: format!("Unknown review kind: {kind}"),
        permission_related: false,
    })?;
    let items: Vec<Value> = GraphClient::new()
        .fetch_all_pages(access_token, path, "beta", INVENTORY_LIST_MAX + 1)
        .await?;
    Ok(InventoryList::from_items(items))
}
