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
            | "appProtection"
            | "autopilotDevice"
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
    GraphClient::new()
        .delete(access_token, &object_path(kind, id)?, "beta")
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
    fn deletable_kinds_include_policies_and_scripts_but_not_apps() {
        assert!(can_delete_graph_object("configurationPolicy"));
        assert!(can_delete_graph_object("compliancePolicy"));
        assert!(can_delete_graph_object("script:remediation"));
        assert!(can_delete_graph_object("autopilotDevice"));
        assert!(!can_delete_graph_object("mobileApp"));
        assert!(!can_delete_graph_object("autopilotProfile"));
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
