use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::graph::{GraphClient, GraphError};

const DEVICE_STATUS_MAX: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceDeviceStatusOverview {
    pub pending_count: Option<i64>,
    pub not_applicable_count: Option<i64>,
    pub success_count: Option<i64>,
    pub error_count: Option<i64>,
    pub failed_count: Option<i64>,
    pub conflict_count: Option<i64>,
    pub in_grace_period_count: Option<i64>,
    pub unknown_device_count: Option<i64>,
    pub last_update_date_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceDeviceStatus {
    pub id: Option<String>,
    pub device_id: Option<String>,
    pub device_display_name: Option<String>,
    pub device_model: Option<String>,
    pub user_name: Option<String>,
    pub user_principal_name: Option<String>,
    pub status: Option<String>,
    pub last_reported_date_time: Option<String>,
    pub compliance_grace_period_expiration_date_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceUserStatus {
    pub id: Option<String>,
    pub user_display_name: Option<String>,
    pub user_principal_name: Option<String>,
    pub devices_count: Option<i64>,
    pub status: Option<String>,
    pub last_reported_date_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceSettingStatusSummary {
    pub setting_name: Option<String>,
    pub setting_id: Option<String>,
    pub platform_type: Option<String>,
    pub number_of_compliant_devices: Option<i64>,
    pub number_of_non_compliant_devices: Option<i64>,
    pub number_of_unknown_devices: Option<i64>,
    pub number_of_not_applicable_devices: Option<i64>,
    pub number_of_error_devices: Option<i64>,
    pub number_of_conflict_devices: Option<i64>,
    pub number_of_other_devices: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceSettingsReportState {
    pub status: String,
    pub last_refresh_date_time: Option<String>,
    pub expiration_date_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompliancePolicyStatusReport {
    pub policy_id: String,
    pub devices: Vec<ComplianceDeviceStatus>,
    #[serde(default)]
    pub users: Vec<ComplianceUserStatus>,
    #[serde(default)]
    pub settings: Vec<ComplianceSettingStatusSummary>,
    pub truncated: bool,
    #[serde(default)]
    pub users_truncated: bool,
    pub fetched_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overview: Option<ComplianceDeviceStatusOverview>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings_report: Option<ComplianceSettingsReportState>,
}

fn encode_id(policy_id: &str) -> String {
    urlencoding::encode(policy_id).into_owned()
}

pub fn device_status_overview_path(policy_id: &str) -> String {
    format!(
        "/deviceManagement/deviceCompliancePolicies/{}/deviceStatusOverview",
        encode_id(policy_id)
    )
}

pub fn device_statuses_path(policy_id: &str) -> String {
    format!(
        "/deviceManagement/deviceCompliancePolicies/{}/deviceStatuses",
        encode_id(policy_id)
    )
}

pub fn user_statuses_path(policy_id: &str) -> String {
    format!(
        "/deviceManagement/deviceCompliancePolicies/{}/userStatuses",
        encode_id(policy_id)
    )
}

const SETTINGS_REPORT_NAME: &str = "DeviceStatusCompPolicySummaryOrgRptV3";
const SETTINGS_REPORT_ORDER: &[&str] = &[
    "PolicyId",
    "SettingId",
    "SettingName",
    "NumberOfCompliantDevices",
    "NumberOfNonCompliantDevices",
    "NumberOfNotEvaluatedDevices",
    "NumberOfErrorDevices",
    "NumberOfNotApplicableDevices",
    "NumberOfOtherDevices",
];
const SETTINGS_REPORT_CREATE_ORDER: &[&str] = &[
    "PolicyId asc",
    "SettingId asc",
    "SettingName asc",
    "NumberOfCompliantDevices asc",
    "NumberOfNonCompliantDevices asc",
    "NumberOfNotEvaluatedDevices asc",
    "NumberOfErrorDevices asc",
    "NumberOfNotApplicableDevices asc",
    "NumberOfOtherDevices asc",
];
const SETTINGS_REPORT_POLL_ATTEMPTS: usize = 12;
const SETTINGS_REPORT_POLL_MS: u64 = 2000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedReportConfiguration {
    status: Option<String>,
    last_refresh_date_time: Option<String>,
    expiration_date_time: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CachedReportPayload {
    #[serde(default, alias = "Schema")]
    schema: Vec<CachedReportColumn>,
    #[serde(default, alias = "Values")]
    values: Vec<serde_json::Value>,
    #[serde(default, alias = "TotalRowCount")]
    total_row_count: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct CachedReportColumn {
    #[serde(default, alias = "Column")]
    column: Option<String>,
    #[serde(default, alias = "Property")]
    property: Option<String>,
}

pub fn settings_report_id(policy_id: &str) -> String {
    format!("{SETTINGS_REPORT_NAME}_{policy_id}")
}

pub fn cached_report_configuration_path(policy_id: &str) -> String {
    format!(
        "/deviceManagement/reports/cachedReportConfigurations('{}')",
        settings_report_id(policy_id)
    )
}

fn settings_report_filter(policy_id: &str) -> String {
    format!("PolicyId eq '{policy_id}'")
}

fn settings_report_create_body(policy_id: &str) -> serde_json::Value {
    serde_json::json!({
        "id": settings_report_id(policy_id),
        "reportName": SETTINGS_REPORT_NAME,
        "filter": settings_report_filter(policy_id),
        "select": [],
        "orderBy": SETTINGS_REPORT_CREATE_ORDER,
    })
}

fn settings_report_fetch_body(policy_id: &str, skip: i64, top: i64) -> serde_json::Value {
    serde_json::json!({
        "id": settings_report_id(policy_id),
        "filter": settings_report_filter(policy_id),
        "select": [],
        "orderBy": SETTINGS_REPORT_ORDER,
        "skip": skip,
        "top": top,
    })
}

fn report_state_from_config(config: &CachedReportConfiguration) -> ComplianceSettingsReportState {
    ComplianceSettingsReportState {
        status: config
            .status
            .as_deref()
            .unwrap_or("unknown")
            .trim()
            .to_ascii_lowercase(),
        last_refresh_date_time: config.last_refresh_date_time.clone(),
        expiration_date_time: config.expiration_date_time.clone(),
    }
}

fn rows_from_cached_report(payload: &CachedReportPayload) -> Vec<serde_json::Value> {
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
                record.insert(key, cells.get(index).cloned().unwrap_or(serde_json::Value::Null));
            }
            serde_json::Value::Object(record)
        })
        .collect()
}

fn report_i64(row: &serde_json::Value, key: &str) -> Option<i64> {
    let wanted = key.to_ascii_lowercase();
    let value = row.get(key).or_else(|| {
        row.as_object().and_then(|map| {
            map.iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(&wanted))
                .map(|(_, value)| value)
        })
    })?;
    value
        .as_i64()
        .or_else(|| value.as_f64().map(|n| n as i64))
        .or_else(|| value.as_str()?.parse().ok())
}

fn report_string(row: &serde_json::Value, key: &str) -> Option<String> {
    let wanted = key.to_ascii_lowercase();
    let value = row.get(key).or_else(|| {
        row.as_object().and_then(|map| {
            map.iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(&wanted))
                .map(|(_, value)| value)
        })
    })?;
    match value {
        serde_json::Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        serde_json::Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn settings_from_cached_rows(rows: Vec<serde_json::Value>) -> Vec<ComplianceSettingStatusSummary> {
    rows.into_iter()
        .filter_map(|row| {
            let setting_name = report_string(&row, "SettingNm_loc")
                .or_else(|| report_string(&row, "SettingNm"))
                .or_else(|| report_string(&row, "SettingName"));
            let setting_id = report_string(&row, "SettingId");
            if setting_name.is_none() && setting_id.is_none() {
                return None;
            }
            Some(ComplianceSettingStatusSummary {
                setting_name,
                setting_id,
                platform_type: None,
                number_of_compliant_devices: report_i64(&row, "NumberOfCompliantDevices"),
                number_of_non_compliant_devices: report_i64(&row, "NumberOfNonCompliantDevices"),
                number_of_unknown_devices: report_i64(&row, "NumberOfNotEvaluatedDevices"),
                number_of_not_applicable_devices: report_i64(&row, "NumberOfNotApplicableDevices"),
                number_of_error_devices: report_i64(&row, "NumberOfErrorDevices"),
                number_of_conflict_devices: None,
                number_of_other_devices: report_i64(&row, "NumberOfOtherDevices"),
            })
        })
        .collect()
}

async fn get_cached_report_configuration(
    client: &GraphClient,
    access_token: &str,
    policy_id: &str,
) -> Result<Option<CachedReportConfiguration>, GraphError> {
    match client
        .fetch_plain::<CachedReportConfiguration>(
            access_token,
            &cached_report_configuration_path(policy_id),
            "beta",
        )
        .await
    {
        Ok(config) => Ok(Some(config)),
        Err(error) if error.status() == Some(404) => Ok(None),
        Err(error) => Err(error),
    }
}

async fn start_settings_report(
    client: &GraphClient,
    access_token: &str,
    policy_id: &str,
) -> Result<CachedReportConfiguration, GraphError> {
    if let Some(existing) = get_cached_report_configuration(client, access_token, policy_id).await? {
        let status = existing
            .status
            .as_deref()
            .unwrap_or("")
            .to_ascii_lowercase();
        if status == "inprogress" || status == "notstarted" {
            return Ok(existing);
        }
        let _ = client
            .delete(
                access_token,
                &cached_report_configuration_path(policy_id),
                "beta",
            )
            .await;
    }
    match client
        .post::<CachedReportConfiguration>(
            access_token,
            "/deviceManagement/reports/cachedReportConfigurations",
            "beta",
            &settings_report_create_body(policy_id),
        )
        .await
    {
        Ok(created) => Ok(created),
        Err(error) if error.status() == Some(409) => {
            get_cached_report_configuration(client, access_token, policy_id)
                .await?
                .ok_or(error)
        }
        Err(error) => Err(error),
    }
}

async fn poll_settings_report(
    client: &GraphClient,
    access_token: &str,
    policy_id: &str,
) -> Result<CachedReportConfiguration, GraphError> {
    for attempt in 0..SETTINGS_REPORT_POLL_ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(SETTINGS_REPORT_POLL_MS)).await;
        }
        let Some(config) = get_cached_report_configuration(client, access_token, policy_id).await?
        else {
            continue;
        };
        let status = config
            .status
            .as_deref()
            .unwrap_or("")
            .to_ascii_lowercase();
        if status == "completed" || status == "failed" {
            return Ok(config);
        }
    }
    get_cached_report_configuration(client, access_token, policy_id)
        .await?
        .ok_or_else(|| GraphError::Request {
            status: 202,
            code: None,
            message: "Intune is still generating the setting report.".into(),
            permission_related: false,
        })
}

async fn fetch_cached_setting_rows(
    client: &GraphClient,
    access_token: &str,
    policy_id: &str,
) -> Result<Vec<ComplianceSettingStatusSummary>, GraphError> {
    let first: CachedReportPayload = client
        .post_intune_report(
            access_token,
            "/deviceManagement/reports/getCachedReport",
            &settings_report_fetch_body(policy_id, 0, 50),
        )
        .await?;
    let mut rows = rows_from_cached_report(&first);
    let total = first.total_row_count.unwrap_or(rows.len() as i64);
    let mut skip = rows.len() as i64;
    while skip < total && skip < 500 {
        let page: CachedReportPayload = client
            .post_intune_report(
                access_token,
                "/deviceManagement/reports/getCachedReport",
                &settings_report_fetch_body(policy_id, skip, 50),
            )
            .await?;
        let next = rows_from_cached_report(&page);
        if next.is_empty() {
            break;
        }
        skip += next.len() as i64;
        rows.extend(next);
    }
    Ok(settings_from_cached_rows(rows))
}

async fn load_settings_report(
    client: &GraphClient,
    access_token: &str,
    policy_id: &str,
    generate: bool,
) -> Result<(Vec<ComplianceSettingStatusSummary>, ComplianceSettingsReportState), GraphError> {
    let config = if generate {
        let started = start_settings_report(client, access_token, policy_id).await?;
        let status = started
            .status
            .as_deref()
            .unwrap_or("")
            .to_ascii_lowercase();
        if status == "completed" {
            started
        } else {
            poll_settings_report(client, access_token, policy_id).await?
        }
    } else {
        match get_cached_report_configuration(client, access_token, policy_id).await? {
            Some(config) => config,
            None => {
                return Ok((
                    Vec::new(),
                    ComplianceSettingsReportState {
                        status: "missing".into(),
                        last_refresh_date_time: None,
                        expiration_date_time: None,
                    },
                ));
            }
        }
    };
    let state = report_state_from_config(&config);
    if state.status != "completed" {
        return Ok((Vec::new(), state));
    }
    let settings = fetch_cached_setting_rows(client, access_token, policy_id).await?;
    Ok((settings, state))
}

fn sort_by_reported<T>(
    items: &mut [T],
    reported: impl Fn(&T) -> Option<&str>,
) {
    items.sort_by(|left, right| reported(right).cmp(&reported(left)));
}

async fn page_states<T: serde::de::DeserializeOwned + Send + 'static>(
    client: &GraphClient,
    access_token: &str,
    path: &str,
) -> Result<(Vec<T>, bool), GraphError> {
    let mut items = client
        .fetch_all_pages::<T>(access_token, path, "beta", DEVICE_STATUS_MAX + 1)
        .await?;
    let truncated = items.len() > DEVICE_STATUS_MAX;
    if truncated {
        items.truncate(DEVICE_STATUS_MAX);
    }
    Ok((items, truncated))
}

pub async fn fetch_compliance_policy_status(
    access_token: &str,
    policy_id: &str,
) -> Result<CompliancePolicyStatusReport, GraphError> {
    fetch_compliance_policy_status_with_options(access_token, policy_id, false).await
}

pub async fn fetch_compliance_policy_status_with_options(
    access_token: &str,
    policy_id: &str,
    generate_settings: bool,
) -> Result<CompliancePolicyStatusReport, GraphError> {
    let client = GraphClient::new();
    let overview = client
        .fetch_plain::<ComplianceDeviceStatusOverview>(
            access_token,
            &device_status_overview_path(policy_id),
            "beta",
        )
        .await
        .ok();
    let (mut devices, truncated) = match page_states::<ComplianceDeviceStatus>(
        &client,
        access_token,
        &device_statuses_path(policy_id),
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            if overview.is_none() {
                return Err(error);
            }
            (Vec::new(), false)
        }
    };
    sort_by_reported(&mut devices, |row| row.last_reported_date_time.as_deref());

    let (mut users, users_truncated) =
        match page_states::<ComplianceUserStatus>(&client, access_token, &user_statuses_path(policy_id))
            .await
        {
            Ok(result) => result,
            Err(_) => (Vec::new(), false),
        };
    sort_by_reported(&mut users, |row| row.last_reported_date_time.as_deref());

    let (settings, settings_report) =
        match load_settings_report(&client, access_token, policy_id, generate_settings).await {
            Ok(result) => result,
            Err(error) if error.status() == Some(202) => (
                Vec::new(),
                ComplianceSettingsReportState {
                    status: "inProgress".into(),
                    last_refresh_date_time: None,
                    expiration_date_time: None,
                },
            ),
            Err(_) => (
                Vec::new(),
                ComplianceSettingsReportState {
                    status: "missing".into(),
                    last_refresh_date_time: None,
                    expiration_date_time: None,
                },
            ),
        };

    Ok(CompliancePolicyStatusReport {
        policy_id: policy_id.to_string(),
        devices,
        users,
        settings,
        truncated,
        users_truncated,
        fetched_at: Utc::now().to_rfc3339(),
        overview,
        settings_report: Some(settings_report),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_paths_use_policy_id() {
        let id = "501fca29-8fa7-4d23-a332-a5d2deb4390e";
        assert_eq!(
            device_status_overview_path(id),
            "/deviceManagement/deviceCompliancePolicies/501fca29-8fa7-4d23-a332-a5d2deb4390e/deviceStatusOverview"
        );
        assert_eq!(
            device_statuses_path(id),
            "/deviceManagement/deviceCompliancePolicies/501fca29-8fa7-4d23-a332-a5d2deb4390e/deviceStatuses"
        );
        assert_eq!(
            user_statuses_path(id),
            "/deviceManagement/deviceCompliancePolicies/501fca29-8fa7-4d23-a332-a5d2deb4390e/userStatuses"
        );
        assert_eq!(
            cached_report_configuration_path(id),
            "/deviceManagement/reports/cachedReportConfigurations('DeviceStatusCompPolicySummaryOrgRptV3_501fca29-8fa7-4d23-a332-a5d2deb4390e')"
        );
        assert_eq!(
            settings_report_id(id),
            "DeviceStatusCompPolicySummaryOrgRptV3_501fca29-8fa7-4d23-a332-a5d2deb4390e"
        );
    }

    #[test]
    fn maps_cached_setting_report_rows() {
        let payload: CachedReportPayload = serde_json::from_str(
            r#"{
                "TotalRowCount": 3,
                "Schema": [
                    { "Column": "SettingId", "PropertyType": "String" },
                    { "Column": "PolicyId", "PropertyType": "String" },
                    { "Column": "SettingName", "PropertyType": "String" },
                    { "Column": "SettingNm", "PropertyType": "String" },
                    { "Column": "SettingNm_loc", "PropertyType": "String" },
                    { "Column": "NumberOfNotEvaluatedDevices", "PropertyType": "Int64" },
                    { "Column": "NumberOfNotApplicableDevices", "PropertyType": "Int64" },
                    { "Column": "NumberOfCompliantDevices", "PropertyType": "Int64" },
                    { "Column": "NumberOfNonCompliantDevices", "PropertyType": "Int64" },
                    { "Column": "NumberOfErrorDevices", "PropertyType": "Int64" },
                    { "Column": "NumberOfOtherDevices", "PropertyType": "Int64" }
                ],
                "Values": [
                    ["7d084d5c-b6c4-4804-20ce-e4220a163b67","0e120899-a5d6-44cb-90c3-e880649e6cd6","Windows10CompliancePolicy.SecureBootEnabled","Windows10CompliancePolicySecureBootEnabled","Secure Boot",0,0,0,1,0,0]
                ]
            }"#,
        )
        .unwrap();
        let settings = settings_from_cached_rows(rows_from_cached_report(&payload));
        assert_eq!(settings[0].setting_name.as_deref(), Some("Secure Boot"));
        assert_eq!(settings[0].number_of_non_compliant_devices, Some(1));
        assert_eq!(settings[0].number_of_compliant_devices, Some(0));
    }

    #[test]
    fn parses_overview_and_device_status() {
        let overview: ComplianceDeviceStatusOverview = serde_json::from_str(
            r#"{
                "pendingCount": 1,
                "successCount": 12,
                "failedCount": 3,
                "errorCount": 0,
                "conflictCount": 0,
                "notApplicableCount": 2,
                "inGracePeriodCount": 1,
                "lastUpdateDateTime": "2026-08-30T08:00:00Z"
            }"#,
        )
        .unwrap();
        assert_eq!(overview.success_count, Some(12));
        assert_eq!(overview.failed_count, Some(3));
        assert_eq!(overview.in_grace_period_count, Some(1));

        let device: ComplianceDeviceStatus = serde_json::from_str(
            r#"{
                "id": "device-1",
                "deviceDisplayName": "BISKIT-02",
                "userPrincipalName": "jakea@mrbiskit.online",
                "deviceModel": "Surface Laptop",
                "status": "nonCompliant",
                "lastReportedDateTime": "2026-08-30T08:11:00Z",
                "complianceGracePeriodExpirationDateTime": "2026-09-06T08:11:00Z"
            }"#,
        )
        .unwrap();
        assert_eq!(device.device_display_name.as_deref(), Some("BISKIT-02"));
        assert_eq!(device.status.as_deref(), Some("nonCompliant"));
    }
}
