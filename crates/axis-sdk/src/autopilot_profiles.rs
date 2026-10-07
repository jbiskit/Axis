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

fn name_error(message: impl Into<String>) -> GraphError {
    GraphError::Request {
        status: 400,
        code: None,
        message: message.into(),
        permission_related: false,
    }
}

/// Intune accepts letters, numbers, spaces, and a short punctuation set.
/// A hyphen in the profile name comes back as an opaque DeviceEnrollmentFE 400.
fn autopilot_name_char_ok(ch: char) -> bool {
    ch.is_alphanumeric()
        || matches!(
            ch,
            ' ' | ':' | '"' | '?' | '.' | '@' | '$' | '&' | '_' | '[' | ']' | '{' | '}' | '|' | '\\'
        )
}

fn validate_display_name(name: &str) -> Result<&str, GraphError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(name_error("Display name is required."));
    }
    if trimmed.len() > 200 {
        return Err(name_error("Display name must be 200 characters or fewer."));
    }
    if trimmed.chars().any(|ch| !autopilot_name_char_ok(ch)) {
        return Err(name_error(
            "Autopilot profile name can use letters, numbers, spaces, and : \" ? . @ $ & _ [ ] { } | \\.",
        ));
    }
    Ok(trimmed)
}

fn validate_device_name_template(template: &str) -> Result<(), GraphError> {
    let template = template.trim();
    if template.is_empty() {
        return Ok(());
    }
    let serial = "%SERIAL%";
    let serial_count = template.matches(serial).count();
    if serial_count > 1 {
        return Err(name_error(
            "Device name template can include %SERIAL% once.",
        ));
    }
    let mut rest = template.to_string();
    let mut rand_digits = 0usize;
    if let Some(start) = template.find("%RAND:") {
        if serial_count > 0 {
            return Err(name_error(
                "Device name template can include %SERIAL% or %RAND:n%, not both.",
            ));
        }
        let after = &template[start + "%RAND:".len()..];
        let digits: String = after.chars().take_while(|ch| ch.is_ascii_digit()).collect();
        let marker = format!("%RAND:{digits}%");
        if digits.is_empty() || !template.contains(&marker) || template.matches("%RAND:").count() != 1 {
            return Err(name_error(
                "Device name template random text uses %RAND:n%, where n is the number of digits.",
            ));
        }
        rand_digits = digits.parse().unwrap_or(0);
        if !(1..=15).contains(&rand_digits) {
            return Err(name_error(
                "Device name template random length must be from 1 to 15.",
            ));
        }
        rest = template.replacen(&marker, "", 1);
    } else if serial_count == 1 {
        rest = template.replacen(serial, "", 1);
    }
    if rest.chars().any(|ch| !ch.is_ascii_alphanumeric() && ch != '-') {
        return Err(name_error(
            "Device name template can use letters, digits, hyphens, %SERIAL%, and %RAND:n%.",
        ));
    }
    let literal_len = rest.chars().count();
    let generated_len = literal_len + rand_digits;
    if generated_len > 15 || (serial_count == 0 && rand_digits == 0 && literal_len > 15) {
        return Err(name_error(
            "Device name template must generate 15 characters or fewer.",
        ));
    }
    if serial_count == 0 && rand_digits == 0 && !rest.chars().any(|ch| ch.is_ascii_alphabetic()) {
        return Err(name_error(
            "Device name template needs a letter, %SERIAL%, or %RAND:n%.",
        ));
    }
    Ok(())
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
    let usage = oobe.device_usage_type.trim();
    let mut body = json!({
        "@odata.type": "#microsoft.graph.outOfBoxExperienceSetting",
        "deviceUsageType": usage,
        "privacySettingsHidden": oobe.privacy_settings_hidden,
        "eulaHidden": oobe.eula_hidden,
        "keyboardSelectionPageSkipped": oobe.keyboard_selection_page_skipped,
        "escapeLinkHidden": oobe.escape_link_hidden,
    });
    // Self-deploying profiles reject userType with an opaque DeviceEnrollmentFE 400.
    if usage != "shared" {
        body["userType"] = Value::String(oobe.user_type.trim().to_string());
    }
    body
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

fn string_opt(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn bool_opt(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn bool_from_keys(value: &Value, keys: &[&str]) -> Option<bool> {
    for key in keys {
        if let Some(flag) = bool_opt(value, key) {
            return Some(flag);
        }
    }
    None
}

/// Map deprecated `outOfBoxExperienceSettings` (read-only) into the create/update property.
/// Always rebuilds a whitelist body — cloning Graph GET blobs keeps legacy field names and
/// causes opaque Intune DeviceEnrollmentFE 400s.
fn normalize_oobe_setting(object: &Value) -> Option<Value> {
    let source = object
        .get("outOfBoxExperienceSetting")
        .filter(|v| v.is_object())
        .or_else(|| object.get("outOfBoxExperienceSettings").filter(|v| v.is_object()))?;
    let user_type = string_opt(source, "userType").unwrap_or_else(|| "standard".into());
    let device_usage = string_opt(source, "deviceUsageType").unwrap_or_else(|| "singleUser".into());
    Some(json!({
        "@odata.type": "#microsoft.graph.outOfBoxExperienceSetting",
        "userType": user_type,
        "deviceUsageType": device_usage,
        "privacySettingsHidden": bool_from_keys(
            source,
            &["privacySettingsHidden", "hidePrivacySettings"],
        )
        .unwrap_or(false),
        "eulaHidden": bool_from_keys(source, &["eulaHidden", "hideEULA"]).unwrap_or(false),
        "keyboardSelectionPageSkipped": bool_from_keys(
            source,
            &["keyboardSelectionPageSkipped", "skipKeyboardSelectionPage"],
        )
        .unwrap_or(false),
        "escapeLinkHidden": bool_from_keys(source, &["escapeLinkHidden", "hideEscapeLink"])
            .unwrap_or(false),
    }))
}

fn normalize_create_odata_type(raw: &str) -> Result<String, GraphError> {
    let mut odata = if raw.trim().starts_with('#') {
        raw.trim().to_string()
    } else {
        format!("#{}", raw.trim())
    };
    let lower = odata.to_ascii_lowercase();
    // Abstract base type is not creatable — default to Entra join.
    if lower.ends_with("windowsautopilotdeploymentprofile")
        && !lower.contains("azuread")
        && !lower.contains("activedirectory")
    {
        odata = ENTRA_ODATA.to_string();
    }
    if !odata.to_ascii_lowercase().contains("windowsautopilotdeploymentprofile") {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: format!("Unsupported Autopilot profile @odata.type: {odata}"),
            permission_related: false,
        });
    }
    Ok(odata)
}

/// Build a Graph create body from an exported Autopilot profile object.
///
/// Matches the minimal payload Intune accepts for New profile / hydration imports:
/// whitelist OOBE fields only, no deprecated plural OOBE, no ESP on create, no
/// managementServiceAppId / foreign role scope tags.
pub fn autopilot_profile_create_body_from_export(
    object: &Value,
    display_name: &str,
    description: Option<&str>,
) -> Result<Value, GraphError> {
    let display_name = validate_display_name(display_name)?;
    let odata = object
        .get("@odata.type")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(normalize_create_odata_type)
        .transpose()?
        .unwrap_or_else(|| ENTRA_ODATA.to_string());
    let oobe = normalize_oobe_setting(object).ok_or_else(|| GraphError::Request {
        status: 400,
        code: None,
        message: "Autopilot export is missing out-of-box experience settings.".into(),
        permission_related: false,
    })?;

    let locale = string_opt(object, "locale")
        .or_else(|| string_opt(object, "language"))
        .unwrap_or_else(|| "os-default".into());
    let device_type = string_opt(object, "deviceType").unwrap_or_else(|| "windowsPc".into());
    let preprovisioning = bool_from_keys(object, &["preprovisioningAllowed", "enableWhiteGlove"])
        .unwrap_or(false);
    let hardware_hash =
        bool_opt(object, "hardwareHashExtractionEnabled")
            .or_else(|| bool_opt(object, "extractHardwareHash"))
            .unwrap_or(false);

    let mut body = json!({
        "@odata.type": odata,
        "displayName": display_name,
        "locale": locale,
        "deviceType": device_type,
        "outOfBoxExperienceSetting": oobe,
        "preprovisioningAllowed": preprovisioning,
        "hardwareHashExtractionEnabled": hardware_hash,
    });

    let desc = description
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| string_opt(object, "description"));
    if let Some(description) = desc {
        if description.len() > 1500 {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: "Description must be 1500 characters or fewer.".into(),
                permission_related: false,
            });
        }
        body["description"] = Value::String(description);
    }
    if !is_hybrid_odata(&odata) {
        if let Some(template) = string_opt(object, "deviceNameTemplate") {
            // Graph caps generated names at 15 chars; keep the template but reject obvious junk.
            if template.len() > 64 {
                return Err(GraphError::Request {
                    status: 400,
                    code: None,
                    message: "Device name template is too long for Autopilot create.".into(),
                    permission_related: false,
                });
            }
            body["deviceNameTemplate"] = Value::String(template);
        }
    }
    if is_hybrid_odata(&odata) {
        if let Some(oobe) = body.get_mut("outOfBoxExperienceSetting") {
            oobe["deviceUsageType"] = json!("singleUser");
        }
        body["hybridAzureADJoinSkipConnectivityCheck"] =
            json!(bool_opt(object, "hybridAzureADJoinSkipConnectivityCheck").unwrap_or(false));
    }
    // Skip enrollmentStatusScreenSettings on create — ESP blobs from GET often 400;
    // Axis New profile also creates without ESP unless the form opts in.
    Ok(body)
}

/// POST a profile; on opaque Intune 400, retry once with licensing-sensitive flags off.
pub async fn create_autopilot_profile_from_export(
    access_token: &str,
    object: &Value,
    display_name: &str,
    description: Option<&str>,
) -> Result<AutopilotProfile, GraphError> {
    let mut body = autopilot_profile_create_body_from_export(object, display_name, description)?;
    let client = GraphClient::new();
    match client
        .post::<Value>(
            access_token,
            "/deviceManagement/windowsAutopilotDeploymentProfiles",
            "beta",
            &body,
        )
        .await
    {
        Ok(created) => summary_from_created(&created),
        Err(error) if error.status() == Some(400) => {
            body["preprovisioningAllowed"] = json!(false);
            body["hardwareHashExtractionEnabled"] = json!(false);
            let created: Value = client
                .post(
                    access_token,
                    "/deviceManagement/windowsAutopilotDeploymentProfiles",
                    "beta",
                    &body,
                )
                .await
                .map_err(|_| error)?;
            summary_from_created(&created)
        }
        Err(error) => Err(error),
    }
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
    if input.join_kind == AutopilotJoinKind::Hybrid
        && input.oobe.device_usage_type.trim() == "shared"
    {
        return Err(name_error(
            "Self-deploying mode is available for Microsoft Entra join.",
        ));
    }
    if input.join_kind != AutopilotJoinKind::Hybrid {
        if let Some(template) = input
            .device_name_template
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            validate_device_name_template(template)?;
            body["deviceNameTemplate"] = Value::String(template.to_string());
        }
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
    if is_hybrid_odata(&odata) && input.oobe.device_usage_type.trim() == "shared" {
        return Err(name_error(
            "Self-deploying mode is available for Microsoft Entra join.",
        ));
    }
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
    if !is_hybrid_odata(&odata) {
        body["deviceNameTemplate"] = match input
            .device_name_template
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            Some(template) => {
                validate_device_name_template(template)?;
                Value::String(template.to_string())
            }
            None => Value::Null,
        };
    }
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
        .await
        .map_err(|error| annotate_autopilot_create_error(error, &body))?;
    summary_from_created(&created)
}

fn annotate_autopilot_create_error(error: GraphError, body: &Value) -> GraphError {
    match error {
        GraphError::Request {
            status: 400,
            code,
            message,
            permission_related,
        } => GraphError::Request {
            status: 400,
            code,
            permission_related,
            message: format!(
                "{message}\nPOST /deviceManagement/windowsAutopilotDeploymentProfiles\n{}",
                serde_json::to_string(body).unwrap_or_default()
            ),
        },
        other => other,
    }
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
    fn export_body_converts_legacy_oobe_settings() {
        let object = json!({
            "@odata.type": "#microsoft.graph.azureADWindowsAutopilotDeploymentProfile",
            "displayName": "PolicyForge - Import",
            "description": "from pack",
            "locale": "en-AU",
            "deviceType": "windowsPc",
            "managementServiceAppId": "should-drop",
            "outOfBoxExperienceSettings": {
                "@odata.type": "#microsoft.graph.outOfBoxExperienceSettings",
                "hidePrivacySettings": true,
                "hideEULA": true,
                "userType": "standard",
                "deviceUsageType": "singleUser",
                "skipKeyboardSelectionPage": true,
                "hideEscapeLink": true
            },
            "enableWhiteGlove": true,
            "hardwareHashExtractionEnabled": false
        });
        let body = autopilot_profile_create_body_from_export(&object, "PolicyForge - Import", None)
            .unwrap();
        assert!(body.get("outOfBoxExperienceSettings").is_none());
        assert!(body.get("managementServiceAppId").is_none());
        assert_eq!(
            body["outOfBoxExperienceSetting"]["privacySettingsHidden"],
            true
        );
        assert_eq!(body["outOfBoxExperienceSetting"]["eulaHidden"], true);
        assert_eq!(
            body["outOfBoxExperienceSetting"]["@odata.type"],
            "#microsoft.graph.outOfBoxExperienceSetting"
        );
        assert_eq!(body["preprovisioningAllowed"], true);
        assert_eq!(body["locale"], "en-AU");
        assert!(body.get("enrollmentStatusScreenSettings").is_none());
        assert!(body.get("roleScopeTagIds").is_none());
        assert!(body.get("outOfBoxExperienceSetting").unwrap().get("hidePrivacySettings").is_none());
    }

    #[test]
    fn abstract_odata_type_defaults_to_entra() {
        let object = json!({
            "@odata.type": "#microsoft.graph.windowsAutopilotDeploymentProfile",
            "outOfBoxExperienceSetting": {
                "userType": "standard",
                "deviceUsageType": "singleUser",
                "privacySettingsHidden": true,
                "eulaHidden": true,
                "keyboardSelectionPageSkipped": true,
                "escapeLinkHidden": true
            }
        });
        let body = autopilot_profile_create_body_from_export(&object, "Base", None).unwrap();
        assert_eq!(body["@odata.type"], ENTRA_ODATA);
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
