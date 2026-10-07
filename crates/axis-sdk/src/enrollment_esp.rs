//! Enrollment Status Page (`windows10EnrollmentCompletionPageConfiguration`).

use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::graph::{GraphClient, GraphError};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEnrollmentStatusPageInput {
    pub display_name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub show_installation_progress: bool,
    /// Portal: Block device use until all apps and profiles are installed.
    /// Yes is an empty `selectedMobileAppIds` list, which tracks every assigned app.
    pub block_device_use_until_all_apps_installed: bool,
    pub allow_device_reset_on_install_failure: bool,
    pub allow_device_use_on_install_failure: bool,
    pub block_device_setup_retry_by_user: bool,
    pub allow_log_collection_on_install_failure: bool,
    /// Portal: Only show page to devices provisioned by out-of-box experience (OOBE).
    pub only_show_during_oobe: bool,
    pub install_quality_updates: bool,
    pub install_progress_timeout_in_minutes: i32,
    #[serde(default)]
    pub custom_error_message: Option<String>,
    /// Empty tracks every assigned app. A list blocks on those apps only.
    #[serde(default)]
    pub selected_mobile_app_ids: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EspBlockingApp {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odata_type: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedEnrollmentStatusPage {
    pub id: String,
    pub display_name: String,
}

fn input_error(message: impl Into<String>) -> GraphError {
    GraphError::Request {
        status: 400,
        code: None,
        message: message.into(),
        permission_related: false,
    }
}

pub fn create_enrollment_status_page_body(
    input: &CreateEnrollmentStatusPageInput,
) -> Result<Value, GraphError> {
    let display_name = input.display_name.trim();
    if display_name.is_empty() {
        return Err(input_error("Enrollment Status Page name is required."));
    }
    if display_name.len() > 200 {
        return Err(input_error(
            "Enrollment Status Page name must be 200 characters or fewer.",
        ));
    }
    let timeout = input.install_progress_timeout_in_minutes;
    if input.show_installation_progress && !(1..=1440).contains(&timeout) {
        return Err(input_error(
            "Install progress timeout must be from 1 to 1440 minutes.",
        ));
    }
    let message = input
        .custom_error_message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if message.is_some_and(|value| value.len() > 10000) {
        return Err(input_error(
            "Custom error message must be 10000 characters or fewer.",
        ));
    }

    // The Intune portal create supplies a client id, the default scope tag, and
    // allowNonBlockingAppInstallation. Omitting those returns an opaque onboarding 400.
    // An empty selectedMobileAppIds list tracks every assigned app.
    let blocking = input.show_installation_progress && input.block_device_use_until_all_apps_installed;
    let selected_mobile_app_ids = if blocking {
        cleaned_app_ids(&input.selected_mobile_app_ids)?
    } else {
        Vec::new()
    };
    let body = json!({
        "@odata.type": "#microsoft.graph.windows10EnrollmentCompletionPageConfiguration",
        "id": Uuid::new_v4().to_string(),
        "displayName": display_name,
        "description": input.description.as_deref().map(str::trim).unwrap_or(""),
        "showInstallationProgress": input.show_installation_progress,
        // The portal create that succeeds sends false. True is rejected by the onboarding service.
        "blockDeviceSetupRetryByUser": false,
        "allowDeviceResetOnInstallFailure": blocking && input.allow_device_reset_on_install_failure,
        "allowLogCollectionOnInstallFailure": input.allow_log_collection_on_install_failure,
        "customErrorMessage": message.unwrap_or("Setup could not be completed. Please try again or contact your support person for help."),
        "installProgressTimeoutInMinutes": if input.show_installation_progress { timeout } else { 60 },
        "allowDeviceUseOnInstallFailure": blocking && input.allow_device_use_on_install_failure,
        "selectedMobileAppIds": selected_mobile_app_ids,
        "trackInstallProgressForAutopilotOnly": input.only_show_during_oobe,
        "disableUserStatusTrackingAfterFirstUser": input.only_show_during_oobe,
        "roleScopeTagIds": ["0"],
        "allowNonBlockingAppInstallation": true,
        "installQualityUpdates": input.install_quality_updates,
    });
    Ok(body)
}

pub async fn create_enrollment_status_page(
    access_token: &str,
    input: CreateEnrollmentStatusPageInput,
) -> Result<CreatedEnrollmentStatusPage, GraphError> {
    let body = create_enrollment_status_page_body(&input)?;
    let created: Value = GraphClient::new()
        .post(
            access_token,
            "/deviceManagement/deviceEnrollmentConfigurations",
            "beta",
            &body,
        )
        .await
        .map_err(|error| annotate_esp_create_error(error, &body))?;
    let id = created
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| input_error("Enrollment Status Page was created but Graph returned no id."))?;
    let display_name = created
        .get("displayName")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(input.display_name.trim())
        .to_string();
    Ok(CreatedEnrollmentStatusPage {
        id: id.to_string(),
        display_name,
    })
}

fn cleaned_app_ids(ids: &[String]) -> Result<Vec<String>, GraphError> {
    let mut out = Vec::new();
    for id in ids {
        let id = id.trim();
        if id.is_empty() || out.iter().any(|existing: &String| existing == id) {
            continue;
        }
        out.push(id.to_string());
    }
    if out.len() > 100 {
        return Err(input_error("Select 100 apps or fewer to block on."));
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EspAppRow {
    id: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    publisher: Option<String>,
    #[serde(default)]
    display_version: Option<String>,
    #[serde(default, rename = "@odata.type")]
    odata_type: Option<String>,
}

/// Portal Enrollment Status Page app picker.
/// `displayVersion` is not selectable on `mobileApp`; it arrives on Win32 rows
/// when the query does not `$select` it.
const ESP_APP_FILTER: &str = "\
isof('microsoft.graph.windowsAppX') or \
isof('microsoft.graph.windowsMobileMSI') or \
isof('microsoft.graph.windowsUniversalAppX') or \
isof('microsoft.graph.officeSuiteApp') or \
isof('microsoft.graph.windowsMicrosoftEdgeApp') or \
isof('microsoft.graph.winGetApp') or \
isof('microsoft.graph.win32LobApp') or \
isof('microsoft.graph.win32CatalogApp')";

pub async fn fetch_esp_blocking_apps(
    access_token: &str,
) -> Result<Vec<EspBlockingApp>, GraphError> {
    let filter = urlencoding::encode(ESP_APP_FILTER);
    let path = format!(
        "/deviceAppManagement/mobileApps?$filter={filter}&$top=250&$orderby=displayname"
    );
    let rows: Vec<EspAppRow> = GraphClient::new()
        .fetch_all_pages(access_token, &path, "beta", 5_000)
        .await?;
    let mut apps = Vec::new();
    for row in rows {
        let Some(id) = row
            .id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let display_name = row
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Untitled")
            .to_string();
        apps.push(EspBlockingApp {
            id,
            display_name,
            publisher: row
                .publisher
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            display_version: row
                .display_version
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            odata_type: row.odata_type.filter(|value| !value.trim().is_empty()),
        });
    }
    apps.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
            .then_with(|| {
                a.display_version
                    .as_deref()
                    .unwrap_or("")
                    .cmp(b.display_version.as_deref().unwrap_or(""))
            })
    });
    Ok(apps)
}

fn annotate_esp_create_error(error: GraphError, body: &Value) -> GraphError {
    match error {
        GraphError::Request {
            status: 400,
            code,
            message,
            permission_related,
        } => GraphError::Request {
            status: 400,
            code,
            permission_related,
            message: format!(
                "{message}\nPOST /deviceManagement/deviceEnrollmentConfigurations\n{}",
                serde_json::to_string(body).unwrap_or_default()
            ),
        },
        other => other,
    }
}
