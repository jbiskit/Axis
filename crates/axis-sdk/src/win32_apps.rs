//! Win32 LOB app metadata and detection-rule updates. Content and packaging stay separate.

use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::app_icon::large_icon_json;
use crate::graph::{GraphClient, GraphError};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWin32AppInput {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub publisher: String,
    pub display_version: String,
    pub notes: String,
    pub owner: String,
    pub install_command_line: String,
    pub uninstall_command_line: String,
    pub allowed_architectures: String,
    pub minimum_supported_windows_release: String,
    pub allow_available_uninstall: bool,
    pub run_as_account: String,
    pub device_restart_behavior: String,
    pub max_run_time_in_minutes: i32,
    pub minimum_free_disk_space_in_mb: Option<i32>,
    pub minimum_memory_in_mb: Option<i32>,
    pub minimum_number_of_processors: Option<i32>,
    pub minimum_cpu_speed_in_mhz: Option<i32>,
    #[serde(default)]
    pub detection_rules: Vec<Value>,
    /// When true, `icon_value` is written to Graph `largeIcon`.
    #[serde(default)]
    pub update_icon: bool,
    #[serde(default)]
    pub icon_value: String,
}

pub async fn update_win32_app(
    access_token: &str,
    input: UpdateWin32AppInput,
) -> Result<(), GraphError> {
    let id = input.id.trim();
    if id.is_empty() {
        return Err(bad_request("Win32 app id is required."));
    }
    let body = update_win32_app_body(&input)?;
    let enc = urlencoding::encode(id);
    GraphClient::new()
        .patch_no_content(
            access_token,
            &format!("/deviceAppManagement/mobileApps/{enc}"),
            "beta",
            &body,
        )
        .await
}

pub fn update_win32_app_body(input: &UpdateWin32AppInput) -> Result<Value, GraphError> {
    let display_name = input.display_name.trim();
    if display_name.is_empty() {
        return Err(bad_request("Display name is required."));
    }
    let publisher = input.publisher.trim();
    if publisher.is_empty() {
        return Err(bad_request("Publisher is required."));
    }
    let install = input.install_command_line.trim();
    let uninstall = input.uninstall_command_line.trim();
    if install.is_empty() || uninstall.is_empty() {
        return Err(bad_request(
            "Install and uninstall command lines are required.",
        ));
    }
    let minutes = input.max_run_time_in_minutes.clamp(1, 1440);
    let mut body = json!({
        "@odata.type": "#microsoft.graph.win32LobApp",
        "displayName": display_name,
        "description": input.description.trim(),
        "publisher": publisher,
        "displayVersion": input.display_version.trim(),
        "notes": input.notes.trim(),
        "owner": input.owner.trim(),
        "installCommandLine": install,
        "uninstallCommandLine": uninstall,
        "allowedArchitectures": normalize_architecture(&input.allowed_architectures),
        "minimumSupportedWindowsRelease": normalize_windows_release(&input.minimum_supported_windows_release),
        "allowAvailableUninstall": input.allow_available_uninstall,
        "installExperience": {
            "@odata.type": "#microsoft.graph.win32LobAppInstallExperience",
            "runAsAccount": pass_or(&input.run_as_account, "system"),
            "deviceRestartBehavior": pass_or(&input.device_restart_behavior, "allow"),
            "maxRunTimeInMinutes": minutes,
        },
    });
    let requirements = body.as_object_mut().expect("object");
    insert_optional_int(
        requirements,
        "minimumFreeDiskSpaceInMB",
        input.minimum_free_disk_space_in_mb,
    );
    insert_optional_int(requirements, "minimumMemoryInMB", input.minimum_memory_in_mb);
    insert_optional_int(
        requirements,
        "minimumNumberOfProcessors",
        input.minimum_number_of_processors,
    );
    insert_optional_int(
        requirements,
        "minimumCpuSpeedInMHz",
        input.minimum_cpu_speed_in_mhz,
    );
    requirements.insert(
        "detectionRules".into(),
        Value::Array(detection_rules_body(&input.detection_rules)?),
    );
    if input.update_icon {
        let icon = large_icon_json(&input.icon_value)
            .map_err(|error| bad_request(&error.to_string()))?;
        requirements.insert("largeIcon".into(), icon);
    }
    Ok(body)
}

fn detection_rules_body(rules: &[Value]) -> Result<Vec<Value>, GraphError> {
    if rules.is_empty() {
        return Err(bad_request("Add at least one detection rule."));
    }
    rules.iter().map(detection_rule_body).collect()
}

fn detection_rule_body(rule: &Value) -> Result<Value, GraphError> {
    let kind = rule.get("type").and_then(Value::as_str).unwrap_or("");
    match kind {
        "file" => file_rule(rule),
        "registry" => registry_rule(rule),
        "msi" => msi_rule(rule),
        "powershell" => powershell_rule(rule),
        "unknown" => unknown_rule(rule),
        _ => Err(bad_request("Detection rule type is not supported.")),
    }
}

fn file_rule(rule: &Value) -> Result<Value, GraphError> {
    let path = required_text(rule, "path", "File detection needs a path.")?;
    let name = required_text(
        rule,
        "fileOrFolderName",
        "File detection needs a file or folder name.",
    )?;
    let detection_type = text_or(rule, "detectionType", "exists");
    let mut body = Map::new();
    body.insert(
        "@odata.type".into(),
        json!("#microsoft.graph.win32LobAppFileSystemDetection"),
    );
    body.insert("path".into(), json!(path));
    body.insert("fileOrFolderName".into(), json!(name));
    body.insert("check32BitOn64System".into(), json!(flag(rule, "check32BitOn64System")));
    body.insert("detectionType".into(), json!(detection_type.clone()));
    insert_comparison(&mut body, rule, &detection_type);
    Ok(Value::Object(body))
}

fn registry_rule(rule: &Value) -> Result<Value, GraphError> {
    let key_path = required_text(rule, "keyPath", "Registry detection needs a key path.")?;
    let detection_type = text_or(rule, "detectionType", "exists");
    let mut body = Map::new();
    body.insert(
        "@odata.type".into(),
        json!("#microsoft.graph.win32LobAppRegistryDetection"),
    );
    body.insert("keyPath".into(), json!(key_path));
    body.insert("valueName".into(), json!(text_or(rule, "valueName", "")));
    body.insert("check32BitOn64System".into(), json!(flag(rule, "check32BitOn64System")));
    body.insert("detectionType".into(), json!(detection_type.clone()));
    insert_comparison(&mut body, rule, &detection_type);
    Ok(Value::Object(body))
}

fn msi_rule(rule: &Value) -> Result<Value, GraphError> {
    let product_code = required_text(rule, "productCode", "MSI detection needs a product code.")?;
    let version = text_or(rule, "productVersion", "");
    let operator = if version.is_empty() {
        "notConfigured".to_string()
    } else {
        text_or(rule, "productVersionOperator", "notConfigured")
    };
    let mut body = Map::new();
    body.insert(
        "@odata.type".into(),
        json!("#microsoft.graph.win32LobAppProductCodeDetection"),
    );
    body.insert("productCode".into(), json!(product_code));
    body.insert("productVersionOperator".into(), json!(operator));
    if !version.is_empty() {
        body.insert("productVersion".into(), json!(version));
    }
    Ok(Value::Object(body))
}

fn powershell_rule(rule: &Value) -> Result<Value, GraphError> {
    let script = required_text(
        rule,
        "scriptContent",
        "PowerShell detection needs a script.",
    )?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(script.as_bytes());
    Ok(json!({
        "@odata.type": "#microsoft.graph.win32LobAppPowerShellScriptDetection",
        "enforceSignatureCheck": flag(rule, "enforceSignatureCheck"),
        "runAs32Bit": flag(rule, "runAs32Bit"),
        "scriptContent": encoded,
    }))
}

fn unknown_rule(rule: &Value) -> Result<Value, GraphError> {
    let Some(raw) = rule.get("raw").and_then(Value::as_object) else {
        return Err(bad_request("Detection rule could not be saved."));
    };
    let mut kept = Map::new();
    for (key, value) in raw {
        if key == "id" || (key.starts_with("@odata.") && key != "@odata.type") {
            continue;
        }
        kept.insert(key.clone(), value.clone());
    }
    if !kept.contains_key("@odata.type") {
        return Err(bad_request("Detection rule could not be saved."));
    }
    Ok(Value::Object(kept))
}

fn insert_comparison(body: &mut Map<String, Value>, rule: &Value, detection_type: &str) {
    let comparable = !matches!(detection_type, "exists" | "doesNotExist" | "notConfigured" | "");
    if !comparable {
        body.insert("operator".into(), json!("notConfigured"));
        return;
    }
    body.insert(
        "operator".into(),
        json!(text_or(rule, "operator", "notConfigured")),
    );
    let value = text_or(rule, "detectionValue", "");
    if !value.is_empty() {
        body.insert("detectionValue".into(), json!(value));
    }
}

fn required_text(rule: &Value, key: &str, message: &str) -> Result<String, GraphError> {
    let value = text_or(rule, key, "");
    if value.is_empty() {
        Err(bad_request(message))
    } else {
        Ok(value)
    }
}

fn text_or(rule: &Value, key: &str, fallback: &str) -> String {
    rule.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn flag(rule: &Value, key: &str) -> bool {
    rule.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn insert_optional_int(
    body: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Option<i32>,
) {
    let next = match value {
        Some(value) if value >= 0 => json!(value),
        _ => Value::Null,
    };
    body.insert(key.to_string(), next);
}

fn normalize_architecture(raw: &str) -> String {
    let value = raw.trim();
    if value.is_empty() {
        "x64".to_string()
    } else {
        value.to_string()
    }
}

fn pass_or(raw: &str, fallback: &str) -> String {
    let value = raw.trim();
    if value.is_empty() {
        fallback.to_string()
    } else {
        value.to_string()
    }
}

/// Keep a Graph value Graph already accepted. Unknown future releases pass through.
fn normalize_windows_release(raw: &str) -> String {
    let value = raw.trim();
    if value.is_empty() {
        return "1809".to_string();
    }
    let lower = value.to_ascii_lowercase();
    if lower == "20h2" || lower == "2h20" {
        return "2H20".to_string();
    }
    value.to_string()
}

fn bad_request(message: &str) -> GraphError {
    GraphError::Request {
        status: 400,
        code: None,
        message: message.into(),
        permission_related: false,
    }
}

/// Create or content-replace body from a catalog `PackageInformation/config.json`.
/// Detection scripts must already be hydrated into `scriptContent`.
pub fn win32_lob_body_from_catalog(
    config: &Value,
    file_name: &str,
    setup_file: &str,
) -> Result<Value, GraphError> {
    let null = Value::Null;
    let application = config.get("application").unwrap_or(&null);
    let installation = config.get("installation").unwrap_or(&null);
    let display_name = json_text(application, "name");
    if display_name.is_empty() {
        return Err(bad_request("Display name is required."));
    }
    let publisher = {
        let explicit = json_text(application, "publisher");
        if explicit.is_empty() {
            json_text(application, "vendor")
        } else {
            explicit
        }
    };
    if publisher.is_empty() {
        return Err(bad_request("Publisher is required."));
    }
    let install = {
        let explicit = json_text(application, "installCommandLine");
        if explicit.is_empty() {
            json_text(installation, "installCommand")
        } else {
            explicit
        }
    };
    let uninstall = {
        let explicit = json_text(application, "uninstallCommandLine");
        if explicit.is_empty() {
            json_text(installation, "uninstallCommand")
        } else {
            explicit
        }
    };
    if install.is_empty() || uninstall.is_empty() {
        return Err(bad_request(
            "Install and uninstall command lines are required.",
        ));
    }
    let setup_file = setup_file.trim();
    if setup_file.is_empty() {
        return Err(bad_request(
            "Detection.xml has no setup file. The .intunewin package is missing SetupFile.",
        ));
    }
    let file_name = file_name.trim();
    if file_name.is_empty() {
        return Err(bad_request(".intunewin file name is required."));
    }
    let rules = config
        .pointer("/detection/rules")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let minutes = json_i32(installation, "timeout").unwrap_or(60).clamp(1, 1440);
    let display_version = {
        let explicit = json_text(application, "displayVersion");
        if explicit.is_empty() {
            json_text(application, "version")
        } else {
            explicit
        }
    };
    let mut body = json!({
        "@odata.type": "#microsoft.graph.win32LobApp",
        "displayName": display_name,
        "description": json_text(application, "description"),
        "publisher": publisher,
        "displayVersion": display_version,
        "notes": json_text(application, "notes"),
        "fileName": file_name,
        "setupFilePath": setup_file,
        "installCommandLine": install,
        "uninstallCommandLine": uninstall,
        "allowedArchitectures": normalize_architecture(&first_nonempty(&[
            json_text(application, "allowedArchitectures"),
            json_text(application, "applicableArchitectures"),
        ])),
        "minimumSupportedWindowsRelease": normalize_windows_release(&json_text(
            application,
            "minimumSupportedWindowsRelease",
        )),
        "allowAvailableUninstall": application
            .get("allowAvailableUninstall")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        "installExperience": {
            "@odata.type": "#microsoft.graph.win32LobAppInstallExperience",
            "runAsAccount": install_account(&json_text(installation, "installBehavior")),
            "deviceRestartBehavior": pass_or(&json_text(installation, "restartBehavior"), "allow"),
            "maxRunTimeInMinutes": minutes,
        },
        "returnCodes": return_codes_body(config),
        "detectionRules": detection_rules_body(&rules)?,
        "committedContentVersion": "1",
    });
    let map = body.as_object_mut().expect("object");
    let owner = json_text(application, "owner");
    if !owner.is_empty() {
        map.insert("owner".into(), json!(owner));
    }
    if let Some(requirements) = application.get("requirements").filter(|value| value.is_object()) {
        insert_requirement(map, "minimumFreeDiskSpaceInMB", requirements);
        insert_requirement(map, "minimumMemoryInMB", requirements);
        insert_requirement(map, "minimumNumberOfProcessors", requirements);
        insert_requirement(map, "minimumCpuSpeedInMHz", requirements);
    }
    Ok(body)
}

fn json_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn json_i32(value: &Value, key: &str) -> Option<i32> {
    value.get(key).and_then(Value::as_i64).and_then(|number| i32::try_from(number).ok())
}

fn first_nonempty(values: &[String]) -> String {
    values
        .iter()
        .find(|value| !value.is_empty())
        .cloned()
        .unwrap_or_default()
}

fn install_account(raw: &str) -> String {
    if raw.trim().eq_ignore_ascii_case("user") {
        "user".to_string()
    } else {
        "system".to_string()
    }
}

fn insert_requirement(body: &mut serde_json::Map<String, Value>, key: &str, requirements: &Value) {
    let Some(number) = requirements.get(key).and_then(Value::as_i64) else {
        return;
    };
    let Ok(number) = i32::try_from(number) else {
        return;
    };
    if number >= 0 {
        body.insert(key.to_string(), json!(number));
    }
}

fn return_codes_body(config: &Value) -> Value {
    let raw = config
        .get("returnCodes")
        .or_else(|| config.pointer("/application/returnCodes"))
        .and_then(Value::as_array);
    let Some(list) = raw else {
        return default_return_codes();
    };
    let mapped: Vec<Value> = list.iter().filter_map(map_return_code).collect();
    if mapped.is_empty() {
        default_return_codes()
    } else {
        Value::Array(mapped)
    }
}

fn map_return_code(value: &Value) -> Option<Value> {
    let code = value
        .get("returnCode")
        .and_then(Value::as_i64)
        .or_else(|| value.get("code").and_then(Value::as_i64))?;
    let code = i32::try_from(code).ok()?;
    let raw_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("success");
    Some(json!({
        "@odata.type": "#microsoft.graph.win32LobAppReturnCode",
        "returnCode": code,
        "type": map_return_type(raw_type),
    }))
}

fn map_return_type(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "success" => "success".to_string(),
        "softreboot" | "soft_reboot" => "softReboot".to_string(),
        "hardreboot" | "hard_reboot" | "reboot" => "hardReboot".to_string(),
        "retry" => "retry".to_string(),
        "failed" | "fail" => "failed".to_string(),
        _ => raw.trim().to_string(),
    }
}

fn default_return_codes() -> Value {
    json!([
        { "@odata.type": "#microsoft.graph.win32LobAppReturnCode", "returnCode": 0, "type": "success" },
        { "@odata.type": "#microsoft.graph.win32LobAppReturnCode", "returnCode": 1707, "type": "success" },
        { "@odata.type": "#microsoft.graph.win32LobAppReturnCode", "returnCode": 3010, "type": "softReboot" },
        { "@odata.type": "#microsoft.graph.win32LobAppReturnCode", "returnCode": 1641, "type": "hardReboot" },
        { "@odata.type": "#microsoft.graph.win32LobAppReturnCode", "returnCode": 1618, "type": "retry" }
    ])
}
