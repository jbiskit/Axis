//! Create / update Windows Autopilot deployment profiles.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::graph::{GraphClient, GraphError};
use crate::inventory::AutopilotProfile;

const ENTRA_ODATA: &str = "#microsoft.graph.azureADWindowsAutopilotDeploymentProfile";
const HYBRID_ODATA: &str = "#microsoft.graph.activeDirectoryWindowsAutopilotDeploymentProfile";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AutopilotJoinKind {
    Entra,
    Hybrid,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotOobeDraft {
    pub user_type: String,
    /// Deployment mode: `singleUser` (user-driven) or `shared` (self-deploying).
    pub device_usage_type: String,
    pub privacy_settings_hidden: bool,
    pub eula_hidden: bool,
    pub keyboard_selection_page_skipped: bool,
    pub escape_link_hidden: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotEspDraft {
    pub show_installation_progress: bool,
    pub block_device_use_until_required_apps_install: bool,
    pub allow_device_use_on_install_failure: bool,
    pub block_device_setup_retry_by_user: bool,
    pub allow_log_collection_on_install_failure: bool,
    pub install_progress_timeout_in_minutes: i32,
    #[serde(default)]
    pub custom_error_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAutopilotProfileInput {
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub join_kind: AutopilotJoinKind,
    #[serde(default)]
    pub device_type: Option<String>,
    #[serde(default)]
    pub device_name_template: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,
    pub oobe: AutopilotOobeDraft,
    #[serde(default)]
    pub preprovisioning_allowed: bool,
    #[serde(default)]
    pub hardware_hash_extraction_enabled: bool,
    #[serde(default)]
    pub hybrid_azure_ad_join_skip_connectivity_check: bool,
    #[serde(default)]
    pub esp: Option<AutopilotEspDraft>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAutopilotProfileInput {
    pub id: String,
    /// Live `@odata.type` — join type is immutable after create.
    pub odata_type: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub device_type: Option<String>,
    #[serde(default)]
    pub device_name_template: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,
    pub oobe: AutopilotOobeDraft,
    #[serde(default)]
    pub preprovisioning_allowed: bool,
    #[serde(default)]
    pub hardware_hash_extraction_enabled: bool,
    #[serde(default)]
    pub hybrid_azure_ad_join_skip_connectivity_check: Option<bool>,
    #[serde(default)]
    pub esp: Option<AutopilotEspDraft>,
}

fn normalize_odata_type(raw: &str) -> Result<String, GraphError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Autopilot profile @odata.type is required.".into(),
            permission_related: false,
        });
    }
    if trimmed.starts_with('#') {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("#{trimmed}"))
    }
}

fn join_odata(kind: AutopilotJoinKind) -> &'static str {
    match kind {
        AutopilotJoinKind::Entra => ENTRA_ODATA,
        AutopilotJoinKind::Hybrid => HYBRID_ODATA,
    }
}

fn is_hybrid_odata(odata: &str) -> bool {
    odata.to_ascii_lowercase().contains("activedirectory")
}

fn validate_display_name(name: &str) -> Result<&str, GraphError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Display name is required.".into(),
            permission_related: false,
        });
    }
    if trimmed.len() > 200 {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Display name must be 200 characters or fewer.".into(),
            permission_related: false,
        });
    }
    Ok(trimmed)
}

fn validate_oobe(oobe: &AutopilotOobeDraft) -> Result<(), GraphError> {
    let usage = oobe.device_usage_type.trim();
    if usage != "singleUser" && usage != "shared" {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Deployment mode must be user-driven (singleUser) or self-deploying (shared)."
                .into(),
            permission_related: false,
        });
    }
    let user = oobe.user_type.trim();
    if user != "administrator" && user != "standard" {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "User account type must be administrator or standard.".into(),
            permission_related: false,
        });
    }
    Ok(())
}

fn oobe_body(oobe: &AutopilotOobeDraft) -> Value {
    json!({
        "@odata.type": "#microsoft.graph.outOfBoxExperienceSetting",
        "userType": oobe.user_type.trim(),
        "deviceUsageType": oobe.device_usage_type.trim(),
        "privacySettingsHidden": oobe.privacy_settings_hidden,
        "eulaHidden": oobe.eula_hidden,
        "keyboardSelectionPageSkipped": oobe.keyboard_selection_page_skipped,
        "escapeLinkHidden": oobe.escape_link_hidden,
    })
}

fn esp_body(esp: &AutopilotEspDraft) -> Value {
    let timeout = esp.install_progress_timeout_in_minutes.clamp(1, 720);
    let mut body = json!({
        "@odata.type": "#microsoft.graph.windowsEnrollmentStatusScreenSettings",
        "hideInstallationProgress": !esp.show_installation_progress,
        "allowDeviceUseBeforeProfileAndAppInstallComplete":
            !esp.block_device_use_until_required_apps_install,
        "allowDeviceUseOnInstallFailure": esp.allow_device_use_on_install_failure,
        "blockDeviceSetupRetryByUser": esp.block_device_setup_retry_by_user,
        "allowLogCollectionOnInstallFailure": esp.allow_log_collection_on_install_failure,
        "installProgressTimeoutInMinutes": timeout,
    });
    if let Some(msg) = esp
        .custom_error_message
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        body["customErrorMessage"] = Value::String(msg.to_string());
    }
    body
}

fn locale_or_default(locale: Option<&str>) -> String {
    match locale {
        Some(value) => value.trim().to_string(),
        None => "os-default".into(),
    }
}

fn device_type_or_default(device_type: Option<&str>) -> String {
    let trimmed = device_type.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("windowsPc");
    trimmed.to_string()
}

pub fn create_autopilot_profile_body(input: &CreateAutopilotProfileInput) -> Result<Value, GraphError> {
    let display_name = validate_display_name(&input.display_name)?;
    validate_oobe(&input.oobe)?;
    let odata = join_odata(input.join_kind);
    let mut body = json!({
        "@odata.type": odata,
        "displayName": display_name,
        "locale": locale_or_default(input.locale.as_deref()),
        "deviceType": device_type_or_default(input.device_type.as_deref()),
        "outOfBoxExperienceSetting": oobe_body(&input.oobe),
        "preprovisioningAllowed": input.preprovisioning_allowed,
        "hardwareHashExtractionEnabled": input.hardware_hash_extraction_enabled,
    });
    if let Some(description) = input
        .description
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        if description.len() > 1500 {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: "Description must be 1500 characters or fewer.".into(),
                permission_related: false,
            });
        }
        body["description"] = Value::String(description.to_string());
    }
    if let Some(template) = input
        .device_name_template
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        body["deviceNameTemplate"] = Value::String(template.to_string());
    }
    if input.join_kind == AutopilotJoinKind::Hybrid {
        body["hybridAzureADJoinSkipConnectivityCheck"] =
            json!(input.hybrid_azure_ad_join_skip_connectivity_check);
    }
    if let Some(esp) = &input.esp {
        body["enrollmentStatusScreenSettings"] = esp_body(esp);
    }
    Ok(body)
}

pub fn update_autopilot_profile_body(input: &UpdateAutopilotProfileInput) -> Result<Value, GraphError> {
    let odata = normalize_odata_type(&input.odata_type)?;
    validate_oobe(&input.oobe)?;
    let mut body = json!({
        "@odata.type": odata,
        "outOfBoxExperienceSetting": oobe_body(&input.oobe),
        "preprovisioningAllowed": input.preprovisioning_allowed,
        "hardwareHashExtractionEnabled": input.hardware_hash_extraction_enabled,
        "locale": locale_or_default(input.locale.as_deref()),
        "deviceType": device_type_or_default(input.device_type.as_deref()),
    });
    if let Some(name) = input.display_name.as_ref() {
        body["displayName"] = Value::String(validate_display_name(name)?.to_string());
    }
    if let Some(description) = &input.description {
        let trimmed = description.trim();
        if trimmed.len() > 1500 {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: "Description must be 1500 characters or fewer.".into(),
                permission_related: false,
            });
        }
        body["description"] = Value::String(trimmed.to_string());
    }
    body["deviceNameTemplate"] = match input
        .device_name_template
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        Some(template) => Value::String(template.to_string()),
        None => Value::Null,
    };
    if is_hybrid_odata(&odata) {
        if let Some(skip) = input.hybrid_azure_ad_join_skip_connectivity_check {
            body["hybridAzureADJoinSkipConnectivityCheck"] = json!(skip);
        }
    }
    if let Some(esp) = &input.esp {
        body["enrollmentStatusScreenSettings"] = esp_body(esp);
    }
    Ok(body)
}

fn summary_from_created(created: &Value) -> Result<AutopilotProfile, GraphError> {
    let id = created
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| GraphError::Request {
            status: 500,
            code: None,
            message: "Graph did not return an Autopilot profile id.".into(),
            permission_related: false,
        })?;
    let odata_type = created
        .get("@odata.type")
        .and_then(Value::as_str)
        .map(str::to_string);
    let device_join_type = odata_type.as_deref().map(|odata| {
        if odata.to_ascii_lowercase().contains("activedirectory") {
            "hybrid".into()
        } else {
            "entra".into()
        }
    });
    Ok(AutopilotProfile {
        id: id.to_string(),
        display_name: created
            .get("displayName")
            .and_then(Value::as_str)
            .unwrap_or(id)
            .to_string(),
        description: created
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string),
        created_date_time: created
            .get("createdDateTime")
            .and_then(Value::as_str)
            .map(str::to_string),
        last_modified_date_time: created
            .get("lastModifiedDateTime")
            .and_then(Value::as_str)
            .map(str::to_string),
        device_join_type,
        odata_type,
        device_name_template: created
            .get("deviceNameTemplate")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

pub async fn create_autopilot_profile(
    access_token: &str,
    input: CreateAutopilotProfileInput,
) -> Result<AutopilotProfile, GraphError> {
    let body = create_autopilot_profile_body(&input)?;
    let created: Value = GraphClient::new()
        .post(
            access_token,
            "/deviceManagement/windowsAutopilotDeploymentProfiles",
            "beta",
            &body,
        )
        .await?;
    summary_from_created(&created)
}

pub async fn update_autopilot_profile(
    access_token: &str,
    input: UpdateAutopilotProfileInput,
) -> Result<(), GraphError> {
    let id = input.id.trim();
    if id.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Autopilot profile id is required.".into(),
            permission_related: false,
        });
    }
    let body = update_autopilot_profile_body(&input)?;
    let enc = urlencoding::encode(id);
    GraphClient::new()
        .patch_no_content(
            access_token,
            &format!("/deviceManagement/windowsAutopilotDeploymentProfiles/{enc}"),
            "beta",
            &body,
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_oobe() -> AutopilotOobeDraft {
        AutopilotOobeDraft {
            user_type: "standard".into(),
            device_usage_type: "singleUser".into(),
            privacy_settings_hidden: true,
            eula_hidden: true,
            keyboard_selection_page_skipped: true,
            escape_link_hidden: true,
        }
    }

    #[test]
    fn create_entra_body_uses_current_oobe_property() {
        let body = create_autopilot_profile_body(&CreateAutopilotProfileInput {
            display_name: "Pilot".into(),
            description: Some("Test".into()),
            join_kind: AutopilotJoinKind::Entra,
            device_type: Some("windowsPc".into()),
            device_name_template: Some("AX-%SERIAL%".into()),
            locale: Some("en-US".into()),
            oobe: sample_oobe(),
            preprovisioning_allowed: false,
            hardware_hash_extraction_enabled: true,
            hybrid_azure_ad_join_skip_connectivity_check: false,
            esp: None,
        })
        .unwrap();
        assert_eq!(body["@odata.type"], ENTRA_ODATA);
        assert_eq!(body["displayName"], "Pilot");
        assert_eq!(
            body["outOfBoxExperienceSetting"]["deviceUsageType"],
            "singleUser"
        );
        assert!(body.get("hybridAzureADJoinSkipConnectivityCheck").is_none());
        assert_eq!(body["hardwareHashExtractionEnabled"], true);
    }

    #[test]
    fn create_hybrid_includes_skip_connectivity() {
        let body = create_autopilot_profile_body(&CreateAutopilotProfileInput {
            display_name: "Hybrid".into(),
            description: None,
            join_kind: AutopilotJoinKind::Hybrid,
            device_type: None,
            device_name_template: None,
            locale: None,
            oobe: sample_oobe(),
            preprovisioning_allowed: true,
            hardware_hash_extraction_enabled: false,
            hybrid_azure_ad_join_skip_connectivity_check: true,
            esp: None,
        })
        .unwrap();
        assert_eq!(body["@odata.type"], HYBRID_ODATA);
        assert_eq!(body["hybridAzureADJoinSkipConnectivityCheck"], true);
        assert_eq!(body["locale"], "os-default");
    }

    #[test]
    fn update_body_does_not_change_odata_type_kind() {
        let body = update_autopilot_profile_body(&UpdateAutopilotProfileInput {
            id: "abc".into(),
            odata_type: HYBRID_ODATA.into(),
            display_name: Some("Renamed".into()),
            description: Some("".into()),
            device_type: Some("windowsPc".into()),
            device_name_template: None,
            locale: Some("os-default".into()),
            oobe: sample_oobe(),
            preprovisioning_allowed: false,
            hardware_hash_extraction_enabled: false,
            hybrid_azure_ad_join_skip_connectivity_check: Some(false),
            esp: None,
        })
        .unwrap();
        assert_eq!(body["@odata.type"], HYBRID_ODATA);
        assert_eq!(body["displayName"], "Renamed");
        assert_eq!(body["hybridAzureADJoinSkipConnectivityCheck"], false);
    }
}
