use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::graph::{GraphClient, GraphError};

const EMPTY_USER_ID: &str = "00000000-0000-0000-0000-000000000000";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PolicySettingSource {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configured_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_configured_value: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PolicySettingIssue {
    pub setting_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setting: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setting_instance_id: Option<String>,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_description: Option<String>,
    pub sources: Vec<PolicySettingSource>,
    pub policy_display_name: String,
    pub policy_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePolicyState {
    pub id: String,
    pub display_name: String,
    pub state: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform_type: Option<String>,
    #[serde(default)]
    pub assigned: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub issues: Vec<PolicySettingIssue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictingPolicy {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyConflictSummary {
    pub id: String,
    pub contributing_settings: Vec<String>,
    pub conflicting_policies: Vec<ConflictingPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_checkins_impacted: Option<i64>,
    pub relevant_to_device: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDiagnosticRow {
    pub display_name: String,
    pub state: String,
    pub source: String,
    pub setting_issue_count: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDiagnostics {
    pub raw_configuration_state_count: usize,
    pub raw_configuration_policy_state_count: usize,
    pub raw_compliance_state_count: usize,
    pub raw_states: Vec<PolicyDiagnosticRow>,
    pub conflict_summary_count: usize,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct DevicePoliciesBundle {
    pub configuration_states: Vec<DevicePolicyState>,
    pub compliance_policy_states: Vec<DevicePolicyState>,
    pub policy_conflicts: Vec<PolicyConflictSummary>,
    pub policy_diagnostics: PolicyDiagnostics,
    pub warning: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IntuneReportPayload {
    #[serde(default, rename = "Schema")]
    schema: Vec<ReportColumn>,
    #[serde(default, rename = "Values")]
    values: Vec<Value>,
    #[serde(default, rename = "TotalRowCount")]
    total_row_count: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ReportColumn {
    #[serde(default, rename = "Column")]
    column: Option<String>,
    #[serde(default, rename = "Property")]
    property: Option<String>,
}

fn encode_id(id: &str) -> String {
    urlencoding::encode(id).into_owned()
}

fn json_str(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn json_i64(value: &Value, key: &str) -> Option<i64> {
    value
        .get(key)
        .and_then(|item| item.as_i64().or_else(|| item.as_f64().map(|n| n as i64)))
}

fn report_field<'a>(row: &'a Value, key: &str) -> Option<&'a Value> {
    if let Some(value) = row.get(key) {
        return Some(value);
    }
    let wanted = key.to_ascii_lowercase();
    row.as_object().and_then(|map| {
        map.iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(&wanted))
            .map(|(_, value)| value)
    })
}

fn report_string(row: &Value, key: &str) -> String {
    match report_field(row, key) {
        Some(Value::String(value)) => value.trim().to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn report_number(row: &Value, key: &str) -> Option<f64> {
    match report_field(row, key) {
        Some(Value::Number(value)) => value.as_f64(),
        Some(Value::String(value)) => value.parse().ok(),
        _ => None,
    }
}

pub fn is_conflict_policy_state(state: &str) -> bool {
    normalize_state(state) == "conflict"
}

pub fn is_problem_policy_state(state: &str) -> bool {
    matches!(
        normalize_state(state).as_str(),
        "conflict" | "error" | "failed" | "noncompliant"
    )
}

fn normalize_state(state: &str) -> String {
    state.trim().to_ascii_lowercase().replace(['_', ' '], "")
}

fn normalize_policy_key(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn policy_state_severity_rank(state: &str) -> u8 {
    match normalize_state(state).as_str() {
        "conflict" => 0,
        "error" => 1,
        "failed" | "noncompliant" => 2,
        "succeeded" | "compliant" | "remediated" => 3,
        "assigned" => 4,
        _ => 5,
    }
}

fn map_report_policy_status(status: i64) -> String {
    match status {
        0 => "unknown",
        1 => "notApplicable",
        2 => "succeeded",
        3 => "remediated",
        4 => "nonCompliant",
        5 => "error",
        6 => "conflict",
        7 => "notAssigned",
        other => return format!("status-{other}"),
    }
    .to_string()
}

fn map_report_policy_source(base_type_name: &str) -> String {
    let value = base_type_name.to_ascii_lowercase();
    if value.contains("compliance") {
        "compliance".into()
    } else if value.contains("devicemanagementconfigurationpolicy")
        || value.contains("settingscatalog")
    {
        "configurationPolicy".into()
    } else {
        "configuration".into()
    }
}

fn rows_from_intune_report(payload: &IntuneReportPayload) -> Vec<Value> {
    payload
        .values
        .iter()
        .map(|row| {
            if row.is_object() {
                return row.clone();
            }
            let cells = row.as_array().cloned().unwrap_or_default();
            let mut record = serde_json::Map::new();
            for (index, column) in payload.schema.iter().enumerate() {
                let key = column
                    .column
                    .clone()
                    .or_else(|| column.property.clone())
                    .unwrap_or_else(|| format!("col{index}"));
                record.insert(key, cells.get(index).cloned().unwrap_or(Value::Null));
            }
            Value::Object(record)
        })
        .collect()
}

async fn fetch_intune_report_pages(
    client: &GraphClient,
    access_token: &str,
    path: &str,
    base_body: Value,
    page_size: i64,
) -> Result<IntuneReportPayload, GraphError> {
    let mut first_body = base_body.clone();
    if let Some(object) = first_body.as_object_mut() {
        object.insert("top".into(), Value::from(page_size));
        object.insert("skip".into(), Value::from(0));
    }
    let first: IntuneReportPayload = client
        .post_intune_report(access_token, path, &first_body)
        .await?;
    let mut all_values = first.values.clone();
    let total = first.total_row_count.filter(|value| *value >= 0);
    let mut skip = all_values.len() as i64;

    while skip < 5000 {
        let done = match total {
            Some(total) => skip >= total,
            None => all_values.len() < page_size as usize || skip == 0,
        };
        if done {
            break;
        }
        let mut page_body = base_body.clone();
        if let Some(object) = page_body.as_object_mut() {
            object.insert("top".into(), Value::from(page_size));
            object.insert("skip".into(), Value::from(skip));
        }
        let page: IntuneReportPayload = client
            .post_intune_report(access_token, path, &page_body)
            .await?;
        if page.values.is_empty() {
            break;
        }
        let page_len = page.values.len() as i64;
        all_values.extend(page.values);
        skip += page_len;
        if page_len < page_size {
            break;
        }
    }

    Ok(IntuneReportPayload {
        schema: first.schema,
        values: all_values,
        total_row_count: total.or(Some(skip)),
    })
}

fn elevate_state_from_issues(policy_state: &str, issues: &[PolicySettingIssue]) -> String {
    let issue_states: Vec<String> = issues
        .iter()
        .map(|issue| normalize_state(&issue.state))
        .collect();
    let current = normalize_state(policy_state);
    if issue_states.iter().any(|state| state == "conflict") || current == "conflict" {
        return "conflict".into();
    }
    if issue_states.iter().any(|state| state == "error") || current == "error" {
        return "error".into();
    }
    if issue_states.iter().any(|state| state == "noncompliant") || current == "noncompliant" {
        return "nonCompliant".into();
    }
    policy_state.to_string()
}

fn dedupe_device_policy_states(policies: Vec<DevicePolicyState>) -> Vec<DevicePolicyState> {
    let mut by_key: Vec<(String, DevicePolicyState)> = Vec::new();
    for policy in policies {
        let key = format!(
            "{}:{}",
            policy.source,
            normalize_policy_key(if policy.id.is_empty() {
                &policy.display_name
            } else {
                &policy.id
            })
        );
        if let Some((_, existing)) = by_key.iter_mut().find(|(item, _)| item == &key) {
            let prefer_new = policy_state_severity_rank(&policy.state)
                < policy_state_severity_rank(&existing.state);
            let (mut winner, loser) = if prefer_new {
                (policy, existing.clone())
            } else {
                (existing.clone(), policy)
            };
            for issue in loser.issues {
                let already = winner.issues.iter().any(|row| {
                    row.setting == issue.setting
                        && row.setting_name == issue.setting_name
                        && row.state == issue.state
                });
                if !already {
                    winner.issues.push(issue);
                }
            }
            if winner.report_user_id.is_none() {
                winner.report_user_id = loser.report_user_id;
            }
            winner.assigned = winner.assigned || loser.assigned;
            *existing = winner;
        } else {
            by_key.push((key, policy));
        }
    }
    let mut items: Vec<_> = by_key.into_iter().map(|(_, policy)| policy).collect();
    items.sort_by(|a, b| {
        policy_state_severity_rank(&a.state)
            .cmp(&policy_state_severity_rank(&b.state))
            .then_with(|| {
                a.display_name
                    .to_ascii_lowercase()
                    .cmp(&b.display_name.to_ascii_lowercase())
            })
    });
    items
}

fn apply_conflict_summaries(
    policies: Vec<DevicePolicyState>,
    summaries: &[PolicyConflictSummary],
) -> Vec<DevicePolicyState> {
    if summaries.is_empty() {
        return policies;
    }
    policies
        .into_iter()
        .map(|mut policy| {
            let key = normalize_policy_key(&policy.display_name);
            let related: Vec<_> = summaries
                .iter()
                .filter(|summary| {
                    summary.conflicting_policies.iter().any(|item| {
                        normalize_policy_key(&item.display_name) == key
                            || normalize_policy_key(&item.id) == normalize_policy_key(&policy.id)
                    })
                })
                .collect();
            if related.is_empty() {
                return policy;
            }
            for summary in related {
                let settings = if summary.contributing_settings.is_empty() {
                    vec!["Overlapping setting".to_string()]
                } else {
                    summary.contributing_settings.clone()
                };
                for setting in settings {
                    policy.issues.push(PolicySettingIssue {
                        setting_name: setting.clone(),
                        setting: Some(setting),
                        setting_instance_id: None,
                        state: "conflict".into(),
                        current_value: None,
                        error_description: None,
                        sources: summary
                            .conflicting_policies
                            .iter()
                            .map(|item| PolicySettingSource {
                                id: item.id.clone(),
                                display_name: item.display_name.clone(),
                                source_type: item.source_type.clone(),
                                ..Default::default()
                            })
                            .collect(),
                        policy_display_name: policy.display_name.clone(),
                        policy_id: policy.id.clone(),
                    });
                }
            }
            policy.state = elevate_state_from_issues("conflict", &policy.issues);
            policy
        })
        .collect()
}

fn map_conflict_summary(raw: &Value) -> Option<PolicyConflictSummary> {
    let contributing_settings = raw
        .get("contributingSettings")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let conflicting_policies = raw
        .get("conflictingDeviceConfigurations")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|item| {
                    let id = json_str(item, "id").unwrap_or_default();
                    let display_name = json_str(item, "displayName").unwrap_or_default();
                    if id.is_empty() && display_name.is_empty() {
                        return None;
                    }
                    Some(ConflictingPolicy {
                        id: if id.is_empty() {
                            display_name.clone()
                        } else {
                            id
                        },
                        display_name: if display_name.is_empty() {
                            json_str(item, "id").unwrap_or_else(|| "Policy".into())
                        } else {
                            display_name
                        },
                        source_type: json_str(item, "sourceType"),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if conflicting_policies.len() < 2 && contributing_settings.is_empty() {
        return None;
    }
    Some(PolicyConflictSummary {
        id: json_str(raw, "id").unwrap_or_else(|| {
            conflicting_policies
                .iter()
                .map(|policy| policy.id.as_str())
                .collect::<Vec<_>>()
                .join("_")
        }),
        contributing_settings,
        conflicting_policies,
        device_checkins_impacted: json_i64(raw, "deviceCheckinsImpacted"),
        relevant_to_device: false,
    })
}

async fn fetch_conflict_summaries(
    client: &GraphClient,
    access_token: &str,
) -> (Vec<PolicyConflictSummary>, Option<String>) {
    match client
        .fetch_all_pages::<Value>(
            access_token,
            "/deviceManagement/deviceConfigurationConflictSummary",
            "beta",
            50,
        )
        .await
    {
        Ok(items) => (
            items.iter().filter_map(map_conflict_summary).collect(),
            None,
        ),
        Err(error) => (vec![], Some(format!("Conflict summaries: {error}"))),
    }
}

async fn fetch_configuration_policies_report(
    client: &GraphClient,
    access_token: &str,
    device_id: &str,
) -> Result<Vec<DevicePolicyState>, GraphError> {
    let filter_portal = format!(
        "((PolicyBaseTypeName eq 'Microsoft.Management.Services.Api.DeviceConfiguration') or (PolicyBaseTypeName eq 'DeviceManagementConfigurationPolicy') or (PolicyBaseTypeName eq 'DeviceConfigurationAdmxPolicy') or (PolicyBaseTypeName eq 'Microsoft.Management.Services.Api.DeviceManagementIntent')) and (IntuneDeviceId eq '{device_id}')"
    );
    let filter_device_only = format!("(IntuneDeviceId eq '{device_id}')");
    let select_portal = [
        "IntuneDeviceId",
        "PolicyBaseTypeName",
        "PolicyId",
        "PolicyName",
        "PolicyStatus",
        "PspdpuLastModifiedTimeUtc",
        "UnifiedPolicyType",
        "UnifiedPolicyType_loc",
        "UPN",
        "UserId",
    ];
    let bodies = [
        serde_json::json!({ "select": [], "filter": filter_portal, "skip": 0, "top": 50 }),
        serde_json::json!({ "select": select_portal, "filter": filter_portal, "skip": 0, "top": 50 }),
        serde_json::json!({ "select": [], "filter": filter_device_only, "top": 50 }),
    ];

    let mut last_error: Option<GraphError> = None;
    let mut payload: Option<IntuneReportPayload> = None;
    for body in bodies {
        match client
            .post_intune_report::<IntuneReportPayload>(
                access_token,
                "/deviceManagement/reports/getConfigurationPoliciesReportForDevice",
                &body,
            )
            .await
        {
            Ok(value) => {
                payload = Some(value);
                break;
            }
            Err(error) => {
                if error.status() == Some(429) || error.status() == Some(503) {
                    return Err(error);
                }
                last_error = Some(error);
            }
        }
    }

    let payload = payload.ok_or_else(|| {
        last_error.unwrap_or_else(|| GraphError::Request {
            status: 400,
            code: None,
            message: "getConfigurationPoliciesReportForDevice failed".into(),
            permission_related: false,
        })
    })?;

    let mut policies = Vec::new();
    for row in rows_from_intune_report(&payload) {
        let policy_id = report_string(&row, "PolicyId");
        let policy_name = report_string(&row, "PolicyName");
        if policy_id.is_empty() && policy_name.is_empty() {
            continue;
        }
        let status_code = report_number(&row, "PolicyStatus").map(|value| value as i64);
        let state = status_code
            .map(map_report_policy_status)
            .unwrap_or_else(|| "unknown".into());
        let source = map_report_policy_source(&report_string(
            &row,
            if report_string(&row, "PolicyBaseTypeName").is_empty() {
                "UnifiedPolicyType"
            } else {
                "PolicyBaseTypeName"
            },
        ));
        let id = if policy_id.is_empty() {
            policy_name.clone()
        } else {
            policy_id.clone()
        };
        let display_name = if policy_name.is_empty() {
            policy_id.clone()
        } else {
            policy_name.clone()
        };
        let issues = if is_problem_policy_state(&state) {
            vec![PolicySettingIssue {
                setting_name: "Policy status".into(),
                setting: Some("PolicyStatus".into()),
                setting_instance_id: None,
                state: state.clone(),
                current_value: status_code.map(|value| value.to_string()),
                error_description: if state == "conflict" {
                    Some("Intune reported this policy as Conflict for the device (overlapping settings with another assigned policy).".into())
                } else {
                    None
                },
                sources: vec![],
                policy_display_name: display_name.clone(),
                policy_id: id.clone(),
            }]
        } else {
            vec![]
        };
        policies.push(DevicePolicyState {
            id,
            display_name,
            state,
            source,
            platform_type: {
                let loc = report_string(&row, "UnifiedPolicyType_loc");
                if loc.is_empty() {
                    let raw = report_string(&row, "UnifiedPolicyType");
                    if raw.is_empty() {
                        None
                    } else {
                        Some(raw)
                    }
                } else {
                    Some(loc)
                }
            },
            assigned: true,
            issues,
            report_user_id: {
                let user_id = report_string(&row, "UserId");
                if user_id.is_empty() {
                    None
                } else {
                    Some(user_id)
                }
            },
        });
    }
    Ok(dedupe_device_policy_states(policies))
}

fn map_setting_issue(
    raw: &Value,
    policy_display_name: &str,
    policy_id: &str,
) -> Option<PolicySettingIssue> {
    let state = json_str(raw, "state").unwrap_or_default();
    let normalized = normalize_state(&state);
    if !matches!(normalized.as_str(), "conflict" | "error" | "noncompliant") {
        return None;
    }
    let setting_name = json_str(raw, "settingName")
        .or_else(|| json_str(raw, "setting"))
        .or_else(|| json_str(raw, "instanceDisplayName"))
        .unwrap_or_else(|| "Setting".into());
    let sources = raw
        .get("sources")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|source| {
                    let display_name = json_str(source, "displayName").unwrap_or_default();
                    let id = json_str(source, "id").unwrap_or_else(|| display_name.clone());
                    if id.is_empty() && display_name.is_empty() {
                        return None;
                    }
                    Some(PolicySettingSource {
                        id: if id.is_empty() {
                            display_name.clone()
                        } else {
                            id
                        },
                        display_name: if display_name.is_empty() {
                            json_str(source, "id").unwrap_or_default()
                        } else {
                            display_name
                        },
                        source_type: json_str(source, "sourceType"),
                        ..Default::default()
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Some(PolicySettingIssue {
        setting_name,
        setting: json_str(raw, "setting"),
        setting_instance_id: json_str(raw, "settingInstanceId"),
        state,
        current_value: json_str(raw, "currentValue"),
        error_description: json_str(raw, "errorDescription"),
        sources,
        policy_display_name: policy_display_name.to_string(),
        policy_id: policy_id.to_string(),
    })
}

fn map_policy_state(raw: &Value, source: &str) -> Option<DevicePolicyState> {
    let id = json_str(raw, "id").unwrap_or_default();
    let display_name = json_str(raw, "displayName")
        .or_else(|| json_str(raw, "name"))
        .unwrap_or_default();
    if id.is_empty() && display_name.is_empty() {
        return None;
    }
    let issues = raw
        .get("settingStates")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|item| map_setting_issue(item, &display_name, &id))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let reported = json_str(raw, "state").unwrap_or_else(|| "unknown".into());
    Some(DevicePolicyState {
        id: if id.is_empty() {
            display_name.clone()
        } else {
            id.clone()
        },
        display_name: if display_name.is_empty() {
            id
        } else {
            display_name
        },
        state: elevate_state_from_issues(&reported, &issues),
        source: source.into(),
        platform_type: json_str(raw, "platformType").or_else(|| json_str(raw, "platforms")),
        assigned: false,
        issues,
        report_user_id: None,
    })
}

async fn list_policy_states(
    client: &GraphClient,
    access_token: &str,
    device_id: &str,
    relative: &str,
    source: &str,
) -> Result<Vec<DevicePolicyState>, GraphError> {
    let encoded = encode_id(device_id);
    let base = format!("/deviceManagement/managedDevices/{encoded}/{relative}");
    let rows = match client
        .fetch_all_pages::<Value>(
            access_token,
            &format!("{base}?$expand=settingStates"),
            "beta",
            200,
        )
        .await
    {
        Ok(rows) => rows,
        Err(_) => {
            client
                .fetch_all_pages::<Value>(access_token, &base, "beta", 200)
                .await?
        }
    };
    Ok(rows
        .iter()
        .filter_map(|row| map_policy_state(row, source))
        .collect())
}

async fn resolve_device_policies_legacy(
    client: &GraphClient,
    access_token: &str,
    device_id: &str,
) -> DevicePoliciesBundle {
    let mut notes = vec![
        "Fell back to assignment/device state APIs because the Intune configuration policies report was empty or unavailable.".into(),
    ];
    let mut warning = None;
    let configuration_states = match list_policy_states(
        client,
        access_token,
        device_id,
        "deviceConfigurationStates",
        "configuration",
    )
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            warning = Some(format!("Configuration states: {error}"));
            notes.push(format!("Configuration states: {error}"));
            vec![]
        }
    };
    let configuration_policy_states = list_policy_states(
        client,
        access_token,
        device_id,
        "deviceConfigurationPolicyStates",
        "configurationPolicy",
    )
    .await
    .unwrap_or_default();
    let compliance_policy_states = match list_policy_states(
        client,
        access_token,
        device_id,
        "deviceCompliancePolicyStates",
        "compliance",
    )
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            notes.push(format!("Compliance states: {error}"));
            vec![]
        }
    };
    let (summaries, conflict_warning) = fetch_conflict_summaries(client, access_token).await;
    if let Some(message) = conflict_warning {
        notes.push(message);
    }
    let assigned_keys: Vec<String> = configuration_states
        .iter()
        .chain(configuration_policy_states.iter())
        .chain(compliance_policy_states.iter())
        .flat_map(|policy| {
            [
                normalize_policy_key(&policy.display_name),
                normalize_policy_key(&policy.id),
            ]
        })
        .collect();
    let policy_conflicts = summaries
        .into_iter()
        .map(|mut summary| {
            let overlap = summary
                .conflicting_policies
                .iter()
                .filter(|policy| {
                    assigned_keys.contains(&normalize_policy_key(&policy.display_name))
                        || assigned_keys.contains(&normalize_policy_key(&policy.id))
                })
                .count();
            summary.relevant_to_device = overlap >= 2;
            summary
        })
        .filter(|summary| summary.relevant_to_device)
        .collect::<Vec<_>>();
    let mut configuration_states =
        apply_conflict_summaries(configuration_states, &policy_conflicts);
    configuration_states.extend(configuration_policy_states);
    let configuration_states = dedupe_device_policy_states(configuration_states);
    let diagnostics = diagnostics_from(
        &configuration_states,
        &compliance_policy_states,
        policy_conflicts.len(),
        notes,
    );
    DevicePoliciesBundle {
        configuration_states,
        compliance_policy_states,
        policy_conflicts,
        policy_diagnostics: diagnostics,
        warning,
    }
}

fn diagnostics_from(
    configuration: &[DevicePolicyState],
    compliance: &[DevicePolicyState],
    conflict_summary_count: usize,
    notes: Vec<String>,
) -> PolicyDiagnostics {
    let raw_states = configuration
        .iter()
        .chain(compliance.iter())
        .map(|policy| PolicyDiagnosticRow {
            display_name: policy.display_name.clone(),
            state: policy.state.clone(),
            source: policy.source.clone(),
            setting_issue_count: policy.issues.len(),
        })
        .collect();
    PolicyDiagnostics {
        raw_configuration_state_count: configuration.len(),
        raw_configuration_policy_state_count: configuration
            .iter()
            .filter(|policy| policy.source == "configurationPolicy")
            .count(),
        raw_compliance_state_count: compliance.len(),
        raw_states,
        conflict_summary_count,
        notes,
    }
}

pub async fn fetch_managed_device_policies(
    access_token: &str,
    device_id: &str,
) -> DevicePoliciesBundle {
    let client = GraphClient::new();
    let mut notes = Vec::new();
    let mut warning = None;
    let report = match fetch_configuration_policies_report(&client, access_token, device_id).await {
        Ok(policies) => policies,
        Err(error) => {
            warning = Some(format!("Configuration policies report: {error}"));
            notes.push(format!("Configuration policies report: {error}"));
            vec![]
        }
    };
    let (summaries, conflict_warning) = fetch_conflict_summaries(&client, access_token).await;
    if let Some(message) = conflict_warning {
        notes.push(message);
    }

    if report.is_empty() {
        let mut fallback = resolve_device_policies_legacy(&client, access_token, device_id).await;
        fallback.policy_diagnostics.notes.splice(0..0, notes);
        if warning.is_some() {
            fallback.warning = warning.or(fallback.warning);
        }
        return fallback;
    }

    notes.push(format!(
        "Loaded {} policies from getConfigurationPoliciesReportForDevice (Intune device Configuration report).",
        report.len()
    ));
    notes.push(
        "Setting details load when you expand a conflict/error policy (avoids Graph throttling)."
            .into(),
    );

    let configuration_states: Vec<_> = report
        .iter()
        .filter(|policy| policy.source != "compliance")
        .cloned()
        .collect();
    let compliance_policy_states: Vec<_> = report
        .into_iter()
        .filter(|policy| policy.source == "compliance")
        .collect();
    let assigned_keys: Vec<String> = configuration_states
        .iter()
        .chain(compliance_policy_states.iter())
        .flat_map(|policy| {
            [
                normalize_policy_key(&policy.display_name),
                normalize_policy_key(&policy.id),
            ]
        })
        .collect();
    let policy_conflicts = summaries
        .into_iter()
        .map(|mut summary| {
            let overlap = summary
                .conflicting_policies
                .iter()
                .filter(|policy| {
                    assigned_keys.contains(&normalize_policy_key(&policy.display_name))
                        || assigned_keys.contains(&normalize_policy_key(&policy.id))
                })
                .count();
            summary.relevant_to_device = overlap >= 2;
            summary
        })
        .filter(|summary| summary.relevant_to_device)
        .collect::<Vec<_>>();
    let with_summaries = dedupe_device_policy_states(apply_conflict_summaries(
        configuration_states,
        &policy_conflicts,
    ));
    let conflict_count = with_summaries
        .iter()
        .filter(|policy| is_conflict_policy_state(&policy.state))
        .count();
    if conflict_count > 0 {
        notes.push(format!(
            "{conflict_count} polic{} reported Conflict (PolicyStatus=6) by Intune.",
            if conflict_count == 1 { "y" } else { "ies" }
        ));
    }
    let diagnostics = diagnostics_from(
        &with_summaries,
        &compliance_policy_states,
        policy_conflicts.len(),
        notes,
    );
    DevicePoliciesBundle {
        configuration_states: with_summaries,
        compliance_policy_states,
        policy_conflicts,
        policy_diagnostics: diagnostics,
        warning,
    }
}

pub async fn fetch_policy_setting_issues(
    access_token: &str,
    device_id: &str,
    policy_id: &str,
    report_user_id: Option<&str>,
    device_user_id: Option<&str>,
) -> Result<Vec<PolicySettingIssue>, GraphError> {
    let client = GraphClient::new();
    let mut user_ids = Vec::new();
    for candidate in [report_user_id, device_user_id, Some(EMPTY_USER_ID)] {
        if let Some(value) = candidate.filter(|item| !item.is_empty()) {
            if !user_ids.iter().any(|existing| existing == value) {
                user_ids.push(value.to_string());
            }
        }
    }

    let mut last_error: Option<GraphError> = None;
    let mut payload: Option<IntuneReportPayload> = None;
    for uid in &user_ids {
        let filter = format!(
            "(PolicyId eq '{policy_id}') and (DeviceId eq '{device_id}') and (UserId eq '{uid}')"
        );
        for body in [
            serde_json::json!({ "select": [], "filter": filter }),
            serde_json::json!({
                "select": ["ErrorCode", "SettingId", "SettingInstanceId", "SettingStatus", "SettingName"],
                "filter": filter
            }),
        ] {
            match fetch_intune_report_pages(
                &client,
                access_token,
                "/deviceManagement/reports/getConfigurationSettingsReport",
                body,
                50,
            )
            .await
            {
                Ok(candidate) => {
                    payload = Some(candidate);
                    if payload
                        .as_ref()
                        .map(|item| !item.values.is_empty())
                        .unwrap_or(false)
                    {
                        break;
                    }
                }
                Err(error) => {
                    if error.status() == Some(429) || error.status() == Some(503) {
                        return Err(error);
                    }
                    last_error = Some(error);
                }
            }
        }
        if payload
            .as_ref()
            .map(|item| !item.values.is_empty())
            .unwrap_or(false)
        {
            break;
        }
    }

    if payload
        .as_ref()
        .map(|item| item.values.is_empty())
        .unwrap_or(true)
    {
        for uid in &user_ids {
            let filter = format!(
                "(PolicyId eq '{policy_id}') and (DeviceId eq '{device_id}') and (UserId eq '{uid}')"
            );
            match fetch_intune_report_pages(
                &client,
                access_token,
                "/deviceManagement/reports/getConfigurationSettingNonComplianceReport",
                serde_json::json!({ "select": [], "filter": filter }),
                50,
            )
            .await
            {
                Ok(candidate) if !candidate.values.is_empty() => {
                    payload = Some(candidate);
                    break;
                }
                Ok(candidate) => payload = Some(candidate),
                Err(error) => {
                    if error.status() == Some(429) || error.status() == Some(503) {
                        return Err(error);
                    }
                    last_error = Some(error);
                }
            }
        }
    }

    let payload = payload.ok_or_else(|| {
        last_error.unwrap_or_else(|| GraphError::Request {
            status: 400,
            code: None,
            message: "getConfigurationSettingsReport failed".into(),
            permission_related: false,
        })
    })?;
    if payload.values.is_empty() {
        return Err(GraphError::Request {
            status: 404,
            code: None,
            message: format!(
                "Settings report returned 0 rows for policy {policy_id}. Tried DeviceId+PolicyId+UserId (and empty GUID)."
            ),
            permission_related: false,
        });
    }

    let mut issues = Vec::new();
    for row in rows_from_intune_report(&payload) {
        let status_code = report_number(&row, "SettingStatus").map(|value| value as i64);
        let state = status_code
            .map(map_report_policy_status)
            .unwrap_or_else(|| "unknown".into());
        let error_code = report_number(&row, "ErrorCode").map(|value| value as i64);
        let setting_name = {
            let name = report_string(&row, "SettingName");
            if !name.is_empty() {
                name
            } else {
                let loc = report_string(&row, "SettingId_loc");
                if !loc.is_empty() {
                    loc
                } else {
                    let id = report_string(&row, "SettingId");
                    if id.is_empty() {
                        "Setting".into()
                    } else {
                        id
                    }
                }
            }
        };
        let setting_id = report_string(&row, "SettingId");
        let setting_instance_id = report_string(&row, "SettingInstanceId");
        issues.push(PolicySettingIssue {
            setting_name,
            setting: if setting_id.is_empty() {
                if setting_instance_id.is_empty() {
                    None
                } else {
                    Some(setting_instance_id.clone())
                }
            } else {
                Some(setting_id)
            },
            setting_instance_id: if setting_instance_id.is_empty() {
                None
            } else {
                Some(setting_instance_id)
            },
            state: state.clone(),
            current_value: if let Some(code) = error_code {
                Some(format!(
                    "Status {} · ErrorCode {code}",
                    status_code
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "?".into())
                ))
            } else {
                status_code.map(|value| format!("Status {value}"))
            },
            error_description: if state == "conflict" {
                Some("Setting is in conflict with another assigned policy.".into())
            } else if state == "error" {
                Some(format!(
                    "Setting reported an error{}.",
                    error_code
                        .map(|code| format!(" (code {code})"))
                        .unwrap_or_default()
                ))
            } else {
                None
            },
            sources: vec![],
            policy_display_name: String::new(),
            policy_id: policy_id.to_string(),
        });
    }
    issues.sort_by(|a, b| {
        policy_state_severity_rank(&a.state)
            .cmp(&policy_state_severity_rank(&b.state))
            .then_with(|| {
                a.setting_name
                    .to_ascii_lowercase()
                    .cmp(&b.setting_name.to_ascii_lowercase())
            })
    });
    Ok(issues)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingConflictDetail {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configured_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_configured_value: Option<String>,
}

pub async fn fetch_setting_conflict_details(
    access_token: &str,
    device_id: &str,
    setting_id: &str,
    setting_instance_id: &str,
    user_id: Option<&str>,
    device_user_id: Option<&str>,
) -> Result<Vec<SettingConflictDetail>, GraphError> {
    let client = GraphClient::new();
    let mut user_ids = Vec::new();
    for candidate in [user_id, device_user_id, Some(EMPTY_USER_ID)] {
        if let Some(value) = candidate.filter(|item| !item.is_empty()) {
            if !user_ids.iter().any(|existing| existing == value) {
                user_ids.push(value.to_string());
            }
        }
    }

    let mut last_error: Option<GraphError> = None;
    let mut payload: Option<IntuneReportPayload> = None;
    for uid in user_ids {
        let filter = format!(
            "(DeviceId eq '{device_id}') and (UserId eq '{uid}') and (SettingInstanceId) eq '{setting_instance_id}' and (SettingId) eq '{setting_id}'"
        );
        match client
            .post_intune_report::<IntuneReportPayload>(
                access_token,
                "/deviceManagement/reports/getConfigurationSettingDetailsReport",
                &serde_json::json!({ "filter": filter }),
            )
            .await
        {
            Ok(candidate) => {
                payload = Some(candidate);
                if payload
                    .as_ref()
                    .map(|item| !item.values.is_empty())
                    .unwrap_or(false)
                {
                    break;
                }
            }
            Err(error) => {
                if error.status() == Some(429) || error.status() == Some(503) {
                    return Err(error);
                }
                last_error = Some(error);
            }
        }
    }

    let payload = payload.ok_or_else(|| {
        last_error.unwrap_or_else(|| GraphError::Request {
            status: 400,
            code: None,
            message: "getConfigurationSettingDetailsReport failed".into(),
            permission_related: false,
        })
    })?;

    let mut rows: Vec<SettingConflictDetail> = rows_from_intune_report(&payload)
        .into_iter()
        .filter_map(|row| {
            let id = report_string(&row, "PolicyId");
            let display_name = report_string(&row, "PolicyName");
            if id.is_empty() && display_name.is_empty() {
                return None;
            }
            let status_code = report_number(&row, "SettingStatus").map(|value| value as i64);
            let error_code = report_number(&row, "ErrorCode").map(|value| value as i64);
            let report_value = {
                let loc = report_string(&row, "SettingValue_loc");
                if !loc.is_empty() {
                    Some(loc)
                } else {
                    let raw = report_string(&row, "SettingValue");
                    if raw.is_empty() {
                        None
                    } else {
                        Some(raw)
                    }
                }
            };
            Some(SettingConflictDetail {
                id: if id.is_empty() {
                    display_name.clone()
                } else {
                    id
                },
                display_name: if display_name.is_empty() {
                    report_string(&row, "PolicyId")
                } else {
                    display_name
                },
                source_type: {
                    let loc = report_string(&row, "UnifiedPolicyType_loc");
                    if loc.is_empty() {
                        let raw = report_string(&row, "UnifiedPolicyType");
                        if raw.is_empty() {
                            None
                        } else {
                            Some(raw)
                        }
                    } else {
                        Some(loc)
                    }
                },
                state: status_code
                    .map(map_report_policy_status)
                    .unwrap_or_else(|| "unknown".into()),
                error_code,
                configured_value: report_value.clone(),
                raw_configured_value: report_value,
            })
        })
        .collect();
    rows.sort_by(|a, b| {
        policy_state_severity_rank(&a.state)
            .cmp(&policy_state_severity_rank(&b.state))
            .then_with(|| {
                a.display_name
                    .to_ascii_lowercase()
                    .cmp(&b.display_name.to_ascii_lowercase())
            })
    });
    Ok(rows)
}
