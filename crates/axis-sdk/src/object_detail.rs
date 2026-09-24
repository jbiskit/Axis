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
            // Portal detail: GET …/deviceEnrollmentConfigurations/{id}?$expand=assignments
            object_path: format!(
                "/deviceManagement/deviceEnrollmentConfigurations/{enc}?$expand=assignments"
            ),
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
        // Graph documents /items and /assignments navigation, but Intune's
        // StatelessPayloadLinkingService returns "No OData route" for those GETs.
        // Items + assignments only come back via $expand on the policy set.
        "policySet" => KindSpec {
            object_path: format!(
                "/deviceAppManagement/policySets/{enc}?$expand=items,assignments"
            ),
            assignments_path: None,
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

fn take_embedded_items(object: &mut Value) -> Option<Value> {
    let items = object.as_object_mut()?.remove("items")?;
    Some(normalize_extra(items))
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

/// A Settings Catalog policy template listed from Graph
/// (`deviceManagement/configurationPolicyTemplates`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationPolicyTemplateSummary {
    pub id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platforms: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub technologies: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lifecycle_state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_id: Option<String>,
}

fn graph_string(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        return Some(trimmed.to_string());
    }
    if value.is_null() {
        return None;
    }
    Some(value.to_string())
}

fn graph_i64(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    value.as_i64().or_else(|| value.as_u64().map(|n| n as i64))
}

fn template_family_is_safe(family: &str) -> bool {
    !family.is_empty()
        && family
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric())
}

fn is_active_template(state: Option<&str>) -> bool {
    match state {
        None => true,
        Some(value) => value.eq_ignore_ascii_case("active"),
    }
}

fn template_version(row: &ConfigurationPolicyTemplateSummary) -> i64 {
    if let Some(version) = row.version {
        return version;
    }
    row.id
        .rsplit_once('_')
        .and_then(|(_, suffix)| suffix.parse::<i64>().ok())
        .unwrap_or(0)
}

/// Shared lineage when Graph versions a template: `baseId`, or `{base}_{version}` on `id`.
fn template_base_key(row: &ConfigurationPolicyTemplateSummary) -> Option<String> {
    if let Some(base) = row
        .base_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(base.to_ascii_lowercase());
    }
    let (base, suffix) = row.id.rsplit_once('_')?;
    if base.is_empty() || !suffix.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    Some(base.to_ascii_lowercase())
}

/// Normalized platform set for a template, so `windows10` and
/// `windows10,windows11` compare equal while `macOS` and `windows10` do not.
fn template_platform_key(row: &ConfigurationPolicyTemplateSummary) -> String {
    let mut parts: Vec<String> = row
        .platforms
        .as_deref()
        .unwrap_or("")
        .split(',')
        .map(|part| part.trim().to_ascii_lowercase())
        .filter(|part| !part.is_empty())
        .collect();
    parts.sort();
    parts.dedup();
    parts.join(",")
}

/// Distinct Intune profile: family + platform + display name (case-insensitive).
///
/// Platform is part of the key because the same display name can exist for more
/// than one platform — e.g. "Microsoft Defender Antivirus Exclusions" ships as
/// both a macOS and a Windows profile. Excluding platform collapsed those into a
/// single picker row and made one of them unselectable. Platform *strings* are
/// normalized so casing/ordering variants of the same set still collapse.
fn template_profile_key(row: &ConfigurationPolicyTemplateSummary) -> String {
    format!(
        "{}\0{}\0{}",
        row.template_family
            .as_deref()
            .unwrap_or("")
            .to_ascii_lowercase(),
        template_platform_key(row),
        row.display_name.to_ascii_lowercase(),
    )
}

fn fold_latest_templates(
    rows: impl IntoIterator<Item = ConfigurationPolicyTemplateSummary>,
    key_fn: impl Fn(&ConfigurationPolicyTemplateSummary) -> String,
) -> Vec<ConfigurationPolicyTemplateSummary> {
    let mut by_key: std::collections::HashMap<String, ConfigurationPolicyTemplateSummary> =
        std::collections::HashMap::new();
    for row in rows {
        let key = key_fn(&row);
        match by_key.get(&key) {
            Some(existing) if template_version(existing) >= template_version(&row) => {}
            _ => {
                by_key.insert(key, row);
            }
        }
    }
    by_key.into_values().collect()
}

/// One picker row per distinct Intune profile: latest active template when Graph
/// returns versioned copies (shared `baseId` / versioned `id`) or casing-only
/// `displayName` aliases. The winner keeps Graph's `displayName` and `id`.
fn prefer_latest_templates(
    rows: Vec<ConfigurationPolicyTemplateSummary>,
) -> Vec<ConfigurationPolicyTemplateSummary> {
    let active: Vec<_> = rows
        .iter()
        .filter(|row| is_active_template(row.lifecycle_state.as_deref()))
        .cloned()
        .collect();
    let source = if active.is_empty() { rows } else { active };
    let by_base = fold_latest_templates(source, |row| {
        template_base_key(row).unwrap_or_else(|| format!("id:{}", row.id))
    });
    let mut templates = fold_latest_templates(by_base, |row| template_profile_key(row));
    templates.sort_by(|left, right| {
        left.display_name
            .to_ascii_lowercase()
            .cmp(&right.display_name.to_ascii_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    templates
}

/// List Settings Catalog templates for an Endpoint Security family
/// (`templateFamily eq 'endpointSecurityAttackSurfaceReduction'`, etc.).
pub async fn list_configuration_policy_templates(
    access_token: &str,
    template_family: &str,
) -> Result<Vec<ConfigurationPolicyTemplateSummary>, GraphError> {
    let family = template_family.trim();
    if !template_family_is_safe(family) {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "A template family is required.".into(),
            permission_related: false,
        });
    }
    let filter = format!("templateFamily eq '{family}'");
    let path = format!(
        "/deviceManagement/configurationPolicyTemplates?$filter={}&$select=id,baseId,displayName,description,platforms,technologies,templateFamily,lifecycleState,version,displayVersion",
        urlencoding::encode(&filter)
    );
    let rows = GraphClient::new()
        .fetch_all_pages::<Value>(access_token, &path, "beta", 200)
        .await?;
    let parsed = rows
        .into_iter()
        .filter_map(|row| {
            let id = graph_string(row.get("id"))?;
            let display_name = graph_string(row.get("displayName")).unwrap_or_else(|| id.clone());
            Some(ConfigurationPolicyTemplateSummary {
                id,
                display_name,
                description: graph_string(row.get("description")),
                platforms: graph_string(row.get("platforms")),
                technologies: graph_string(row.get("technologies")),
                template_family: graph_string(row.get("templateFamily")),
                lifecycle_state: graph_string(row.get("lifecycleState")),
                version: graph_i64(row.get("version")),
                base_id: graph_string(row.get("baseId")),
            })
        })
        .collect();
    Ok(prefer_latest_templates(parsed))
}

/// Fetch a configuration policy template's setting templates with their
/// definitions — the full shape a template-backed policy can take, including
/// group settings and their children. Mirrors the Intune portal's template
/// editor (e.g. Endpoint Security blades).
pub async fn fetch_configuration_policy_template(
    access_token: &str,
    template_id: &str,
) -> Result<Vec<Value>, GraphError> {
    let enc = encode_id(template_id);
    GraphClient::new()
        .fetch_all_pages::<Value>(
            access_token,
            &format!(
                "/deviceManagement/configurationPolicyTemplates/{enc}/settingTemplates?$expand=settingDefinitions"
            ),
            "beta",
            500,
        )
        .await
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
        Err(_) if kind == "policySet" => {
            // Some tenants reject combined expand; try items then assignments separately.
            let enc = urlencoding::encode(id);
            let base = format!("/deviceAppManagement/policySets/{enc}");
            let mut value: Value = match client
                .fetch_plain(access_token, &format!("{base}?$expand=items"), "beta")
                .await
            {
                Ok(value) => value,
                Err(_) => client.fetch_plain(access_token, &base, "beta").await?,
            };
            if take_embedded_assignments(&value).is_empty() {
                if let Ok(with_assignments) = client
                    .fetch_plain::<Value>(
                        access_token,
                        &format!("{base}?$expand=assignments"),
                        "beta",
                    )
                    .await
                {
                    if let Some(assignments) = with_assignments.get("assignments").cloned() {
                        if let Some(map) = value.as_object_mut() {
                            map.insert("assignments".into(), assignments);
                        }
                    }
                }
            }
            value
        }
        Err(error) => return Err(error),
    };
    let mut warnings = Vec::new();

    let mut assignments = take_embedded_assignments(&object);
    if assignments.is_empty() {
        if let Some(path) = &spec.assignments_path {
            // Prefer assignments embedded via $expand=… when present (enrollment configs,
            // scripts, policy sets). Fall back to the /assignments collection if expand
            // was empty/missing — skip when Graph documents a path that Intune rejects.
            match client
                .fetch_all_pages::<Value>(access_token, path, "beta", ASSIGNMENTS_MAX)
                .await
            {
                Ok(rows) => assignments = rows,
                Err(error) => warnings.push(format!("Assignments: {error}")),
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
    if let Some(items) = take_embedded_items(&mut object) {
        extras.insert("items".into(), items);
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

    fn sample_template(
        id: &str,
        display_name: &str,
        version: Option<i64>,
        lifecycle: Option<&str>,
        base_id: Option<&str>,
        platforms: &str,
    ) -> ConfigurationPolicyTemplateSummary {
        ConfigurationPolicyTemplateSummary {
            id: id.into(),
            display_name: display_name.into(),
            description: None,
            platforms: Some(platforms.into()),
            technologies: Some("mdm".into()),
            template_family: Some("endpointSecurityAntivirus".into()),
            lifecycle_state: lifecycle.map(str::to_string),
            version,
            base_id: base_id.map(str::to_string),
        }
    }

    #[test]
    fn latest_active_template_wins_per_base() {
        let rows = vec![
            sample_template(
                "asr-rules_1",
                "Attack Surface Reduction Rules",
                Some(1),
                Some("deprecated"),
                Some("asr-rules"),
                "windows10",
            ),
            sample_template(
                "asr-rules_2",
                "Attack Surface Reduction Rules",
                Some(2),
                Some("active"),
                Some("asr-rules"),
                "windows10",
            ),
            sample_template(
                "device-control_1",
                "Device Control",
                Some(1),
                Some("active"),
                Some("device-control"),
                "windows10",
            ),
        ];
        let templates = prefer_latest_templates(rows);
        assert_eq!(templates.len(), 2);
        assert_eq!(templates[0].id, "asr-rules_2");
        assert_eq!(templates[1].id, "device-control_1");
    }

    #[test]
    fn latest_active_collapses_same_name_and_casing_aliases() {
        let rows = vec![
            sample_template(
                "av_1",
                "Microsoft Defender Antivirus",
                Some(1),
                Some("active"),
                Some("av-v1"),
                "windows10",
            ),
            sample_template(
                "av_3",
                "Microsoft Defender Antivirus",
                Some(3),
                Some("active"),
                Some("av-v3"),
                "windows10",
            ),
            sample_template(
                "av_2",
                "Microsoft Defender Antivirus",
                Some(2),
                Some("deprecated"),
                Some("av-v2"),
                "windows10",
            ),
            sample_template(
                "excl_1",
                "Microsoft Defender Antivirus exclusions",
                Some(1),
                Some("active"),
                Some("excl-v1"),
                "windows10",
            ),
            sample_template(
                "excl_2",
                "Microsoft Defender Antivirus Exclusions",
                Some(2),
                Some("active"),
                Some("excl-v2"),
                "windows10",
            ),
            sample_template(
                "mac_1",
                "macOS Endpoint Security AV",
                Some(1),
                Some("active"),
                Some("mac-av"),
                "macOS",
            ),
            sample_template(
                "update_1",
                "Defender Update controls",
                Some(1),
                Some("active"),
                Some("update"),
                "windows10",
            ),
        ];
        let templates = prefer_latest_templates(rows);
        let names: Vec<_> = templates
            .iter()
            .map(|row| (row.display_name.as_str(), row.id.as_str()))
            .collect();
        assert_eq!(
            names,
            vec![
                ("Defender Update controls", "update_1"),
                ("macOS Endpoint Security AV", "mac_1"),
                ("Microsoft Defender Antivirus", "av_3"),
                ("Microsoft Defender Antivirus Exclusions", "excl_2"),
            ]
        );
    }

    #[test]
    fn same_name_collapses_across_platform_string_variants() {
        // Casing/ordering variants of the same platform set are the same profile
        // and must not surface as duplicate picker rows.
        let rows = vec![
            sample_template(
                "av-win_2",
                "Microsoft Defender Antivirus",
                Some(2),
                Some("active"),
                None,
                "windows10",
            ),
            sample_template(
                "av-win_3",
                "Microsoft Defender Antivirus",
                Some(3),
                Some("active"),
                None,
                "windows10,windows11",
            ),
        ];
        let templates = prefer_latest_templates(rows);
        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0].id, "av-win_3");
    }

    #[test]
    fn same_name_kept_per_platform() {
        // The same display name ships as separate macOS and Windows profiles.
        // Both must stay selectable — collapsing them hid the Windows one.
        let rows = vec![
            sample_template(
                "excl-mac_1",
                "Microsoft Defender Antivirus Exclusions",
                Some(1),
                Some("active"),
                None,
                "macOS",
            ),
            sample_template(
                "excl-win_1",
                "Microsoft Defender Antivirus Exclusions",
                Some(1),
                Some("active"),
                None,
                "windows10",
            ),
        ];
        let templates = prefer_latest_templates(rows);
        assert_eq!(templates.len(), 2);
        let ids: Vec<_> = templates.iter().map(|row| row.id.as_str()).collect();
        assert!(ids.contains(&"excl-mac_1"));
        assert!(ids.contains(&"excl-win_1"));
    }
}
