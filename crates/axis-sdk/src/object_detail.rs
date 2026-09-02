use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::graph::{GraphClient, GraphError};

const ASSIGNMENTS_MAX: usize = 200;
const SETTINGS_MAX: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphObjectDetail {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub object: Value,
    pub assignments: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub script_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detection_script_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation_script_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extras: Option<Value>,
    pub warnings: Vec<String>,
}

struct KindSpec {
    object_path: String,
    assignments_path: Option<String>,
    settings_path: Option<String>,
    extra_paths: Vec<(&'static str, String)>,
    decode_scripts: bool,
}

fn encode_id(id: &str) -> String {
    urlencoding::encode(id).into_owned()
}

fn unknown_kind(kind: &str) -> GraphError {
    GraphError::Request {
        status: 400,
        code: None,
        message: format!("Unknown object kind: {kind}"),
        permission_related: false,
    }
}

fn spec_for(kind: &str, id: &str) -> Result<KindSpec, GraphError> {
    let enc = encode_id(id);
    Ok(match kind {
        "configurationPolicy" => KindSpec {
            object_path: format!("/deviceManagement/configurationPolicies/{enc}"),
            assignments_path: Some(format!(
                "/deviceManagement/configurationPolicies/{enc}/assignments"
            )),
            settings_path: Some(format!(
                "/deviceManagement/configurationPolicies/{enc}/settings?$expand=settingDefinitions&$top=1000"
            )),
            extra_paths: vec![],
            decode_scripts: false,
        },
        "compliancePolicy" => KindSpec {
            object_path: format!("/deviceManagement/deviceCompliancePolicies/{enc}"),
            assignments_path: Some(format!(
                "/deviceManagement/deviceCompliancePolicies/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: false,
        },
        "groupPolicyConfiguration" => KindSpec {
            object_path: format!("/deviceManagement/groupPolicyConfigurations/{enc}"),
            assignments_path: Some(format!(
                "/deviceManagement/groupPolicyConfigurations/{enc}/assignments"
            )),
            settings_path: Some(format!(
                "/deviceManagement/groupPolicyConfigurations/{enc}/definitionValues?$expand=definition,presentationValues"
            )),
            extra_paths: vec![],
            decode_scripts: false,
        },
        "deviceConfiguration" => KindSpec {
            object_path: format!("/deviceManagement/deviceConfigurations/{enc}"),
            assignments_path: Some(format!(
                "/deviceManagement/deviceConfigurations/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: false,
        },
        "enrollmentConfiguration" => KindSpec {
            object_path: format!("/deviceManagement/deviceEnrollmentConfigurations/{enc}"),
            assignments_path: Some(format!(
                "/deviceManagement/deviceEnrollmentConfigurations/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: false,
        },
        "appProtection" => KindSpec {
            object_path: format!("/deviceAppManagement/managedAppPolicies/{enc}"),
            assignments_path: Some(format!(
                "/deviceAppManagement/managedAppPolicies/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: false,
        },
        "mobileApp" => KindSpec {
            object_path: format!("/deviceAppManagement/mobileApps/{enc}"),
            assignments_path: Some(format!(
                "/deviceAppManagement/mobileApps/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![(
                "installSummary",
                format!("/deviceAppManagement/mobileApps/{enc}/installSummary"),
            )],
            decode_scripts: false,
        },
        "script:platform-powershell" => KindSpec {
            object_path: format!(
                "/deviceManagement/deviceManagementScripts/{enc}?$expand=assignments"
            ),
            assignments_path: Some(format!(
                "/deviceManagement/deviceManagementScripts/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: true,
        },
        "script:platform-shell" => KindSpec {
            object_path: format!(
                "/deviceManagement/deviceShellScripts/{enc}?$expand=assignments"
            ),
            assignments_path: Some(format!(
                "/deviceManagement/deviceShellScripts/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: true,
        },
        "script:remediation" => KindSpec {
            object_path: format!(
                "/deviceManagement/deviceHealthScripts/{enc}?$expand=assignments"
            ),
            assignments_path: Some(format!(
                "/deviceManagement/deviceHealthScripts/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: true,
        },
        "script:compliance" => KindSpec {
            object_path: format!(
                "/deviceManagement/deviceComplianceScripts/{enc}?$expand=assignments"
            ),
            assignments_path: Some(format!(
                "/deviceManagement/deviceComplianceScripts/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: true,
        },
        "autopilotDevice" => KindSpec {
            object_path: format!("/deviceManagement/windowsAutopilotDeviceIdentities/{enc}"),
            assignments_path: None,
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: false,
        },
        "autopilotProfile" => KindSpec {
            object_path: format!("/deviceManagement/windowsAutopilotDeploymentProfiles/{enc}"),
            assignments_path: Some(format!(
                "/deviceManagement/windowsAutopilotDeploymentProfiles/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: false,
        },
        "windowsUpdate:rings" => KindSpec {
            object_path: format!("/deviceManagement/deviceConfigurations/{enc}"),
            assignments_path: Some(format!(
                "/deviceManagement/deviceConfigurations/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: false,
        },
        "windowsUpdate:feature" => KindSpec {
            object_path: format!("/deviceManagement/windowsFeatureUpdateProfiles/{enc}"),
            assignments_path: Some(format!(
                "/deviceManagement/windowsFeatureUpdateProfiles/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: false,
        },
        "windowsUpdate:quality" => KindSpec {
            object_path: format!("/deviceManagement/windowsQualityUpdateProfiles/{enc}"),
            assignments_path: Some(format!(
                "/deviceManagement/windowsQualityUpdateProfiles/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: false,
        },
        "windowsUpdate:drivers" => KindSpec {
            object_path: format!("/deviceManagement/windowsDriverUpdateProfiles/{enc}"),
            assignments_path: Some(format!(
                "/deviceManagement/windowsDriverUpdateProfiles/{enc}/assignments"
            )),
            settings_path: None,
            extra_paths: vec![],
            decode_scripts: false,
        },
        other => return Err(unknown_kind(other)),
    })
}

fn title_from(value: &Value) -> String {
    value
        .get("displayName")
        .and_then(Value::as_str)
        .or_else(|| value.get("name").and_then(Value::as_str))
        .or_else(|| value.get("serialNumber").and_then(Value::as_str))
        .or_else(|| value.get("id").and_then(Value::as_str))
        .unwrap_or("Untitled")
        .to_string()
}

fn decode_b64(value: Option<&str>) -> Option<String> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw)
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(raw))
        .ok()?;
    match String::from_utf8(bytes) {
        Ok(text) => Some(text),
        Err(error) => Some(String::from_utf8_lossy(error.as_bytes()).into_owned()),
    }
}

fn take_embedded_assignments(object: &Value) -> Vec<Value> {
    object
        .get("assignments")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn normalize_extra(value: Value) -> Value {
    if let Some(rows) = value.get("value").and_then(Value::as_array) {
        return Value::Array(rows.clone());
    }
    value
}

/// Graph documents GET …/scheduledActionsForRule, but Intune returns 400
/// ("No OData route exists"). Actions only come back via $expand on the policy.
const COMPLIANCE_SCHEDULED_ACTIONS_EXPAND: &str =
    "$expand=scheduledActionsForRule($expand=scheduledActionConfigurations)";

fn take_scheduled_actions(object: &mut Value) -> Option<Value> {
    object
        .as_object_mut()?
        .remove("scheduledActionsForRule")
        .map(normalize_extra)
}

pub async fn fetch_graph_object_detail(
    access_token: &str,
    kind: &str,
    id: &str,
) -> Result<GraphObjectDetail, GraphError> {
    let spec = spec_for(kind, id)?;
    let client = GraphClient::new();
    let object_path = if kind == "compliancePolicy" {
        format!("{}?{COMPLIANCE_SCHEDULED_ACTIONS_EXPAND}", spec.object_path)
    } else {
        spec.object_path.clone()
    };
    let mut object: Value = match client.fetch_plain(access_token, &object_path, "beta").await {
        Ok(value) => value,
        Err(_) if kind == "compliancePolicy" => {
            client
                .fetch_plain(access_token, &spec.object_path, "beta")
                .await?
        }
        Err(error) => return Err(error),
    };
    let mut warnings = Vec::new();

    let mut assignments = Vec::new();
    if let Some(path) = &spec.assignments_path {
        match client
            .fetch_all_pages::<Value>(access_token, path, "beta", ASSIGNMENTS_MAX)
            .await
        {
            Ok(rows) => assignments = rows,
            Err(error) => {
                let embedded = take_embedded_assignments(&object);
                if embedded.is_empty() {
                    warnings.push(format!("Assignments: {error}"));
                } else {
                    assignments = embedded;
                }
            }
        }
    }

    let mut settings = None;
    if let Some(path) = &spec.settings_path {
        match client
            .fetch_all_pages::<Value>(access_token, path, "beta", SETTINGS_MAX)
            .await
        {
            Ok(rows) => settings = Some(rows),
            Err(error) => warnings.push(format!("Settings: {error}")),
        }
    }

    let mut extras = serde_json::Map::new();
    if let Some(actions) = take_scheduled_actions(&mut object) {
        extras.insert("scheduledActions".into(), actions);
    }
    for (name, path) in spec.extra_paths {
        match client
            .fetch_plain::<Value>(access_token, &path, "beta")
            .await
        {
            Ok(value) => {
                extras.insert(name.to_string(), normalize_extra(value));
            }
            Err(_) => match client
                .fetch_all_pages::<Value>(access_token, &path, "beta", ASSIGNMENTS_MAX)
                .await
            {
                Ok(rows) => {
                    extras.insert(name.to_string(), Value::Array(rows));
                }
                Err(error) => warnings.push(format!("{name}: {error}")),
            },
        }
    }

    let (script_text, detection_script_text, remediation_script_text) = if spec.decode_scripts {
        let script_text = decode_b64(object.get("scriptContent").and_then(Value::as_str));
        let detection_script_text =
            decode_b64(object.get("detectionScriptContent").and_then(Value::as_str));
        let remediation_script_text = decode_b64(
            object
                .get("remediationScriptContent")
                .and_then(Value::as_str),
        );
        if let Some(map) = object.as_object_mut() {
            map.remove("scriptContent");
            map.remove("detectionScriptContent");
            map.remove("remediationScriptContent");
        }
        (script_text, detection_script_text, remediation_script_text)
    } else {
        (None, None, None)
    };

    if let Some(map) = object.as_object_mut() {
        map.remove("assignments");
    }

    Ok(GraphObjectDetail {
        id: object
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or(id)
            .to_string(),
        kind: kind.to_string(),
        title: title_from(&object),
        object,
        assignments,
        settings,
        script_text,
        detection_script_text,
        remediation_script_text,
        extras: if extras.is_empty() {
            None
        } else {
            Some(json!(extras))
        },
        warnings,
    })
}

fn encode_b64(text: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(text.as_bytes())
}

#[derive(Clone, Copy)]
enum ScriptContentKind {
    Platform,
    Remediation,
    Compliance,
}

struct ScriptKindSpec {
    kind: &'static str,
    collection: &'static str,
    odata_type: &'static str,
    content: ScriptContentKind,
    supports_32bit: bool,
    supports_signature: bool,
    file_ext: &'static str,
}

fn script_kind_spec(kind: &str) -> Result<ScriptKindSpec, GraphError> {
    let kind = kind.strip_prefix("script:").unwrap_or(kind);
    Ok(match kind {
        "platform-powershell" => ScriptKindSpec {
            kind: "platform-powershell",
            collection: "/deviceManagement/deviceManagementScripts",
            odata_type: "#microsoft.graph.deviceManagementScript",
            content: ScriptContentKind::Platform,
            supports_32bit: true,
            supports_signature: true,
            file_ext: "ps1",
        },
        "platform-shell" => ScriptKindSpec {
            kind: "platform-shell",
            collection: "/deviceManagement/deviceShellScripts",
            odata_type: "#microsoft.graph.deviceShellScript",
            content: ScriptContentKind::Platform,
            supports_32bit: false,
            supports_signature: false,
            file_ext: "sh",
        },
        "remediation" => ScriptKindSpec {
            kind: "remediation",
            collection: "/deviceManagement/deviceHealthScripts",
            odata_type: "#microsoft.graph.deviceHealthScript",
            content: ScriptContentKind::Remediation,
            supports_32bit: true,
            supports_signature: true,
            file_ext: "ps1",
        },
        "compliance" => ScriptKindSpec {
            kind: "compliance",
            collection: "/deviceManagement/deviceComplianceScripts",
            odata_type: "#microsoft.graph.deviceComplianceScript",
            content: ScriptContentKind::Compliance,
            supports_32bit: true,
            supports_signature: true,
            file_ext: "ps1",
        },
        other => {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: format!("Cannot create or PATCH script for kind: {other}"),
                permission_related: false,
            });
        }
    })
}

/// PATCH decoded script bodies back to Graph (Base64 UTF-8), matching the Next.js workbenches.
pub async fn update_script_content(
    access_token: &str,
    input: &UpdateScriptContentInput,
) -> Result<(), GraphError> {
    let spec = script_kind_spec(&input.kind)?;
    let path = format!("{}/{enc}", spec.collection, enc = encode_id(&input.id));
    let mut body = json!({ "@odata.type": spec.odata_type });
    let object = body.as_object_mut().expect("json object");
    if let Some(name) = input.display_name.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        object.insert("displayName".into(), json!(name));
    }
    if let Some(description) = &input.description {
        object.insert("description".into(), json!(description.trim()));
    }
    if let Some(publisher) = &input.publisher {
        object.insert("publisher".into(), json!(publisher.trim()));
    }
    if let Some(run_as) = input
        .run_as_account
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if !matches!(run_as, "system" | "user") {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: "Run as must be system or user.".into(),
                permission_related: false,
            });
        }
        object.insert("runAsAccount".into(), json!(run_as));
    }
    if spec.supports_signature {
        if let Some(value) = input.enforce_signature_check {
            object.insert("enforceSignatureCheck".into(), json!(value));
        }
    }
    if spec.supports_32bit {
        if let Some(value) = input.run_as_32_bit {
            object.insert("runAs32Bit".into(), json!(value));
        }
    }
    match spec.content {
        ScriptContentKind::Remediation => {
            if let Some(text) = &input.detection_script_text {
                object.insert("detectionScriptContent".into(), json!(encode_b64(text)));
            }
            if let Some(text) = &input.remediation_script_text {
                object.insert("remediationScriptContent".into(), json!(encode_b64(text)));
            }
        }
        ScriptContentKind::Compliance => {
            if let Some(text) = input.detection_script_text.as_deref().or(input.script_text.as_deref())
            {
                object.insert("detectionScriptContent".into(), json!(encode_b64(text)));
            }
        }
        ScriptContentKind::Platform => {
            if let Some(text) = &input.script_text {
                object.insert("scriptContent".into(), json!(encode_b64(text)));
            }
        }
    }
    GraphClient::new()
        .patch_no_content(access_token, &path, "beta", &body)
        .await
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScriptContentInput {
    pub kind: String,
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub run_as_account: Option<String>,
    #[serde(default)]
    pub run_as_32_bit: Option<bool>,
    #[serde(default)]
    pub enforce_signature_check: Option<bool>,
    #[serde(default)]
    pub script_text: Option<String>,
    #[serde(default)]
    pub detection_script_text: Option<String>,
    #[serde(default)]
    pub remediation_script_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTenantScriptInput {
    pub kind: String,
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub run_as_account: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
    #[serde(default)]
    pub script_text: Option<String>,
    #[serde(default)]
    pub detection_script_text: Option<String>,
    #[serde(default)]
    pub remediation_script_text: Option<String>,
    #[serde(default)]
    pub run_as_32_bit: Option<bool>,
    #[serde(default)]
    pub enforce_signature_check: Option<bool>,
}

fn default_script_file_name(display_name: &str, ext: &str) -> String {
    let mut stem: String = display_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch
            } else {
                '-'
            }
        })
        .collect();
    while stem.contains("--") {
        stem = stem.replace("--", "-");
    }
    let stem = stem.trim_matches('-');
    let stem = if stem.is_empty() { "script" } else { stem };
    format!("{stem}.{ext}")
}

fn script_create_body(
    spec: &ScriptKindSpec,
    input: &CreateTenantScriptInput,
) -> Result<Value, GraphError> {
    let display_name = input.display_name.trim();
    if display_name.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Display name is required.".into(),
            permission_related: false,
        });
    }
    let run_as = input
        .run_as_account
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("system");
    if !matches!(run_as, "system" | "user") {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Run as must be system or user.".into(),
            permission_related: false,
        });
    }
    let file_name = input
        .file_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| default_script_file_name(display_name, spec.file_ext));
    let description = input
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let mut body = json!({
        "@odata.type": spec.odata_type,
        "displayName": display_name,
        "runAsAccount": run_as,
        "roleScopeTagIds": ["0"],
    });
    let object = body.as_object_mut().expect("json object");
    if matches!(spec.content, ScriptContentKind::Platform) {
        object.insert("fileName".into(), json!(file_name));
    }
    if spec.supports_signature {
        object.insert(
            "enforceSignatureCheck".into(),
            json!(input.enforce_signature_check.unwrap_or(false)),
        );
    }
    if let Some(description) = description {
        object.insert("description".into(), json!(description));
    }
    if let Some(publisher) = input
        .publisher
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        object.insert("publisher".into(), json!(publisher));
    }
    if spec.supports_32bit {
        object.insert(
            "runAs32Bit".into(),
            json!(input.run_as_32_bit.unwrap_or(false)),
        );
    }

    match spec.content {
        ScriptContentKind::Platform => {
            let text = input.script_text.as_deref().unwrap_or("");
            object.insert("scriptContent".into(), json!(encode_b64(text)));
        }
        ScriptContentKind::Remediation => {
            let detection = input
                .detection_script_text
                .as_deref()
                .or(input.script_text.as_deref())
                .unwrap_or("");
            if detection.trim().is_empty() {
                return Err(GraphError::Request {
                    status: 400,
                    code: None,
                    message: "A detection script is required.".into(),
                    permission_related: false,
                });
            }
            object.insert("detectionScriptContent".into(), json!(encode_b64(detection)));
            object.insert(
                "remediationScriptContent".into(),
                json!(encode_b64(
                    input.remediation_script_text.as_deref().unwrap_or("")
                )),
            );
        }
        ScriptContentKind::Compliance => {
            let detection = input
                .detection_script_text
                .as_deref()
                .or(input.script_text.as_deref())
                .unwrap_or("");
            if detection.trim().is_empty() {
                return Err(GraphError::Request {
                    status: 400,
                    code: None,
                    message: "A detection script is required.".into(),
                    permission_related: false,
                });
            }
            object.insert("detectionScriptContent".into(), json!(encode_b64(detection)));
        }
    }
    Ok(body)
}

fn summary_from_created(
    kind: &str,
    object: &Value,
) -> Result<crate::TenantScriptSummary, GraphError> {
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| GraphError::Request {
            status: 502,
            code: None,
            message: "Graph created the script but did not return an id.".into(),
            permission_related: false,
        })?;
    Ok(crate::TenantScriptSummary {
        kind: kind.to_string(),
        display_name: object
            .get("displayName")
            .and_then(Value::as_str)
            .unwrap_or("Untitled")
            .to_string(),
        description: object
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_string),
        file_name: object
            .get("fileName")
            .and_then(Value::as_str)
            .map(str::to_string),
        run_as_account: object
            .get("runAsAccount")
            .and_then(Value::as_str)
            .map(str::to_string),
        publisher: object
            .get("publisher")
            .and_then(Value::as_str)
            .map(str::to_string),
        version: object
            .get("version")
            .and_then(Value::as_str)
            .map(str::to_string),
        is_global_script: object.get("isGlobalScript").and_then(Value::as_bool),
        created_date_time: object
            .get("createdDateTime")
            .and_then(Value::as_str)
            .map(str::to_string),
        last_modified_date_time: object
            .get("lastModifiedDateTime")
            .and_then(Value::as_str)
            .map(str::to_string),
        assignment_count: Some(0),
        id: id.to_string(),
    })
}

/// POST a new Intune platform, remediation, or compliance script.
pub async fn create_tenant_script(
    access_token: &str,
    input: CreateTenantScriptInput,
) -> Result<crate::TenantScriptSummary, GraphError> {
    let spec = script_kind_spec(&input.kind)?;
    let body = script_create_body(&spec, &input)?;
    let created: Value = GraphClient::new()
        .post(access_token, spec.collection, "beta", &body)
        .await?;
    summary_from_created(spec.kind, &created)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(kind: &str, name: &str) -> CreateTenantScriptInput {
        CreateTenantScriptInput {
            kind: kind.into(),
            display_name: name.into(),
            description: Some("  from Axis  ".into()),
            publisher: None,
            run_as_account: None,
            file_name: None,
            script_text: Some("Write-Output 'hi'".into()),
            detection_script_text: Some("exit 0".into()),
            remediation_script_text: Some("# fix".into()),
            run_as_32_bit: Some(true),
            enforce_signature_check: None,
        }
    }

    #[test]
    fn platform_powershell_body_encodes_script_content() {
        let spec = script_kind_spec("script:platform-powershell").unwrap();
        let body = script_create_body(&spec, &input("platform-powershell", "Hello world")).unwrap();
        assert_eq!(
            body["@odata.type"],
            "#microsoft.graph.deviceManagementScript"
        );
        assert_eq!(body["displayName"], "Hello world");
        assert_eq!(body["fileName"], "Hello-world.ps1");
        assert_eq!(body["runAsAccount"], "system");
        assert_eq!(body["runAs32Bit"], true);
        assert_eq!(body["enforceSignatureCheck"], false);
        assert_eq!(body["scriptContent"], encode_b64("Write-Output 'hi'"));
        assert_eq!(body["description"], "from Axis");
        assert!(body.get("detectionScriptContent").is_none());
    }

    #[test]
    fn shell_script_omits_32bit() {
        let spec = script_kind_spec("platform-shell").unwrap();
        let body = script_create_body(&spec, &input("platform-shell", "mac")).unwrap();
        assert_eq!(body["fileName"], "mac.sh");
        assert!(body.get("runAs32Bit").is_none());
        assert!(body.get("enforceSignatureCheck").is_none());
    }

    #[test]
    fn remediation_omits_file_name() {
        let spec = script_kind_spec("remediation").unwrap();
        let body = script_create_body(&spec, &input("remediation", "Probe")).unwrap();
        assert!(body.get("fileName").is_none());
        assert_eq!(body["detectionScriptContent"], encode_b64("exit 0"));
        assert_eq!(body["remediationScriptContent"], encode_b64("# fix"));
    }

    #[test]
    fn remediation_requires_detection() {
        let spec = script_kind_spec("remediation").unwrap();
        let mut empty = input("remediation", "Probe");
        empty.detection_script_text = Some("  ".into());
        empty.script_text = None;
        assert!(script_create_body(&spec, &empty).is_err());
    }

    #[test]
    fn unknown_kind_is_rejected() {
        assert!(script_kind_spec("win32").is_err());
    }

    #[test]
    fn scheduled_actions_are_lifted_from_expanded_policy() {
        let mut object = json!({
            "id": "p1",
            "displayName": "Windows compliance",
            "scheduledActionsForRule": [
                {
                    "id": "rule-1",
                    "ruleName": "PasswordRequired",
                    "scheduledActionConfigurations": [
                        { "actionType": "block", "gracePeriodHours": 0 }
                    ]
                }
            ]
        });
        let actions = take_scheduled_actions(&mut object).expect("actions");
        assert!(object.get("scheduledActionsForRule").is_none());
        assert_eq!(actions[0]["ruleName"], "PasswordRequired");
        assert_eq!(actions[0]["scheduledActionConfigurations"][0]["actionType"], "block");
    }
}
