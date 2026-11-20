mod app_catalog;
mod app_icon;
mod assignments;
mod auth;
mod autopilot_profiles;
mod licence_names;
mod ca_coverage;
mod catalog_index;
mod client_container;
mod compliance_docs;
mod compliance_policy;
mod compliance_status;
mod device_actions;
mod device_compare;
mod device_detail;
mod device_policies;
mod device_recovery;
mod devices;
mod domain_join;
mod e8_baselines;
mod enrollment_esp;
mod enrollment_limits;
mod enrollment_restrictions;
mod environment_report;
mod exchange_admin;
mod feature_updates;
mod glance;
mod graph;
mod intunewin;
mod inventory;
mod laps;
mod object_detail;
mod object_duplicate;
mod object_metadata;
mod pack_diff;
mod pack_export;
mod pack_kits;
mod pack_restore;
mod policy_health;
mod readiness;
mod review;
mod script_status;
mod session_store;
mod setting_usage;
mod settings_catalog;
mod store_apps;
mod tenant_health;
mod types;
mod whatif;
mod win32_apps;
mod windows_update;
mod write_log;

pub use app_catalog::{
    attach_catalog_intunewin, catalog_dependency_chain, copy_catalog_app_version,
    create_catalog_app, delete_catalog_apps, find_intune_win_path, list_catalog_apps,
    read_catalog_app_config, save_catalog_app_config, CatalogAppDocument, CatalogAppSummary,
    CatalogDependencyChain, CatalogDependencyNode, CatalogIntuneWinFile, CopyCatalogAppInput,
    CreateCatalogAppInput, SaveCatalogAppInput,
};
pub use app_icon::{
    attach_catalog_icon, download_public_icon, fetch_catalog_icon, large_icon_json,
    preview_catalog_icon, read_local_icon, resolve_catalog_large_icon, CatalogAppIcon,
    CatalogIconPreview, IconError,
};
pub use assignments::{
    add_directory_group_member, apply_filter_names, apply_group_metadata, assign_object_assignments,
    assignment_capabilities, assignment_capabilities_for, classify_group_membership,
    create_directory_group, default_remediation_schedule, drafts_from_graph_assignments, export_directory_groups,
    list_assignment_filters, list_directory_group_members, list_directory_groups,
    mail_nickname_from_display_name, normalize_assignment_drafts, normalize_assignment_drafts_for,
    remove_directory_group_member, resolve_directory_groups, search_directory_groups,
    AssignmentCapabilities, AssignmentDraft, AssignmentFilter, AssignmentFilterMode,
    AssignmentIntent, AssignmentTargetKind, CreateDirectoryGroupInput, CreateGroupMembership,
    DirectoryGroup, DirectoryGroupMember, GroupMembershipKind, RemediationScheduleDraft,
    RemediationScheduleKind, DYNAMIC_DEVICE_RULE_TEMPLATE, DYNAMIC_USER_RULE_TEMPLATE,
};
pub use auth::{
    decode_access_token_claims, device_code_client_id, device_code_scopes, device_code_tenant,
    is_graph_command_line_tools_client, is_write_or_privileged_scope, parse_extra_scopes,
    scopes_for_mode, scopes_for_mode_with_extras, token_scp_has_write_scopes, AuthError, AuthManager,
    BrowserSignIn, PollResult, SessionTokens, StoredSignIn, StoredSignInOutcome, TokenClaims,
};
pub use autopilot_profiles::{
    autopilot_profile_create_body_from_export, create_autopilot_profile,
    create_autopilot_profile_body, create_autopilot_profile_from_export, update_autopilot_profile,
    update_autopilot_profile_body, AutopilotEspDraft, AutopilotJoinKind, AutopilotOobeDraft,
    CreateAutopilotProfileInput, UpdateAutopilotProfileInput,
};
pub use catalog_index::*;
pub use client_container::{
    build_status as build_client_container_status, create_container, finalize_snapshot,
    list_snapshots, open_container, prepare_snapshot_export, snapshot_label, snapshot_pack_dir,
    snooze_stale_prompt, ClientContainerError, ClientContainerManifest, ClientContainerStatus,
    ClientSnapshotSummary, SnapshotManifest, CLIENT_MANIFEST_FILE, DEFAULT_STALE_DAYS,
    SNAPSHOT_REPORT_DIR,
};
pub use compliance_docs::{
    fetch_compliance_property_docs, CompliancePropertyDoc, CompliancePropertyOption,
};
pub use compliance_policy::{
    create_compliance_policy, platforms_from_compliance_odata, update_compliance_policy,
    CreateCompliancePolicyInput, UpdateCompliancePolicyInput,
};
pub use compliance_status::{
    fetch_compliance_policy_status, fetch_compliance_policy_status_with_options,
    ComplianceDeviceStatus, ComplianceDeviceStatusOverview, CompliancePolicyStatusReport,
    ComplianceSettingStatusSummary, ComplianceSettingsReportState, ComplianceUserStatus,
};
pub use device_actions::{
    collect_managed_device_diagnostics, delete_managed_device, initiate_on_demand_remediation,
    reboot_managed_device, remote_lock_managed_device, retire_managed_device, sync_managed_device,
    wipe_managed_device,
};
pub use device_compare::{
    fetch_applied_policy_settings, fetch_baseline_export_json, fetch_pack_artifact_text,
    AppliedPolicySettings, AppliedPolicySettingsLoad,
};
pub use device_detail::{
    fetch_managed_device_detail, fetch_user_group_memberships, DetectedApp,
    DirectoryGroupMembership, ManagedApp, ManagedDeviceDetail, ManagedDeviceHardwareDetails,
};
pub use device_policies::{
    fetch_policy_setting_issues, fetch_setting_conflict_details, DevicePolicyState,
    PolicyConflictSummary, PolicyDiagnostics, PolicySettingIssue, SettingConflictDetail,
};
pub use device_recovery::{
    get_laps_credential_info, list_bitlocker_recovery_keys, reveal_bitlocker_recovery_key,
    reveal_laps_credentials, rotate_managed_device_laps_password, BitLockerRecoveryKeySummary,
    LapsCredentialInfo,
};
pub use devices::fetch_managed_device_list;
pub use domain_join::{
    create_domain_join_body, create_domain_join_profile, CreateDomainJoinInput,
    CreatedDomainJoinProfile,
};
pub use e8_baselines::*;
pub use enrollment_esp::{
    create_enrollment_status_page, create_enrollment_status_page_body, fetch_esp_blocking_apps,
    CreateEnrollmentStatusPageInput, CreatedEnrollmentStatusPage, EspBlockingApp,
};
pub use enrollment_limits::{
    create_enrollment_limit, update_enrollment_limit, CreateEnrollmentLimitInput,
    UpdateEnrollmentLimitInput, DEVICE_LIMIT_MAX, DEVICE_LIMIT_MIN,
};
pub use enrollment_restrictions::{
    create_enrollment_platform_restriction, update_enrollment_platform_restrictions,
    CreateEnrollmentPlatformRestrictionInput, PlatformRestrictionPatch,
    UpdateEnrollmentPlatformRestrictionsInput,
};
pub use environment_report::{
    generate_environment_report, EnvironmentReport, EnvironmentReportProgress,
    EnvironmentReportSelection,
};
pub use feature_updates::{
    create_feature_update_profile, feature_update_body, fetch_feature_update_eligibility,
    fetch_feature_update_profile, update_feature_update_profile, FeatureUpdateEligibility,
    fetch_feature_update_catalog, FeatureUpdateCatalogItem, FeatureUpdateProfile,
};
pub use glance::{fetch_tenant_glance, list_intune_audit_events};
pub use graph::{set_throttle_listener, GraphClient, GraphError, ThrottleNotice};
pub use intunewin::{
    find_catalog_upload_matches, link_win32_app_dependency, link_win32_app_supersedence,
    unlink_win32_app_dependency, unlink_win32_app_supersedence, upload_catalog_win32,
    Win32AppMatch, Win32UploadProgress, Win32UploadResult,
};
pub use inventory::*;
pub use laps::{
    create_laps_policy, enable_laps_for_tenant, fetch_laps_tenant_status, CreateLapsPolicyInput,
    LapsTenantStatus,
};
pub use object_detail::{
    create_tenant_script, fetch_configuration_policy_template, fetch_graph_object_detail,
    list_configuration_policy_templates, update_script_content, ConfigurationPolicyTemplateSummary,
    CreateTenantScriptInput, GraphObjectDetail, UpdateScriptContentInput,
};
pub use object_duplicate::{
    can_duplicate_kind, copy_display_name, duplicate_graph_object, strip_for_graph_create,
    strip_keys, strip_setting_definitions, DuplicatedObject,
};
pub use exchange_admin::{
    fetch_exchange_review_object, fetch_exchange_review_objects, is_compliance_review_kind,
    is_exchange_review_kind,
};
pub use object_metadata::{
    can_delete_graph_object, can_update_object_metadata, delete_graph_object,
    fetch_windows_autopilot_settings, mobile_app_delete_links, mobile_app_relationships,
    sync_windows_autopilot_devices, update_autopilot_device_properties, update_directory_group,
    update_object_metadata, can_edit_scope_tags, list_role_scope_tags, fetch_object_scope_tags,
    update_object_scope_tags, RoleScopeTag, UpdateObjectScopeTagsInput,
    MobileAppDeleteLink, UpdateObjectMetadataInput, UpdatedObjectMetadata,
    WindowsAutopilotSettings, AUTOPILOT_SYNC_COOLDOWN_SECS,
};
pub use pack_diff::{
    assignment_target_ids, diff_pack_roots, label_assignment_ids, PackDiffChangeKind,
    PackDiffError, PackDiffReport, PackDiffSummary, PackFieldChange, PackObjectDiff,
};
pub use pack_export::{
    dest_dir_from_save_as, export_selected_graph_objects, export_tenant_pack,
    graph_fetch_concurrency, pretty_json, PackExportError, PackExportObject, PackExportOptions,
    PackExportProgress, PackExportResult, SelectedExportResult,
};
pub use pack_kits::{
    create_empty_kit, create_local_pack, open_pack_workspace, open_pack_workspace_from_source,
    write_pack_kit, CreateLocalPackInput, PackArtifactRow, PackKitSummary, PackKitWriteInput,
    PackKitsError, PackManifestView, PackWorkspace,
};
pub use pack_restore::{
    apply_kit_apply, apply_restore, import_pack_json_document, import_pack_script_text,
    kit_apply_selection_preview, list_restore_candidates, plan_kit_apply, plan_restore,
    KitApplyPlan, KitApplyResult, PackImportResult, PackRestoreError, RestoreApplyResult,
    RestoreCandidate, RestoreItemStatus, RestoreMode, RestorePlan, RestorePlanItem,
};
pub use policy_health::{
    fetch_app_install_health, fetch_configuration_policy_health, fetch_device_configuration_devices, index_app_install,
    index_policy_health, lookup_app_install, lookup_policy_health, AppInstallHealth, PolicyHealth,
};
pub use ca_coverage::{evaluate_conditional_access, fetch_conditional_access_coverage, fetch_conditional_access_sign_ins, search_conditional_access_apps, create_conditional_access_policy, fetch_signed_in_user, ConditionalAccessCoverage};
pub use review::{
    fetch_review_objects, fetch_review_row, is_row_only_review_kind, resolve_review_names,
    ReviewReferences,
};
pub use readiness::{
    fetch_intune_readiness, fetch_mdm_user_scope, fetch_user_readiness, search_readiness_users,
    update_mdm_user_scope, MdmScopeGroup, MdmUserScope, MdmUserScopePatch, ReadinessReport,
    ReadinessRow, ReadinessSection, ReadinessUserHit, UserReadinessReport,
};
pub use script_status::{
    fetch_remediation_device_status, fetch_script_run_status, RemediationDeviceRunState,
    RemediationDeviceStatusReport, RemediationRunManagedDevice, RemediationRunSummary,
    ScriptUserRunState,
};
pub use session_store::{mark_signed_out, SessionMode};
pub use settings_catalog::*;
pub use store_apps::{
    create_winget_app, fetch_store_catalog_manifest, search_store_catalog, update_winget_app,
    CreateWinGetAppInput, StoreCatalogHit, StoreCatalogManifest, UpdateWinGetAppInput,
};
pub use setting_usage::{
    fetch_setting_usage_index, SettingUsage, SettingUsageIndex, SettingUsagePolicy,
    SettingUsageValue,
};
pub use tenant_health::{fetch_tenant_health, HealthItem, HealthStatus, TenantHealth};
pub use types::*;
pub use whatif::{
    assignments_by_object, fetch_assignment_snapshot, AssignmentSnapshot, ObjectAssignments,
};
pub use windows_update::{
    apply_ring_action, apply_ring_action_checked, create_windows_update_ring,
    fetch_windows_update_ring, ring_action_skip_reason, ring_update_body,
    update_windows_update_ring, RingAction, RingChannel, RingChannelState, RingUpdateState,
    WindowsUpdateRing,
};
pub use write_log::{
    init_write_log, list_write_log, set_write_state_tracking, undo_write, with_write_operation,
    write_log_dir, UndoOutcome,
    WriteLogEntry, WriteLogRow,
};
pub use win32_apps::{
    update_win32_app, update_win32_app_body, win32_lob_body_from_catalog, UpdateWin32AppInput,
};
