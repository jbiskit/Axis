use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::graph::{GraphClient, GraphCollection, GraphError};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateObjectMetadataInput {
    pub kind: String,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedObjectMetadata {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub description: Option<String>,
}

pub fn can_update_object_metadata(kind: &str) -> bool {
    !matches!(kind, "mobileApp" | "autopilotDevice") && object_path(kind, "id").is_ok()
}

pub fn can_delete_graph_object(kind: &str) -> bool {
    matches!(
        kind,
        "configurationPolicy"
            | "compliancePolicy"
            | "groupPolicyConfiguration"
            | "deviceConfiguration"
            | "enrollmentConfiguration"
            | "appProtection"
            | "mobileApp"
            | "policySet"
            | "autopilotDevice"
            | "autopilotProfile"
            | "windowsUpdate:rings"
            | "windowsUpdate:feature"
            | "windowsUpdate:quality"
            | "windowsUpdate:drivers"
            | "script:platform-powershell"
            | "script:platform-shell"
            | "script:remediation"
            | "script:compliance"
    )
}

fn object_path(kind: &str, id: &str) -> Result<String, GraphError> {
    let id = urlencoding::encode(id);
    let collection = match kind {
        "configurationPolicy" => "deviceManagement/configurationPolicies",
        "compliancePolicy" => "deviceManagement/deviceCompliancePolicies",
        "groupPolicyConfiguration" => "deviceManagement/groupPolicyConfigurations",
        "deviceConfiguration" | "windowsUpdate:rings" => "deviceManagement/deviceConfigurations",
        "enrollmentConfiguration" => "deviceManagement/deviceEnrollmentConfigurations",
        "appProtection" => "deviceAppManagement/managedAppPolicies",
        "mobileApp" => "deviceAppManagement/mobileApps",
        "policySet" => "deviceAppManagement/policySets",
        "autopilotProfile" => "deviceManagement/windowsAutopilotDeploymentProfiles",
        "autopilotDevice" => "deviceManagement/windowsAutopilotDeviceIdentities",
        "windowsUpdate:feature" => "deviceManagement/windowsFeatureUpdateProfiles",
        "windowsUpdate:quality" => "deviceManagement/windowsQualityUpdateProfiles",
        "windowsUpdate:drivers" => "deviceManagement/windowsDriverUpdateProfiles",
        "script:platform-powershell" => "deviceManagement/deviceManagementScripts",
        "script:platform-shell" => "deviceManagement/deviceShellScripts",
        "script:remediation" => "deviceManagement/deviceHealthScripts",
        "script:compliance" => "deviceManagement/deviceComplianceScripts",
        other => {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: format!("Metadata editing is not available for {other}."),
                permission_related: false,
            });
        }
    };
    Ok(format!("/{collection}/{id}"))
}

/// Updates Autopilot device identity properties (group tag, optional display name / user).
/// Graph: POST …/windowsAutopilotDeviceIdentities/{id}/updateDeviceProperties
pub async fn update_autopilot_device_properties(
    access_token: &str,
    id: &str,
    group_tag: &str,
) -> Result<(), GraphError> {
    let enc = urlencoding::encode(id);
    let path = format!(
        "/deviceManagement/windowsAutopilotDeviceIdentities/{enc}/updateDeviceProperties"
    );
    GraphClient::new()
        .post_no_content(
            access_token,
            &path,
            "beta",
            &json!({ "groupTag": group_tag }),
        )
        .await
}

/// Graph documents a 10-minute cooldown between Autopilot sync triggers (429 if earlier).
pub const AUTOPILOT_SYNC_COOLDOWN_SECS: u64 = 10 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsAutopilotSettings {
    pub id: Option<String>,
    pub last_sync_date_time: Option<String>,
    pub last_manual_sync_trigger_date_time: Option<String>,
    pub sync_status: Option<String>,
}

pub async fn fetch_windows_autopilot_settings(
    access_token: &str,
) -> Result<WindowsAutopilotSettings, GraphError> {
    GraphClient::new()
        .fetch_plain(
            access_token,
            "/deviceManagement/windowsAutopilotSettings",
            "beta",
        )
        .await
}

/// Initiates Autopilot device sync (`POST …/windowsAutopilotSettings/sync`), then re-reads settings.
/// Graph returns 409 if a sync is already in progress, 429 within the cooldown window.
pub async fn sync_windows_autopilot_devices(
    access_token: &str,
) -> Result<WindowsAutopilotSettings, GraphError> {
    GraphClient::new()
        .post_no_content(
            access_token,
            "/deviceManagement/windowsAutopilotSettings/sync",
            "beta",
            &json!({}),
        )
        .await?;
    fetch_windows_autopilot_settings(access_token).await
}

pub async fn delete_graph_object(
    access_token: &str,
    kind: &str,
    id: &str,
) -> Result<(), GraphError> {
    if !can_delete_graph_object(kind) {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: format!("Deletion is not available for {kind}."),
            permission_related: false,
        });
    }
    // Autopilot profiles cannot be deleted while group assignments remain
    // (Graph returns an opaque 400 from DeviceEnrollmentFE). Clear direct
    // assignments and policy-set membership first.
    // https://learn.microsoft.com/en-us/troubleshoot/mem/intune/device-enrollment/cannot-delete-autopilot-deployment-profile
    if kind == "autopilotProfile" {
        clear_autopilot_profile_blockers(access_token, id).await?;
    }
    if kind == "mobileApp" {
        return delete_mobile_app(access_token, id).await;
    }
    GraphClient::new()
        .delete(access_token, &object_path(kind, id)?, "beta")
        .await
}

/// Win32 apps cannot be deleted while a dependency or supersedence link remains.
/// Outgoing links are cleared first. If Intune still reports this app as a child,
/// that link is removed from the named parent and the delete is retried.
async fn delete_mobile_app(access_token: &str, app_id: &str) -> Result<(), GraphError> {
    let client = GraphClient::new();
    let path = object_path("mobileApp", app_id)?;
    clear_outgoing_app_relationships(&client, access_token, app_id).await?;
    for _ in 0..8 {
        match client.delete(access_token, &path, "beta").await {
            Ok(()) => return Ok(()),
            Err(error) => {
                let message = error.to_string();
                if let Some(parent_id) = guid_after(&message, "child of another app:") {
                    detach_app_from_parent(&client, access_token, &parent_id, app_id).await?;
                    continue;
                }
                if guid_after(&message, "parent of another app:").is_some() {
                    clear_outgoing_app_relationships(&client, access_token, app_id).await?;
                    continue;
                }
                return Err(error);
            }
        }
    }
    Err(GraphError::Request {
        status: 400,
        code: None,
        message: "App dependency or supersedence links could not be cleared before delete.".into(),
        permission_related: false,
    })
}

async fn clear_outgoing_app_relationships(
    client: &GraphClient,
    access_token: &str,
    app_id: &str,
) -> Result<(), GraphError> {
    let path = format!(
        "/deviceAppManagement/mobileApps/{}/relationships",
        urlencoding::encode(app_id)
    );
    let page: GraphCollection<Value> = match client.fetch_plain(access_token, &path, "beta").await {
        Ok(page) => page,
        Err(GraphError::Request { status: 400 | 404, .. }) => return Ok(()),
        Err(error) => return Err(error),
    };
    if page.value.is_empty() {
        return Ok(());
    }
    write_app_relationships(client, access_token, app_id, &[]).await
}

async fn detach_app_from_parent(
    client: &GraphClient,
    access_token: &str,
    parent_id: &str,
    child_id: &str,
) -> Result<(), GraphError> {
    let relationships = read_app_relationships(client, access_token, parent_id).await?;
    let kept: Vec<Value> = relationships
        .into_iter()
        .filter(|row| {
            row.get("targetId")
                .and_then(Value::as_str)
                .map(|target| !target.eq_ignore_ascii_case(child_id))
                .unwrap_or(true)
        })
        .collect();
    write_app_relationships(client, access_token, parent_id, &kept).await
}

async fn read_raw_app_relationships(
    client: &GraphClient,
    access_token: &str,
    app_id: &str,
) -> Result<Vec<Value>, GraphError> {
    let path = format!(
        "/deviceAppManagement/mobileApps/{}/relationships",
        urlencoding::encode(app_id)
    );
    let page: GraphCollection<Value> = client.fetch_plain(access_token, &path, "beta").await?;
    Ok(page.value)
}

async fn read_app_relationships(
    client: &GraphClient,
    access_token: &str,
    app_id: &str,
) -> Result<Vec<Value>, GraphError> {
    let path = format!(
        "/deviceAppManagement/mobileApps/{}/relationships",
        urlencoding::encode(app_id)
    );
    let page: GraphCollection<Value> = client.fetch_plain(access_token, &path, "beta").await?;
    Ok(page
        .value
        .iter()
        .filter_map(relationship_write_body)
        .collect())
}

async fn write_app_relationships(
    client: &GraphClient,
    access_token: &str,
    app_id: &str,
    relationships: &[Value],
) -> Result<(), GraphError> {
    client
        .post_no_content(
            access_token,
            &format!(
                "/deviceAppManagement/mobileApps/{}/updateRelationships",
                urlencoding::encode(app_id)
            ),
            "beta",
            &json!({ "relationships": relationships }),
        )
        .await
}

fn relationship_write_body(row: &Value) -> Option<Value> {
    let target = row.get("targetId").and_then(Value::as_str)?.trim();
    if target.is_empty() {
        return None;
    }
    let odata = row.get("@odata.type").and_then(Value::as_str).unwrap_or("");
    let dependency_type = row.get("dependencyType").and_then(Value::as_str);
    let supersedence_type = row.get("supersedenceType").and_then(Value::as_str);
    let lower = odata.to_ascii_lowercase();
    if lower.contains("supersedence") || supersedence_type.is_some() {
        return Some(json!({
            "@odata.type": "#microsoft.graph.mobileAppSupersedence",
            "targetId": target,
            "supersedenceType": supersedence_type.unwrap_or("update"),
        }));
    }
    if lower.contains("dependency") || dependency_type.is_some() {
        return Some(json!({
            "@odata.type": "#microsoft.graph.mobileAppDependency",
            "targetId": target,
            "dependencyType": dependency_type.unwrap_or("detect"),
        }));
    }
    None
}

fn guid_after(message: &str, marker: &str) -> Option<String> {
    let lower = message.to_ascii_lowercase();
    let marker = marker.to_ascii_lowercase();
    let start = lower.find(&marker)? + marker.len();
    let rest = message.get(start..)?.trim_start();
    let guid: String = rest
        .chars()
        .take_while(|ch| ch.is_ascii_hexdigit() || *ch == '-')
        .collect();
    if guid.len() == 36 { Some(guid) } else { None }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAppDeleteLink {
    pub source_id: String,
    pub source_name: String,
    pub target_id: String,
    pub target_name: String,
    /// `dependency` or `supersedence`.
    pub relationship: String,
    /// `autoInstall`, `detect`, `update`, or `replace`.
    pub relationship_type: String,
}

/// Dependency and supersedence links that touch the apps about to be deleted.
pub async fn mobile_app_delete_links(
    access_token: &str,
    app_ids: &[String],
) -> Result<Vec<MobileAppDeleteLink>, GraphError> {
    let selected: HashSet<String> = app_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    if selected.is_empty() {
        return Ok(Vec::new());
    }
    let client = GraphClient::new();
    let mut names = HashMap::new();
    let mut read_ids: Vec<String> = selected.iter().cloned().collect();
    let filter = urlencoding::encode(
        "(isof('microsoft.graph.win32LobApp') and not(isof('microsoft.graph.win32CatalogApp')))",
    );
    let list_path = format!("/deviceAppManagement/mobileApps?$filter={filter}&$select=id,displayName");
    if let Ok(rows) = client
        .fetch_all_pages::<Value>(access_token, &list_path, "beta", 2000)
        .await
    {
        for row in rows {
            let Some(id) = row.get("id").and_then(Value::as_str).map(str::trim) else {
                continue;
            };
            if id.is_empty() {
                continue;
            }
            let name = row
                .get("displayName")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .unwrap_or(id);
            names.insert(id.to_string(), name.to_string());
            if !read_ids.iter().any(|existing| existing.eq_ignore_ascii_case(id)) {
                read_ids.push(id.to_string());
            }
        }
    }

    let pages = match read_relationship_pages(&client, access_token, &read_ids).await {
        Ok(pages) => pages,
        Err(_) => {
            let selected_ids: Vec<String> = selected.iter().cloned().collect();
            read_relationship_pages_sequential(&client, access_token, &selected_ids).await?
        }
    };
    Ok(sort_app_links(collect_app_links(pages, &names, Some(&selected))))
}

/// Dependency and supersedence links for the apps in a tenant list.
///
/// Each id is read directly. A relationship stored on either app is enough:
/// `targetType` says whether that row's target is the parent or the dependency.
pub async fn mobile_app_relationships(
    access_token: &str,
    app_ids: &[String],
) -> Result<Vec<MobileAppDeleteLink>, GraphError> {
    let mut ids = Vec::new();
    let mut seen_ids = HashSet::new();
    for id in app_ids {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen_ids.insert(trimmed.to_ascii_lowercase()) {
            ids.push(trimmed.to_string());
        }
    }
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let client = GraphClient::new();
    let pages = match read_relationship_pages(&client, access_token, &ids).await {
        Ok(pages) => pages,
        Err(_) => read_relationship_pages_sequential(&client, access_token, &ids).await?,
    };
    Ok(sort_app_links(collect_app_links(pages, &HashMap::new(), None)))
}

fn sort_app_links(mut links: Vec<MobileAppDeleteLink>) -> Vec<MobileAppDeleteLink> {
    links.sort_by(|left, right| {
        left.source_name
            .to_ascii_lowercase()
            .cmp(&right.source_name.to_ascii_lowercase())
            .then(
                left.target_name
                    .to_ascii_lowercase()
                    .cmp(&right.target_name.to_ascii_lowercase()),
            )
    });
    links
}

fn collect_app_links(
    pages: Vec<(String, Vec<Value>)>,
    names: &HashMap<String, String>,
    selected: Option<&HashSet<String>>,
) -> Vec<MobileAppDeleteLink> {
    let mut links = Vec::new();
    let mut seen = HashSet::new();
    for (source_id, rows) in pages {
        let source_name = names
            .get(&source_id)
            .cloned()
            .unwrap_or_else(|| source_id.clone());
        for row in rows {
            let Some(link) = delete_link_from_row(&source_id, &source_name, &row, names) else {
                continue;
            };
            if let Some(selected) = selected {
                let touches = selected.iter().any(|id| {
                    id.eq_ignore_ascii_case(&link.source_id)
                        || id.eq_ignore_ascii_case(&link.target_id)
                });
                if !touches {
                    continue;
                }
            }
            let key = format!(
                "{}|{}|{}|{}",
                link.source_id.to_ascii_lowercase(),
                link.target_id.to_ascii_lowercase(),
                link.relationship,
                link.relationship_type
            );
            if seen.insert(key) {
                links.push(link);
            }
        }
    }
    links
}

async fn read_relationship_pages(
    client: &GraphClient,
    access_token: &str,
    app_ids: &[String],
) -> Result<Vec<(String, Vec<Value>)>, GraphError> {
    let mut pages = Vec::new();
    for chunk in app_ids.chunks(20) {
        pages.extend(batch_app_relationships(client, access_token, chunk).await?);
    }
    Ok(pages)
}

async fn read_relationship_pages_sequential(
    client: &GraphClient,
    access_token: &str,
    app_ids: &[String],
) -> Result<Vec<(String, Vec<Value>)>, GraphError> {
    let mut pages = Vec::new();
    for app_id in app_ids {
        match read_raw_app_relationships(client, access_token, app_id).await {
            Ok(rows) => pages.push((app_id.clone(), rows)),
            Err(GraphError::Request { status: 400 | 404, .. }) => {
                pages.push((app_id.clone(), Vec::new()));
            }
            Err(error) => return Err(error),
        }
    }
    Ok(pages)
}

async fn batch_app_relationships(
    client: &GraphClient,
    access_token: &str,
    app_ids: &[String],
) -> Result<Vec<(String, Vec<Value>)>, GraphError> {
    let requests: Vec<Value> = app_ids
        .iter()
        .enumerate()
        .map(|(index, app_id)| {
            json!({
                "id": index.to_string(),
                "method": "GET",
                "url": format!(
                    "/deviceAppManagement/mobileApps/{}/relationships",
                    urlencoding::encode(app_id)
                ),
            })
        })
        .collect();
    let response: Value = client
        .post(access_token, "/$batch", "beta", &json!({ "requests": requests }))
        .await?;
    let responses = response
        .get("responses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut pages = Vec::new();
    for app_index in 0..app_ids.len() {
        let app_id = &app_ids[app_index];
        let response = responses.iter().find(|row| {
            row.get("id")
                .and_then(Value::as_str)
                .and_then(|id| id.parse::<usize>().ok())
                == Some(app_index)
        });
        let Some(response) = response else {
            pages.push((app_id.clone(), Vec::new()));
            continue;
        };
        let status = response.get("status").and_then(Value::as_u64).unwrap_or(0);
        if status == 400 || status == 404 || !(200..300).contains(&status) {
            pages.push((app_id.clone(), Vec::new()));
            continue;
        }
        let rows = response
            .pointer("/body/value")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        pages.push((app_id.clone(), rows));
    }
    Ok(pages)
}

fn relationship_app_name(
    row: &Value,
    name_key: &str,
    id: &str,
    names: &HashMap<String, String>,
) -> String {
    row.get(name_key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
        .or_else(|| names.get(id).cloned())
        .unwrap_or_else(|| id.to_string())
}

/// `source` is the parent (the app that requires the dependency, or the app that supersedes).
/// `target` is the child (the dependency, or the superseded app).
///
/// Graph returns the same relationship from both apps. `targetType` says whether
/// `targetId` is the parent or the child, so a row read from the dependency is not
/// treated as the opposite dependency.
fn delete_link_from_row(
    queried_id: &str,
    queried_name: &str,
    row: &Value,
    names: &HashMap<String, String>,
) -> Option<MobileAppDeleteLink> {
    let target_id = row.get("targetId").and_then(Value::as_str)?.trim();
    if target_id.is_empty() {
        return None;
    }
    let odata = row.get("@odata.type").and_then(Value::as_str).unwrap_or("");
    let dependency_type = row.get("dependencyType").and_then(Value::as_str);
    let supersedence_type = row.get("supersedenceType").and_then(Value::as_str);
    let lower = odata.to_ascii_lowercase();
    let (relationship, relationship_type) = if lower.contains("supersedence") || supersedence_type.is_some()
    {
        (
            "supersedence",
            supersedence_type.unwrap_or("update"),
        )
    } else if lower.contains("dependency") || dependency_type.is_some() {
        ("dependency", dependency_type.unwrap_or("detect"))
    } else {
        return None;
    };
    let target_name = relationship_app_name(row, "targetDisplayName", target_id, names);
    let row_source_id = row
        .get("sourceId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty());
    let target_type = row
        .get("targetType")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let (parent_id, parent_name, child_id, child_name) = if target_type == "parent" {
        let parent_id = target_id.to_string();
        let parent_name = target_name;
        let (child_id, child_name) = match row_source_id {
            Some(id) if !id.eq_ignore_ascii_case(&parent_id) => (
                id.to_string(),
                relationship_app_name(row, "sourceDisplayName", id, names),
            ),
            _ => (queried_id.to_string(), queried_name.to_string()),
        };
        (parent_id, parent_name, child_id, child_name)
    } else if target_type == "child" {
        let child_id = target_id.to_string();
        let child_name = target_name;
        let (parent_id, parent_name) = match row_source_id {
            Some(id) if !id.eq_ignore_ascii_case(&child_id) => (
                id.to_string(),
                relationship_app_name(row, "sourceDisplayName", id, names),
            ),
            _ => (queried_id.to_string(), queried_name.to_string()),
        };
        (parent_id, parent_name, child_id, child_name)
    } else {
        (
            queried_id.to_string(),
            queried_name.to_string(),
            target_id.to_string(),
            target_name,
        )
    };
    if parent_id.eq_ignore_ascii_case(&child_id) {
        return None;
    }
    Some(MobileAppDeleteLink {
        source_id: parent_id,
        source_name: parent_name,
        target_id: child_id,
        target_name: child_name,
        relationship: relationship.to_string(),
        relationship_type: relationship_type.to_string(),
    })
}

async fn clear_autopilot_profile_blockers(
    access_token: &str,
    profile_id: &str,
) -> Result<(), GraphError> {
    let client = GraphClient::new();
    let enc = urlencoding::encode(profile_id);
    let assignments_path =
        format!("/deviceManagement/windowsAutopilotDeploymentProfiles/{enc}/assignments");
    let rows: Vec<Value> = client
        .fetch_all_pages(access_token, &assignments_path, "beta", 500)
        .await?;

    // Policy-set–sourced rows cannot be removed via assignment DELETE; drop the
    // profile from each policy set first (sourceId = policy set id).
    let mut policy_set_ids = Vec::new();
    for row in &rows {
        let source = row
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("direct");
        if !source.eq_ignore_ascii_case("policySets") {
            continue;
        }
        if let Some(set_id) = row
            .get("sourceId")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            if !policy_set_ids.iter().any(|existing: &String| existing == set_id) {
                policy_set_ids.push(set_id.to_string());
            }
        }
    }
    for set_id in &policy_set_ids {
        remove_profile_from_policy_set(&client, access_token, set_id, profile_id).await?;
    }

    // Re-read after policy-set cleanup; delete remaining direct assignments.
    let remaining: Vec<Value> = client
        .fetch_all_pages(access_token, &assignments_path, "beta", 500)
        .await?;

    // If policySets-sourced rows remain (missing/stale sourceId), scan every
    // policy set for this profile payload and remove matching items.
    let still_policy_set = remaining.iter().any(|row| {
        row.get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .eq_ignore_ascii_case("policySets")
    });
    if still_policy_set {
        let sets: Vec<Value> = client
            .fetch_all_pages(
                access_token,
                "/deviceAppManagement/policySets?$select=id",
                "beta",
                500,
            )
            .await?;
        for set in sets {
            let Some(set_id) = set.get("id").and_then(|v| v.as_str()).filter(|s| !s.is_empty())
            else {
                continue;
            };
            if policy_set_ids.iter().any(|known| known == set_id) {
                continue;
            }
            remove_profile_from_policy_set(&client, access_token, set_id, profile_id).await?;
        }
    }

    let remaining: Vec<Value> = if still_policy_set {
        client
            .fetch_all_pages(access_token, &assignments_path, "beta", 500)
            .await?
    } else {
        remaining
    };

    for row in remaining {
        let source = row
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("direct");
        if source.eq_ignore_ascii_case("policySets") {
            // Owned by a policy set — leave alone; item removal above should clear them.
            continue;
        }
        let Some(assignment_id) = row.get("id").and_then(|v| v.as_str()).filter(|s| !s.is_empty())
        else {
            continue;
        };
        let enc_id = urlencoding::encode(assignment_id);
        client
            .delete(
                access_token,
                &format!("{assignments_path}/{enc_id}"),
                "beta",
            )
            .await?;
    }
    Ok(())
}

async fn remove_profile_from_policy_set(
    client: &GraphClient,
    access_token: &str,
    policy_set_id: &str,
    profile_id: &str,
) -> Result<(), GraphError> {
    // /items navigation GET is broken on Intune; load via $expand instead.
    let enc_set = urlencoding::encode(policy_set_id);
    let set: Value = client
        .fetch_plain(
            access_token,
            &format!("/deviceAppManagement/policySets/{enc_set}?$expand=items"),
            "beta",
        )
        .await?;
    let items = set
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut deleted: Vec<String> = Vec::new();
    for item in items {
        let payload = item
            .get("payloadId")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !payload.eq_ignore_ascii_case(profile_id) {
            continue;
        }
        if let Some(item_id) = item.get("id").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            deleted.push(item_id.to_string());
        }
    }
    if deleted.is_empty() {
        return Ok(());
    }
    // DELETE …/items/{id} is also unavailable; use the update action.
    // Omit `assignments` so we do not wipe the set's group targets.
    client
        .post_no_content(
            access_token,
            &format!("/deviceAppManagement/policySets/{enc_set}/update"),
            "beta",
            &json!({
                "addedPolicySetItems": [],
                "updatedPolicySetItems": [],
                "deletedPolicySetItems": deleted,
            }),
        )
        .await
}

pub async fn update_object_metadata(
    access_token: &str,
    input: UpdateObjectMetadataInput,
) -> Result<UpdatedObjectMetadata, GraphError> {
    if !can_update_object_metadata(&input.kind) {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: format!("Metadata editing is not available for {}.", input.kind),
            permission_related: false,
        });
    }
    let name = input.name.trim();
    if name.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Name is required.".into(),
            permission_related: false,
        });
    }
    let description = input.description.map(|value| value.trim().to_string());
    let name_key = if input.kind == "configurationPolicy" {
        "name"
    } else {
        "displayName"
    };
    let mut body = json!({ name_key: name });
    if let Some(value) = &description {
        body.as_object_mut()
            .expect("metadata body")
            .insert("description".into(), Value::String(value.clone()));
    }
    GraphClient::new()
        .patch_no_content(
            access_token,
            &object_path(&input.kind, &input.id)?,
            "beta",
            &body,
        )
        .await?;
    Ok(UpdatedObjectMetadata {
        id: input.id,
        kind: input.kind,
        title: name.to_string(),
        description,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_metadata_kinds_exclude_apps_and_devices() {
        assert!(can_update_object_metadata("configurationPolicy"));
        assert!(can_update_object_metadata("script:remediation"));
        assert!(!can_update_object_metadata("mobileApp"));
        assert!(!can_update_object_metadata("autopilotDevice"));
    }

    #[test]
    fn deletable_kinds_include_policies_scripts_and_apps() {
        assert!(can_delete_graph_object("configurationPolicy"));
        assert!(can_delete_graph_object("compliancePolicy"));
        assert!(can_delete_graph_object("script:remediation"));
        assert!(can_delete_graph_object("autopilotDevice"));
        assert!(can_delete_graph_object("autopilotProfile"));
        assert!(can_delete_graph_object("enrollmentConfiguration"));
        assert!(can_delete_graph_object("mobileApp"));
        assert!(can_delete_graph_object("policySet"));
    }

    #[test]
    fn maps_script_and_update_paths() {
        assert_eq!(
            object_path("script:platform-shell", "a/b").unwrap(),
            "/deviceManagement/deviceShellScripts/a%2Fb"
        );
        assert_eq!(
            object_path("windowsUpdate:quality", "q").unwrap(),
            "/deviceManagement/windowsQualityUpdateProfiles/q"
        );
    }
}
