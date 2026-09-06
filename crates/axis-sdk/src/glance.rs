use chrono::{DateTime, Duration, Utc};
use std::collections::HashMap;

use crate::graph::{format_graph_error, GraphClient, GraphCollection, GraphError};
use crate::policy_health::fetch_configuration_policy_health;
use crate::types::*;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Organization {
    #[serde(default)]
    display_name: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedDevice {
    #[serde(default)]
    operating_system: Option<String>,
    #[serde(default)]
    compliance_state: Option<String>,
    #[serde(default)]
    last_sync_date_time: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConflictingPolicy {
    id: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConflictSummary {
    id: Option<String>,
    #[serde(default)]
    contributing_settings: Vec<String>,
    #[serde(default)]
    conflicting_device_configurations: Vec<ConflictingPolicy>,
    #[serde(default)]
    device_checkins_impacted: Option<u32>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntuneAuditActor {
    #[serde(default)]
    user_principal_name: Option<String>,
    #[serde(default)]
    application_display_name: Option<String>,
    #[serde(default)]
    service_principal_name: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntuneAuditProperty {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    old_value: Option<String>,
    #[serde(default)]
    new_value: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntuneAuditResource {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    modified_properties: Vec<IntuneAuditProperty>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntuneAuditRow {
    id: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    activity: Option<String>,
    #[serde(default)]
    activity_date_time: Option<String>,
    #[serde(default)]
    activity_type: Option<String>,
    #[serde(default)]
    activity_operation_type: Option<String>,
    #[serde(default)]
    activity_result: Option<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    actor: Option<IntuneAuditActor>,
    #[serde(default)]
    resources: Vec<IntuneAuditResource>,
}

struct QueryWarning {
    message: String,
    permission_related: bool,
}

struct ConflictResult {
    summaries: Vec<ConflictSummary>,
    warning: Option<String>,
}

struct ActivityResult {
    events: Vec<DirectoryAuditEvent>,
    warning: Option<String>,
    permission_related: bool,
}

struct AppFailureResult {
    failed_device_count: Option<u32>,
    sample_size: Option<u32>,
    warning: Option<String>,
}

pub async fn fetch_tenant_glance(
    access_token: &str,
    token_scopes: &[String],
) -> Result<TenantGlance, GraphError> {
    let client = GraphClient::new();

    let org_result = fetch_organization(&client, access_token).await;
    let devices_result = fetch_managed_devices(&client, access_token).await;
    let inventory = fetch_inventory(&client, access_token).await;
    let conflict_result = fetch_conflicts(&client, access_token).await;
    let app_failure_result = fetch_app_failures(&client, access_token).await;
    let activity_result = fetch_recent_audits(access_token).await;

    let device_list = devices_result.devices;
    let by_os = tally(
        device_list
            .iter()
            .filter_map(|device| device.operating_system.as_deref()),
    );
    let by_compliance = tally(
        device_list
            .iter()
            .filter_map(|device| device.compliance_state.as_deref()),
    );
    let freshness = summarize_check_in_freshness(&device_list);
    let compliance = summarize_compliance(&by_compliance, device_list.len() as u32);

    let devices = DeviceSummary {
        total: device_list.len() as u32,
        by_os,
        by_compliance: by_compliance.clone(),
        active: freshness.active,
        stale: freshness.stale,
    };

    let policies = PolicyCounts {
        compliance_policies: pick_count(&inventory, "CompliancePolicies")
            + pick_count(&inventory, "CompliancePoliciesV2"),
        configuration_profiles: pick_count(&inventory, "SettingsCatalog"),
        device_configurations: pick_count(&inventory, "DeviceConfiguration"),
        group_policy_configurations: pick_count(&inventory, "AdministrativeTemplates"),
        endpoint_security: pick_count(&inventory, "EndpointSecurity"),
    };

    let conflict_items: Vec<GlanceConflictItem> = conflict_result
        .summaries
        .iter()
        .filter(|item| {
            item.conflicting_device_configurations.len() >= 2
                || !item.contributing_settings.is_empty()
        })
        .take(8)
        .enumerate()
        .map(|(index, item)| {
            let names: Vec<&str> = item
                .conflicting_device_configurations
                .iter()
                .filter_map(|policy| {
                    policy
                        .display_name
                        .as_deref()
                        .filter(|name| !name.is_empty())
                        .or(policy.id.as_deref().filter(|id| !id.is_empty()))
                })
                .collect();
            GlanceConflictItem {
                id: item
                    .id
                    .clone()
                    .unwrap_or_else(|| format!("conflict-{index}")),
                label: if names.is_empty() {
                    item.contributing_settings
                        .first()
                        .cloned()
                        .unwrap_or_else(|| "Conflict set".into())
                } else {
                    names.into_iter().take(2).collect::<Vec<_>>().join(" ↔ ")
                },
                setting_count: item.device_checkins_impacted.unwrap_or(0),
                policy_count: item.conflicting_device_configurations.len().max(1) as u32,
                device_checkins_impacted: item.device_checkins_impacted,
            }
        })
        .collect();

    let devices_impacted = conflict_result
        .summaries
        .iter()
        .filter_map(|item| item.device_checkins_impacted)
        .filter(|value| *value > 0)
        .sum();

    let conflict_warning = conflict_result.warning.clone();
    let conflicts = GlanceConflicts {
        summary_count: conflict_items.len() as u32,
        devices_impacted,
        items: conflict_items,
        warning: conflict_warning.clone(),
    };

    let config_error_devices = pick_compliance_bucket(&by_compliance, &["error", "failed"]);
    let failures = GlanceFailures {
        app_failed_device_count: app_failure_result.failed_device_count,
        app_failure_sample_size: app_failure_result.sample_size,
        config_noncompliant_devices: compliance.noncompliant,
        config_error_devices,
        warning: app_failure_result.warning,
    };

    let failed_inventory: Vec<_> = inventory
        .iter()
        .filter(|item| item.error.is_some())
        .collect();
    let mut permission_warnings = Vec::new();
    let mut other_warnings = Vec::new();

    if let Some(warning) = org_result.warning {
        if warning.permission_related {
            permission_warnings.push(warning.message);
        } else {
            other_warnings.push(warning.message);
        }
    }
    if let Some(warning) = devices_result.warning {
        if warning.permission_related {
            permission_warnings.push(warning.message);
        } else {
            other_warnings.push(warning.message);
        }
    }
    if let Some(warning) = activity_result.warning.clone() {
        if activity_result.permission_related {
            permission_warnings.push(warning);
        } else {
            other_warnings.push(warning);
        }
    }
    if let Some(warning) = conflict_warning {
        other_warnings.push(warning);
    }

    for item in failed_inventory {
        let message = format_inventory_warning(item);
        if item.permission_related.unwrap_or(false) {
            permission_warnings.push(message);
        } else {
            other_warnings.push(message);
        }
    }

    let warnings = permission_warnings
        .iter()
        .chain(other_warnings.iter())
        .cloned()
        .collect::<Vec<_>>();

    Ok(TenantGlance {
        organization_name: org_result.organization_name,
        devices,
        policies,
        inventory,
        conflicts,
        failures,
        compliance,
        recent_activity: activity_result.events,
        recent_activity_warning: activity_result.warning,
        recent_activity_permission_related: if activity_result.permission_related {
            Some(true)
        } else {
            None
        },
        drift: None,
        warnings,
        permission_warnings,
        other_warnings,
        token_scopes: token_scopes.to_vec(),
        fetched_at: Utc::now().to_rfc3339(),
    })
}

struct OrganizationResult {
    organization_name: Option<String>,
    warning: Option<QueryWarning>,
}

struct DevicesResult {
    devices: Vec<ManagedDevice>,
    warning: Option<QueryWarning>,
}

async fn fetch_organization(client: &GraphClient, access_token: &str) -> OrganizationResult {
    match client
        .fetch::<GraphCollection<Organization>>(
            access_token,
            "/organization?$select=displayName",
            "beta",
        )
        .await
    {
        Ok(org) => OrganizationResult {
            organization_name: org.value.first().and_then(|row| row.display_name.clone()),
            warning: None,
        },
        Err(error) => {
            let (message, permission_related) = format_graph_error("Organization", &error);
            OrganizationResult {
                organization_name: None,
                warning: Some(QueryWarning {
                    message,
                    permission_related,
                }),
            }
        }
    }
}

async fn fetch_managed_devices(client: &GraphClient, access_token: &str) -> DevicesResult {
    let path = "/deviceManagement/managedDevices?$select=operatingSystem,complianceState,lastSyncDateTime&$top=999";
    match client
        .fetch_all_pages::<ManagedDevice>(access_token, path, "beta", 5000)
        .await
    {
        Ok(devices) => DevicesResult {
            devices,
            warning: None,
        },
        Err(error) => {
            let (message, permission_related) = format_graph_error("Devices", &error);
            DevicesResult {
                devices: vec![],
                warning: Some(QueryWarning {
                    message,
                    permission_related,
                }),
            }
        }
    }
}

async fn fetch_inventory(client: &GraphClient, access_token: &str) -> Vec<InventoryCount> {
    let mut results = Vec::with_capacity(GLANCE_OBJECT_TYPES.len());
    for object_type in GLANCE_OBJECT_TYPES {
        match client.count(access_token, object_type.api, "beta").await {
            Ok(count) => results.push(InventoryCount {
                id: object_type.id.into(),
                title: object_type.title.into(),
                category: object_type.category.into(),
                count,
                api: object_type.api.into(),
                error: None,
                permission_related: None,
                status: None,
                code: None,
            }),
            Err(GraphError::Request {
                status,
                code,
                message,
                permission_related,
            }) => results.push(InventoryCount {
                id: object_type.id.into(),
                title: object_type.title.into(),
                category: object_type.category.into(),
                count: 0,
                api: object_type.api.into(),
                error: Some(message),
                permission_related: Some(permission_related),
                status: Some(status),
                code,
            }),
            Err(error) => {
                let (message, permission_related) = format_graph_error(&object_type.title, &error);
                results.push(InventoryCount {
                    id: object_type.id.into(),
                    title: object_type.title.into(),
                    category: object_type.category.into(),
                    count: 0,
                    api: object_type.api.into(),
                    error: Some(message),
                    permission_related: Some(permission_related),
                    status: None,
                    code: None,
                });
            }
        }
    }
    results
}

async fn fetch_conflicts(client: &GraphClient, access_token: &str) -> ConflictResult {
    match fetch_configuration_policy_health(access_token).await {
        Ok(rows) => {
            let summaries = rows
                .into_iter()
                .filter(|row| row.has_conflict())
                .map(|row| ConflictSummary {
                    id: Some(row.policy_id),
                    contributing_settings: vec![],
                    conflicting_device_configurations: vec![ConflictingPolicy {
                        id: None,
                        display_name: Some(row.policy_name),
                    }],
                    device_checkins_impacted: Some(row.conflict),
                })
                .collect();
            ConflictResult {
                summaries,
                warning: None,
            }
        }
        Err(error) => {
            match client
                .fetch::<GraphCollection<ConflictSummary>>(
                    access_token,
                    "/deviceManagement/deviceConfigurationConflictSummary?$top=20",
                    "beta",
                )
                .await
            {
                Ok(response) => ConflictResult {
                    summaries: response.value,
                    warning: Some(format!(
                        "Settings Catalog conflict report unavailable ({error}); fell back to classic conflict summary."
                    )),
                },
                Err(fallback) => {
                    let (message, _) = format_graph_error("Conflicts", &fallback);
                    ConflictResult {
                        summaries: vec![],
                        warning: Some(format!("{error} · {message}")),
                    }
                }
            }
        }
    }
}

async fn fetch_app_failures(client: &GraphClient, access_token: &str) -> AppFailureResult {
    let path =
        "/deviceAppManagement/mobileApps?$filter=isAssigned eq true&$select=id,displayName&$top=12";
    match client
        .fetch::<GraphCollection<serde_json::Value>>(access_token, path, "beta")
        .await
    {
        Ok(apps) => {
            let sample_size = apps.value.len() as u32;
            if sample_size == 0 {
                return AppFailureResult {
                    failed_device_count: Some(0),
                    sample_size: Some(0),
                    warning: None,
                };
            }
            AppFailureResult {
                failed_device_count: None,
                sample_size: Some(sample_size),
                warning: Some(
                    "App install failure rollup is not yet implemented in the desktop SDK — sample size only."
                        .into(),
                ),
            }
        }
        Err(error) => {
            let (message, _) = format_graph_error("App failures", &error);
            AppFailureResult {
                failed_device_count: None,
                sample_size: None,
                warning: Some(message),
            }
        }
    }
}

async fn fetch_recent_audits(access_token: &str) -> ActivityResult {
    match list_intune_audit_events(access_token, 20).await {
        Ok(events) => ActivityResult {
            events,
            warning: None,
            permission_related: false,
        },
        Err(error) => {
            let (message, permission_related) = format_graph_error("Intune audit", &error);
            ActivityResult {
                events: vec![],
                warning: Some(message),
                permission_related,
            }
        }
    }
}

pub async fn list_intune_audit_events(
    access_token: &str,
    max_items: usize,
) -> Result<Vec<DirectoryAuditEvent>, GraphError> {
    let client = GraphClient::new();
    let max_items = max_items.clamp(1, 500);
    let since = (Utc::now() - Duration::days(30)).format("%Y-%m-%dT00:00:00Z");
    let filter_raw = format!("activityDateTime ge {since}");
    let filter = urlencoding::encode(&filter_raw);
    let candidates = [
        format!(
            "/deviceManagement/auditEvents?$orderby=activityDateTime desc&$filter={filter}&$top=50"
        ),
        "/deviceManagement/auditEvents?$orderby=activityDateTime desc&$top=50".into(),
        "/deviceManagement/auditEvents?$top=50".into(),
    ];
    let mut last_error = None;
    for path in candidates {
        match client
            .fetch_all_pages::<IntuneAuditRow>(access_token, &path, "beta", max_items)
            .await
        {
            Ok(rows) => {
                let mut events: Vec<DirectoryAuditEvent> = rows
                    .into_iter()
                    .enumerate()
                    .map(|(index, row)| map_intune_audit_event(index, row))
                    .collect();
                events.sort_by(|left, right| right.activity_date_time.cmp(&left.activity_date_time));
                events.truncate(max_items);
                return Ok(events);
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.expect("audit query attempted"))
}

fn map_intune_audit_event(index: usize, row: IntuneAuditRow) -> DirectoryAuditEvent {
    let actor = row.actor.unwrap_or(IntuneAuditActor {
        user_principal_name: None,
        application_display_name: None,
        service_principal_name: None,
    });
    DirectoryAuditEvent {
        id: row.id.unwrap_or_else(|| format!("audit-{index}")),
        activity_date_time: row.activity_date_time.unwrap_or_default(),
        activity_display_name: audit_activity_label(
            row.activity.as_deref(),
            row.display_name.as_deref(),
            row.activity_type.as_deref(),
            row.activity_operation_type.as_deref(),
        ),
        category: nonempty(row.category),
        result: nonempty(row.activity_result).map(title_case_result),
        operation_type: nonempty(row.activity_operation_type),
        actor: DirectoryAuditActor {
            display_name: None,
            user_principal_name: nonempty(actor.user_principal_name),
            app_display_name: nonempty(actor.application_display_name)
                .or_else(|| nonempty(actor.service_principal_name)),
        },
        target_resources: row
            .resources
            .iter()
            .filter_map(|resource| usable_audit_name(resource.display_name.as_deref()))
            .collect(),
        changes: row
            .resources
            .into_iter()
            .flat_map(|resource| resource.modified_properties)
            .filter_map(map_audit_change)
            .take(40)
            .collect(),
    }
}

fn map_audit_change(property: IntuneAuditProperty) -> Option<AuditPropertyChange> {
    let display_name = usable_audit_name(property.display_name.as_deref())?;
    let old_value = clip_audit_value(property.old_value);
    let new_value = clip_audit_value(property.new_value);
    if old_value.is_none() && new_value.is_none() {
        return None;
    }
    if old_value == new_value {
        return None;
    }
    Some(AuditPropertyChange {
        display_name,
        old_value,
        new_value,
    })
}

fn clip_audit_value(value: Option<String>) -> Option<String> {
    let trimmed = nonempty(value)?;
    if trimmed.eq_ignore_ascii_case("null") || trimmed == "[]" || trimmed == "{}" {
        return None;
    }
    if trimmed.len() > 400 {
        let mut clipped = trimmed.chars().take(400).collect::<String>();
        clipped.push('…');
        return Some(clipped);
    }
    Some(trimmed)
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn usable_audit_name(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower == "unknown" || lower == "none" || lower == "null" {
        return None;
    }
    if looks_like_guid(trimmed) {
        return None;
    }
    Some(trimmed.to_string())
}

fn looks_like_guid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes[8] == b'-'
        && bytes[13] == b'-'
        && bytes[18] == b'-'
        && bytes[23] == b'-'
        && bytes.iter().all(|byte| byte.is_ascii_hexdigit() || *byte == b'-')
}

fn audit_activity_label(
    activity: Option<&str>,
    display_name: Option<&str>,
    activity_type: Option<&str>,
    operation: Option<&str>,
) -> String {
    for candidate in [activity, display_name, activity_type] {
        if let Some(label) = usable_audit_name(candidate) {
            return label;
        }
    }
    usable_audit_name(operation).unwrap_or_else(|| "Intune change".into())
}

fn title_case_result(value: String) -> String {
    match value.to_ascii_lowercase().as_str() {
        "success" => "Success".into(),
        "failure" | "fail" | "failed" => "Failed".into(),
        "timeout" => "Timed out".into(),
        other if other.starts_with("unknown") => "Unknown".into(),
        _ => value,
    }
}

fn tally<'a>(values: impl Iterator<Item = &'a str>) -> HashMap<String, u32> {
    let mut counts = HashMap::new();
    for value in values {
        let key = if value.trim().is_empty() {
            "Unknown".to_string()
        } else {
            value.trim().to_string()
        };
        *counts.entry(key).or_insert(0) += 1;
    }
    counts
}

struct FreshnessSummary {
    active: u32,
    stale: u32,
}

fn summarize_check_in_freshness(devices: &[ManagedDevice]) -> FreshnessSummary {
    let threshold = Utc::now() - Duration::days(STALE_DEVICE_DAYS);
    let mut active = 0;
    let mut stale = 0;
    for device in devices {
        let Some(raw) = device.last_sync_date_time.as_ref() else {
            stale += 1;
            continue;
        };
        let parsed = DateTime::parse_from_rfc3339(raw)
            .map(|value| value.with_timezone(&Utc))
            .ok();
        match parsed {
            Some(value) if value >= threshold => active += 1,
            _ => stale += 1,
        }
    }
    FreshnessSummary { active, stale }
}

fn summarize_compliance(by_compliance: &HashMap<String, u32>, total: u32) -> GlanceCompliance {
    let compliant = pick_compliance_bucket(by_compliance, &["compliant"]);
    let noncompliant = pick_compliance_bucket(by_compliance, &["noncompliant"]);
    let in_grace_period =
        pick_compliance_bucket(by_compliance, &["ingraceperiod", "inGracePeriod"]);
    let unknown = pick_compliance_bucket(by_compliance, &["unknown"]);
    let rate_percent = if total == 0 {
        None
    } else {
        Some(((compliant as f64 / total as f64) * 100.0).round() as u32)
    };
    GlanceCompliance {
        compliant,
        noncompliant,
        in_grace_period,
        unknown,
        rate_percent,
    }
}

fn pick_count(inventory: &[InventoryCount], id: &str) -> u32 {
    inventory
        .iter()
        .find(|item| item.id == id)
        .map(|item| item.count)
        .unwrap_or(0)
}

fn pick_compliance_bucket(by_compliance: &HashMap<String, u32>, keys: &[&str]) -> u32 {
    let normalized: Vec<String> = keys
        .iter()
        .map(|key| key.to_lowercase().replace(['_', ' '], ""))
        .collect();
    by_compliance
        .iter()
        .filter(|(key, _)| {
            let normalized_key = key.to_lowercase().replace(['_', ' '], "");
            normalized
                .iter()
                .any(|candidate| candidate == &normalized_key)
        })
        .map(|(_, count)| *count)
        .sum()
}

fn format_inventory_warning(item: &InventoryCount) -> String {
    let prefix = if item.permission_related.unwrap_or(false) {
        "Permission denied"
    } else {
        "Query failed"
    };
    format!(
        "{prefix} — {title}{status}{error}",
        title = item.title,
        status = item
            .status
            .map(|status| format!(" · HTTP {status}"))
            .unwrap_or_default(),
        error = item
            .error
            .as_ref()
            .map(|error| format!(" — {error}"))
            .unwrap_or_default()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_guid_audit_targets() {
        assert_eq!(
            usable_audit_name(Some("BitLocker")),
            Some("BitLocker".into())
        );
        assert_eq!(
            usable_audit_name(Some("59653ce8-3ce8-5965-e83c-6559e83c6559")),
            None
        );
        assert_eq!(usable_audit_name(Some("unknown")), None);
    }

    #[test]
    fn prefers_friendly_activity_label() {
        assert_eq!(
            audit_activity_label(
                Some("Create policy"),
                Some("deviceManagementConfigurationPolicy"),
                Some("Create"),
                Some("POST"),
            ),
            "Create policy"
        );
        assert_eq!(
            audit_activity_label(None, None, None, Some("Patch")),
            "Patch"
        );
    }
}
