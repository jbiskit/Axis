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
            extra_paths: vec![(
                "scheduledActions",
                format!(
                    "/deviceManagement/deviceCompliancePolicies/{enc}/scheduledActionsForRule"
                ),
            )],
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

pub async fn fetch_graph_object_detail(
    access_token: &str,
    kind: &str,
    id: &str,
) -> Result<GraphObjectDetail, GraphError> {
    let spec = spec_for(kind, id)?;
    let client = GraphClient::new();
    let mut object: Value = client
        .fetch_plain(access_token, &spec.object_path, "beta")
        .await?;
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

fn script_patch_target(kind: &str, id: &str) -> Result<(String, &'static str), GraphError> {
    let enc = encode_id(id);
    Ok(match kind {
        "script:platform-powershell" => (
            format!("/deviceManagement/deviceManagementScripts/{enc}"),
            "#microsoft.graph.deviceManagementScript",
        ),
        "script:platform-shell" => (
            format!("/deviceManagement/deviceShellScripts/{enc}"),
            "#microsoft.graph.deviceShellScript",
        ),
        "script:remediation" => (
            format!("/deviceManagement/deviceHealthScripts/{enc}"),
            "#microsoft.graph.deviceHealthScript",
        ),
        "script:compliance" => (
            format!("/deviceManagement/deviceComplianceScripts/{enc}"),
            "#microsoft.graph.deviceComplianceScript",
        ),
        other => {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: format!("Cannot PATCH script body for kind: {other}"),
                permission_related: false,
            });
        }
    })
}

/// PATCH decoded script bodies back to Graph (Base64 UTF-8), matching the Next.js workbenches.
pub async fn update_script_content(
    access_token: &str,
    kind: &str,
    id: &str,
    script_text: Option<&str>,
    detection_script_text: Option<&str>,
    remediation_script_text: Option<&str>,
) -> Result<(), GraphError> {
    let (path, odata_type) = script_patch_target(kind, id)?;
    let mut body = json!({ "@odata.type": odata_type });
    let object = body.as_object_mut().expect("json object");
    match kind {
        "script:remediation" => {
            if let Some(text) = detection_script_text {
                object.insert("detectionScriptContent".into(), json!(encode_b64(text)));
            }
            if let Some(text) = remediation_script_text {
                object.insert("remediationScriptContent".into(), json!(encode_b64(text)));
            }
        }
        "script:compliance" => {
            if let Some(text) = detection_script_text.or(script_text) {
                object.insert("detectionScriptContent".into(), json!(encode_b64(text)));
            }
        }
        _ => {
            if let Some(text) = script_text {
                object.insert("scriptContent".into(), json!(encode_b64(text)));
            }
        }
    }
    GraphClient::new()
        .patch_no_content(access_token, &path, "beta", &body)
        .await
}
