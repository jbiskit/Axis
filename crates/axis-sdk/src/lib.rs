mod assignments;
mod auth;
mod autopilot_profiles;
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
mod e8_baselines;
mod enrollment_limits;
mod enrollment_restrictions;
mod environment_report;
mod glance;
mod graph;
mod inventory;
mod object_detail;
mod object_metadata;
mod object_duplicate;
mod pack_diff;
mod pack_export;
mod pack_kits;
mod pack_restore;
mod policy_health;
mod script_status;
mod session_store;
mod settings_catalog;
mod types;

pub use assignments::{
    apply_filter_names, apply_group_metadata, assign_object_assignments, assignment_capabilities,
    assignment_capabilities_for, classify_group_membership, create_directory_group,
    drafts_from_graph_assignments, normalize_assignment_drafts, normalize_assignment_drafts_for,
    list_assignment_filters, mail_nickname_from_display_name, resolve_directory_groups,
    search_directory_groups, AssignmentCapabilities, AssignmentDraft, AssignmentFilter,
    AssignmentFilterMode, AssignmentIntent, AssignmentTargetKind, CreateDirectoryGroupInput,
    CreateGroupMembership, DirectoryGroup, GroupMembershipKind, RemediationScheduleDraft,
    RemediationScheduleKind, DYNAMIC_DEVICE_RULE_TEMPLATE, DYNAMIC_USER_RULE_TEMPLATE,
    default_remediation_schedule,
};
pub use auth::{
    decode_access_token_claims, device_code_client_id, device_code_scopes, device_code_tenant,
    is_graph_command_line_tools_client, is_write_or_privileged_scope, parse_extra_scopes,
    scopes_for_mode, scopes_for_mode_with_extras, token_scp_has_write_scopes, AuthManager,
    DeviceCodePrompt, DeviceCodeTokens, PollResult, TokenClaims,
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
    fetch_managed_device_detail, DetectedApp, DirectoryGroupMembership, ManagedApp,
    ManagedDeviceDetail, ManagedDeviceHardwareDetails,
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
pub use e8_baselines::*;
pub use enrollment_limits::{
    create_enrollment_limit, update_enrollment_limit, CreateEnrollmentLimitInput,
    UpdateEnrollmentLimitInput, DEVICE_LIMIT_MAX, DEVICE_LIMIT_MIN,
};
pub use enrollment_restrictions::{
    create_enrollment_platform_restriction, CreateEnrollmentPlatformRestrictionInput,
    update_enrollment_platform_restrictions, PlatformRestrictionPatch,
    UpdateEnrollmentPlatformRestrictionsInput,
};
pub use environment_report::{
    generate_environment_report, EnvironmentReport, EnvironmentReportProgress,
    EnvironmentReportSelection,
};
pub use glance::{fetch_tenant_glance, list_intune_audit_events};
pub use graph::GraphError;
pub use inventory::*;
pub use object_detail::{
    create_tenant_script, fetch_configuration_policy_template, fetch_graph_object_detail,
    list_configuration_policy_templates, update_script_content, ConfigurationPolicyTemplateSummary,
    CreateTenantScriptInput, GraphObjectDetail, UpdateScriptContentInput,
};
pub use object_metadata::{
    can_delete_graph_object, can_update_object_metadata, delete_graph_object,
    fetch_windows_autopilot_settings, sync_windows_autopilot_devices,
    update_autopilot_device_properties, AUTOPILOT_SYNC_COOLDOWN_SECS,
    update_object_metadata, UpdateObjectMetadataInput, UpdatedObjectMetadata,
    WindowsAutopilotSettings,
};
pub use object_duplicate::{
    can_duplicate_kind, duplicate_graph_object, copy_display_name, strip_for_graph_create, strip_keys,
    strip_setting_definitions, DuplicatedObject,
};
pub use pack_diff::{
    diff_pack_roots, PackDiffChangeKind, PackDiffError, PackDiffReport, PackDiffSummary,
    PackFieldChange, PackObjectDiff,
};
pub use pack_export::{
    dest_dir_from_save_as, export_selected_graph_objects, export_tenant_pack, graph_fetch_concurrency,
    pretty_json, PackExportError, PackExportObject, PackExportOptions, PackExportProgress,
    PackExportResult, SelectedExportResult,
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
    fetch_app_install_health, fetch_configuration_policy_health, index_app_install,
    index_policy_health, lookup_app_install, lookup_policy_health, AppInstallHealth, PolicyHealth,
};
pub use script_status::{
    fetch_remediation_device_status, fetch_script_run_status, RemediationDeviceRunState,
    RemediationDeviceStatusReport, RemediationRunManagedDevice, RemediationRunSummary,
    ScriptUserRunState,
};
pub use session_store::SessionMode;
pub use settings_catalog::*;
pub use types::*;
