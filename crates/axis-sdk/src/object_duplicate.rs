use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::graph::{GraphClient, GraphError};
use crate::object_detail::{
    create_tenant_script, fetch_graph_object_detail, CreateTenantScriptInput, GraphObjectDetail,
};
use crate::{
    assign_object_assignments, assignment_capabilities, drafts_from_graph_assignments,
};

const STRIP_KEYS: &[&str] = &[
    "id",
    "@odata.context",
    "@odata.etag",
    "@odata.id",
    "@odata.editLink",
    "createdDateTime",
    "lastModifiedDateTime",
    "modifiedDateTime",
    "version",
    "assignments",
    "isAssigned",
    "settingCount",
    "supportsScopeTags",
    "lastModifiedBy",
    "createdBy",
    "priority",
    "deviceStatusOverview",
    "userStatusOverview",
    "deviceStatuses",
    "userStatuses",
    "deviceSettingStateSummaries",
    "scheduledActionsForRule",
    "definitionValues",
    "settings",
    "installSummary",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatedObject {
    pub id: String,
    pub kind: String,
    pub title: String,
}

pub fn can_duplicate_kind(kind: &str) -> bool {
    if matches!(kind, "mobileApp" | "autopilotDevice") {
        return false;
    }
    kind.starts_with("script:") || create_collection(kind).is_ok()
}

pub fn copy_display_name(title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return "Copy".into();
    }
    if let Some(rest) = trimmed.strip_suffix(" (copy)") {
        return format!("{rest} (copy 2)");
    }
    if let Some(prefix) = trimmed.strip_suffix(')') {
        if let Some((head, n)) = prefix.rsplit_once(" (copy ") {
            if n.parse::<u32>().is_ok() {
                let next = n.parse::<u32>().unwrap_or(2).saturating_add(1);
                return format!("{head} (copy {next})");
            }
        }
    }
    format!("{trimmed} (copy)")
}

fn create_collection(kind: &str) -> Result<&'static str, GraphError> {
    Ok(match kind {
        "configurationPolicy" => "/deviceManagement/configurationPolicies",
        "compliancePolicy" => "/deviceManagement/deviceCompliancePolicies",
        "groupPolicyConfiguration" => "/deviceManagement/groupPolicyConfigurations",
        "deviceConfiguration" | "windowsUpdate:rings" => "/deviceManagement/deviceConfigurations",
        "enrollmentConfiguration" => "/deviceManagement/deviceEnrollmentConfigurations",
        "appProtection" => "/deviceAppManagement/managedAppPolicies",
        "autopilotProfile" => "/deviceManagement/windowsAutopilotDeploymentProfiles",
        "windowsUpdate:feature" => "/deviceManagement/windowsFeatureUpdateProfiles",
        "windowsUpdate:quality" => "/deviceManagement/windowsQualityUpdateProfiles",
        "windowsUpdate:drivers" => "/deviceManagement/windowsDriverUpdateProfiles",
        k if k.starts_with("script:") => {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: "Scripts use the script create path.".into(),
                permission_related: false,
            });
        }
        other => {
            return Err(GraphError::Request {
                status: 400,
                code: None,
                message: format!("Duplicate is not available for {other}."),
                permission_related: false,
            });
        }
    })
}

fn string_field(object: &Value, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn strip_keys(value: &Value, keys: &[&str]) -> Value {
    match value {
        Value::Object(map) => {
            let mut next = Map::new();
            for (key, child) in map {
                if keys.iter().any(|strip| *strip == key) {
                    continue;
                }
                next.insert(key.clone(), strip_keys(child, keys));
            }
            Value::Object(next)
        }
        Value::Array(rows) => Value::Array(rows.iter().map(|row| strip_keys(row, keys)).collect()),
        other => other.clone(),
    }
}

fn strip_setting_definitions(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.remove("settingDefinitions");
            map.remove("settingDefinition");
            map.remove("id");
            for child in map.values_mut() {
                strip_setting_definitions(child);
            }
        }
        Value::Array(rows) => {
            for row in rows {
                strip_setting_definitions(row);
            }
        }
        _ => {}
    }
}

fn apply_copy_name(body: &mut Value, name: &str) {
    let Some(map) = body.as_object_mut() else {
        return;
    };
    if map.contains_key("displayName") {
        map.insert("displayName".into(), json!(name));
    }
    if map.contains_key("name") {
        map.insert("name".into(), json!(name));
    }
    if !map.contains_key("displayName") && !map.contains_key("name") {
        map.insert("displayName".into(), json!(name));
    }
}

fn catalog_create_body(
    detail: &GraphObjectDetail,
    name: &str,
    description: Option<&str>,
) -> Result<Value, GraphError> {
    let object = &detail.object;
    let mut settings = detail.settings.clone().unwrap_or_default();
    for row in &mut settings {
        strip_setting_definitions(row);
        if let Some(map) = row.as_object_mut() {
            map.entry("@odata.type".to_string()).or_insert_with(|| {
                json!("#microsoft.graph.deviceManagementConfigurationSetting")
            });
        }
    }
    let mut payload = json!({
        "name": name,
        "platforms": object.get("platforms").cloned().unwrap_or(json!("windows10")),
        "technologies": object.get("technologies").cloned().unwrap_or(json!("mdm")),
        "roleScopeTagIds": object.get("roleScopeTagIds").cloned().unwrap_or(json!(["0"])),
        "settings": settings,
    });
    if let Some(description) =
        description.map(str::to_string).or_else(|| string_field(object, "description"))
    {
        payload
            .as_object_mut()
            .expect("object")
            .insert("description".into(), json!(description));
    }
    if let Some(reference) = object.get("templateReference").cloned() {
        if !reference.is_null() {
            let mut cleaned = strip_keys(&reference, &["id"]);
            strip_setting_definitions(&mut cleaned);
            payload
                .as_object_mut()
                .expect("object")
                .insert("templateReference".into(), cleaned);
        }
    }
    Ok(payload)
}

fn generic_create_body(
    detail: &GraphObjectDetail,
    name: &str,
    description: Option<&str>,
) -> Value {
    let mut body = strip_keys(&detail.object, STRIP_KEYS);
    apply_copy_name(&mut body, name);
    if let Some(description) = description {
        if let Some(map) = body.as_object_mut() {
            map.insert("description".into(), json!(description));
        }
    }
    if detail.kind == "compliancePolicy" {
        if let Some(actions) = detail
            .extras
            .as_ref()
            .and_then(|extras| extras.get("scheduledActions"))
        {
            let cleaned = strip_keys(actions, &["id", "@odata.context", "@odata.etag"]);
            if let Some(map) = body.as_object_mut() {
                map.insert("scheduledActionsForRule".into(), cleaned);
            }
        }
    }
    body
}

fn definition_bind(definition_id: &str) -> String {
    format!(
        "https://graph.microsoft.com/beta/deviceManagement/groupPolicyDefinitions/{definition_id}"
    )
}

fn presentation_bind(definition_id: &str, presentation_id: &str) -> String {
    format!(
        "https://graph.microsoft.com/beta/deviceManagement/groupPolicyDefinitions/{definition_id}/presentations/{presentation_id}"
    )
}

fn gpo_definition_value_body(row: &Value) -> Option<Value> {
    let definition_id = row
        .get("definition")
        .and_then(|definition| definition.get("id"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())?;
    let mut payload = json!({
        "@odata.type": "#microsoft.graph.groupPolicyDefinitionValue",
        "enabled": row.get("enabled").cloned().unwrap_or(json!(true)),
        "definition@odata.bind": definition_bind(definition_id),
    });
    if let Some(configuration_type) = string_field(row, "configurationType") {
        payload.as_object_mut()?.insert(
            "configurationType".into(),
            json!(configuration_type),
        );
    }
    if let Some(presentations) = row.get("presentationValues").and_then(Value::as_array) {
        let copied: Vec<Value> = presentations
            .iter()
            .filter_map(|item| {
                let presentation_id = item
                    .get("presentation")
                    .and_then(|presentation| presentation.get("id"))
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty());
                let mut next = strip_keys(
                    item,
                    &[
                        "id",
                        "lastModifiedDateTime",
                        "createdDateTime",
                        "presentation",
                        "@odata.context",
                    ],
                );
                if let Some(presentation_id) = presentation_id {
                    next.as_object_mut()?.insert(
                        "presentation@odata.bind".into(),
                        json!(presentation_bind(definition_id, presentation_id)),
                    );
                }
                Some(next)
            })
            .collect();
        if !copied.is_empty() {
            payload
                .as_object_mut()?
                .insert("presentationValues".into(), Value::Array(copied));
        }
    }
    Some(payload)
}

async fn copy_gpo_definition_values(
    access_token: &str,
    configuration_id: &str,
    settings: &[Value],
) {
    let client = GraphClient::new();
    let path = format!(
        "/deviceManagement/groupPolicyConfigurations/{}/definitionValues",
        urlencoding::encode(configuration_id)
    );
    for row in settings {
        let Some(body) = gpo_definition_value_body(row) else {
            continue;
        };
        let _ = client.post::<Value>(access_token, &path, "beta", &body).await;
    }
}

fn created_title(created: &Value, fallback: &str) -> String {
    string_field(created, "displayName")
        .or_else(|| string_field(created, "name"))
        .unwrap_or_else(|| fallback.to_string())
}

fn created_id(created: &Value) -> Result<String, GraphError> {
    created
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| GraphError::Request {
            status: 502,
            code: None,
            message: "Duplicate succeeded but Graph returned no id.".into(),
            permission_related: false,
        })
}

async fn duplicate_script(
    access_token: &str,
    kind: &str,
    detail: GraphObjectDetail,
    name: String,
    description: Option<&str>,
    copy_assignments: bool,
) -> Result<DuplicatedObject, GraphError> {
    let object = &detail.object;
    let created = create_tenant_script(
        access_token,
        CreateTenantScriptInput {
            kind: kind.to_string(),
            display_name: name.clone(),
            description: description
                .map(str::to_string)
                .or_else(|| string_field(object, "description")),
            run_as_account: string_field(object, "runAsAccount"),
            file_name: None,
            script_text: detail.script_text.clone(),
            detection_script_text: detail.detection_script_text.clone(),
            remediation_script_text: detail.remediation_script_text.clone(),
            run_as_32_bit: object.get("runAs32Bit").and_then(Value::as_bool),
            enforce_signature_check: object.get("enforceSignatureCheck").and_then(Value::as_bool),
            publisher: string_field(object, "publisher"),
        },
    )
    .await?;
    if copy_assignments {
        copy_object_assignments(access_token, kind, &created.id, &detail).await?;
    }
    Ok(DuplicatedObject {
        id: created.id,
        kind: kind.to_string(),
        title: created.display_name,
    })
}

async fn copy_object_assignments(
    access_token: &str,
    kind: &str,
    created_id: &str,
    detail: &GraphObjectDetail,
) -> Result<(), GraphError> {
    if detail.assignments.is_empty() || !assignment_capabilities(kind).writable {
        return Ok(());
    }
    let drafts = drafts_from_graph_assignments(&detail.assignments, false);
    let odata_type = detail
        .object
        .get("@odata.type")
        .and_then(Value::as_str);
    assign_object_assignments(access_token, kind, created_id, &drafts, odata_type).await
}

pub async fn duplicate_graph_object(
    access_token: &str,
    kind: &str,
    id: &str,
    display_name: Option<&str>,
    description: Option<&str>,
    copy_assignments: bool,
) -> Result<DuplicatedObject, GraphError> {
    if matches!(kind, "mobileApp" | "autopilotDevice") {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: if kind == "mobileApp" {
                "Apps cannot be duplicated from Axis.".into()
            } else {
                "Autopilot devices cannot be duplicated.".into()
            },
            permission_related: false,
        });
    }
    if !can_duplicate_kind(kind) {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: format!("Duplicate is not available for {kind}."),
            permission_related: false,
        });
    }
    let detail = fetch_graph_object_detail(access_token, kind, id).await?;
    let name = display_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| copy_display_name(&detail.title));

    if kind.starts_with("script:") {
        return duplicate_script(
            access_token,
            kind,
            detail,
            name,
            description,
            copy_assignments,
        )
        .await;
    }

    let path = create_collection(kind)?;
    let body = if kind == "configurationPolicy" {
        catalog_create_body(&detail, &name, description)?
    } else {
        generic_create_body(&detail, &name, description)
    };
    let created: Value = GraphClient::new()
        .post(access_token, path, "beta", &body)
        .await?;
    let id = created_id(&created)?;
    if kind == "groupPolicyConfiguration" {
        if let Some(settings) = detail.settings.as_deref() {
            copy_gpo_definition_values(access_token, &id, settings).await;
        }
    }
    if copy_assignments {
        copy_object_assignments(access_token, kind, &id, &detail).await?;
    }
    Ok(DuplicatedObject {
        id,
        kind: kind.to_string(),
        title: created_title(&created, &name),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_name_appends_suffix() {
        assert_eq!(copy_display_name("Baseline"), "Baseline (copy)");
        assert_eq!(copy_display_name("Baseline (copy)"), "Baseline (copy 2)");
        assert_eq!(copy_display_name("Baseline (copy 2)"), "Baseline (copy 3)");
    }

    #[test]
    fn apps_are_not_duplicatable() {
        assert!(!can_duplicate_kind("mobileApp"));
        assert!(!can_duplicate_kind("autopilotDevice"));
        assert!(can_duplicate_kind("configurationPolicy"));
        assert!(can_duplicate_kind("compliancePolicy"));
        assert!(can_duplicate_kind("script:remediation"));
        assert!(can_duplicate_kind("autopilotProfile"));
    }

    #[test]
    fn catalog_body_strips_setting_ids() {
        let detail = GraphObjectDetail {
            id: "src".into(),
            kind: "configurationPolicy".into(),
            title: "Source".into(),
            object: json!({
                "name": "Source",
                "platforms": "windows10",
                "technologies": "mdm"
            }),
            assignments: vec![],
            settings: Some(vec![json!({
                "id": "should-drop",
                "settingDefinitions": [{"id": "def"}],
                "settingInstance": {
                    "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance",
                    "settingDefinitionId": "def",
                    "simpleSettingValue": { "value": "1" }
                }
            })]),
            script_text: None,
            detection_script_text: None,
            remediation_script_text: None,
            extras: None,
            warnings: vec![],
        };
        let body = catalog_create_body(&detail, "Source (copy)", None).unwrap();
        assert_eq!(body["name"], "Source (copy)");
        assert!(body["settings"][0].get("id").is_none());
        assert!(body["settings"][0].get("settingDefinitions").is_none());
        assert_eq!(
            body["settings"][0]["settingInstance"]["settingDefinitionId"],
            "def"
        );
    }
}
