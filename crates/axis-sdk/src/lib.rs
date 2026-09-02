mod assignments;
mod auth;
mod catalog_index;
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
mod glance;
mod graph;
mod inventory;
mod object_detail;
mod object_metadata;
mod object_duplicate;
mod pack_export;
mod script_status;
mod session_store;
mod settings_catalog;
mod types;

pub use assignments::{
    apply_filter_names, apply_group_metadata, assign_object_assignments, assignment_capabilities,
    classify_group_membership, create_directory_group, drafts_from_graph_assignments,
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
pub use catalog_index::*;
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
    fetch_applied_policy_settings, fetch_baseline_export_json, AppliedPolicySettings,
    AppliedPolicySettingsLoad,
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
pub use glance::fetch_tenant_glance;
pub use graph::GraphError;
pub use inventory::*;
pub use object_detail::{
    create_tenant_script, fetch_graph_object_detail, update_script_content, CreateTenantScriptInput,
    GraphObjectDetail, UpdateScriptContentInput,
};
pub use object_metadata::{
    can_delete_graph_object, can_update_object_metadata, delete_graph_object,
    update_object_metadata, UpdateObjectMetadataInput, UpdatedObjectMetadata,
};
pub use object_duplicate::{
    can_duplicate_kind, duplicate_graph_object, copy_display_name, DuplicatedObject,
};
pub use pack_export::{
    dest_dir_from_save_as, export_selected_graph_objects, export_tenant_pack, pretty_json,
    PackExportError, PackExportObject, PackExportOptions, PackExportProgress, PackExportResult,
    SelectedExportResult,
};
pub use script_status::{
    fetch_remediation_device_status, fetch_script_run_status, RemediationDeviceRunState,
    RemediationDeviceStatusReport, RemediationRunManagedDevice, RemediationRunSummary,
    ScriptUserRunState,
};
pub use session_store::SessionMode;
pub use settings_catalog::*;
pub use types::*;
