use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::graph::{GraphClient, GraphError};

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
    GraphClient::new()
        .delete(access_token, &object_path(kind, id)?, "beta")
        .await
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
