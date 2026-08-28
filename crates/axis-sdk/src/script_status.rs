use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::graph::{GraphClient, GraphError};

const DEVICE_RUN_STATES_MAX: usize = 2000;

const REMEDIATION_DEVICE_SELECT: &str = concat!(
    "assignmentFilterIds,detectionState,lastStateUpdateDateTime,",
    "postRemediationDetectionScriptError,postRemediationDetectionScriptOutput,",
    "preRemediationDetectionScriptError,preRemediationDetectionScriptOutput,",
    "remediationScriptError,remediationState"
);

const PLATFORM_DEVICE_SELECT: &str =
    "id,lastStateUpdateDateTime,runState,errorCode,errorDescription,resultMessage";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScriptStatusFamily {
    Remediation,
    PlatformPowershell,
    PlatformShell,
}

impl ScriptStatusFamily {
    fn parse(kind: &str) -> Result<Self, GraphError> {
        match kind {
            "script:remediation" | "remediation" => Ok(Self::Remediation),
            "script:platform-powershell" | "platform-powershell" => Ok(Self::PlatformPowershell),
            "script:platform-shell" | "platform-shell" => Ok(Self::PlatformShell),
            other => Err(GraphError::Request {
                status: 400,
                code: None,
                message: format!("No run-state report for {other}."),
                permission_related: false,
            }),
        }
    }

    fn collection(self) -> &'static str {
        match self {
            Self::Remediation => "deviceHealthScripts",
            Self::PlatformPowershell => "deviceManagementScripts",
            Self::PlatformShell => "deviceShellScripts",
        }
    }

    fn is_remediation(self) -> bool {
        matches!(self, Self::Remediation)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemediationRunManagedDevice {
    pub id: Option<String>,
    pub device_name: Option<String>,
    pub os_version: Option<String>,
    pub user_id: Option<String>,
    pub user_principal_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemediationDeviceRunState {
    pub id: Option<String>,
    pub run_state: Option<String>,
    pub error_code: Option<i64>,
    #[serde(default)]
    pub error_description: String,
    #[serde(default)]
    pub result_message: String,
    #[serde(default)]
    pub assignment_filter_ids: Vec<String>,
    pub detection_state: Option<String>,
    pub last_state_update_date_time: Option<String>,
    #[serde(default)]
    pub post_remediation_detection_script_error: String,
    #[serde(default)]
    pub post_remediation_detection_script_output: String,
    #[serde(default)]
    pub pre_remediation_detection_script_error: String,
    #[serde(default)]
    pub pre_remediation_detection_script_output: String,
    #[serde(default)]
    pub remediation_script_error: String,
    pub remediation_state: Option<String>,
    pub managed_device: Option<RemediationRunManagedDevice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemediationRunSummary {
    pub no_issue_detected_device_count: Option<i64>,
    pub issue_detected_device_count: Option<i64>,
    pub detection_script_error_device_count: Option<i64>,
    pub detection_script_pending_device_count: Option<i64>,
    pub issue_remediated_device_count: Option<i64>,
    pub remediation_script_error_device_count: Option<i64>,
    pub unknown_device_count: Option<i64>,
    pub last_script_run_date_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScriptUserRunState {
    pub id: Option<String>,
    pub user_principal_name: Option<String>,
    pub success_device_count: Option<i64>,
    pub error_device_count: Option<i64>,
    pub pending_device_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemediationDeviceStatusReport {
    pub script_id: String,
    pub kind: String,
    pub family: String,
    pub states: Vec<RemediationDeviceRunState>,
    #[serde(default)]
    pub user_states: Vec<ScriptUserRunState>,
    pub truncated: bool,
    #[serde(default)]
    pub users_truncated: bool,
    pub fetched_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<RemediationRunSummary>,
}

fn encode_id(script_id: &str) -> String {
    urlencoding::encode(script_id).into_owned()
}

pub fn device_run_states_path(kind: &str, script_id: &str) -> Result<String, GraphError> {
    let family = ScriptStatusFamily::parse(kind)?;
    let enc = encode_id(script_id);
    let collection = family.collection();
    Ok(if family.is_remediation() {
        format!(
            "/deviceManagement/{collection}/{enc}/deviceRunStates?$select={REMEDIATION_DEVICE_SELECT}&$expand=managedDevice($select=id,deviceName,osVersion,userId,userPrincipalName)"
        )
    } else {
        format!(
            "/deviceManagement/{collection}/{enc}/deviceRunStates?$select={PLATFORM_DEVICE_SELECT}&$expand=managedDevice($select=deviceName,userPrincipalName,osVersion)"
        )
    })
}

pub fn user_run_states_path(kind: &str, script_id: &str) -> Result<String, GraphError> {
    let family = ScriptStatusFamily::parse(kind)?;
    let enc = encode_id(script_id);
    Ok(format!(
        "/deviceManagement/{}/{enc}/userRunStates",
        family.collection()
    ))
}

pub fn run_summary_path(script_id: &str) -> String {
    let enc = encode_id(script_id);
    format!("/deviceManagement/deviceHealthScripts/{enc}/runSummary")
}

fn sort_device_states(states: &mut [RemediationDeviceRunState]) {
    states.sort_by(|left, right| {
        right
            .last_state_update_date_time
            .as_deref()
            .cmp(&left.last_state_update_date_time.as_deref())
    });
}

async fn page_states<T: serde::de::DeserializeOwned + Send + 'static>(
    client: &GraphClient,
    access_token: &str,
    path: &str,
) -> Result<(Vec<T>, bool), GraphError> {
    let mut items = client
        .fetch_all_pages::<T>(access_token, path, "beta", DEVICE_RUN_STATES_MAX + 1)
        .await?;
    let truncated = items.len() > DEVICE_RUN_STATES_MAX;
    if truncated {
        items.truncate(DEVICE_RUN_STATES_MAX);
    }
    Ok((items, truncated))
}

pub async fn fetch_script_run_status(
    access_token: &str,
    kind: &str,
    script_id: &str,
) -> Result<RemediationDeviceStatusReport, GraphError> {
    let family = ScriptStatusFamily::parse(kind)?;
    let client = GraphClient::new();
    let device_path = device_run_states_path(kind, script_id)?;
    let (mut states, truncated) =
        page_states::<RemediationDeviceRunState>(&client, access_token, &device_path).await?;
    sort_device_states(&mut states);

    let (user_states, users_truncated) = if family.is_remediation() {
        (Vec::new(), false)
    } else {
        let path = user_run_states_path(kind, script_id)?;
        page_states::<ScriptUserRunState>(&client, access_token, &path)
            .await
            .unwrap_or_else(|_| (Vec::new(), false))
    };

    let summary = if family.is_remediation() {
        client
            .fetch_plain::<RemediationRunSummary>(access_token, &run_summary_path(script_id), "beta")
            .await
            .ok()
    } else {
        None
    };

    Ok(RemediationDeviceStatusReport {
        script_id: script_id.to_string(),
        kind: kind.to_string(),
        family: if family.is_remediation() {
            "remediation".into()
        } else {
            "platform".into()
        },
        states,
        user_states,
        truncated,
        users_truncated,
        fetched_at: Utc::now().to_rfc3339(),
        summary,
    })
}

pub async fn fetch_remediation_device_status(
    access_token: &str,
    script_id: &str,
) -> Result<RemediationDeviceStatusReport, GraphError> {
    fetch_script_run_status(access_token, "script:remediation", script_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remediation_device_path() {
        let path = device_run_states_path(
            "script:remediation",
            "501fca29-8fa7-4d23-a332-a5d2deb4390e",
        )
        .unwrap();
        assert!(path.contains("/deviceManagement/deviceHealthScripts/501fca29-8fa7-4d23-a332-a5d2deb4390e/deviceRunStates"));
        assert!(path.contains("preRemediationDetectionScriptError"));
    }

    #[test]
    fn platform_device_path_matches_portal() {
        let path = device_run_states_path(
            "script:platform-powershell",
            "8d52e6fc-8e5a-4c3a-9a1d-3434c48cdc16",
        )
        .unwrap();
        assert!(path.contains("/deviceManagement/deviceManagementScripts/8d52e6fc-8e5a-4c3a-9a1d-3434c48cdc16/deviceRunStates"));
        assert!(path.contains("$select=id,lastStateUpdateDateTime,runState"));
        assert!(path.contains("$expand=managedDevice($select=deviceName,userPrincipalName,osVersion)"));
    }

    #[test]
    fn platform_user_path() {
        let path = user_run_states_path(
            "script:platform-powershell",
            "8d52e6fc-8e5a-4c3a-9a1d-3434c48cdc16",
        )
        .unwrap();
        assert_eq!(
            path,
            "/deviceManagement/deviceManagementScripts/8d52e6fc-8e5a-4c3a-9a1d-3434c48cdc16/userRunStates"
        );
    }

    #[test]
    fn shell_uses_device_shell_scripts() {
        let path =
            device_run_states_path("script:platform-shell", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
                .unwrap();
        assert!(path.contains("/deviceManagement/deviceShellScripts/"));
    }

    #[test]
    fn parses_portal_device_run_state() {
        let json = r#"{
            "assignmentFilterIds": [],
            "detectionState": "fail",
            "lastStateUpdateDateTime": "2026-08-28T11:20:30Z",
            "postRemediationDetectionScriptError": "",
            "postRemediationDetectionScriptOutput": "",
            "preRemediationDetectionScriptError": "File C:\\WINDOWS\\IMECache\\detect.ps1 cannot be loaded.",
            "preRemediationDetectionScriptOutput": "",
            "remediationScriptError": "File C:\\WINDOWS\\IMECache\\remediate.ps1 cannot be loaded.",
            "remediationState": "scriptError",
            "managedDevice": {
                "id": "f8a6afb3-8824-427b-82e8-8f22929e119f",
                "deviceName": "BISKIT-02",
                "osVersion": "10.0.26200.9168",
                "userId": "7cc26d96-048b-419d-a47c-81c0373bca5c",
                "userPrincipalName": "jakea@mrbiskit.online"
            }
        }"#;
        let row: RemediationDeviceRunState = serde_json::from_str(json).unwrap();
        assert_eq!(row.detection_state.as_deref(), Some("fail"));
        assert_eq!(row.remediation_state.as_deref(), Some("scriptError"));
        assert!(row
            .pre_remediation_detection_script_error
            .contains("cannot be loaded"));
        assert_eq!(
            row.managed_device
                .as_ref()
                .and_then(|device| device.device_name.as_deref()),
            Some("BISKIT-02")
        );
    }

    #[test]
    fn parses_platform_device_and_user_states() {
        let device: RemediationDeviceRunState = serde_json::from_str(
            r#"{
                "id": "8d52e6fc-8e5a-4c3a-9a1d-3434c48cdc16:f8a6afb3-8824-427b-82e8-8f22929e119f",
                "lastStateUpdateDateTime": "2026-08-28T19:19:56Z",
                "runState": "fail",
                "managedDevice": {
                    "deviceName": "BISKIT-02",
                    "userPrincipalName": "jakea@mrbiskit.online",
                    "osVersion": "10.0.26200.9168"
                }
            }"#,
        )
        .unwrap();
        assert_eq!(device.run_state.as_deref(), Some("fail"));
        assert_eq!(
            device
                .managed_device
                .as_ref()
                .and_then(|row| row.device_name.as_deref()),
            Some("BISKIT-02")
        );

        let user: ScriptUserRunState = serde_json::from_str(
            r#"{
                "id": "8d52e6fc-8e5a-4c3a-9a1d-3434c48cdc16:7cc26d96-048b-419d-a47c-81c0373bca5c",
                "successDeviceCount": 0,
                "errorDeviceCount": 1,
                "userPrincipalName": "jakea@mrbiskit.online"
            }"#,
        )
        .unwrap();
        assert_eq!(user.error_device_count, Some(1));
        assert_eq!(user.success_device_count, Some(0));
        assert_eq!(
            user.user_principal_name.as_deref(),
            Some("jakea@mrbiskit.online")
        );
    }
}
