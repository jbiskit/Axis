use crate::AppState;
use axis_sdk::{
    add_settings_to_policy, apply_filter_names, apply_group_metadata, assign_object_assignments,
    assignment_capabilities, collect_managed_device_diagnostics, create_directory_group,
    create_policy_with_settings, delete_managed_device,
    drafts_from_graph_assignments, fetch_app_protection_policies, fetch_autopilot_devices,
    fetch_applied_policy_settings, fetch_autopilot_profiles, fetch_baseline_export_json,
    fetch_baseline_reference_sources, fetch_compliance_policies,
    fetch_configuration_policies, fetch_device_configurations, fetch_e8_baseline_references,
    fetch_endpoint_security_intents, fetch_enrollment_configurations, fetch_graph_object_detail,
    fetch_group_policy_configurations, fetch_managed_device_detail, fetch_policy_setting_issues,
    fetch_mobile_apps, fetch_remediation_scripts, fetch_setting_conflict_details, fetch_store_apps,
    fetch_tenant_scripts, fetch_win32_apps, fetch_windows_update_policies,
    get_laps_credential_info, initiate_on_demand_remediation, list_assignment_filters,
    list_bitlocker_recovery_keys, list_catalog_categories, load_category_settings,
    reboot_managed_device, remote_lock_managed_device, resolve_directory_groups,
    retire_managed_device, reveal_bitlocker_recovery_key, reveal_laps_credentials,
    rotate_managed_device_laps_password, search_catalog_settings, search_directory_groups,
    sync_managed_device, update_script_content, wipe_managed_device, AppProtectionPolicy,
    AppliedPolicySettingsLoad, AssignmentCapabilities, AssignmentDraft, AssignmentFilter, AutopilotDevice, AutopilotProfile,
    BaselineReferenceSourceInput, BaselineReferenceSourceLoad, BitLockerRecoveryKeySummary,
    CatalogCategory, CatalogIndexState, CatalogPolicySummary, CatalogSearchResult,
    CategorySettingsLoad, CreateDirectoryGroupInput, CreatedCatalogPolicy, DirectoryGroup,
    E8BaselineReference, E8BaselineSource, GraphObjectDetail, InventoryList, LapsCredentialInfo,
    MobileAppSummary, PolicySettingIssue, SettingConflictDetail,
    SettingsCatalogPlatform, TenantScriptSummary, WindowsUpdatePolicy,
};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryResponse<T> {
    pub list: InventoryList<T>,
    pub error: Option<String>,
    pub mode: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDetailResponse {
    pub device: Option<axis_sdk::ManagedDeviceDetail>,
    pub error: Option<String>,
    pub mode: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityStatus {
    pub available: bool,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct E8BaselineReferencesResponse {
    pub source: E8BaselineSource,
    pub references: Vec<E8BaselineReference>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineReferenceSourcesResponse {
    pub sources: Vec<BaselineReferenceSourceLoad>,
}

#[tauri::command]
pub async fn fetch_e8_baseline_references_cmd() -> Result<E8BaselineReferencesResponse, String> {
    match fetch_e8_baseline_references().await {
        Ok(load) => Ok(E8BaselineReferencesResponse {
            source: load.source,
            references: load.references,
            warnings: load.warnings,
            error: None,
        }),
        Err(error) => Ok(E8BaselineReferencesResponse {
            source: E8BaselineSource {
                id: "e8-github".into(),
                name: "ASD E8".into(),
                owner: "ASD-Blueprint".into(),
                repo: "ASD-Blueprint-for-Secure-Cloud".into(),
                git_ref: "main".into(),
                path: "static/content/files/intune-config-policies".into(),
                repository_url: "https://github.com/ASD-Blueprint/ASD-Blueprint-for-Secure-Cloud".into(),
                directory_url: "https://github.com/ASD-Blueprint/ASD-Blueprint-for-Secure-Cloud/tree/main/static/content/files/intune-config-policies".into(),
                api_url: "https://api.github.com/repos/ASD-Blueprint/ASD-Blueprint-for-Secure-Cloud/contents/static/content/files/intune-config-policies?ref=main".into(),
                has_token: false,
            },
            references: Vec::new(),
            warnings: Vec::new(),
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn fetch_baseline_reference_sources_cmd(
    sources: Option<Vec<BaselineReferenceSourceInput>>,
) -> Result<BaselineReferenceSourcesResponse, String> {
    let load = fetch_baseline_reference_sources(sources.unwrap_or_default()).await;
    Ok(BaselineReferenceSourcesResponse {
        sources: load.sources,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineExportResponse {
    pub document: Option<Value>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fetch_baseline_export_cmd(
    download_url: String,
    token: Option<String>,
) -> Result<BaselineExportResponse, String> {
    match fetch_baseline_export_json(&download_url, token.as_deref()).await {
        Ok(document) => Ok(BaselineExportResponse {
            document: Some(document),
            error: None,
        }),
        Err(error) => Ok(BaselineExportResponse {
            document: None,
            error: Some(error.to_string()),
        }),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedPolicySettingsResponse {
    pub load: Option<AppliedPolicySettingsLoad>,
    pub error: Option<String>,
    pub mode: &'static str,
}

#[tauri::command]
pub async fn fetch_applied_policy_settings_cmd(
    state: State<'_, AppState>,
    policy_ids: Vec<String>,
) -> Result<AppliedPolicySettingsResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(AppliedPolicySettingsResponse {
            load: None,
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };
    Ok(AppliedPolicySettingsResponse {
        load: Some(fetch_applied_policy_settings(&token, &policy_ids).await),
        error: None,
        mode: "live",
    })
}

async fn with_inventory<T, Fut>(
    state: &State<'_, AppState>,
    live: Fut,
) -> Result<InventoryResponse<T>, String>
where
    Fut: std::future::Future<Output = Result<InventoryList<T>, axis_sdk::GraphError>>,
{
    let tokens = state
        .auth
        .get_session_token()
        .await
        .map_err(|error| error.to_string())?;
    let Some(_tokens) = tokens else {
        return Ok(InventoryResponse {
            list: InventoryList::empty_now(),
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };

    match live.await {
        Ok(list) => Ok(InventoryResponse {
            list,
            error: None,
            mode: "live",
        }),
        Err(error) => Ok(InventoryResponse {
            list: InventoryList::empty_now(),
            error: Some(error.to_string()),
            mode: "live",
        }),
    }
}

async fn session_token(state: &State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(state
        .auth
        .get_session_token()
        .await
        .map_err(|error| error.to_string())?
        .map(|token| token.access_token))
}

#[tauri::command]
pub async fn fetch_win32_apps_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<MobileAppSummary>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_win32_apps(&token)).await
}

#[tauri::command]
pub async fn fetch_mobile_apps_cmd(
    state: State<'_, AppState>,
    platform: Option<String>,
    app_kind: Option<String>,
) -> Result<InventoryResponse<MobileAppSummary>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(
        &state,
        fetch_mobile_apps(&token, platform.as_deref(), app_kind.as_deref()),
    )
    .await
}

#[tauri::command]
pub async fn fetch_store_apps_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<MobileAppSummary>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_store_apps(&token)).await
}

#[tauri::command]
pub async fn fetch_configuration_policies_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<CatalogPolicySummary>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_configuration_policies(&token)).await
}

#[tauri::command]
pub async fn fetch_compliance_policies_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<CatalogPolicySummary>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_compliance_policies(&token)).await
}

#[tauri::command]
pub async fn fetch_group_policy_configurations_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<CatalogPolicySummary>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_group_policy_configurations(&token)).await
}

#[tauri::command]
pub async fn fetch_device_configurations_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<CatalogPolicySummary>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_device_configurations(&token)).await
}

#[tauri::command]
pub async fn fetch_endpoint_security_intents_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<CatalogPolicySummary>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_endpoint_security_intents(&token)).await
}

#[tauri::command]
pub async fn fetch_app_protection_policies_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<AppProtectionPolicy>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_app_protection_policies(&token)).await
}

#[tauri::command]
pub async fn fetch_tenant_scripts_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<TenantScriptSummary>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_tenant_scripts(&token)).await
}

#[tauri::command]
pub async fn fetch_autopilot_devices_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<AutopilotDevice>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_autopilot_devices(&token)).await
}

#[tauri::command]
pub async fn fetch_autopilot_profiles_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<AutopilotProfile>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_autopilot_profiles(&token)).await
}

#[tauri::command]
pub async fn fetch_windows_update_policies_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<WindowsUpdatePolicy>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_windows_update_policies(&token)).await
}

#[tauri::command]
pub async fn fetch_enrollment_configurations_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<CatalogPolicySummary>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_enrollment_configurations(&token)).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphObjectDetailResponse {
    pub detail: Option<GraphObjectDetail>,
    pub error: Option<String>,
    pub mode: &'static str,
}

#[tauri::command]
pub async fn fetch_graph_object_detail_cmd(
    state: State<'_, AppState>,
    kind: String,
    id: String,
) -> Result<GraphObjectDetailResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(GraphObjectDetailResponse {
            detail: None,
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };
    match fetch_graph_object_detail(&token, &kind, &id).await {
        Ok(detail) => Ok(GraphObjectDetailResponse {
            detail: Some(detail),
            error: None,
            mode: "live",
        }),
        Err(error) => Ok(GraphObjectDetailResponse {
            detail: None,
            error: Some(error.to_string()),
            mode: "live",
        }),
    }
}

#[tauri::command]
pub async fn fetch_managed_device_detail_cmd(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<DeviceDetailResponse, String> {
    let tokens = state
        .auth
        .get_session_token()
        .await
        .map_err(|error| error.to_string())?;
    let Some(tokens) = tokens else {
        return Ok(DeviceDetailResponse {
            device: None,
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };

    match fetch_managed_device_detail(&tokens.access_token, &device_id).await {
        Ok(device) => Ok(DeviceDetailResponse {
            device: Some(device),
            error: None,
            mode: "live",
        }),
        Err(error) => Ok(DeviceDetailResponse {
            device: None,
            error: Some(error.to_string()),
            mode: "live",
        }),
    }
}

#[tauri::command]
pub async fn desktop_capability(name: String) -> Result<CapabilityStatus, String> {
    let reason = match name.as_str() {
        "intunewin" | "localCatalog" | "uploads" | "appsSetup" => {
            "Win32 packaging, local catalog folders, and IntuneWinAppUtil still run on the Next.js host. The Tauri shell has not wired local filesystem packaging yet."
        }
        "gitBaselines" | "localBaselinePack" => {
            "GitHub baseline exports can be compared on a device. Generic Git/local baseline packs are still resolved by the Next.js API."
        }
        "monacoScripts" => {
            return Ok(CapabilityStatus {
                available: true,
                reason: "Monaco is available in script / remediation / compliance inspectors.".into(),
            });
        }
        "admxStudio" => {
            "List and metadata are live. The full authoring surface (ADMX Studio, Settings Catalog forms) is not ported in this pass."
        }
        "settingsCatalogEditor" => {
            "Browse + create a freeform Settings Catalog policy is live. Group-collection value editors and IndexedDB catalog cache are not ported."
        }
        other => {
            return Ok(CapabilityStatus {
                available: false,
                reason: format!("Unknown desktop capability '{other}'."),
            });
        }
    };
    Ok(CapabilityStatus {
        available: false,
        reason: reason.into(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCategoriesResponse {
    pub categories: Vec<CatalogCategory>,
    pub error: Option<String>,
    pub mode: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySettingsResponse {
    pub load: Option<CategorySettingsLoad>,
    pub error: Option<String>,
    pub mode: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSearchResponse {
    pub result: CatalogSearchResult,
    pub error: Option<String>,
    pub mode: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCatalogPolicyResponse {
    pub policy: Option<CreatedCatalogPolicy>,
    pub error: Option<String>,
    pub mode: &'static str,
}

fn parse_catalog_platform(platform: &str) -> SettingsCatalogPlatform {
    SettingsCatalogPlatform::parse(platform)
}

#[tauri::command]
pub async fn list_catalog_categories_cmd(
    state: State<'_, AppState>,
    platform: String,
) -> Result<CatalogCategoriesResponse, String> {
    let catalog_platform = parse_catalog_platform(&platform);
    if let Some(categories) = state.catalog_index.cached_categories(catalog_platform) {
        return Ok(CatalogCategoriesResponse {
            categories,
            error: None,
            mode: "cache",
        });
    }
    let Some(token) = session_token(&state).await? else {
        return Ok(CatalogCategoriesResponse {
            categories: vec![],
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };
    match list_catalog_categories(&token, catalog_platform).await {
        Ok(categories) => {
            state
                .catalog_index
                .store_categories(catalog_platform, &categories);
            Ok(CatalogCategoriesResponse {
                categories,
                error: None,
                mode: "live",
            })
        }
        Err(error) => Ok(CatalogCategoriesResponse {
            categories: vec![],
            error: Some(error.to_string()),
            mode: "live",
        }),
    }
}

#[tauri::command]
pub async fn load_category_settings_cmd(
    state: State<'_, AppState>,
    category_id: String,
    platform: String,
) -> Result<CategorySettingsResponse, String> {
    let catalog_platform = parse_catalog_platform(&platform);
    if let Some(load) = state
        .catalog_index
        .cached_category_settings(catalog_platform, &category_id)
    {
        state.catalog_index.merge_settings(
            catalog_platform,
            load.by_id.values().map(|detail| detail.summary.clone()),
        );
        return Ok(CategorySettingsResponse {
            load: Some(load),
            error: None,
            mode: "cache",
        });
    }
    let Some(token) = session_token(&state).await? else {
        return Ok(CategorySettingsResponse {
            load: None,
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };
    match load_category_settings(&token, &category_id, catalog_platform).await {
        Ok(load) => {
            state
                .catalog_index
                .store_category_settings(catalog_platform, &load);
            Ok(CategorySettingsResponse {
                load: Some(load),
                error: None,
                mode: "live",
            })
        }
        Err(error) => Ok(CategorySettingsResponse {
            load: None,
            error: Some(error.to_string()),
            mode: "live",
        }),
    }
}

#[tauri::command]
pub async fn search_catalog_settings_cmd(
    state: State<'_, AppState>,
    query: String,
    platform: String,
) -> Result<CatalogSearchResponse, String> {
    let catalog_platform = parse_catalog_platform(&platform);
    let (indexed, index_state) = state.catalog_index.search(catalog_platform, &query, 25);
    if !indexed.settings.is_empty() || index_state.complete {
        return Ok(CatalogSearchResponse {
            result: indexed,
            error: None,
            mode: if index_state.complete {
                "index"
            } else {
                "index-partial"
            },
        });
    }

    let Some(token) = session_token(&state).await? else {
        return Ok(CatalogSearchResponse {
            result: CatalogSearchResult {
                settings: vec![],
                mode: "indexing".into(),
            },
            error: Some("Not signed in.".into()),
            mode: "indexing",
        });
    };
    match search_catalog_settings(&token, &query, catalog_platform).await {
        Ok(result) => {
            if !result.settings.is_empty() {
                state
                    .catalog_index
                    .merge_settings(catalog_platform, result.settings.clone());
            }
            Ok(CatalogSearchResponse {
                result,
                error: None,
                mode: "live",
            })
        }
        Err(error) => Ok(CatalogSearchResponse {
            result: CatalogSearchResult {
                settings: vec![],
                mode: "error".into(),
            },
            error: Some(error.to_string()),
            mode: "live",
        }),
    }
}

#[tauri::command]
pub async fn ensure_catalog_index_cmd(
    state: State<'_, AppState>,
    platform: String,
    force: Option<bool>,
) -> Result<CatalogIndexState, String> {
    let catalog_platform = parse_catalog_platform(&platform);
    if let Some(token) = session_token(&state).await? {
        state
            .catalog_index
            .ensure(catalog_platform, token, force.unwrap_or(false));
    }
    Ok(state.catalog_index.status(catalog_platform))
}

#[tauri::command]
pub async fn catalog_index_status_cmd(
    state: State<'_, AppState>,
    platform: String,
) -> Result<CatalogIndexState, String> {
    Ok(state
        .catalog_index
        .status(parse_catalog_platform(&platform)))
}

#[tauri::command]
pub async fn pause_catalog_index_cmd(state: State<'_, AppState>) -> Result<(), String> {
    state.catalog_index.pause();
    Ok(())
}

#[tauri::command]
pub async fn create_settings_catalog_policy_cmd(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
    platform: String,
    settings: Vec<Value>,
) -> Result<CreateCatalogPolicyResponse, String> {
    let catalog_platform = parse_catalog_platform(&platform);
    let Some(token) = session_token(&state).await? else {
        return Ok(CreateCatalogPolicyResponse {
            policy: None,
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };
    match create_policy_with_settings(
        &token,
        &name,
        description.as_deref(),
        catalog_platform,
        &settings,
    )
    .await
    {
        Ok(policy) => Ok(CreateCatalogPolicyResponse {
            policy: Some(policy),
            error: None,
            mode: "live",
        }),
        Err(error) => Ok(CreateCatalogPolicyResponse {
            policy: None,
            error: Some(error.to_string()),
            mode: "live",
        }),
    }
}

#[tauri::command]
pub async fn add_settings_to_policy_cmd(
    state: State<'_, AppState>,
    policy_id: String,
    settings: Vec<Value>,
) -> Result<CreateCatalogPolicyResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(CreateCatalogPolicyResponse {
            policy: None,
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };
    match add_settings_to_policy(&token, &policy_id, &settings).await {
        Ok(()) => Ok(CreateCatalogPolicyResponse {
            policy: Some(CreatedCatalogPolicy {
                id: policy_id,
                name: String::new(),
            }),
            error: None,
            mode: "live",
        }),
        Err(error) => Ok(CreateCatalogPolicyResponse {
            policy: None,
            error: Some(error.to_string()),
            mode: "live",
        }),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResponse {
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyIssuesResponse {
    pub issues: Vec<PolicySettingIssue>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingConflictDetailsResponse {
    pub details: Vec<SettingConflictDetail>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LapsResponse {
    pub laps: Option<LapsCredentialInfo>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BitLockerKeysResponse {
    pub keys: Vec<BitLockerRecoveryKeySummary>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BitLockerKeyResponse {
    pub key: Option<BitLockerRecoveryKeySummary>,
    pub error: Option<String>,
}

fn action_err(error: axis_sdk::GraphError) -> ActionResponse {
    ActionResponse {
        ok: false,
        error: Some(error.to_string()),
    }
}

#[tauri::command]
pub async fn fetch_policy_setting_issues_cmd(
    state: State<'_, AppState>,
    device_id: String,
    policy_id: String,
    report_user_id: Option<String>,
    device_user_id: Option<String>,
) -> Result<PolicyIssuesResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(PolicyIssuesResponse {
            issues: vec![],
            error: Some("Not signed in.".into()),
        });
    };
    match fetch_policy_setting_issues(
        &token,
        &device_id,
        &policy_id,
        report_user_id.as_deref(),
        device_user_id.as_deref(),
    )
    .await
    {
        Ok(issues) => Ok(PolicyIssuesResponse {
            issues,
            error: None,
        }),
        Err(error) => Ok(PolicyIssuesResponse {
            issues: vec![],
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn fetch_setting_conflict_details_cmd(
    state: State<'_, AppState>,
    device_id: String,
    setting_id: String,
    setting_instance_id: String,
    user_id: Option<String>,
    device_user_id: Option<String>,
) -> Result<SettingConflictDetailsResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(SettingConflictDetailsResponse {
            details: vec![],
            error: Some("Not signed in.".into()),
        });
    };
    match fetch_setting_conflict_details(
        &token,
        &device_id,
        &setting_id,
        &setting_instance_id,
        user_id.as_deref(),
        device_user_id.as_deref(),
    )
    .await
    {
        Ok(details) => Ok(SettingConflictDetailsResponse {
            details,
            error: None,
        }),
        Err(error) => Ok(SettingConflictDetailsResponse {
            details: vec![],
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn fetch_remediation_scripts_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<TenantScriptSummary>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_remediation_scripts(&token)).await
}

#[tauri::command]
pub async fn sync_managed_device_cmd(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<ActionResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match sync_managed_device(&token, &device_id).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(action_err(error)),
    }
}

#[tauri::command]
pub async fn reboot_managed_device_cmd(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<ActionResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match reboot_managed_device(&token, &device_id).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(action_err(error)),
    }
}

#[tauri::command]
pub async fn remote_lock_managed_device_cmd(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<ActionResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match remote_lock_managed_device(&token, &device_id).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(action_err(error)),
    }
}

#[tauri::command]
pub async fn collect_device_diagnostics_cmd(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<ActionResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match collect_managed_device_diagnostics(&token, &device_id).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(action_err(error)),
    }
}

#[tauri::command]
pub async fn initiate_on_demand_remediation_cmd(
    state: State<'_, AppState>,
    device_id: String,
    script_policy_id: String,
) -> Result<ActionResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match initiate_on_demand_remediation(&token, &device_id, &script_policy_id).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(action_err(error)),
    }
}

#[tauri::command]
pub async fn retire_managed_device_cmd(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<ActionResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match retire_managed_device(&token, &device_id).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(action_err(error)),
    }
}

#[tauri::command]
pub async fn wipe_managed_device_cmd(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<ActionResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match wipe_managed_device(&token, &device_id).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(action_err(error)),
    }
}

#[tauri::command]
pub async fn delete_managed_device_cmd(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<ActionResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match delete_managed_device(&token, &device_id).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(action_err(error)),
    }
}

#[tauri::command]
pub async fn get_laps_info_cmd(
    state: State<'_, AppState>,
    entra_device_id: String,
) -> Result<LapsResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(LapsResponse {
            laps: None,
            error: Some("Not signed in.".into()),
        });
    };
    match get_laps_credential_info(&token, &entra_device_id).await {
        Ok(laps) => Ok(LapsResponse {
            laps: Some(laps),
            error: None,
        }),
        Err(error) => Ok(LapsResponse {
            laps: None,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn reveal_laps_cmd(
    state: State<'_, AppState>,
    entra_device_id: String,
) -> Result<LapsResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(LapsResponse {
            laps: None,
            error: Some("Not signed in.".into()),
        });
    };
    match reveal_laps_credentials(&token, &entra_device_id).await {
        Ok(laps) => Ok(LapsResponse {
            laps: Some(laps),
            error: None,
        }),
        Err(error) => Ok(LapsResponse {
            laps: None,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn list_bitlocker_keys_cmd(
    state: State<'_, AppState>,
    entra_device_id: String,
) -> Result<BitLockerKeysResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(BitLockerKeysResponse {
            keys: vec![],
            error: Some("Not signed in.".into()),
        });
    };
    match list_bitlocker_recovery_keys(&token, &entra_device_id).await {
        Ok(keys) => Ok(BitLockerKeysResponse { keys, error: None }),
        Err(error) => Ok(BitLockerKeysResponse {
            keys: vec![],
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn reveal_bitlocker_key_cmd(
    state: State<'_, AppState>,
    recovery_key_id: String,
) -> Result<BitLockerKeyResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(BitLockerKeyResponse {
            key: None,
            error: Some("Not signed in.".into()),
        });
    };
    match reveal_bitlocker_recovery_key(&token, &recovery_key_id).await {
        Ok(key) => Ok(BitLockerKeyResponse {
            key: Some(key),
            error: None,
        }),
        Err(error) => Ok(BitLockerKeyResponse {
            key: None,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn rotate_laps_password_cmd(
    state: State<'_, AppState>,
    managed_device_id: String,
) -> Result<ActionResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match rotate_managed_device_laps_password(&token, &managed_device_id).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(action_err(error)),
    }
}

fn popout_label(kind: &str, id: &str) -> String {
    format!("popout-{kind}-{id}")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '/') {
                c
            } else {
                '-'
            }
        })
        .collect()
}

#[tauri::command]
pub async fn update_script_content_cmd(
    state: State<'_, AppState>,
    kind: String,
    id: String,
    script_text: Option<String>,
    detection_script_text: Option<String>,
    remediation_script_text: Option<String>,
) -> Result<ActionResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match update_script_content(
        &token,
        &kind,
        &id,
        script_text.as_deref(),
        detection_script_text.as_deref(),
        remediation_script_text.as_deref(),
    )
    .await
    {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(action_err(error)),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryGroupsResponse {
    pub groups: Vec<DirectoryGroup>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDirectoryGroupResponse {
    pub group: Option<DirectoryGroup>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentFiltersResponse {
    pub filters: Vec<AssignmentFilter>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentWorkspaceResponse {
    pub drafts: Vec<AssignmentDraft>,
    pub filters: Vec<AssignmentFilter>,
    pub capabilities: AssignmentCapabilities,
    pub filters_error: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn search_directory_groups_cmd(
    state: State<'_, AppState>,
    query: String,
) -> Result<DirectoryGroupsResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(DirectoryGroupsResponse {
            groups: Vec::new(),
            error: Some("Not signed in.".into()),
        });
    };
    match search_directory_groups(&token, &query).await {
        Ok(groups) => Ok(DirectoryGroupsResponse {
            groups,
            error: None,
        }),
        Err(error) => Ok(DirectoryGroupsResponse {
            groups: Vec::new(),
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn create_directory_group_cmd(
    state: State<'_, AppState>,
    input: CreateDirectoryGroupInput,
) -> Result<CreateDirectoryGroupResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(CreateDirectoryGroupResponse {
            group: None,
            error: Some("Not signed in.".into()),
        });
    };
    match create_directory_group(&token, input).await {
        Ok(group) => Ok(CreateDirectoryGroupResponse {
            group: Some(group),
            error: None,
        }),
        Err(error) => {
            let message = error.to_string();
            let lowered = message.to_ascii_lowercase();
            let error = if error.permission_related()
                || lowered.contains("403")
                || lowered.contains("401")
                || lowered.contains("permission")
                || lowered.contains("accessdenied")
                || lowered.contains("forbidden")
            {
                "Missing Group.ReadWrite.All — switch to Admin and grant write access, then retry."
                    .into()
            } else {
                message
            };
            Ok(CreateDirectoryGroupResponse {
                group: None,
                error: Some(error),
            })
        }
    }
}

#[tauri::command]
pub async fn list_assignment_filters_cmd(
    state: State<'_, AppState>,
) -> Result<AssignmentFiltersResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(AssignmentFiltersResponse {
            filters: Vec::new(),
            error: Some("Not signed in.".into()),
        });
    };
    match list_assignment_filters(&token).await {
        Ok(filters) => Ok(AssignmentFiltersResponse {
            filters,
            error: None,
        }),
        Err(error) => Ok(AssignmentFiltersResponse {
            filters: Vec::new(),
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn load_assignment_workspace_cmd(
    state: State<'_, AppState>,
    kind: String,
    assignments: Vec<Value>,
) -> Result<AssignmentWorkspaceResponse, String> {
    let capabilities = assignment_capabilities(&kind);
    let Some(token) = session_token(&state).await? else {
        return Ok(AssignmentWorkspaceResponse {
            drafts: drafts_from_graph_assignments(&assignments, capabilities.supports_intent),
            filters: Vec::new(),
            capabilities,
            filters_error: Some("Not signed in.".into()),
            error: Some("Not signed in.".into()),
        });
    };

    let mut drafts = drafts_from_graph_assignments(&assignments, capabilities.supports_intent);
    let group_ids: Vec<String> = drafts
        .iter()
        .filter_map(|draft| draft.group_id.clone())
        .collect();
    if !group_ids.is_empty() {
        match resolve_directory_groups(&token, &group_ids).await {
            Ok(groups) => apply_group_metadata(&mut drafts, &groups),
            Err(error) => {
                return Ok(AssignmentWorkspaceResponse {
                    drafts,
                    filters: Vec::new(),
                    capabilities,
                    filters_error: None,
                    error: Some(error.to_string()),
                });
            }
        }
    }

    let (filters, filters_error) = match list_assignment_filters(&token).await {
        Ok(filters) => {
            apply_filter_names(&mut drafts, &filters);
            (filters, None)
        }
        Err(error) => {
            let message = error.to_string();
            let friendly = if error.permission_related() {
                "Cannot load filters — check DeviceManagementConfiguration.Read.All.".to_string()
            } else {
                message
            };
            (Vec::new(), Some(friendly))
        }
    };

    Ok(AssignmentWorkspaceResponse {
        drafts,
        filters,
        capabilities,
        filters_error,
        error: None,
    })
}

#[tauri::command]
pub async fn assign_object_assignments_cmd(
    state: State<'_, AppState>,
    kind: String,
    id: String,
    drafts: Vec<AssignmentDraft>,
    object_odata_type: Option<String>,
) -> Result<ActionResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match assign_object_assignments(&token, &kind, &id, &drafts, object_odata_type.as_deref()).await
    {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(action_err(error)),
    }
}

#[tauri::command]
pub async fn open_popout_window(
    app: AppHandle,
    kind: String,
    id: String,
    title: Option<String>,
) -> Result<(), String> {
    let label = popout_label(&kind, &id);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.unminimize();
        existing.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let hash = format!(
        "index.html#/popout?kind={}&id={}",
        urlencoding::encode(&kind),
        urlencoding::encode(&id)
    );
    let window_title = title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Inspector".into());
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(hash.into()))
        .title(format!("{window_title} — Axis"))
        .inner_size(1040.0, 840.0)
        .min_inner_size(720.0, 520.0)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}
