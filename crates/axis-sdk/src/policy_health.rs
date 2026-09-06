use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::graph::{GraphClient, GraphError};

#[derive(Debug, Clone, Default)]
pub struct PolicyHealth {
    pub policy_id: String,
    pub policy_name: String,
    pub platform: Option<String>,
    pub compliant: u32,
    pub noncompliant: u32,
    pub error: u32,
    pub conflict: u32,
    pub not_applicable: u32,
}

impl PolicyHealth {
    pub fn targeted_devices(&self) -> u32 {
        self.compliant
            .saturating_add(self.noncompliant)
            .saturating_add(self.error)
            .saturating_add(self.conflict)
    }

    pub fn has_conflict(&self) -> bool {
        self.conflict > 0
    }
}

#[derive(Debug, Deserialize)]
struct IntuneReportPayload {
    #[serde(default, rename = "Schema", alias = "schema")]
    schema: Vec<ReportColumn>,
    #[serde(default, rename = "Values", alias = "values")]
    values: Vec<Value>,
    #[serde(default, rename = "TotalRowCount", alias = "totalRowCount")]
    total_row_count: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ReportColumn {
    #[serde(default, rename = "Column", alias = "column")]
    column: Option<String>,
    #[serde(default, rename = "Property", alias = "property")]
    property: Option<String>,
}

const REPORT_PATHS: &[&str] = &[
    "/deviceManagement/reports/getConfigurationPolicyNoncomplianceSummaryReport",
    "/deviceManagement/reports/getConfigurationPolicyNonComplianceSummaryReport",
];

const SELECT: &[&str] = &[
    "PolicyId",
    "PolicyName",
    "PolicyPlatformType",
    "UnifiedPolicyPlatformType",
    "NumberOfCompliantDevices",
    "NumberOfNonCompliantDevices",
    "NumberOfErrorDevices",
    "NumberOfConflictDevices",
    "NumberOfNotApplicableDevices",
    "NumberOfNonCompliantOrErrorDevices",
];

pub async fn fetch_configuration_policy_health(
    access_token: &str,
) -> Result<Vec<PolicyHealth>, GraphError> {
    let client = GraphClient::new();
    let mut last_error = None;
    for path in REPORT_PATHS {
        match fetch_report_pages(&client, access_token, path, SELECT).await {
            Ok(payload) => {
                return Ok(rows_from_report(&payload)
                    .into_iter()
                    .filter_map(map_health)
                    .collect());
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| GraphError::Request {
        status: 500,
        code: None,
        message: "Configuration policy noncompliance report was not available.".into(),
        permission_related: false,
    }))
}

pub fn index_policy_health(rows: &[PolicyHealth]) -> HashMap<String, PolicyHealth> {
    let mut map = HashMap::new();
    for row in rows {
        if !row.policy_id.is_empty() {
            map.insert(row.policy_id.to_ascii_lowercase(), row.clone());
        }
        if !row.policy_name.is_empty() {
            map.entry(format!("name:{}", row.policy_name.to_ascii_lowercase()))
                .or_insert_with(|| row.clone());
        }
    }
    map
}

pub fn lookup_policy_health<'a>(
    index: &'a HashMap<String, PolicyHealth>,
    id: &str,
    name: &str,
) -> Option<&'a PolicyHealth> {
    let id = id.trim();
    if !id.is_empty() {
        if let Some(row) = index.get(&id.to_ascii_lowercase()) {
            return Some(row);
        }
    }
    let name = name.trim();
    if !name.is_empty() {
        return index.get(&format!("name:{}", name.to_ascii_lowercase()));
    }
    None
}

#[derive(Debug, Clone, Default)]
pub struct AppInstallHealth {
    pub app_id: String,
    pub app_name: String,
    pub installed: u32,
    pub failed: u32,
    pub not_installed: u32,
    pub pending: u32,
    pub not_applicable: u32,
}

const APP_REPORT_PATHS: &[&str] = &[
    "/deviceManagement/reports/getAppsInstallSummaryReport",
];

const APP_SELECT: &[&str] = &[
    "ApplicationId",
    "DisplayName",
    "InstalledDeviceCount",
    "FailedDeviceCount",
    "NotInstalledDeviceCount",
    "PendingInstallDeviceCount",
    "NotApplicableDeviceCount",
];

pub async fn fetch_app_install_health(
    access_token: &str,
) -> Result<Vec<AppInstallHealth>, GraphError> {
    let client = GraphClient::new();
    let mut last_error = None;
    for path in APP_REPORT_PATHS {
        match fetch_report_pages(&client, access_token, path, APP_SELECT).await {
            Ok(payload) => {
                return Ok(rows_from_report(&payload)
                    .into_iter()
                    .filter_map(map_app_install)
                    .collect());
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| GraphError::Request {
        status: 500,
        code: None,
        message: "App install summary report was not available.".into(),
        permission_related: false,
    }))
}

pub fn index_app_install(rows: &[AppInstallHealth]) -> HashMap<String, AppInstallHealth> {
    let mut map = HashMap::new();
    for row in rows {
        if !row.app_id.is_empty() {
            map.insert(row.app_id.to_ascii_lowercase(), row.clone());
        }
        if !row.app_name.is_empty() {
            map.entry(format!("name:{}", row.app_name.to_ascii_lowercase()))
                .or_insert_with(|| row.clone());
        }
    }
    map
}

pub fn lookup_app_install<'a>(
    index: &'a HashMap<String, AppInstallHealth>,
    id: &str,
    name: &str,
) -> Option<&'a AppInstallHealth> {
    let id = id.trim();
    if !id.is_empty() {
        if let Some(row) = index.get(&id.to_ascii_lowercase()) {
            return Some(row);
        }
    }
    let name = name.trim();
    if !name.is_empty() {
        return index.get(&format!("name:{}", name.to_ascii_lowercase()));
    }
    None
}

fn map_app_install(row: Value) -> Option<AppInstallHealth> {
    let app_id = report_string(&row, "ApplicationId");
    let app_name = report_string(&row, "DisplayName");
    if app_id.is_empty() && app_name.is_empty() {
        return None;
    }
    Some(AppInstallHealth {
        app_id,
        app_name,
        installed: report_u32(&row, "InstalledDeviceCount"),
        failed: report_u32(&row, "FailedDeviceCount"),
        not_installed: report_u32(&row, "NotInstalledDeviceCount"),
        pending: report_u32(&row, "PendingInstallDeviceCount"),
        not_applicable: report_u32(&row, "NotApplicableDeviceCount"),
    })
}

async fn fetch_report_pages(
    client: &GraphClient,
    access_token: &str,
    path: &str,
    select: &[&str],
) -> Result<IntuneReportPayload, GraphError> {
    let page_size = 50i64;
    let base = json!({
        "select": select,
        "filter": "",
        "skip": 0,
        "top": page_size,
    });
    let first: IntuneReportPayload = client.post_intune_report(access_token, path, &base).await?;
    let mut values = first.values.clone();
    let schema = first.schema;
    let total = first.total_row_count.filter(|value| *value >= 0);
    let mut skip = values.len() as i64;
    while skip < 5000 {
        let done = match total {
            Some(total) => skip >= total,
            None => values.len() < page_size as usize || skip == 0,
        };
        if done {
            break;
        }
        let page_body = json!({
            "select": select,
            "filter": "",
            "skip": skip,
            "top": page_size,
        });
        let page: IntuneReportPayload = client
            .post_intune_report(access_token, path, &page_body)
            .await?;
        if page.values.is_empty() {
            break;
        }
        let page_len = page.values.len() as i64;
        values.extend(page.values);
        skip += page_len;
    }
    Ok(IntuneReportPayload {
        schema,
        values,
        total_row_count: total,
    })
}

fn rows_from_report(payload: &IntuneReportPayload) -> Vec<Value> {
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

fn map_health(row: Value) -> Option<PolicyHealth> {
    let policy_id = report_string(&row, "PolicyId");
    let policy_name = report_string(&row, "PolicyName");
    if policy_id.is_empty() && policy_name.is_empty() {
        return None;
    }
    let platform = [
        report_string(&row, "UnifiedPolicyPlatformType"),
        report_string(&row, "PolicyPlatformType"),
    ]
    .into_iter()
    .find(|value| !value.is_empty());
    Some(PolicyHealth {
        policy_id,
        policy_name,
        platform,
        compliant: report_u32(&row, "NumberOfCompliantDevices"),
        noncompliant: report_u32(&row, "NumberOfNonCompliantDevices"),
        error: report_u32(&row, "NumberOfErrorDevices"),
        conflict: report_u32(&row, "NumberOfConflictDevices"),
        not_applicable: report_u32(&row, "NumberOfNotApplicableDevices"),
    })
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

fn report_u32(row: &Value, key: &str) -> u32 {
    match report_field(row, key) {
        Some(Value::Number(value)) => value.as_u64().or_else(|| value.as_i64().map(|n| n.max(0) as u64)).unwrap_or(0) as u32,
        Some(Value::String(value)) => value.parse::<f64>().ok().map(|n| n.max(0.0) as u32).unwrap_or(0),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_array_rows_from_schema() {
        let payload = IntuneReportPayload {
            schema: vec![
                ReportColumn {
                    column: Some("PolicyId".into()),
                    property: None,
                },
                ReportColumn {
                    column: Some("PolicyName".into()),
                    property: None,
                },
                ReportColumn {
                    column: Some("NumberOfConflictDevices".into()),
                    property: None,
                },
                ReportColumn {
                    column: Some("NumberOfCompliantDevices".into()),
                    property: None,
                },
            ],
            values: vec![json!(["pol-1", "BitLocker", 12, 80])],
            total_row_count: Some(1),
        };
        let rows = rows_from_report(&payload);
        let health = map_health(rows[0].clone()).unwrap();
        assert_eq!(health.policy_id, "pol-1");
        assert_eq!(health.conflict, 12);
        assert_eq!(health.compliant, 80);
        assert_eq!(health.targeted_devices(), 92);
    }

    #[test]
    fn maps_app_install_rows() {
        let payload = IntuneReportPayload {
            schema: vec![
                ReportColumn {
                    column: Some("ApplicationId".into()),
                    property: None,
                },
                ReportColumn {
                    column: Some("DisplayName".into()),
                    property: None,
                },
                ReportColumn {
                    column: Some("InstalledDeviceCount".into()),
                    property: None,
                },
                ReportColumn {
                    column: Some("FailedDeviceCount".into()),
                    property: None,
                },
                ReportColumn {
                    column: Some("PendingInstallDeviceCount".into()),
                    property: None,
                },
            ],
            values: vec![json!(["app-1", "Company Portal", 40, 2, 3])],
            total_row_count: Some(1),
        };
        let rows = rows_from_report(&payload);
        let health = map_app_install(rows[0].clone()).unwrap();
        assert_eq!(health.app_id, "app-1");
        assert_eq!(health.installed, 40);
        assert_eq!(health.failed, 2);
        assert_eq!(health.pending, 3);
    }
}
