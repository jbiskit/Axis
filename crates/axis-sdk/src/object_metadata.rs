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
