use crate::AppState;
use axis_sdk::{
    add_settings_to_policy, remove_settings_from_policy, apply_filter_names, apply_group_metadata, assign_object_assignments,
    assignment_capabilities_for, collect_managed_device_diagnostics, create_directory_group,
    create_enrollment_platform_restriction,
    create_enrollment_limit,
    create_compliance_policy, create_policy_with_settings, create_policy_with_template,
    create_tenant_script, delete_graph_object, delete_managed_device, fetch_compliance_policy_status_with_options, fetch_compliance_property_docs, update_compliance_policy,
    duplicate_graph_object, update_autopilot_device_properties, fetch_windows_autopilot_settings,
    sync_windows_autopilot_devices, WindowsAutopilotSettings,
    create_autopilot_profile, update_autopilot_profile, CreateAutopilotProfileInput,
    UpdateAutopilotProfileInput,
    drafts_from_graph_assignments, normalize_assignment_drafts_for, fetch_app_protection_policies,
    fetch_policy_sets,
    fetch_autopilot_devices,
    fetch_applied_policy_settings, fetch_autopilot_profiles, fetch_baseline_export_json,
    fetch_pack_artifact_text, import_pack_json_document, import_pack_script_text, PackImportResult,
    fetch_baseline_reference_sources, fetch_compliance_policies,
    fetch_configuration_policies, fetch_device_configurations,
    fetch_configuration_policy_template, list_configuration_policy_templates,
    fetch_endpoint_security_intents, fetch_enrollment_configurations_filtered, fetch_graph_object_detail,
    fetch_group_policy_configurations, fetch_managed_device_detail, fetch_policy_setting_issues,
    fetch_mobile_apps, fetch_script_run_status, fetch_remediation_scripts, fetch_setting_conflict_details, fetch_store_apps,
    fetch_tenant_scripts, fetch_win32_apps, fetch_windows_update_policies,
    dest_dir_from_save_as, export_selected_graph_objects, export_tenant_pack, PackExportObject,
    PackExportOptions, PackExportProgress, PackExportResult, SelectedExportResult,
    create_empty_kit, create_local_pack, open_pack_workspace, open_pack_workspace_from_source,
    write_pack_kit, CreateLocalPackInput, PackKitWriteInput, PackWorkspace, PackKitSummary,
    finalize_snapshot, list_snapshots, prepare_snapshot_export, snapshot_label, snapshot_pack_dir,
    ClientContainerStatus, ClientSnapshotSummary, SnapshotManifest, SNAPSHOT_REPORT_DIR,
    diff_pack_roots, PackDiffReport,
    apply_kit_apply, apply_restore, list_restore_candidates, plan_kit_apply, plan_restore,
    KitApplyPlan, KitApplyResult, RestoreApplyResult, RestoreCandidate, RestoreMode, RestorePlan,
    generate_environment_report, EnvironmentReport, EnvironmentReportProgress,
    EnvironmentReportSelection,
    decode_access_token_claims,
    get_laps_credential_info, initiate_on_demand_remediation, list_assignment_filters,
    list_bitlocker_recovery_keys, list_catalog_categories, list_intune_audit_events, load_category_settings,
    reboot_managed_device, remote_lock_managed_device, resolve_directory_groups,
    retire_managed_device, reveal_bitlocker_recovery_key, reveal_laps_credentials,
    rotate_managed_device_laps_password, search_catalog_settings, search_directory_groups,
    sync_managed_device, update_enrollment_platform_restrictions, update_enrollment_limit,
    update_object_metadata, update_script_content, wipe_managed_device, AppProtectionPolicy,
    PolicySetSummary,
    AppliedPolicySettingsLoad, AssignmentCapabilities, AssignmentDraft, AssignmentFilter, AutopilotDevice, AutopilotProfile,
    BaselineReferenceSourceInput, BaselineReferenceSourceLoad, BitLockerRecoveryKeySummary,
    CatalogCategory, CatalogIndexState, CatalogPolicySummary, CatalogSearchResult,
    ConfigurationPolicyTemplateSummary,
    CompliancePolicyStatusReport,
    CategorySettingsLoad, CreateCompliancePolicyInput, CreateDirectoryGroupInput,
    CreateEnrollmentLimitInput, CreateEnrollmentPlatformRestrictionInput, CreateTenantScriptInput,
    CreatedCatalogPolicy, UpdateCompliancePolicyInput,
    DirectoryAuditEvent, DirectoryGroup, DuplicatedObject,
    GraphObjectDetail, InventoryList, LapsCredentialInfo,
    MobileAppSummary, PolicySettingIssue, RemediationDeviceStatusReport, SettingConflictDetail,
    SettingsCatalogPlatform, TenantScriptSummary, UpdateEnrollmentLimitInput,
    UpdateEnrollmentPlatformRestrictionsInput,
    UpdateObjectMetadataInput, UpdateScriptContentInput, UpdatedObjectMetadata,
    WindowsUpdatePolicy, SessionMode,
};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

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
pub struct BaselineReferenceSourcesResponse {
    pub sources: Vec<BaselineReferenceSourceLoad>,
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
pub struct PackArtifactTextResponse {
    pub text: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fetch_pack_artifact_text_cmd(
    download_url: String,
    token: Option<String>,
) -> Result<PackArtifactTextResponse, String> {
    match fetch_pack_artifact_text(&download_url, token.as_deref()).await {
        Ok(text) => Ok(PackArtifactTextResponse {
            text: Some(text),
            error: None,
        }),
        Err(error) => Ok(PackArtifactTextResponse {
            text: None,
            error: Some(error.to_string()),
        }),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackImportResponse {
    pub result: Option<PackImportResult>,
    pub error: Option<String>,
    pub mode: &'static str,
}

#[tauri::command]
pub async fn import_pack_json_document_cmd(
    state: State<'_, AppState>,
    document: Value,
    display_name: Option<String>,
    description: Option<String>,
) -> Result<PackImportResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(PackImportResponse {
            result: None,
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };
    match import_pack_json_document(
        &token,
        &document,
        display_name.as_deref(),
        description.as_deref(),
    )
    .await
    {
        Ok(result) => Ok(PackImportResponse {
            result: Some(result),
            error: None,
            mode: "live",
        }),
        Err(error) => Ok(PackImportResponse {
            result: None,
            error: Some(error.to_string()),
            mode: "live",
        }),
    }
}

#[tauri::command]
pub async fn import_pack_script_text_cmd(
    state: State<'_, AppState>,
    text: String,
    display_name: Option<String>,
    description: Option<String>,
) -> Result<PackImportResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(PackImportResponse {
            result: None,
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };
    match import_pack_script_text(
        &token,
        &text,
        display_name.as_deref(),
        description.as_deref(),
    )
    .await
    {
        Ok(result) => Ok(PackImportResponse {
            result: Some(result),
            error: None,
            mode: "live",
        }),
        Err(error) => Ok(PackImportResponse {
            result: None,
            error: Some(error.to_string()),
            mode: "live",
        }),
    }
}

#[tauri::command]
pub async fn pick_local_pack_folder_cmd(title: Option<String>) -> Result<Option<String>, String> {
    let title = title
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .unwrap_or_else(|| "Choose an Axis pack folder".into());
    tokio::task::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title(&title)
            .pick_folder()
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_pack_workspace_cmd(pack_root: String) -> Result<PackWorkspace, String> {
    open_pack_workspace(&pack_root).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_pack_workspace_from_source_cmd(
    source: BaselineReferenceSourceInput,
) -> Result<PackWorkspace, String> {
    open_pack_workspace_from_source(source)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn write_pack_kit_cmd(input: PackKitWriteInput) -> Result<PackKitSummary, String> {
    write_pack_kit(input).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_pack_kit_cmd(
    pack_root: String,
    name: Option<String>,
) -> Result<PackKitSummary, String> {
    create_empty_kit(&pack_root, name.as_deref().unwrap_or("New kit")).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_local_pack_cmd(input: CreateLocalPackInput) -> Result<PackWorkspace, String> {
    create_local_pack(input).map_err(|error| error.to_string())
}

const KIT_APPLY_PROGRESS_EVENT: &str = "axis-pack-kit-apply-progress";

#[tauri::command]
pub async fn plan_pack_kit_apply_cmd(
    state: State<'_, AppState>,
    pack_root: String,
    kit_rel_path: String,
    mode: String,
) -> Result<KitApplyPlan, String> {
    let Some(token) = session_token(&state).await? else {
        return Err("Sign in to plan applying a kit.".into());
    };
    let mode = RestoreMode::parse(&mode).map_err(|error| error.to_string())?;
    let root = std::path::PathBuf::from(pack_root.trim());
    if !root.is_dir() {
        return Err("Local pack folder is required to apply a kit.".into());
    }
    plan_kit_apply(&token, &root, kit_rel_path.trim(), mode)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn apply_pack_kit_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    pack_root: String,
    kit_rel_path: String,
    mode: String,
    keys: Vec<String>,
) -> Result<KitApplyResult, String> {
    let Some(token) = session_token(&state).await? else {
        return Err("Sign in to apply a kit.".into());
    };
    let mode = RestoreMode::parse(&mode).map_err(|error| error.to_string())?;
    let root = std::path::PathBuf::from(pack_root.trim());
    if !root.is_dir() {
        return Err("Local pack folder is required to apply a kit.".into());
    }
    if keys.is_empty() {
        return Err("Select at least one object to apply.".into());
    }
    apply_kit_apply(
        &token,
        &root,
        kit_rel_path.trim(),
        mode,
        &keys,
        |message| {
            let _ = app.emit(KIT_APPLY_PROGRESS_EVENT, &message);
        },
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn client_container_status_cmd(
    state: State<'_, AppState>,
) -> Result<ClientContainerStatus, String> {
    let tenant_id = state.auth.session_tenant_id().await;
    state
        .client_container
        .status(tenant_id.as_deref())
}

#[tauri::command]
pub async fn client_container_pick_open_cmd(
    state: State<'_, AppState>,
) -> Result<Option<ClientContainerStatus>, String> {
    let path = tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Open client container")
            .pick_folder()
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(path) = path else {
        return Ok(None);
    };
    state
        .client_container
        .set_active(std::path::PathBuf::from(&path))?;
    let tenant_id = state.auth.session_tenant_id().await;
    Ok(Some(
        state
            .client_container
            .status(tenant_id.as_deref())?,
    ))
}

#[tauri::command]
pub async fn client_container_pick_create_cmd() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Choose a folder for the new client container")
            .pick_folder()
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn client_container_create_cmd(
    state: State<'_, AppState>,
    path: String,
    name: String,
    primary_domain: Option<String>,
) -> Result<ClientContainerStatus, String> {
    let tenant_id = state
        .auth
        .session_tenant_id()
        .await
        .ok_or_else(|| {
            "Sign in so Axis can bind this container to your Entra tenant.".to_string()
        })?;
    let domain = primary_domain
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    state.client_container.create_and_activate(
        std::path::PathBuf::from(path.trim()),
        name.trim(),
        &tenant_id,
        domain,
    )?;
    state.client_container.status(Some(&tenant_id))
}

#[tauri::command]
pub async fn client_container_clear_cmd(
    state: State<'_, AppState>,
) -> Result<ClientContainerStatus, String> {
    state.client_container.clear();
    let tenant_id = state.auth.session_tenant_id().await;
    state.client_container.status(tenant_id.as_deref())
}

#[tauri::command]
pub async fn client_container_snooze_stale_cmd(
    state: State<'_, AppState>,
    days: u32,
) -> Result<ClientContainerStatus, String> {
    state.client_container.snooze(days)?;
    let tenant_id = state.auth.session_tenant_id().await;
    state.client_container.status(tenant_id.as_deref())
}

#[tauri::command]
pub async fn client_container_list_snapshots_cmd(
    state: State<'_, AppState>,
) -> Result<Vec<ClientSnapshotSummary>, String> {
    let path = state
        .client_container
        .active_path()
        .ok_or_else(|| "No client container is open.".to_string())?;
    list_snapshots(&path).map_err(|error| error.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSnapshotExportResult {
    pub snapshot: SnapshotManifest,
    pub pack: PackExportResult,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report: Option<EnvironmentReport>,
    pub status: ClientContainerStatus,
}

#[tauri::command]
pub async fn client_container_export_snapshot_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    pack_name: Option<String>,
) -> Result<ClientSnapshotExportResult, String> {
    let Some(token) = session_token(&state).await? else {
        return Err("Sign in to export a snapshot.".into());
    };
    let root = state
        .client_container
        .active_path()
        .ok_or_else(|| "Open a client container before exporting a snapshot.".to_string())?;
    let status = {
        let tenant_id = state.auth.session_tenant_id().await;
        state.client_container.status(tenant_id.as_deref())?
    };
    if status.tenant_mismatch {
        return Err(
            "Signed-in tenant does not match this client container. Swap session or open another container."
                .into(),
        );
    }
    let tenant_id = status
        .manifest
        .as_ref()
        .map(|m| m.tenant_id.clone())
        .or(status.session_tenant_id.clone())
        .ok_or_else(|| "Missing tenant id for snapshot.".to_string())?;

    let (snap_root, pack_root, report_root, exported_at) =
        prepare_snapshot_export(&root).map_err(|error| error.to_string())?;

    let suggested = pack_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            status
                .manifest
                .as_ref()
                .map(|m| format!("{} Intune export", m.name))
        })
        .unwrap_or_else(|| "Tenant Intune export".into());

    let options = PackExportOptions {
        pack_id: status.manifest.as_ref().map(|m| m.id.clone()),
        pack_name: Some(suggested.clone()),
    };

    let pack = match export_tenant_pack(
        &token,
        &pack_root,
        options,
        |progress: PackExportProgress| {
            let _ = app.emit(PACK_EXPORT_PROGRESS_EVENT, &progress);
        },
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&snap_root);
            return Err(error.to_string());
        }
    };

    let axis_version = app.package_info().version.to_string();
    let claims = decode_access_token_claims(&token);
    let token_scopes = claims
        .scp
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let prepared_for = status.manifest.as_ref().map(|m| m.name.clone());
    let report = match generate_environment_report(
        &token,
        &axis_version,
        prepared_for.as_deref(),
        None,
        &token_scopes,
        &EnvironmentReportSelection::default(),
        |progress: EnvironmentReportProgress| {
            let _ = app.emit(ENVIRONMENT_REPORT_PROGRESS_EVENT, &progress);
        },
    )
    .await
    {
        Ok(report) => {
            let html_name = report.suggested_name.clone();
            let md_name = report.suggested_markdown_name.clone();
            if let Err(error) = std::fs::write(report_root.join(&html_name), report.html.as_bytes())
            {
                let _ = std::fs::remove_dir_all(&snap_root);
                return Err(format!("Failed to write environment report HTML: {error}"));
            }
            if let Err(error) =
                std::fs::write(report_root.join(&md_name), report.markdown.as_bytes())
            {
                let _ = std::fs::remove_dir_all(&snap_root);
                return Err(format!("Failed to write environment report Markdown: {error}"));
            }
            Some(report)
        }
        Err(error) => {
            // Pack already written — keep snapshot, surface report failure as warning via None
            // and a soft error string is worse UX than failing the whole snapshot. Fail the
            // snapshot so callers know the export is incomplete.
            let _ = std::fs::remove_dir_all(&snap_root);
            return Err(format!("Environment report failed: {error}"));
        }
    };

    let report_html = report
        .as_ref()
        .map(|r| format!("{}/{}", SNAPSHOT_REPORT_DIR, r.suggested_name));
    let report_markdown = report
        .as_ref()
        .map(|r| format!("{}/{}", SNAPSHOT_REPORT_DIR, r.suggested_markdown_name));
    let report_object_count = report.as_ref().map(|r| r.object_count);

    let snapshot = finalize_snapshot(
        &root,
        &snap_root,
        &exported_at,
        &tenant_id,
        Some(&suggested),
        pack.files_written,
        pack.catalog_count,
        pack.include_count,
        report_html.as_deref(),
        report_markdown.as_deref(),
        report_object_count,
        Some(&axis_version),
    )
    .map_err(|error| error.to_string())?;

    let tenant_id = state.auth.session_tenant_id().await;
    let status = state.client_container.status(tenant_id.as_deref())?;
    Ok(ClientSnapshotExportResult {
        snapshot,
        pack,
        report,
        status,
    })
}

async fn resolve_diff_side(
    app: &AppHandle,
    state: &State<'_, AppState>,
    root: &std::path::Path,
    side: &str,
    pack_name: &str,
) -> Result<(std::path::PathBuf, String, Option<std::path::PathBuf>), String> {
    let trimmed = side.trim();
    if trimmed.eq_ignore_ascii_case("live") {
        let Some(token) = session_token(state).await? else {
            return Err("Sign in to compare against the live tenant.".into());
        };
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let temp = std::env::temp_dir().join(format!("axis-live-diff-{nanos}"));
        std::fs::create_dir_all(&temp).map_err(|error| error.to_string())?;
        let options = PackExportOptions {
            pack_id: Some("live-diff".into()),
            pack_name: Some(pack_name.to_string()),
        };
        match export_tenant_pack(
            &token,
            &temp,
            options,
            |progress: PackExportProgress| {
                let _ = app.emit(PACK_EXPORT_PROGRESS_EVENT, &progress);
            },
        )
        .await
        {
            Ok(_) => Ok((temp.clone(), "Live tenant".into(), Some(temp))),
            Err(error) => {
                let _ = std::fs::remove_dir_all(&temp);
                Err(error.to_string())
            }
        }
    } else {
        let pack = snapshot_pack_dir(root, trimmed).map_err(|error| error.to_string())?;
        let label = snapshot_label(root, trimmed);
        Ok((pack, label, None))
    }
}

#[tauri::command]
pub async fn client_container_diff_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    left: String,
    right: String,
) -> Result<PackDiffReport, String> {
    let root = state
        .client_container
        .active_path()
        .ok_or_else(|| "Open a client container before comparing snapshots.".to_string())?;
    let status = {
        let tenant_id = state.auth.session_tenant_id().await;
        state.client_container.status(tenant_id.as_deref())?
    };
    if status.tenant_mismatch
        && (left.trim().eq_ignore_ascii_case("live") || right.trim().eq_ignore_ascii_case("live"))
    {
        return Err(
            "Signed-in tenant does not match this client container. Live compare is blocked."
                .into(),
        );
    }
    if left.trim().eq_ignore_ascii_case(&right) {
        return Err("Pick two different sides to compare.".into());
    }

    let pack_name = status
        .manifest
        .as_ref()
        .map(|m| format!("{} Intune export", m.name))
        .unwrap_or_else(|| "Tenant Intune export".into());

    let (left_pack, left_label, left_cleanup) =
        resolve_diff_side(&app, &state, &root, &left, &pack_name).await?;
    let (right_pack, right_label, right_cleanup) =
        match resolve_diff_side(&app, &state, &root, &right, &pack_name).await {
            Ok(value) => value,
            Err(error) => {
                if let Some(path) = left_cleanup {
                    let _ = std::fs::remove_dir_all(path);
                }
                return Err(error);
            }
        };

    let report = diff_pack_roots(&left_pack, &right_pack, &left_label, &right_label);
    if let Some(path) = left_cleanup {
        let _ = std::fs::remove_dir_all(path);
    }
    if let Some(path) = right_cleanup {
        let _ = std::fs::remove_dir_all(path);
    }
    report.map_err(|error| error.to_string())
}

const RESTORE_PROGRESS_EVENT: &str = "axis-client-restore-progress";

#[tauri::command]
pub async fn client_container_restore_candidates_cmd(
    state: State<'_, AppState>,
    snapshot_id: String,
) -> Result<Vec<RestoreCandidate>, String> {
    let root = state
        .client_container
        .active_path()
        .ok_or_else(|| "Open a client container before restoring.".to_string())?;
    let pack = snapshot_pack_dir(&root, &snapshot_id).map_err(|error| error.to_string())?;
    list_restore_candidates(&pack).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn client_container_restore_plan_cmd(
    state: State<'_, AppState>,
    snapshot_id: String,
    mode: String,
    keys: Vec<String>,
) -> Result<RestorePlan, String> {
    let Some(token) = session_token(&state).await? else {
        return Err("Sign in to plan a restore.".into());
    };
    let root = state
        .client_container
        .active_path()
        .ok_or_else(|| "Open a client container before restoring.".to_string())?;
    let status = {
        let tenant_id = state.auth.session_tenant_id().await;
        state.client_container.status(tenant_id.as_deref())?
    };
    if status.tenant_mismatch {
        return Err(
            "Signed-in tenant does not match this client container. Restore is blocked.".into(),
        );
    }
    let mode = RestoreMode::parse(&mode).map_err(|error| error.to_string())?;
    let pack = snapshot_pack_dir(&root, &snapshot_id).map_err(|error| error.to_string())?;
    plan_restore(&token, &pack, snapshot_id.trim(), mode, &keys)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn client_container_restore_apply_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    snapshot_id: String,
    mode: String,
    keys: Vec<String>,
) -> Result<RestoreApplyResult, String> {
    let Some(token) = session_token(&state).await? else {
        return Err("Sign in to restore from a snapshot.".into());
    };
    let root = state
        .client_container
        .active_path()
        .ok_or_else(|| "Open a client container before restoring.".to_string())?;
    let status = {
        let tenant_id = state.auth.session_tenant_id().await;
        state.client_container.status(tenant_id.as_deref())?
    };
    if status.tenant_mismatch {
        return Err(
            "Signed-in tenant does not match this client container. Restore is blocked.".into(),
        );
    }
    if keys.is_empty() {
        return Err("Select at least one object to restore.".into());
    }
    let mode = RestoreMode::parse(&mode).map_err(|error| error.to_string())?;
    let pack = snapshot_pack_dir(&root, &snapshot_id).map_err(|error| error.to_string())?;
    apply_restore(
        &token,
        &pack,
        snapshot_id.trim(),
        mode,
        &keys,
        |message| {
            let _ = app.emit(RESTORE_PROGRESS_EVENT, &message);
        },
    )
    .await
    .map_err(|error| error.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedJsonFile {
    pub path: String,
    pub file_name: String,
    pub document: Option<Value>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn pick_json_files_cmd(title: Option<String>) -> Result<Option<Vec<PickedJsonFile>>, String> {
    let title = dialog_title(title, "Import Settings Catalog policies");
    let paths = tokio::task::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title(&title)
            .add_filter("JSON", &["json"])
            .pick_files()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(paths) = paths else {
        return Ok(None);
    };
    Ok(Some(
            paths
                .into_iter()
                .map(|path| {
                    let file_name = path
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_else(|| "policy.json".into());
                    match std::fs::read_to_string(&path) {
                        Ok(text) => match serde_json::from_str::<Value>(text.trim_start_matches('\u{FEFF}')) {
                            Ok(document) => PickedJsonFile {
                                path: path.to_string_lossy().into_owned(),
                                file_name,
                                document: Some(document),
                                error: None,
                            },
                            Err(error) => PickedJsonFile {
                                path: path.to_string_lossy().into_owned(),
                                file_name,
                                document: None,
                                error: Some(format!("Invalid JSON: {error}")),
                            },
                        },
                        Err(error) => PickedJsonFile {
                            path: path.to_string_lossy().into_owned(),
                            file_name,
                            document: None,
                            error: Some(error.to_string()),
                        },
                    }
                })
                .collect(),
        ))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedTextFile {
    pub path: String,
    pub file_name: String,
    pub text: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn pick_script_files_cmd(title: Option<String>) -> Result<Option<Vec<PickedTextFile>>, String> {
    let title = dialog_title(title, "Import scripts");
    let paths = tokio::task::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title(&title)
            .add_filter("Scripts", &["ps1", "sh", "zsh", "bash", "json"])
            .add_filter("JSON", &["json"])
            .pick_files()
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(paths) = paths else {
        return Ok(None);
    };
    Ok(Some(
        paths
            .into_iter()
            .map(|path| {
                let file_name = path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "script.ps1".into());
                match std::fs::read_to_string(&path) {
                    Ok(text) => PickedTextFile {
                        path: path.to_string_lossy().into_owned(),
                        file_name,
                        text: Some(text),
                        error: None,
                    },
                    Err(error) => PickedTextFile {
                        path: path.to_string_lossy().into_owned(),
                        file_name,
                        text: None,
                        error: Some(error.to_string()),
                    },
                }
            })
            .collect(),
    ))
}

const PACK_EXPORT_PROGRESS_EVENT: &str = "axis-pack-export-progress";
const ENVIRONMENT_REPORT_PROGRESS_EVENT: &str = "axis-environment-report-progress";

fn dialog_title(title: Option<String>, fallback: &str) -> String {
    title
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .unwrap_or_else(|| fallback.to_string())
}

async fn save_as_path(
    title: String,
    suggested_name: String,
    json_filter: bool,
) -> Result<Option<std::path::PathBuf>, String> {
    tokio::task::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new()
            .set_title(&title)
            .set_file_name(&suggested_name);
        if json_filter {
            let ext = suggested_name
                .rsplit('.')
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            dialog = match ext.as_str() {
                "html" | "htm" => dialog.add_filter("HTML", &["html"]),
                "md" | "markdown" => dialog.add_filter("Markdown", &["md"]),
                _ => dialog.add_filter("JSON", &["json"]),
            };
        }
        dialog.save_file()
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_text_file_cmd(
    contents: String,
    suggested_name: Option<String>,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let title = dialog_title(title, "Save as");
    let suggested = suggested_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("export.json")
        .to_string();
    let Some(path) = save_as_path(title, suggested, true).await? else {
        return Ok(None);
    };
    tokio::task::spawn_blocking(move || {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::write(&path, contents).map_err(|error| error.to_string())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn generate_environment_report_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    prepared_for: Option<String>,
    prepared_by: Option<String>,
    selection: Option<EnvironmentReportSelection>,
) -> Result<EnvironmentReport, String> {
    let Some(token) = session_token(&state).await? else {
        return Err("Sign in to generate an as-built report.".into());
    };
    let claims = decode_access_token_claims(&token);
    let token_scopes = claims
        .scp
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let version = app.package_info().version.to_string();
    let selection = selection.unwrap_or_default();
    generate_environment_report(
        &token,
        &version,
        prepared_for.as_deref(),
        prepared_by.as_deref(),
        &token_scopes,
        &selection,
        |progress: EnvironmentReportProgress| {
            let _ = app.emit(ENVIRONMENT_REPORT_PROGRESS_EVENT, &progress);
        },
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn export_tenant_pack_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    dest: Option<String>,
    pack_name: Option<String>,
    pack_id: Option<String>,
) -> Result<Option<PackExportResult>, String> {
    let Some(token) = session_token(&state).await? else {
        return Err("Sign in to export this tenant.".into());
    };
    let suggested = pack_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Tenant Intune export")
        .to_string();
    let dest = if let Some(dest) = dest.filter(|value| !value.trim().is_empty()) {
        std::path::PathBuf::from(dest.trim())
    } else {
        let Some(path) = save_as_path("Save tenant pack as".into(), suggested.clone(), false).await?
        else {
            return Ok(None);
        };
        dest_dir_from_save_as(&path)
    };
    if dest.is_file() {
        return Err("That path is an existing file. Choose a new folder name in Save As.".into());
    }
    let options = PackExportOptions {
        pack_id,
        pack_name: Some(suggested),
    };
    let result = export_tenant_pack(
        &token,
        &dest,
        options,
        |progress: PackExportProgress| {
            let _ = app.emit(PACK_EXPORT_PROGRESS_EVENT, &progress);
        },
    )
    .await
    .map_err(|error| error.to_string())?;
    Ok(Some(result))
}

#[tauri::command]
pub async fn export_selected_objects_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    objects: Vec<PackExportObject>,
) -> Result<Option<SelectedExportResult>, String> {
    let Some(token) = session_token(&state).await? else {
        return Err("Sign in to export.".into());
    };
    if objects.is_empty() {
        return Err("Select at least one object to export.".into());
    }
    let dest = if objects.len() == 1 {
        let suggested = format!(
            "{}.json",
            objects[0]
                .title
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("export")
        );
        let Some(path) = save_as_path("Save export as".into(), suggested, true).await? else {
            return Ok(None);
        };
        path
    } else {
        let Some(path) = save_as_path(
            "Save selected exports as".into(),
            "Intune export".into(),
            false,
        )
        .await?
        else {
            return Ok(None);
        };
        dest_dir_from_save_as(&path)
    };
    export_selected_graph_objects(&token, &dest, &objects, |progress: PackExportProgress| {
        let _ = app.emit(PACK_EXPORT_PROGRESS_EVENT, &progress);
    })
    .await
    .map(Some)
    .map_err(|error| error.to_string())
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

async fn ensure_write_allowed(state: &State<'_, AppState>) -> Result<(), String> {
    if state.auth.session_mode().await == SessionMode::Read {
        return Err("Action blocked: Axis is running in Read-only mode.".into());
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntuneAuditLogResponse {
    pub events: Vec<DirectoryAuditEvent>,
    pub error: Option<String>,
    pub truncated: bool,
}

#[tauri::command]
pub async fn list_intune_audit_events_cmd(
    state: State<'_, AppState>,
) -> Result<IntuneAuditLogResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(IntuneAuditLogResponse {
            events: vec![],
            error: Some("Not signed in.".into()),
            truncated: false,
        });
    };
    match list_intune_audit_events(&token, 250).await {
        Ok(events) => Ok(IntuneAuditLogResponse {
            truncated: events.len() >= 250,
            events,
            error: None,
        }),
        Err(error) => Ok(IntuneAuditLogResponse {
            events: vec![],
            error: Some(error.to_string()),
            truncated: false,
        }),
    }
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
pub async fn fetch_policy_sets_cmd(
    state: State<'_, AppState>,
) -> Result<InventoryResponse<PolicySetSummary>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    with_inventory(&state, fetch_policy_sets(&token)).await
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
    kind: Option<String>,
) -> Result<InventoryResponse<CatalogPolicySummary>, String> {
    let token = session_token(&state).await?.unwrap_or_default();
    let query = kind
        .as_deref()
        .and_then(axis_sdk::EnrollmentConfigQuery::parse)
        .unwrap_or(axis_sdk::EnrollmentConfigQuery::All);
    with_inventory(
        &state,
        fetch_enrollment_configurations_filtered(&token, query),
    )
    .await
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationPolicyTemplateResponse {
    templates: Vec<serde_json::Value>,
    error: Option<String>,
}

#[tauri::command]
pub async fn fetch_configuration_policy_template_cmd(
    state: State<'_, AppState>,
    template_id: String,
) -> Result<ConfigurationPolicyTemplateResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(ConfigurationPolicyTemplateResponse {
            templates: vec![],
            error: Some("Not signed in.".into()),
        });
    };
    match fetch_configuration_policy_template(&token, &template_id).await {
        Ok(templates) => Ok(ConfigurationPolicyTemplateResponse {
            templates,
            error: None,
        }),
        Err(error) => Ok(ConfigurationPolicyTemplateResponse {
            templates: vec![],
            error: Some(error.to_string()),
        }),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationPolicyTemplatesListResponse {
    templates: Vec<ConfigurationPolicyTemplateSummary>,
    error: Option<String>,
}

#[tauri::command]
pub async fn list_configuration_policy_templates_cmd(
    state: State<'_, AppState>,
    template_family: String,
) -> Result<ConfigurationPolicyTemplatesListResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(ConfigurationPolicyTemplatesListResponse {
            templates: vec![],
            error: Some("Not signed in.".into()),
        });
    };
    match list_configuration_policy_templates(&token, &template_family).await {
        Ok(templates) => Ok(ConfigurationPolicyTemplatesListResponse {
            templates,
            error: None,
        }),
        Err(error) => Ok(ConfigurationPolicyTemplatesListResponse {
            templates: vec![],
            error: Some(error.to_string()),
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
            return Ok(CapabilityStatus {
                available: true,
                reason: "GitHub and local template stores are listed on Templates. ASD hard baselines stay on Baselines. The desktop app fetches these sources directly.".into(),
            });
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
        Ok(mut result) => {
            result.settings.truncate(25);
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
    ensure_write_allowed(&state).await?;
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
pub async fn create_endpoint_security_policy_cmd(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
    platform: String,
    template_id: String,
    template_family: String,
    settings: Vec<Value>,
    platforms: Option<String>,
    technologies: Option<String>,
) -> Result<CreateCatalogPolicyResponse, String> {
    ensure_write_allowed(&state).await?;
    let catalog_platform = parse_catalog_platform(&platform);
    let Some(token) = session_token(&state).await? else {
        return Ok(CreateCatalogPolicyResponse {
            policy: None,
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };
    match create_policy_with_template(
        &token,
        &name,
        description.as_deref(),
        catalog_platform,
        &template_id,
        Some(&template_family),
        &settings,
        platforms.as_deref(),
        technologies.as_deref(),
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
    ensure_write_allowed(&state).await?;
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

#[tauri::command]
pub async fn remove_settings_from_policy_cmd(
    state: State<'_, AppState>,
    policy_id: String,
    definition_ids: Vec<String>,
) -> Result<CreateCatalogPolicyResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(CreateCatalogPolicyResponse {
            policy: None,
            error: Some("Not signed in.".into()),
            mode: "live",
        });
    };
    match remove_settings_from_policy(&token, &policy_id, &definition_ids).await {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemediationDeviceStatusResponse {
    pub report: Option<RemediationDeviceStatusReport>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fetch_remediation_device_status_cmd(
    state: State<'_, AppState>,
    script_id: String,
    kind: Option<String>,
) -> Result<RemediationDeviceStatusResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(RemediationDeviceStatusResponse {
            report: None,
            error: Some("Not signed in.".into()),
        });
    };
    let kind = kind.unwrap_or_else(|| "script:remediation".into());
    match fetch_script_run_status(&token, &kind, &script_id).await {
        Ok(report) => Ok(RemediationDeviceStatusResponse {
            report: Some(report),
            error: None,
        }),
        Err(error) => Ok(RemediationDeviceStatusResponse {
            report: None,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn sync_managed_device_cmd(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<ActionResponse, String> {
    ensure_write_allowed(&state).await?;
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
    ensure_write_allowed(&state).await?;
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
    ensure_write_allowed(&state).await?;
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
    ensure_write_allowed(&state).await?;
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
    ensure_write_allowed(&state).await?;
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
    ensure_write_allowed(&state).await?;
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
    ensure_write_allowed(&state).await?;
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
    ensure_write_allowed(&state).await?;
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
    ensure_write_allowed(&state).await?;
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
    input: UpdateScriptContentInput,
) -> Result<ActionResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match update_script_content(&token, &input).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(action_err(error)),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTenantScriptResponse {
    pub script: Option<TenantScriptSummary>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCompliancePolicyResponse {
    pub policy: Option<CatalogPolicySummary>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEnrollmentPlatformRestrictionResponse {
    pub policy: Option<CatalogPolicySummary>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEnrollmentLimitResponse {
    pub policy: Option<CatalogPolicySummary>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompliancePropertyDocsResponse {
    pub properties: Vec<axis_sdk::CompliancePropertyDoc>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompliancePolicyStatusResponse {
    pub report: Option<CompliancePolicyStatusReport>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fetch_compliance_policy_status_cmd(
    state: State<'_, AppState>,
    policy_id: String,
    generate_settings: Option<bool>,
) -> Result<CompliancePolicyStatusResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(CompliancePolicyStatusResponse {
            report: None,
            error: Some("Not signed in.".into()),
        });
    };
    match fetch_compliance_policy_status_with_options(
        &token,
        &policy_id,
        generate_settings.unwrap_or(false),
    )
    .await {
        Ok(report) => Ok(CompliancePolicyStatusResponse {
            report: Some(report),
            error: None,
        }),
        Err(error) => Ok(CompliancePolicyStatusResponse {
            report: None,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn fetch_compliance_property_docs_cmd(
    odata_type: String,
) -> Result<CompliancePropertyDocsResponse, String> {
    match fetch_compliance_property_docs(&odata_type).await {
        Ok(properties) => Ok(CompliancePropertyDocsResponse {
            properties,
            error: None,
        }),
        Err(error) => Ok(CompliancePropertyDocsResponse {
            properties: Vec::new(),
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn create_compliance_policy_cmd(
    state: State<'_, AppState>,
    input: CreateCompliancePolicyInput,
) -> Result<CreateCompliancePolicyResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(CreateCompliancePolicyResponse {
            policy: None,
            error: Some("Not signed in.".into()),
        });
    };
    match create_compliance_policy(&token, input).await {
        Ok(policy) => Ok(CreateCompliancePolicyResponse {
            policy: Some(policy),
            error: None,
        }),
        Err(error) => Ok(CreateCompliancePolicyResponse {
            policy: None,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn create_enrollment_platform_restriction_cmd(
    state: State<'_, AppState>,
    input: CreateEnrollmentPlatformRestrictionInput,
) -> Result<CreateEnrollmentPlatformRestrictionResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(CreateEnrollmentPlatformRestrictionResponse {
            policy: None,
            error: Some("Not signed in.".into()),
        });
    };
    match create_enrollment_platform_restriction(&token, input).await {
        Ok(policy) => Ok(CreateEnrollmentPlatformRestrictionResponse {
            policy: Some(policy),
            error: None,
        }),
        Err(error) => Ok(CreateEnrollmentPlatformRestrictionResponse {
            policy: None,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn create_enrollment_limit_cmd(
    state: State<'_, AppState>,
    input: CreateEnrollmentLimitInput,
) -> Result<CreateEnrollmentLimitResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(CreateEnrollmentLimitResponse {
            policy: None,
            error: Some("Not signed in.".into()),
        });
    };
    match create_enrollment_limit(&token, input).await {
        Ok(policy) => Ok(CreateEnrollmentLimitResponse {
            policy: Some(policy),
            error: None,
        }),
        Err(error) => Ok(CreateEnrollmentLimitResponse {
            policy: None,
            error: Some(error.to_string()),
        }),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAutopilotProfileResponse {
    pub profile: Option<AutopilotProfile>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn create_autopilot_profile_cmd(
    state: State<'_, AppState>,
    input: CreateAutopilotProfileInput,
) -> Result<CreateAutopilotProfileResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(CreateAutopilotProfileResponse {
            profile: None,
            error: Some("Not signed in.".into()),
        });
    };
    match create_autopilot_profile(&token, input).await {
        Ok(profile) => Ok(CreateAutopilotProfileResponse {
            profile: Some(profile),
            error: None,
        }),
        Err(error) => Ok(CreateAutopilotProfileResponse {
            profile: None,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn update_autopilot_profile_cmd(
    state: State<'_, AppState>,
    input: UpdateAutopilotProfileInput,
) -> Result<ActionResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match update_autopilot_profile(&token, input).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(ActionResponse {
            ok: false,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn update_compliance_policy_cmd(
    state: State<'_, AppState>,
    input: UpdateCompliancePolicyInput,
) -> Result<ActionResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match update_compliance_policy(&token, input).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(ActionResponse {
            ok: false,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn update_enrollment_platform_restrictions_cmd(
    state: State<'_, AppState>,
    input: UpdateEnrollmentPlatformRestrictionsInput,
) -> Result<ActionResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match update_enrollment_platform_restrictions(&token, input).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(ActionResponse {
            ok: false,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn update_enrollment_limit_cmd(
    state: State<'_, AppState>,
    input: UpdateEnrollmentLimitInput,
) -> Result<ActionResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match update_enrollment_limit(&token, input).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(ActionResponse {
            ok: false,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn create_tenant_script_cmd(
    state: State<'_, AppState>,
    input: CreateTenantScriptInput,
) -> Result<CreateTenantScriptResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(CreateTenantScriptResponse {
            script: None,
            error: Some("Not signed in.".into()),
        });
    };
    match create_tenant_script(&token, input).await {
        Ok(script) => Ok(CreateTenantScriptResponse {
            script: Some(script),
            error: None,
        }),
        Err(error) => Ok(CreateTenantScriptResponse {
            script: None,
            error: Some(error.to_string()),
        }),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGraphObjectResponse {
    pub object: Option<DuplicatedObject>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn duplicate_graph_object_cmd(
    state: State<'_, AppState>,
    kind: String,
    id: String,
    display_name: Option<String>,
    description: Option<String>,
    copy_assignments: Option<bool>,
) -> Result<DuplicateGraphObjectResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(DuplicateGraphObjectResponse {
            object: None,
            error: Some("Not signed in.".into()),
        });
    };
    match duplicate_graph_object(
        &token,
        &kind,
        &id,
        display_name.as_deref(),
        description.as_deref(),
        copy_assignments.unwrap_or(false),
    )
    .await
    {
        Ok(object) => Ok(DuplicateGraphObjectResponse {
            object: Some(object),
            error: None,
        }),
        Err(error) => Ok(DuplicateGraphObjectResponse {
            object: None,
            error: Some(error.to_string()),
        }),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateObjectMetadataResponse {
    pub object: Option<UpdatedObjectMetadata>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn update_object_metadata_cmd(
    state: State<'_, AppState>,
    input: UpdateObjectMetadataInput,
) -> Result<UpdateObjectMetadataResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(UpdateObjectMetadataResponse {
            object: None,
            error: Some("Not signed in.".into()),
        });
    };
    match update_object_metadata(&token, input).await {
        Ok(object) => Ok(UpdateObjectMetadataResponse {
            object: Some(object),
            error: None,
        }),
        Err(error) => Ok(UpdateObjectMetadataResponse {
            object: None,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn delete_graph_object_cmd(
    state: State<'_, AppState>,
    kind: String,
    id: String,
) -> Result<ActionResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match delete_graph_object(&token, &kind, &id).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(ActionResponse {
            ok: false,
            error: Some(error.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn update_autopilot_device_group_tag_cmd(
    state: State<'_, AppState>,
    id: String,
    group_tag: String,
) -> Result<ActionResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(ActionResponse {
            ok: false,
            error: Some("Not signed in.".into()),
        });
    };
    match update_autopilot_device_properties(&token, &id, &group_tag).await {
        Ok(()) => Ok(ActionResponse {
            ok: true,
            error: None,
        }),
        Err(error) => Ok(ActionResponse {
            ok: false,
            error: Some(error.to_string()),
        }),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsAutopilotSettingsResponse {
    pub settings: Option<WindowsAutopilotSettings>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn fetch_windows_autopilot_settings_cmd(
    state: State<'_, AppState>,
) -> Result<WindowsAutopilotSettingsResponse, String> {
    let Some(token) = session_token(&state).await? else {
        return Ok(WindowsAutopilotSettingsResponse {
            settings: None,
            error: Some("Not signed in.".into()),
        });
    };
    match fetch_windows_autopilot_settings(&token).await {
        Ok(settings) => Ok(WindowsAutopilotSettingsResponse {
            settings: Some(settings),
            error: None,
        }),
        Err(error) => Ok(WindowsAutopilotSettingsResponse {
            settings: None,
            error: Some(error.to_string()),
        }),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncWindowsAutopilotResponse {
    pub ok: bool,
    pub error: Option<String>,
    pub status: Option<u16>,
    pub settings: Option<WindowsAutopilotSettings>,
}

#[tauri::command]
pub async fn sync_windows_autopilot_devices_cmd(
    state: State<'_, AppState>,
) -> Result<SyncWindowsAutopilotResponse, String> {
    ensure_write_allowed(&state).await?;
    let Some(token) = session_token(&state).await? else {
        return Ok(SyncWindowsAutopilotResponse {
            ok: false,
            error: Some("Not signed in.".into()),
            status: None,
            settings: None,
        });
    };
    match sync_windows_autopilot_devices(&token).await {
        Ok(settings) => Ok(SyncWindowsAutopilotResponse {
            ok: true,
            error: None,
            status: None,
            settings: Some(settings),
        }),
        Err(error) => {
            let status = error.status();
            let settings = fetch_windows_autopilot_settings(&token).await.ok();
            let message = match status {
                Some(409) => "An Autopilot sync is already in progress.".into(),
                Some(429) => {
                    "Autopilot sync is on cooldown (Graph allows one manual sync every 10 minutes)."
                        .into()
                }
                _ => error.to_string(),
            };
            Ok(SyncWindowsAutopilotResponse {
                ok: false,
                error: Some(message),
                status,
                settings,
            })
        }
    }
}

#[tauri::command]
pub async fn lint_script_cmd(
    language: String,
    source: String,
) -> Result<crate::script_lint::ScriptLintResult, String> {
    tokio::task::spawn_blocking(move || crate::script_lint::lint_script(&language, &source))
        .await
        .map_err(|error| error.to_string())
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
    ensure_write_allowed(&state).await?;
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
    object_odata_type: Option<String>,
) -> Result<AssignmentWorkspaceResponse, String> {
    let odata = object_odata_type.as_deref();
    let capabilities = assignment_capabilities_for(&kind, odata);
    let Some(token) = session_token(&state).await? else {
        let mut drafts =
            drafts_from_graph_assignments(&assignments, capabilities.supports_intent);
        normalize_assignment_drafts_for(&kind, odata, &mut drafts);
        return Ok(AssignmentWorkspaceResponse {
            drafts,
            filters: Vec::new(),
            capabilities,
            filters_error: Some("Not signed in.".into()),
            error: Some("Not signed in.".into()),
        });
    };

    let mut drafts = drafts_from_graph_assignments(&assignments, capabilities.supports_intent);
    normalize_assignment_drafts_for(&kind, odata, &mut drafts);
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
    ensure_write_allowed(&state).await?;
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
