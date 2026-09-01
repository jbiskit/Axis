import { invoke } from "@tauri-apps/api/core";
import type {
  DeviceCodePrompt,
  DevicesResponse,
  GlanceResponse,
  PollResult,
  SessionStatus,
} from "../types/glance";
import type { UpdateCheck } from "../types/updater";
import type {
  AppProtectionPolicy,
  AutopilotDevice,
  AutopilotProfile,
  CapabilityStatus,
  CatalogCategoriesResponse,
  CatalogIndexState,
  CatalogPolicySummary,
  CatalogSearchResponse,
  CategorySettingsResponse,
  CreateCatalogPolicyResponse,
  CreateCompliancePolicyInput,
  CreateCompliancePolicyResponse,
  CompliancePolicyStatusResponse,
  CompliancePropertyDocsResponse,
  CreateTenantScriptInput,
  CreateTenantScriptResponse,
  DuplicateGraphObjectResponse,
  UpdateObjectMetadataResponse,
  GraphObjectDetailResponse,
  E8BaselineReferencesResponse,
  BaselineExportResponse,
  BaselineReferenceSourceInput,
  BaselineReferenceSourcesResponse,
  PackExportResult,
  SelectedExportResult,
  PickedJsonFile,
  PickedTextFile,
  AppliedPolicySettingsResponse,
  ActionResponse,
  AssignmentDraft,
  AssignmentWorkspaceResponse,
  CreateDirectoryGroupInput,
  CreateDirectoryGroupResponse,
  DirectoryGroupsResponse,
  BitLockerKeyResponse,
  BitLockerKeysResponse,
  DeviceDetailResponse,
  InventoryResponse,
  LapsResponse,
  MobileAppSummary,
  PolicyIssuesResponse,
  RemediationDeviceStatusReport,
  SettingConflictDetailsResponse,
  ScriptLintResult,
  TenantScriptSummary,
  WindowsUpdatePolicy,
} from "../types/inventory";

export async function deviceLoginStart(extraScopes?: string): Promise<DeviceCodePrompt> {
  return invoke<DeviceCodePrompt>("device_login_start", {
    mode: "admin",
    extraScopes: extraScopes?.trim() ? extraScopes : null,
  });
}

export async function deviceLoginPoll(flowId: string): Promise<PollResult> {
  return invoke<PollResult>("device_login_poll", { flowId });
}

export async function deviceLoginCancel(flowId: string): Promise<void> {
  return invoke("device_login_cancel", { flowId });
}

export async function deviceSessionStatus(): Promise<SessionStatus> {
  return invoke<SessionStatus>("device_session_status");
}

export async function fetchGlance(): Promise<GlanceResponse> {
  return invoke<GlanceResponse>("fetch_glance");
}

export async function refreshGlance(): Promise<GlanceResponse> {
  return invoke<GlanceResponse>("refresh_glance");
}

export async function fetchManagedDevices(): Promise<DevicesResponse> {
  return invoke<DevicesResponse>("fetch_managed_devices");
}

export async function fetchManagedDeviceDetail(deviceId: string): Promise<DeviceDetailResponse> {
  return invoke<DeviceDetailResponse>("fetch_managed_device_detail_cmd", { deviceId });
}

export async function fetchPolicySettingIssues(input: {
  deviceId: string;
  policyId: string;
  reportUserId?: string | null;
  deviceUserId?: string | null;
}): Promise<PolicyIssuesResponse> {
  return invoke("fetch_policy_setting_issues_cmd", input);
}

export async function fetchSettingConflictDetails(input: {
  deviceId: string;
  settingId: string;
  settingInstanceId: string;
  userId?: string | null;
  deviceUserId?: string | null;
}): Promise<SettingConflictDetailsResponse> {
  return invoke("fetch_setting_conflict_details_cmd", input);
}

export async function fetchRemediationScripts(): Promise<InventoryResponse<TenantScriptSummary>> {
  return invoke("fetch_remediation_scripts_cmd");
}

export async function fetchRemediationDeviceStatus(
  scriptId: string,
  kind = "script:remediation",
): Promise<{ report: RemediationDeviceStatusReport | null; error: string | null }> {
  return invoke("fetch_remediation_device_status_cmd", { scriptId, kind });
}

export async function syncManagedDevice(deviceId: string): Promise<ActionResponse> {
  return invoke("sync_managed_device_cmd", { deviceId });
}

export async function rebootManagedDevice(deviceId: string): Promise<ActionResponse> {
  return invoke("reboot_managed_device_cmd", { deviceId });
}

export async function remoteLockManagedDevice(deviceId: string): Promise<ActionResponse> {
  return invoke("remote_lock_managed_device_cmd", { deviceId });
}

export async function collectDeviceDiagnostics(deviceId: string): Promise<ActionResponse> {
  return invoke("collect_device_diagnostics_cmd", { deviceId });
}

export async function initiateOnDemandRemediation(
  deviceId: string,
  scriptPolicyId: string,
): Promise<ActionResponse> {
  return invoke("initiate_on_demand_remediation_cmd", { deviceId, scriptPolicyId });
}

export async function retireManagedDevice(deviceId: string): Promise<ActionResponse> {
  return invoke("retire_managed_device_cmd", { deviceId });
}

export async function wipeManagedDevice(deviceId: string): Promise<ActionResponse> {
  return invoke("wipe_managed_device_cmd", { deviceId });
}

export async function deleteManagedDevice(deviceId: string): Promise<ActionResponse> {
  return invoke("delete_managed_device_cmd", { deviceId });
}

export async function getLapsInfo(entraDeviceId: string): Promise<LapsResponse> {
  return invoke("get_laps_info_cmd", { entraDeviceId });
}

export async function revealLaps(entraDeviceId: string): Promise<LapsResponse> {
  return invoke("reveal_laps_cmd", { entraDeviceId });
}

export async function listBitlockerKeys(entraDeviceId: string): Promise<BitLockerKeysResponse> {
  return invoke("list_bitlocker_keys_cmd", { entraDeviceId });
}

export async function revealBitlockerKey(recoveryKeyId: string): Promise<BitLockerKeyResponse> {
  return invoke("reveal_bitlocker_key_cmd", { recoveryKeyId });
}

export async function rotateLapsPassword(managedDeviceId: string): Promise<ActionResponse> {
  return invoke("rotate_laps_password_cmd", { managedDeviceId });
}

export async function fetchWin32Apps(): Promise<InventoryResponse<MobileAppSummary>> {
  return invoke("fetch_win32_apps_cmd");
}

export async function fetchMobileApps(opts?: {
  platform?: string;
  appKind?: string;
}): Promise<InventoryResponse<MobileAppSummary>> {
  return invoke("fetch_mobile_apps_cmd", {
    platform: opts?.platform ?? null,
    appKind: opts?.appKind ?? null,
  });
}

export async function fetchStoreApps(): Promise<InventoryResponse<MobileAppSummary>> {
  return invoke("fetch_store_apps_cmd");
}

export async function fetchConfigurationPolicies(): Promise<InventoryResponse<CatalogPolicySummary>> {
  return invoke("fetch_configuration_policies_cmd");
}

export async function fetchCompliancePolicies(): Promise<InventoryResponse<CatalogPolicySummary>> {
  return invoke("fetch_compliance_policies_cmd");
}

export async function fetchGroupPolicyConfigurations(): Promise<InventoryResponse<CatalogPolicySummary>> {
  return invoke("fetch_group_policy_configurations_cmd");
}

export async function fetchDeviceConfigurations(): Promise<InventoryResponse<CatalogPolicySummary>> {
  return invoke("fetch_device_configurations_cmd");
}

export async function fetchEndpointSecurityIntents(): Promise<InventoryResponse<CatalogPolicySummary>> {
  return invoke("fetch_endpoint_security_intents_cmd");
}

export async function fetchAppProtectionPolicies(): Promise<InventoryResponse<AppProtectionPolicy>> {
  return invoke("fetch_app_protection_policies_cmd");
}

export async function fetchTenantScripts(): Promise<InventoryResponse<TenantScriptSummary>> {
  return invoke("fetch_tenant_scripts_cmd");
}

export async function fetchAutopilotDevices(): Promise<InventoryResponse<AutopilotDevice>> {
  return invoke("fetch_autopilot_devices_cmd");
}

export async function fetchAutopilotProfiles(): Promise<InventoryResponse<AutopilotProfile>> {
  return invoke("fetch_autopilot_profiles_cmd");
}

export async function fetchWindowsUpdatePolicies(): Promise<InventoryResponse<WindowsUpdatePolicy>> {
  return invoke("fetch_windows_update_policies_cmd");
}

export async function fetchEnrollmentConfigurations(): Promise<InventoryResponse<CatalogPolicySummary>> {
  return invoke("fetch_enrollment_configurations_cmd");
}

export async function desktopCapability(name: string): Promise<CapabilityStatus> {
  return invoke("desktop_capability", { name });
}

export async function fetchE8BaselineReferences(): Promise<E8BaselineReferencesResponse> {
  return invoke("fetch_e8_baseline_references_cmd");
}

export async function fetchBaselineReferenceSources(
  sources: BaselineReferenceSourceInput[],
): Promise<BaselineReferenceSourcesResponse> {
  return invoke("fetch_baseline_reference_sources_cmd", { sources });
}

export async function pickLocalPackFolder(title?: string): Promise<string | null> {
  return invoke<string | null>("pick_local_pack_folder_cmd", {
    title: title?.trim() ? title : null,
  });
}

export async function pickJsonFiles(title?: string): Promise<PickedJsonFile[] | null> {
  return invoke<PickedJsonFile[] | null>("pick_json_files_cmd", {
    title: title?.trim() ? title : null,
  });
}

export async function pickScriptFiles(title?: string): Promise<PickedTextFile[] | null> {
  return invoke<PickedTextFile[] | null>("pick_script_files_cmd", {
    title: title?.trim() ? title : null,
  });
}

export async function saveTextFile(input: {
  contents: string;
  suggestedName?: string;
  title?: string;
}): Promise<string | null> {
  return invoke<string | null>("save_text_file_cmd", {
    contents: input.contents,
    suggestedName: input.suggestedName ?? null,
    title: input.title ?? null,
  });
}

export async function exportTenantPack(input: {
  dest?: string;
  packName?: string;
  packId?: string;
}): Promise<PackExportResult | null> {
  return invoke("export_tenant_pack_cmd", {
    dest: input.dest ?? null,
    packName: input.packName ?? null,
    packId: input.packId ?? null,
  });
}

export async function exportSelectedObjects(
  objects: Array<{ kind: string; id: string; title?: string }>,
): Promise<SelectedExportResult | null> {
  return invoke("export_selected_objects_cmd", { objects });
}

export async function fetchBaselineExport(
  downloadUrl: string,
  token?: string,
): Promise<BaselineExportResponse> {
  return invoke("fetch_baseline_export_cmd", { downloadUrl, token: token || null });
}

export async function fetchAppliedPolicySettings(
  policyIds: string[],
): Promise<AppliedPolicySettingsResponse> {
  return invoke("fetch_applied_policy_settings_cmd", { policyIds });
}

export async function listCatalogCategories(platform: string): Promise<CatalogCategoriesResponse> {
  return invoke("list_catalog_categories_cmd", { platform });
}

export async function loadCategorySettings(
  categoryId: string,
  platform: string,
): Promise<CategorySettingsResponse> {
  return invoke("load_category_settings_cmd", { categoryId, platform });
}

export async function searchCatalogSettings(
  query: string,
  platform: string,
): Promise<CatalogSearchResponse> {
  return invoke("search_catalog_settings_cmd", { query, platform });
}

export async function ensureCatalogIndex(
  platform: string,
  force = false,
): Promise<CatalogIndexState> {
  return invoke("ensure_catalog_index_cmd", { platform, force });
}

export async function catalogIndexStatus(platform: string): Promise<CatalogIndexState> {
  return invoke("catalog_index_status_cmd", { platform });
}

export async function pauseCatalogIndex(): Promise<void> {
  return invoke("pause_catalog_index_cmd");
}

export async function createSettingsCatalogPolicy(input: {
  name: string;
  description?: string;
  platform: string;
  settings: Record<string, unknown>[];
}): Promise<CreateCatalogPolicyResponse> {
  return invoke("create_settings_catalog_policy_cmd", input);
}

export async function fetchGraphObjectDetail(
  kind: string,
  id: string,
): Promise<GraphObjectDetailResponse> {
  return invoke("fetch_graph_object_detail_cmd", { kind, id });
}

export async function updateScriptContent(input: {
  kind: string;
  id: string;
  scriptText?: string | null;
  detectionScriptText?: string | null;
  remediationScriptText?: string | null;
}): Promise<ActionResponse> {
  return invoke("update_script_content_cmd", input);
}

export async function createCompliancePolicy(
  input: CreateCompliancePolicyInput,
): Promise<CreateCompliancePolicyResponse> {
  return invoke<CreateCompliancePolicyResponse>("create_compliance_policy_cmd", { input });
}

export async function updateCompliancePolicy(input: {
  id: string;
  odataType: string;
  settings: Record<string, unknown>;
}): Promise<ActionResponse> {
  return invoke<ActionResponse>("update_compliance_policy_cmd", { input });
}

export async function fetchCompliancePropertyDocs(
  odataType: string,
): Promise<CompliancePropertyDocsResponse> {
  return invoke<CompliancePropertyDocsResponse>("fetch_compliance_property_docs_cmd", {
    odataType,
  });
}

export async function fetchCompliancePolicyStatus(
  policyId: string,
  generateSettings = false,
): Promise<CompliancePolicyStatusResponse> {
  return invoke<CompliancePolicyStatusResponse>("fetch_compliance_policy_status_cmd", {
    policyId,
    generateSettings,
  });
}

export async function createTenantScript(
  input: CreateTenantScriptInput,
): Promise<CreateTenantScriptResponse> {
  return invoke<CreateTenantScriptResponse>("create_tenant_script_cmd", { input });
}

export async function duplicateGraphObject(
  kind: string,
  id: string,
  options?: {
    displayName?: string;
    description?: string;
    copyAssignments?: boolean;
  },
): Promise<DuplicateGraphObjectResponse> {
  return invoke<DuplicateGraphObjectResponse>("duplicate_graph_object_cmd", {
    kind,
    id,
    displayName: options?.displayName ?? null,
    description: options?.description ?? null,
    copyAssignments: options?.copyAssignments ?? false,
  });
}

export async function updateObjectMetadata(input: {
  kind: string;
  id: string;
  name: string;
  description?: string | null;
}): Promise<UpdateObjectMetadataResponse> {
  return invoke<UpdateObjectMetadataResponse>("update_object_metadata_cmd", { input });
}

export async function deleteGraphObject(kind: string, id: string): Promise<ActionResponse> {
  return invoke<ActionResponse>("delete_graph_object_cmd", { kind, id });
}

export async function lintScript(
  language: "powershell" | "bash" | "shell",
  source: string,
): Promise<ScriptLintResult> {
  return invoke<ScriptLintResult>("lint_script_cmd", { language, source });
}

export async function searchDirectoryGroups(query: string): Promise<DirectoryGroupsResponse> {
  return invoke("search_directory_groups_cmd", { query });
}

export async function createDirectoryGroup(
  input: CreateDirectoryGroupInput,
): Promise<CreateDirectoryGroupResponse> {
  return invoke("create_directory_group_cmd", { input });
}

export async function loadAssignmentWorkspace(
  kind: string,
  assignments: Record<string, unknown>[],
): Promise<AssignmentWorkspaceResponse> {
  return invoke("load_assignment_workspace_cmd", { kind, assignments });
}

export async function assignObjectAssignments(input: {
  kind: string;
  id: string;
  drafts: AssignmentDraft[];
  objectOdataType?: string | null;
}): Promise<ActionResponse> {
  return invoke("assign_object_assignments_cmd", input);
}

export async function openPopoutWindow(kind: string, id: string, title?: string): Promise<void> {
  return invoke("open_popout_window", { kind, id, title: title ?? null });
}

export async function addSettingsToPolicy(
  policyId: string,
  settings: Record<string, unknown>[],
): Promise<CreateCatalogPolicyResponse> {
  return invoke("add_settings_to_policy_cmd", { policyId, settings });
}

export async function signOut(): Promise<void> {
  return invoke("sign_out");
}

export async function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  return invoke<UpdateCheck>("check_for_update");
}

export async function downloadUpdate(): Promise<UpdateCheck> {
  return invoke<UpdateCheck>("download_update");
}

export async function applyUpdateAndRelaunch(): Promise<void> {
  return invoke("apply_update_and_relaunch");
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
