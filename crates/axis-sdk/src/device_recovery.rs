use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::device_actions::rotate_local_admin_password;
use crate::graph::{GraphClient, GraphError};

const LAPS_HEADERS: &[(&str, &str)] = &[
    ("User-Agent", "Axis/1.0 (Windows; Device recovery)"),
    ("ocp-client-name", "Axis"),
    ("ocp-client-version", "1.0"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitLockerRecoveryKeySummary {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LapsCredential {
    pub account_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_sid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LapsCredentialInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_backup_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_date_time: Option<String>,
    pub credentials: Vec<LapsCredential>,
}

fn json_str(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn map_volume_type(value: Option<String>) -> Option<String> {
    match value.as_deref() {
        Some("1") | Some("operatingSystemVolume") => Some("OS volume".into()),
        Some("2") | Some("fixedDataVolume") => Some("Fixed data volume".into()),
        Some("3") | Some("removableDataVolume") => Some("Removable data volume".into()),
        Some(other) => Some(other.to_string()),
        None => None,
    }
}

fn map_bitlocker_key(raw: &Value) -> Option<BitLockerRecoveryKeySummary> {
    let id = json_str(raw, "id")?;
    Some(BitLockerRecoveryKeySummary {
        id,
        created_date_time: json_str(raw, "createdDateTime"),
        device_id: json_str(raw, "deviceId"),
        volume_type: map_volume_type(json_str(raw, "volumeType")),
        key: json_str(raw, "key"),
    })
}

pub fn decode_laps_password_base64(value: &str) -> String {
    use base64::Engine;
    let normalized: String = value.chars().filter(|ch| !ch.is_whitespace()).collect();
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(normalized.as_bytes()) else {
        return value.to_string();
    };
    if bytes.is_empty() {
        return String::new();
    }
    let is_utf16le = bytes.len() >= 2 && bytes[1] == 0;
    if is_utf16le {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

pub async fn list_bitlocker_recovery_keys(
    access_token: &str,
    entra_device_id: &str,
) -> Result<Vec<BitLockerRecoveryKeySummary>, GraphError> {
    let id = entra_device_id.trim();
    if id.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Entra device id is required for BitLocker keys.".into(),
            permission_related: false,
        });
    }
    let escaped = id.replace('\'', "''");
    let client = GraphClient::new();
    let payload: Value = client
        .fetch_plain(
            access_token,
            &format!(
                "/informationProtection/bitlocker/recoveryKeys?$filter=deviceId eq '{escaped}'"
            ),
            "v1.0",
        )
        .await
        .map_err(|error| annotate_scope(error, "BitlockerKey.Read.All"))?;
    let mut keys = payload
        .get("value")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(map_bitlocker_key)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    keys.sort_by(|a, b| {
        b.created_date_time
            .as_deref()
            .unwrap_or_default()
            .cmp(a.created_date_time.as_deref().unwrap_or_default())
    });
    Ok(keys)
}

pub async fn reveal_bitlocker_recovery_key(
    access_token: &str,
    recovery_key_id: &str,
) -> Result<BitLockerRecoveryKeySummary, GraphError> {
    let client = GraphClient::new();
    let raw: Value = client
        .fetch_plain(
            access_token,
            &format!(
                "/informationProtection/bitlocker/recoveryKeys/{}?$select=id,createdDateTime,volumeType,deviceId,key",
                urlencoding::encode(recovery_key_id)
            ),
            "v1.0",
        )
        .await
        .map_err(|error| annotate_scope(error, "BitlockerKey.Read.All"))?;
    let mapped = map_bitlocker_key(&raw).ok_or_else(|| GraphError::Request {
        status: 404,
        code: None,
        message: "BitLocker key was not returned. Check BitlockerKey.Read.All and your Entra role."
            .into(),
        permission_related: true,
    })?;
    if mapped.key.is_none() {
        return Err(GraphError::Request {
            status: 403,
            code: None,
            message:
                "BitLocker key was not returned. Check BitlockerKey.Read.All and your Entra role."
                    .into(),
            permission_related: true,
        });
    }
    Ok(mapped)
}

pub async fn get_laps_credential_info(
    access_token: &str,
    entra_device_id: &str,
) -> Result<LapsCredentialInfo, GraphError> {
    let id = entra_device_id.trim();
    if id.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Entra device id is required for LAPS.".into(),
            permission_related: false,
        });
    }
    let client = GraphClient::new();
    let raw: Value = client
        .fetch_with_headers(
            access_token,
            &format!(
                "/directory/deviceLocalCredentials/{}",
                urlencoding::encode(id)
            ),
            "v1.0",
            LAPS_HEADERS,
        )
        .await
        .map_err(|error| annotate_scope(error, "DeviceLocalCredential.Read.All"))?;
    Ok(LapsCredentialInfo {
        id: json_str(&raw, "id").unwrap_or_else(|| id.to_string()),
        device_name: json_str(&raw, "deviceName"),
        last_backup_date_time: json_str(&raw, "lastBackupDateTime"),
        refresh_date_time: json_str(&raw, "refreshDateTime"),
        credentials: vec![],
    })
}

pub async fn reveal_laps_credentials(
    access_token: &str,
    entra_device_id: &str,
) -> Result<LapsCredentialInfo, GraphError> {
    let id = entra_device_id.trim();
    if id.is_empty() {
        return Err(GraphError::Request {
            status: 400,
            code: None,
            message: "Entra device id is required for LAPS.".into(),
            permission_related: false,
        });
    }
    let client = GraphClient::new();
    let raw: Value = client
        .fetch_with_headers(
            access_token,
            &format!(
                "/directory/deviceLocalCredentials/{}?$select=id,deviceName,lastBackupDateTime,refreshDateTime,credentials",
                urlencoding::encode(id)
            ),
            "v1.0",
            LAPS_HEADERS,
        )
        .await
        .map_err(|error| annotate_scope(error, "DeviceLocalCredential.Read.All"))?;
    let credentials = raw
        .get("credentials")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let account_name = json_str(row, "accountName")?;
                    let password = json_str(row, "passwordBase64")
                        .map(|value| decode_laps_password_base64(&value));
                    Some(LapsCredential {
                        account_name,
                        account_sid: json_str(row, "accountSid"),
                        backup_date_time: json_str(row, "backupDateTime"),
                        password,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(LapsCredentialInfo {
        id: json_str(&raw, "id").unwrap_or_else(|| id.to_string()),
        device_name: json_str(&raw, "deviceName"),
        last_backup_date_time: json_str(&raw, "lastBackupDateTime"),
        refresh_date_time: json_str(&raw, "refreshDateTime"),
        credentials,
    })
}

pub async fn rotate_managed_device_laps_password(
    access_token: &str,
    managed_device_id: &str,
) -> Result<(), GraphError> {
    rotate_local_admin_password(access_token, managed_device_id)
        .await
        .map_err(|error| {
            annotate_scope(
                error,
                "DeviceManagementManagedDevices.PrivilegedOperations.All",
            )
        })
}

fn annotate_scope(error: GraphError, scope: &str) -> GraphError {
    if !error.permission_related() {
        return error;
    }
    match error {
        GraphError::Request {
            status,
            code,
            message,
            permission_related,
        } => GraphError::Request {
            status,
            code,
            message: format!("{message} (needs {scope} on the token)"),
            permission_related,
        },
        other => other,
    }
}
