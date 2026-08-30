use axis_sdk::{
    decode_access_token_claims, fetch_managed_device_list,
    fetch_tenant_glance, AuthManager, DeviceCodePrompt, DeviceCodeTokens, ManagedDeviceList,
    PollResult, SessionMode, TenantGlance,
};
use serde::Serialize;
use std::sync::Arc;
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

mod catalog_index;
mod commands;
mod script_lint;
mod updater;

pub(crate) struct AppState {
    pub auth: Arc<AuthManager>,
    pub account_name: Mutex<Option<String>>,
    pub catalog_index: Arc<catalog_index::CatalogIndexRuntime>,
    pub updater: updater::UpdaterRuntime,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStatus {
    signed_in: bool,
    account_name: Option<String>,
    mode: SessionMode,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GlanceResponse {
    glance: TenantGlance,
    error: Option<String>,
    mode: &'static str,
}

#[tauri::command]
async fn device_login_start(
    state: State<'_, AppState>,
    mode: Option<String>,
    extra_scopes: Option<String>,
) -> Result<DeviceCodePrompt, String> {
    let requested = mode.as_deref().map(SessionMode::parse).transpose()?;
    state
        .auth
        .start_device_code_flow(requested, extra_scopes.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn device_login_cancel(state: State<'_, AppState>, flow_id: String) -> Result<(), String> {
    state.auth.cancel_device_code_flow(&flow_id).await;
    Ok(())
}

#[tauri::command]
async fn device_login_poll(
    state: State<'_, AppState>,
    flow_id: String,
) -> Result<PollResult, String> {
    let result = state
        .auth
        .poll_device_code_flow(&flow_id)
        .await
        .map_err(|error| error.to_string())?;

    if let PollResult::SignedIn {
        account_name,
        access_token,
        ..
    } = &result
    {
        let claims = decode_access_token_claims(access_token);
        let name = account_name.clone().or(claims.name).or(claims.upn);
        *state.account_name.lock().await = name;
    }

    Ok(result)
}

#[tauri::command]
async fn device_session_status(state: State<'_, AppState>) -> Result<SessionStatus, String> {
    let (signed_in, account_name) = state.auth.restore_session().await;
    *state.account_name.lock().await = account_name.clone();
    Ok(SessionStatus {
        signed_in,
        account_name,
        mode: state.auth.session_mode().await,
    })
}

#[tauri::command]
async fn device_session_token(
    state: State<'_, AppState>,
) -> Result<Option<DeviceCodeTokens>, String> {
    state
        .auth
        .get_session_token()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn fetch_glance(state: State<'_, AppState>) -> Result<GlanceResponse, String> {
    let tokens = state
        .auth
        .get_session_token()
        .await
        .map_err(|error| error.to_string())?;

    let Some(tokens) = tokens else {
        return Ok(GlanceResponse {
            glance: TenantGlance::empty_with_now(),
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };

    let claims = decode_access_token_claims(&tokens.access_token);
    let token_scopes = claims
        .scp
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();

    match fetch_tenant_glance(&tokens.access_token, &token_scopes).await {
        Ok(glance) => Ok(GlanceResponse {
            glance,
            error: None,
            mode: "live",
        }),
        Err(error) => Ok(GlanceResponse {
            glance: TenantGlance::empty_with_now(),
            error: Some(error.to_string()),
            mode: "live",
        }),
    }
}

#[tauri::command]
async fn refresh_glance(state: State<'_, AppState>) -> Result<GlanceResponse, String> {
    fetch_glance(state).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DevicesResponse {
    list: ManagedDeviceList,
    error: Option<String>,
    mode: &'static str,
}

#[tauri::command]
async fn fetch_managed_devices(state: State<'_, AppState>) -> Result<DevicesResponse, String> {
    let tokens = state
        .auth
        .get_session_token()
        .await
        .map_err(|error| error.to_string())?;

    let Some(tokens) = tokens else {
        return Ok(DevicesResponse {
            list: ManagedDeviceList::empty_with_now(),
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };

    match fetch_managed_device_list(&tokens.access_token).await {
        Ok(list) => Ok(DevicesResponse {
            list,
            error: None,
            mode: "live",
        }),
        Err(error) => Ok(DevicesResponse {
            list: ManagedDeviceList::empty_with_now(),
            error: Some(error.to_string()),
            mode: "live",
        }),
    }
}

#[tauri::command]
async fn sign_out(state: State<'_, AppState>) -> Result<(), String> {
    state.auth.end_session().await;
    *state.account_name.lock().await = None;
    Ok(())
}

#[tauri::command]
async fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            updater::cleanup_previous_install();
            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            let cache_dir = app_data.join("catalog-index");
            app.manage(AppState {
                auth: Arc::new(AuthManager::new()),
                account_name: Mutex::new(None),
                catalog_index: Arc::new(catalog_index::CatalogIndexRuntime::new(cache_dir)),
                updater: updater::UpdaterRuntime::new(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            device_login_start,
            device_login_poll,
            device_login_cancel,
            device_session_status,
            device_session_token,
            fetch_glance,
            refresh_glance,
            fetch_managed_devices,
            sign_out,
            open_external_url,
            commands::fetch_win32_apps_cmd,
            commands::fetch_mobile_apps_cmd,
            commands::fetch_store_apps_cmd,
            commands::fetch_configuration_policies_cmd,
            commands::fetch_compliance_policies_cmd,
            commands::fetch_group_policy_configurations_cmd,
            commands::fetch_device_configurations_cmd,
            commands::fetch_endpoint_security_intents_cmd,
            commands::fetch_app_protection_policies_cmd,
            commands::fetch_tenant_scripts_cmd,
            commands::fetch_autopilot_devices_cmd,
            commands::fetch_autopilot_profiles_cmd,
            commands::fetch_windows_update_policies_cmd,
            commands::fetch_enrollment_configurations_cmd,
            commands::fetch_graph_object_detail_cmd,
            commands::fetch_managed_device_detail_cmd,
            commands::fetch_e8_baseline_references_cmd,
            commands::fetch_baseline_reference_sources_cmd,
            commands::fetch_baseline_export_cmd,
            commands::fetch_applied_policy_settings_cmd,
            commands::desktop_capability,
            commands::list_catalog_categories_cmd,
            commands::load_category_settings_cmd,
            commands::search_catalog_settings_cmd,
            commands::ensure_catalog_index_cmd,
            commands::catalog_index_status_cmd,
            commands::pause_catalog_index_cmd,
            commands::create_settings_catalog_policy_cmd,
            commands::add_settings_to_policy_cmd,
            commands::fetch_policy_setting_issues_cmd,
            commands::fetch_setting_conflict_details_cmd,
            commands::fetch_remediation_scripts_cmd,
            commands::fetch_remediation_device_status_cmd,
            commands::sync_managed_device_cmd,
            commands::reboot_managed_device_cmd,
            commands::remote_lock_managed_device_cmd,
            commands::collect_device_diagnostics_cmd,
            commands::initiate_on_demand_remediation_cmd,
            commands::retire_managed_device_cmd,
            commands::wipe_managed_device_cmd,
            commands::delete_managed_device_cmd,
            commands::get_laps_info_cmd,
            commands::reveal_laps_cmd,
            commands::list_bitlocker_keys_cmd,
            commands::reveal_bitlocker_key_cmd,
            commands::rotate_laps_password_cmd,
            commands::update_script_content_cmd,
            commands::create_tenant_script_cmd,
            commands::create_compliance_policy_cmd,
            commands::update_compliance_policy_cmd,
            commands::fetch_compliance_policy_status_cmd,
            commands::fetch_compliance_property_docs_cmd,
            commands::duplicate_graph_object_cmd,
            commands::update_object_metadata_cmd,
            commands::delete_graph_object_cmd,
            commands::lint_script_cmd,
            commands::search_directory_groups_cmd,
            commands::create_directory_group_cmd,
            commands::list_assignment_filters_cmd,
            commands::load_assignment_workspace_cmd,
            commands::assign_object_assignments_cmd,
            commands::open_popout_window,
            updater::check_for_update,
            updater::download_update,
            updater::apply_update_and_relaunch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
