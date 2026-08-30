use chrono::Utc;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::graph::{GraphClient, GraphError};

pub const INVENTORY_LIST_MAX: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryList<T> {
    pub items: Vec<T>,
    pub truncated: bool,
    pub fetched_at: String,
}

impl<T> InventoryList<T> {
    pub fn from_items(mut items: Vec<T>) -> Self {
        let truncated = items.len() > INVENTORY_LIST_MAX;
        if truncated {
            items.truncate(INVENTORY_LIST_MAX);
        }
        Self {
            items,
            truncated,
            fetched_at: Utc::now().to_rfc3339(),
        }
    }

    pub fn empty_now() -> Self {
        Self {
            items: vec![],
            truncated: false,
            fetched_at: Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAppSummary {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publishing_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_assigned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odata_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_identifier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_type_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPolicySummary {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platforms: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub technologies: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setting_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_assigned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odata_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantScriptSummary {
    pub id: String,
    pub kind: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_as_account: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_global_script: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignment_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotDevice {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enrollment_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_contacted_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_principal_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub azure_active_directory_device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub managed_device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_profile_assignment_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotProfile {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_join_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odata_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_name_template: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppProtectionPolicy {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odata_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified_date_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsUpdatePolicy {
    pub id: String,
    pub family: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified_date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub odata_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphNamed {
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    platforms: Option<String>,
    #[serde(default)]
    technologies: Option<String>,
    #[serde(default)]
    setting_count: Option<u32>,
    #[serde(default)]
    created_date_time: Option<String>,
    #[serde(default)]
    last_modified_date_time: Option<String>,
    #[serde(default)]
    is_assigned: Option<bool>,
    #[serde(default)]
    publisher: Option<String>,
    #[serde(default)]
    display_version: Option<String>,
    #[serde(default)]
    file_name: Option<String>,
    #[serde(default)]
    publishing_state: Option<String>,
    #[serde(default)]
    package_identifier: Option<String>,
    #[serde(default)]
    run_as_account: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    is_global_script: Option<bool>,
    #[serde(default)]
    serial_number: Option<String>,
    #[serde(default)]
    group_tag: Option<String>,
    #[serde(default)]
    manufacturer: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    enrollment_state: Option<String>,
    #[serde(default)]
    last_contacted_date_time: Option<String>,
    #[serde(default)]
    user_principal_name: Option<String>,
    #[serde(default)]
    azure_active_directory_device_id: Option<String>,
    #[serde(default)]
    managed_device_id: Option<String>,
    #[serde(default)]
    deployment_profile_assignment_status: Option<String>,
    #[serde(default)]
    device_name_template: Option<String>,
    #[serde(default, rename = "@odata.type")]
    odata_type: Option<String>,
    #[serde(default)]
    template_reference: Option<TemplateReference>,
    #[serde(default)]
    assignments: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TemplateReference {
    #[serde(default)]
    template_family: Option<String>,
    #[serde(default)]
    template_id: Option<String>,
}

async fn list_beta<T: DeserializeOwned + Send + 'static>(
    access_token: &str,
    path: &str,
) -> Result<Vec<T>, GraphError> {
    GraphClient::new()
        .fetch_all_pages(access_token, path, "beta", INVENTORY_LIST_MAX + 1)
        .await
}

async fn list_named(access_token: &str, path: &str) -> Result<Vec<GraphNamed>, GraphError> {
    list_beta(access_token, path).await
}

fn title(row: &GraphNamed) -> String {
    row.display_name
        .as_deref()
        .or(row.name.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled")
        .to_string()
}

fn take_id(row: &GraphNamed) -> Option<String> {
    row.id.clone().filter(|value| !value.is_empty())
}

fn as_app(row: GraphNamed, kind: &str) -> Option<MobileAppSummary> {
    let id = take_id(&row)?;
    let classified = classify_odata_type(row.odata_type.as_deref());
    Some(MobileAppSummary {
        display_name: title(&row),
        publisher: row.publisher,
        display_version: row.display_version,
        file_name: row.file_name,
        publishing_state: row.publishing_state,
        is_assigned: row.is_assigned,
        odata_type: row.odata_type,
        package_identifier: row.package_identifier,
        last_modified_date_time: row.last_modified_date_time,
        kind: Some(kind.into()),
        platform: classified.map(|value| value.0.to_string()),
        app_kind: classified.map(|value| value.1.to_string()),
        app_type_label: classified.map(|value| value.2.to_string()),
        id,
    })
}

fn assigned_from_row(row: &GraphNamed) -> Option<bool> {
    row.is_assigned
        .or_else(|| row.assignments.as_ref().map(|rows| !rows.is_empty()))
}

fn as_policy(row: GraphNamed) -> Option<CatalogPolicySummary> {
    let id = take_id(&row)?;
    let is_assigned = assigned_from_row(&row);
    Some(CatalogPolicySummary {
        name: title(&row),
        description: row.description,
        platforms: row.platforms,
        technologies: row.technologies,
        setting_count: row.setting_count,
        created_date_time: row.created_date_time,
        last_modified_date_time: row.last_modified_date_time,
        is_assigned,
        template_family: row
            .template_reference
            .as_ref()
            .and_then(|value| value.template_family.clone()),
        template_id: row
            .template_reference
            .as_ref()
            .and_then(|value| value.template_id.clone()),
        odata_type: row.odata_type,
        id,
    })
}

fn as_script(row: GraphNamed, kind: &str) -> Option<TenantScriptSummary> {
    let id = take_id(&row)?;
    Some(TenantScriptSummary {
        kind: kind.into(),
        display_name: title(&row),
        description: row.description,
        file_name: row.file_name,
        run_as_account: row.run_as_account,
        publisher: row.publisher,
        version: row.version,
        is_global_script: row.is_global_script,
        created_date_time: row.created_date_time,
        last_modified_date_time: row.last_modified_date_time,
        assignment_count: row.assignments.as_ref().map(|value| value.len() as u32),
        id,
    })
}

fn as_autopilot_device(row: GraphNamed) -> Option<AutopilotDevice> {
    let id = take_id(&row)?;
    Some(AutopilotDevice {
        serial_number: row.serial_number,
        group_tag: row.group_tag,
        manufacturer: row.manufacturer,
        model: row.model,
        enrollment_state: row.enrollment_state,
        last_contacted_date_time: row.last_contacted_date_time,
        user_principal_name: row.user_principal_name,
        display_name: row.display_name.or(row.name),
        azure_active_directory_device_id: row.azure_active_directory_device_id,
        managed_device_id: row.managed_device_id,
        deployment_profile_assignment_status: row.deployment_profile_assignment_status,
        id,
    })
}

fn as_autopilot_profile(row: GraphNamed) -> Option<AutopilotProfile> {
    let id = take_id(&row)?;
    Some(AutopilotProfile {
        display_name: title(&row),
        description: row.description,
        created_date_time: row.created_date_time,
        last_modified_date_time: row.last_modified_date_time,
        device_join_type: None,
        odata_type: row.odata_type,
        device_name_template: row.device_name_template,
        id,
    })
}

fn as_app_protection(row: GraphNamed) -> Option<AppProtectionPolicy> {
    let id = take_id(&row)?;
    Some(AppProtectionPolicy {
        display_name: title(&row),
        description: row.description,
        odata_type: row.odata_type,
        last_modified_date_time: row.last_modified_date_time,
        id,
    })
}

fn as_windows_update(row: GraphNamed, family: &str) -> Option<WindowsUpdatePolicy> {
    let id = take_id(&row)?;
    Some(WindowsUpdatePolicy {
        family: family.into(),
        name: title(&row),
        description: row.description,
        created_date_time: row.created_date_time,
        last_modified_date_time: row.last_modified_date_time,
        odata_type: row.odata_type,
        id,
    })
}

const WIN32_FILTER: &str = "(isof(%27microsoft.graph.win32LobApp%27)%20and%20not(isof(%27microsoft.graph.win32CatalogApp%27)))";
const WINGET_FILTER: &str = "isof(%27microsoft.graph.winGetApp%27)";
const WUFB_FILTER: &str = "isof(%27microsoft.graph.windowsUpdateForBusinessConfiguration%27)";
const DRIVER_FILTER: &str = "isof(%27microsoft.graph.windowsDriverUpdateProfile%27)";

#[derive(Clone, Copy)]
struct GraphAppType {
    odata_type: &'static str,
    platform: &'static str,
    kind: &'static str,
    label: &'static str,
    exclude_win32_catalog: bool,
}

const GRAPH_APP_TYPES: &[GraphAppType] = &[
    GraphAppType { odata_type: "microsoft.graph.win32LobApp", platform: "windows", kind: "lob", label: "Win32", exclude_win32_catalog: true },
    GraphAppType { odata_type: "microsoft.graph.windowsUniversalAppX", platform: "windows", kind: "lob", label: "AppX", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.windowsAppX", platform: "windows", kind: "lob", label: "AppX", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.windowsMobileMSI", platform: "windows", kind: "msi", label: "MSI", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.winGetApp", platform: "windows", kind: "store", label: "WinGet", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.microsoftStoreForBusinessApp", platform: "windows", kind: "store", label: "Store for Business", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.windowsStoreApp", platform: "windows", kind: "store", label: "Microsoft Store", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.win32CatalogApp", platform: "windows", kind: "store", label: "Enterprise catalog", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.macOSDmgApp", platform: "macos", kind: "lob", label: "macOS DMG", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.macOSPkgApp", platform: "macos", kind: "lob", label: "macOS PKG", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.macOSLobApp", platform: "macos", kind: "lob", label: "macOS LOB", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.macOSMicrosoftEdgeApp", platform: "macos", kind: "store", label: "Edge", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.macOSOfficeSuiteApp", platform: "macos", kind: "store", label: "Microsoft 365", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.iosLobApp", platform: "ios", kind: "lob", label: "iOS LOB", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.managedIOSLobApp", platform: "ios", kind: "lob", label: "iOS LOB (managed)", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.iosStoreApp", platform: "ios", kind: "store", label: "App Store", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.iosVppApp", platform: "ios", kind: "store", label: "VPP", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.androidLobApp", platform: "android", kind: "lob", label: "Android LOB", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.managedAndroidLobApp", platform: "android", kind: "lob", label: "Android LOB (managed)", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.androidStoreApp", platform: "android", kind: "store", label: "Play Store", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.androidManagedStoreApp", platform: "android", kind: "store", label: "Managed Google Play", exclude_win32_catalog: false },
    GraphAppType { odata_type: "microsoft.graph.androidForWorkApp", platform: "android", kind: "store", label: "Android for Work", exclude_win32_catalog: false },
];

fn classify_odata_type(odata_type: Option<&str>) -> Option<(&'static str, &'static str, &'static str)> {
    let needle = odata_type.unwrap_or("").trim().trim_start_matches('#').to_ascii_lowercase();
    if needle.is_empty() {
        return None;
    }
    GRAPH_APP_TYPES.iter().find(|entry| entry.odata_type.eq_ignore_ascii_case(&needle)).map(|entry| {
        (entry.platform, entry.kind, entry.label)
    })
}

fn mobile_app_filter(platform: Option<&str>, app_kind: Option<&str>) -> Option<String> {
    let clauses: Vec<String> = GRAPH_APP_TYPES
        .iter()
        .filter(|entry| platform.map(|value| entry.platform == value).unwrap_or(true))
        .filter(|entry| app_kind.map(|value| entry.kind == value).unwrap_or(true))
        .map(|entry| {
            let isof = format!("isof('{}')", entry.odata_type);
            if entry.exclude_win32_catalog {
                format!("({isof} and not(isof('microsoft.graph.win32CatalogApp')))")
            } else {
                isof
            }
        })
        .collect();
    if clauses.is_empty() {
        return None;
    }
    if clauses.len() == 1 {
        return clauses.into_iter().next();
    }
    Some(
        clauses
            .into_iter()
            .map(|clause| format!("({clause})"))
            .collect::<Vec<_>>()
            .join(" or "),
    )
}

pub async fn fetch_mobile_apps(
    access_token: &str,
    platform: Option<&str>,
    app_kind: Option<&str>,
) -> Result<InventoryList<MobileAppSummary>, GraphError> {
    let Some(filter) = mobile_app_filter(platform, app_kind) else {
        return Ok(InventoryList::from_items(vec![]));
    };
    let encoded = urlencoding::encode(&filter);
    let rows = list_named(
        access_token,
        &format!("/deviceAppManagement/mobileApps?$filter={encoded}&$orderby=displayName%20asc"),
    )
    .await?;
    let kind_label = app_kind.unwrap_or("mobile");
    let mut items: Vec<_> = rows
        .into_iter()
        .filter_map(|row| as_app(row, kind_label))
        .collect();
    items.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    Ok(InventoryList::from_items(items))
}

pub async fn fetch_win32_apps(
    access_token: &str,
) -> Result<InventoryList<MobileAppSummary>, GraphError> {
    let rows = list_named(
        access_token,
        &format!(
            "/deviceAppManagement/mobileApps?$filter={WIN32_FILTER}&$orderby=displayName%20asc"
        ),
    )
    .await?;
    let mut items: Vec<_> = rows
        .into_iter()
        .filter_map(|row| as_app(row, "win32"))
        .collect();
    items.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    Ok(InventoryList::from_items(items))
}

pub async fn fetch_store_apps(
    access_token: &str,
) -> Result<InventoryList<MobileAppSummary>, GraphError> {
    let rows = list_named(
        access_token,
        &format!("/deviceAppManagement/mobileApps?$filter={WINGET_FILTER}"),
    )
    .await?;
    let mut items: Vec<_> = rows
        .into_iter()
        .filter_map(|row| as_app(row, "winget"))
        .collect();
    items.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    Ok(InventoryList::from_items(items))
}

pub async fn fetch_configuration_policies(
    access_token: &str,
) -> Result<InventoryList<CatalogPolicySummary>, GraphError> {
    let rows = list_named(
        access_token,
        "/deviceManagement/configurationPolicies?$select=id,name,description,platforms,technologies,settingCount,createdDateTime,lastModifiedDateTime,isAssigned,templateReference",
    )
    .await?;
    let mut items: Vec<_> = rows.into_iter().filter_map(as_policy).collect();
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(InventoryList::from_items(items))
}

pub async fn fetch_compliance_policies(
    access_token: &str,
) -> Result<InventoryList<CatalogPolicySummary>, GraphError> {
    // Classic deviceCompliancePolicy has no isAssigned property; Graph 400s if selected.
    // Assignment state comes from the assignments navigation, same as scripts.
    let expanded = "/deviceManagement/deviceCompliancePolicies?$select=id,displayName,description,createdDateTime,lastModifiedDateTime&$expand=assignments($select=id)";
    let fallback = "/deviceManagement/deviceCompliancePolicies?$select=id,displayName,description,createdDateTime,lastModifiedDateTime&$expand=assignments";
    let plain = "/deviceManagement/deviceCompliancePolicies?$select=id,displayName,description,createdDateTime,lastModifiedDateTime";
    let rows = match list_named(access_token, expanded).await {
        Ok(rows) => rows,
        Err(_) => match list_named(access_token, fallback).await {
            Ok(rows) => rows,
            Err(_) => list_named(access_token, plain).await?,
        },
    };
    let mut items: Vec<_> = rows
        .into_iter()
        .filter_map(as_policy)
        .map(|mut item| {
            if item.platforms.is_none() {
                item.platforms = crate::platforms_from_compliance_odata(item.odata_type.as_deref());
            }
            item
        })
        .collect();
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(InventoryList::from_items(items))
}

pub async fn fetch_group_policy_configurations(
    access_token: &str,
) -> Result<InventoryList<CatalogPolicySummary>, GraphError> {
    let rows = list_named(
        access_token,
        "/deviceManagement/groupPolicyConfigurations?$select=id,displayName,description,createdDateTime,lastModifiedDateTime",
    )
    .await?;
    let mut items: Vec<_> = rows.into_iter().filter_map(as_policy).collect();
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(InventoryList::from_items(items))
}

pub async fn fetch_device_configurations(
    access_token: &str,
) -> Result<InventoryList<CatalogPolicySummary>, GraphError> {
    let rows = list_named(
        access_token,
        "/deviceManagement/deviceConfigurations?$select=id,displayName,description,createdDateTime,lastModifiedDateTime,isAssigned",
    )
    .await?;
    let mut items: Vec<_> = rows.into_iter().filter_map(as_policy).collect();
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(InventoryList::from_items(items))
}

pub async fn fetch_endpoint_security_intents(
    access_token: &str,
) -> Result<InventoryList<CatalogPolicySummary>, GraphError> {
    let rows = list_named(
        access_token,
        "/deviceManagement/intents?$select=id,displayName,description,isAssigned,lastModifiedDateTime,templateId",
    )
    .await?;
    let mut items: Vec<_> = rows.into_iter().filter_map(as_policy).collect();
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(InventoryList::from_items(items))
}

pub async fn fetch_app_protection_policies(
    access_token: &str,
) -> Result<InventoryList<AppProtectionPolicy>, GraphError> {
    let rows = list_named(access_token, "/deviceAppManagement/managedAppPolicies").await?;
    let mut items: Vec<_> = rows.into_iter().filter_map(as_app_protection).collect();
    items.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    Ok(InventoryList::from_items(items))
}

async fn list_scripts_kind(
    access_token: &str,
    path: &str,
    kind: &str,
) -> Result<Vec<TenantScriptSummary>, GraphError> {
    let expanded = format!("{path}?$expand=assignments");
    let rows = match list_named(access_token, &expanded).await {
        Ok(rows) => rows,
        Err(_) => list_named(access_token, path).await?,
    };
    Ok(rows
        .into_iter()
        .filter_map(|row| as_script(row, kind))
        .collect())
}

pub async fn fetch_tenant_scripts(
    access_token: &str,
) -> Result<InventoryList<TenantScriptSummary>, GraphError> {
    let mut items = Vec::new();
    let mut errors = Vec::new();

    match list_scripts_kind(
        access_token,
        "/deviceManagement/deviceManagementScripts",
        "platform-powershell",
    )
    .await
    {
        Ok(rows) => items.extend(rows),
        Err(error) => errors.push(error),
    }
    match list_scripts_kind(
        access_token,
        "/deviceManagement/deviceShellScripts",
        "platform-shell",
    )
    .await
    {
        Ok(rows) => items.extend(rows),
        Err(error) => errors.push(error),
    }
    match list_scripts_kind(
        access_token,
        "/deviceManagement/deviceHealthScripts",
        "remediation",
    )
    .await
    {
        Ok(rows) => items.extend(
            rows.into_iter()
                .filter(|row| row.is_global_script != Some(true)),
        ),
        Err(error) => errors.push(error),
    }
    match list_scripts_kind(
        access_token,
        "/deviceManagement/deviceComplianceScripts",
        "compliance",
    )
    .await
    {
        Ok(rows) => items.extend(rows),
        Err(error) => errors.push(error),
    }

    if items.is_empty() {
        if let Some(error) = errors.into_iter().next() {
            return Err(error);
        }
    }

    items.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    Ok(InventoryList::from_items(items))
}

pub async fn fetch_remediation_scripts(
    access_token: &str,
) -> Result<InventoryList<TenantScriptSummary>, GraphError> {
    let mut items = list_scripts_kind(
        access_token,
        "/deviceManagement/deviceHealthScripts",
        "remediation",
    )
    .await?;
    items.retain(|row| row.is_global_script != Some(true));
    items.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    Ok(InventoryList::from_items(items))
}

pub async fn fetch_autopilot_devices(
    access_token: &str,
) -> Result<InventoryList<AutopilotDevice>, GraphError> {
    let rows = list_named(
        access_token,
        "/deviceManagement/windowsAutopilotDeviceIdentities",
    )
    .await?;
    let mut items: Vec<_> = rows.into_iter().filter_map(as_autopilot_device).collect();
    items.sort_by(|a, b| {
        a.serial_number
            .as_deref()
            .or(a.display_name.as_deref())
            .unwrap_or(&a.id)
            .to_lowercase()
            .cmp(
                &b.serial_number
                    .as_deref()
                    .or(b.display_name.as_deref())
                    .unwrap_or(&b.id)
                    .to_lowercase(),
            )
    });
    Ok(InventoryList::from_items(items))
}

pub async fn fetch_autopilot_profiles(
    access_token: &str,
) -> Result<InventoryList<AutopilotProfile>, GraphError> {
    let rows = list_named(
        access_token,
        "/deviceManagement/windowsAutopilotDeploymentProfiles",
    )
    .await?;
    let mut items: Vec<_> = rows.into_iter().filter_map(as_autopilot_profile).collect();
    items.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    Ok(InventoryList::from_items(items))
}

pub async fn fetch_windows_update_policies(
    access_token: &str,
) -> Result<InventoryList<WindowsUpdatePolicy>, GraphError> {
    let mut items = Vec::new();
    let mut errors = Vec::new();

    match list_named(
        access_token,
        &format!("/deviceManagement/deviceConfigurations?$filter={WUFB_FILTER}"),
    )
    .await
    {
        Ok(rows) => items.extend(
            rows.into_iter()
                .filter_map(|row| as_windows_update(row, "rings")),
        ),
        Err(error) => errors.push(error),
    }
    match list_named(
        access_token,
        "/deviceManagement/windowsFeatureUpdateProfiles",
    )
    .await
    {
        Ok(rows) => items.extend(
            rows.into_iter()
                .filter_map(|row| as_windows_update(row, "feature")),
        ),
        Err(error) => errors.push(error),
    }
    match list_named(
        access_token,
        "/deviceManagement/windowsQualityUpdateProfiles",
    )
    .await
    {
        Ok(rows) => items.extend(
            rows.into_iter()
                .filter_map(|row| as_windows_update(row, "quality")),
        ),
        Err(error) => errors.push(error),
    }
    match list_named(
        access_token,
        &format!("/deviceManagement/windowsDriverUpdateProfiles?$filter={DRIVER_FILTER}"),
    )
    .await
    {
        Ok(rows) => items.extend(
            rows.into_iter()
                .filter_map(|row| as_windows_update(row, "drivers")),
        ),
        Err(_) => {
            if let Ok(rows) = list_named(
                access_token,
                "/deviceManagement/windowsDriverUpdateProfiles",
            )
            .await
            {
                items.extend(
                    rows.into_iter()
                        .filter_map(|row| as_windows_update(row, "drivers")),
                );
            }
        }
    }

    if items.is_empty() {
        if let Some(error) = errors.into_iter().next() {
            return Err(error);
        }
    }

    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(InventoryList::from_items(items))
}

pub async fn fetch_enrollment_configurations(
    access_token: &str,
) -> Result<InventoryList<CatalogPolicySummary>, GraphError> {
    let rows = list_named(
        access_token,
        "/deviceManagement/deviceEnrollmentConfigurations",
    )
    .await?;
    let mut items: Vec<_> = rows.into_iter().filter_map(as_policy).collect();
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(InventoryList::from_items(items))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compliance_row_derives_assigned_from_assignments() {
        let assigned: GraphNamed = serde_json::from_str(
            r#"{
                "id": "policy-1",
                "displayName": "Windows compliance",
                "assignments": [{ "id": "a1" }]
            }"#,
        )
        .unwrap();
        assert_eq!(assigned_from_row(&assigned), Some(true));
        assert_eq!(as_policy(assigned).unwrap().is_assigned, Some(true));

        let empty: GraphNamed = serde_json::from_str(
            r#"{
                "id": "policy-2",
                "displayName": "Unassigned",
                "assignments": []
            }"#,
        )
        .unwrap();
        assert_eq!(assigned_from_row(&empty), Some(false));
        assert_eq!(as_policy(empty).unwrap().is_assigned, Some(false));
    }

    #[test]
    fn explicit_is_assigned_wins_over_assignments() {
        let row: GraphNamed = serde_json::from_str(
            r#"{
                "id": "policy-3",
                "name": "Catalog",
                "isAssigned": true,
                "assignments": []
            }"#,
        )
        .unwrap();
        assert_eq!(assigned_from_row(&row), Some(true));
    }
}
