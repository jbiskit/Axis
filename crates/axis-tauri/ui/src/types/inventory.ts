export type InventoryList<T> = {
  items: T[];
  truncated: boolean;
  fetchedAt: string;
};

export type InventoryResponse<T> = {
  list: InventoryList<T>;
  error: string | null;
  mode: "live";
};

export type MobileAppSummary = {
  id: string;
  displayName: string;
  publisher?: string | null;
  displayVersion?: string | null;
  fileName?: string | null;
  publishingState?: string | null;
  isAssigned?: boolean | null;
  odataType?: string | null;
  packageIdentifier?: string | null;
  lastModifiedDateTime?: string | null;
  kind?: string | null;
  platform?: string | null;
  appKind?: string | null;
  appTypeLabel?: string | null;
};

export type CatalogPolicySummary = {
  id: string;
  name: string;
  description?: string | null;
  platforms?: string | null;
  technologies?: string | null;
  settingCount?: number | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  isAssigned?: boolean | null;
  templateFamily?: string | null;
  templateId?: string | null;
  odataType?: string | null;
};

export type TenantScriptSummary = {
  id: string;
  kind: string;
  displayName: string;
  description?: string | null;
  fileName?: string | null;
  runAsAccount?: string | null;
  publisher?: string | null;
  version?: string | null;
  isGlobalScript?: boolean | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  assignmentCount?: number | null;
};

export type RemediationRunManagedDevice = {
  id?: string | null;
  deviceName?: string | null;
  osVersion?: string | null;
  userId?: string | null;
  userPrincipalName?: string | null;
};

export type RemediationDeviceRunState = {
  id?: string | null;
  runState?: string | null;
  errorCode?: number | null;
  errorDescription?: string;
  resultMessage?: string;
  assignmentFilterIds?: string[];
  detectionState?: string | null;
  lastStateUpdateDateTime?: string | null;
  postRemediationDetectionScriptError?: string;
  postRemediationDetectionScriptOutput?: string;
  preRemediationDetectionScriptError?: string;
  preRemediationDetectionScriptOutput?: string;
  remediationScriptError?: string;
  remediationState?: string | null;
  managedDevice?: RemediationRunManagedDevice | null;
};

export type RemediationRunSummary = {
  noIssueDetectedDeviceCount?: number | null;
  issueDetectedDeviceCount?: number | null;
  detectionScriptErrorDeviceCount?: number | null;
  detectionScriptPendingDeviceCount?: number | null;
  issueRemediatedDeviceCount?: number | null;
  remediationScriptErrorDeviceCount?: number | null;
  unknownDeviceCount?: number | null;
  lastScriptRunDateTime?: string | null;
};

export type ScriptUserRunState = {
  id?: string | null;
  userPrincipalName?: string | null;
  successDeviceCount?: number | null;
  errorDeviceCount?: number | null;
  pendingDeviceCount?: number | null;
};

export type RemediationDeviceStatusReport = {
  scriptId: string;
  kind?: string;
  family?: string;
  states: RemediationDeviceRunState[];
  userStates?: ScriptUserRunState[];
  truncated: boolean;
  usersTruncated?: boolean;
  fetchedAt: string;
  summary?: RemediationRunSummary | null;
};

export type AutopilotDevice = {
  id: string;
  serialNumber?: string | null;
  groupTag?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  enrollmentState?: string | null;
  lastContactedDateTime?: string | null;
  userPrincipalName?: string | null;
  displayName?: string | null;
  azureActiveDirectoryDeviceId?: string | null;
  managedDeviceId?: string | null;
  deploymentProfileAssignmentStatus?: string | null;
};

export type AutopilotProfile = {
  id: string;
  displayName: string;
  description?: string | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  deviceJoinType?: string | null;
  odataType?: string | null;
  deviceNameTemplate?: string | null;
};

export type AppProtectionPolicy = {
  id: string;
  displayName: string;
  description?: string | null;
  odataType?: string | null;
  lastModifiedDateTime?: string | null;
};

export type WindowsUpdatePolicy = {
  id: string;
  family: string;
  name: string;
  description?: string | null;
  createdDateTime?: string | null;
  lastModifiedDateTime?: string | null;
  odataType?: string | null;
};

export type ManagedDeviceHardwareDetails = {
  managedDeviceName?: string | null;
  azureAdRegistered?: boolean | null;
  serialNumber?: string | null;
  enrollmentProfileName?: string | null;
  userDisplayName?: string | null;
  operatingSystemLanguage?: string | null;
  operatingSystemEdition?: string | null;
  skuFamily?: string | null;
  skuNumber?: number | null;
  subscriberCarrier?: string | null;
  cellularTechnology?: string | null;
  wifiMacAddress?: string | null;
  ethernetMacAddress?: string | null;
  iccid?: string | null;
  ipAddressV4?: string | null;
  subnetAddress?: string | null;
  wiredIpv4Addresses?: string[];
  totalStorageSpaceInBytes?: number | null;
  freeStorageSpaceInBytes?: number | null;
  physicalMemoryInBytes?: number | null;
  imei?: string | null;
  meid?: string | null;
  processorArchitecture?: string | null;
  tpmSpecificationVersion?: string | null;
  tpmManufacturer?: string | null;
  tpmVersion?: string | null;
  systemManagementBiosVersion?: string | null;
  activationLockBypassCode?: string | null;
  easActivated?: boolean | null;
  easDeviceId?: string | null;
  easActivationDateTime?: string | null;
  isSupervised?: boolean | null;
  managedDeviceOwnerType?: string | null;
  subscriptionState?: string | null;
};

export type PolicySettingSource = {
  id: string;
  displayName: string;
  sourceType?: string | null;
  state?: string | null;
  configuredValue?: string | null;
  rawConfiguredValue?: string | null;
};

export type PolicySettingIssue = {
  settingName: string;
  setting?: string | null;
  settingInstanceId?: string | null;
  state: string;
  currentValue?: string | null;
  errorDescription?: string | null;
  sources: PolicySettingSource[];
  policyDisplayName: string;
  policyId: string;
};

export type DevicePolicyState = {
  id: string;
  displayName: string;
  state: string;
  source: string;
  platformType?: string | null;
  assigned?: boolean;
  issues?: PolicySettingIssue[];
  reportUserId?: string | null;
};

export type PolicyConflictSummary = {
  id: string;
  contributingSettings: string[];
  conflictingPolicies: Array<{
    id: string;
    displayName: string;
    sourceType?: string | null;
  }>;
  deviceCheckinsImpacted?: number | null;
  relevantToDevice: boolean;
};

export type PolicyDiagnostics = {
  rawConfigurationStateCount: number;
  rawConfigurationPolicyStateCount: number;
  rawComplianceStateCount: number;
  rawStates: Array<{
    displayName: string;
    state: string;
    source: string;
    settingIssueCount: number;
  }>;
  conflictSummaryCount: number;
  notes: string[];
};

export type DetectedApp = {
  id: string;
  displayName: string;
  version?: string | null;
  publisher?: string | null;
};

export type ManagedApp = {
  applicationId: string;
  displayName: string;
  displayVersion?: string | null;
  installState?: string | null;
  mobileAppIntent?: string | null;
};

export type DirectoryGroupMembership = {
  id: string;
  displayName: string;
  groupTypes: string[];
  securityEnabled?: boolean | null;
  mailEnabled?: boolean | null;
  membershipKind: "device" | "user" | string;
};

export type ManagedDeviceDetail = {
  id: string;
  deviceName: string;
  userPrincipalName?: string | null;
  operatingSystem?: string | null;
  osVersion?: string | null;
  complianceState?: string | null;
  lastSyncDateTime?: string | null;
  managementAgent?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  isEncrypted?: boolean | null;
  azureADDeviceId?: string | null;
  managedDeviceOwnerType?: string | null;
  enrolledDateTime?: string | null;
  emailAddress?: string | null;
  jailBroken?: string | null;
  userId?: string | null;
  hardware: ManagedDeviceHardwareDetails;
  configurationStates: DevicePolicyState[];
  compliancePolicyStates: DevicePolicyState[];
  policyConflicts: PolicyConflictSummary[];
  policyDiagnostics: PolicyDiagnostics;
  detectedApps: DetectedApp[];
  managedApps: ManagedApp[];
  deviceGroups: DirectoryGroupMembership[];
  userGroups: DirectoryGroupMembership[];
  enrichmentWarnings: string[];
};

export type DeviceDetailResponse = {
  device: ManagedDeviceDetail | null;
  error: string | null;
  mode: "live";
};

export type ActionResponse = {
  ok: boolean;
  error: string | null;
};

export type AssignmentTargetKind = "allUsers" | "allDevices" | "group" | "exclusionGroup";
export type AssignmentFilterMode = "include" | "exclude";
export type AssignmentIntent = "available" | "required" | "uninstall";
export type GroupMembershipKind = "assigned" | "dynamicUser" | "dynamicDevice" | "dynamic";
export type CreateGroupMembership = "assigned" | "dynamicUser" | "dynamicDevice";

export type DirectoryGroup = {
  id: string;
  displayName: string;
  membership: GroupMembershipKind;
  membershipRule?: string | null;
};

export type AssignmentFilter = {
  id: string;
  displayName: string;
  platform?: string | null;
  assignmentFilterManagementType?: string | null;
  rule?: string | null;
};

export type RemediationScheduleKind =
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "runOnce";

export type RemediationScheduleDraft = {
  kind: RemediationScheduleKind;
  interval: number;
  time?: string | null;
  useUtc?: boolean | null;
  date?: string | null;
};

export type AssignmentDraft = {
  targetKind: AssignmentTargetKind;
  groupId?: string | null;
  groupName?: string | null;
  groupMembership?: GroupMembershipKind | null;
  filterId?: string | null;
  filterName?: string | null;
  filterMode?: AssignmentFilterMode | null;
  intent?: AssignmentIntent | null;
  runRemediationScript?: boolean | null;
  runSchedule?: RemediationScheduleDraft | null;
};

export type AssignmentCapabilities = {
  writable: boolean;
  supportsIntent: boolean;
  supportsFilters: boolean;
  supportsSchedule: boolean;
};

export type DirectoryGroupsResponse = {
  groups: DirectoryGroup[];
  error: string | null;
};

export type CreateDirectoryGroupInput = {
  displayName: string;
  description?: string | null;
  membership: CreateGroupMembership;
  membershipRule?: string | null;
};

export type CreateDirectoryGroupResponse = {
  group: DirectoryGroup | null;
  error: string | null;
};

export type AssignmentFiltersResponse = {
  filters: AssignmentFilter[];
  error: string | null;
};

export type AssignmentWorkspaceResponse = {
  drafts: AssignmentDraft[];
  filters: AssignmentFilter[];
  capabilities: AssignmentCapabilities;
  filtersError: string | null;
  error: string | null;
};

export type PolicyIssuesResponse = {
  issues: PolicySettingIssue[];
  error: string | null;
};

export type SettingConflictDetail = {
  id: string;
  displayName: string;
  sourceType?: string | null;
  state: string;
  errorCode?: number | null;
  configuredValue?: string | null;
  rawConfiguredValue?: string | null;
};

export type SettingConflictDetailsResponse = {
  details: SettingConflictDetail[];
  error: string | null;
};

export type LapsCredential = {
  accountName: string;
  accountSid?: string | null;
  backupDateTime?: string | null;
  password?: string | null;
};

export type LapsCredentialInfo = {
  id: string;
  deviceName?: string | null;
  lastBackupDateTime?: string | null;
  refreshDateTime?: string | null;
  credentials: LapsCredential[];
};

export type BitLockerRecoveryKeySummary = {
  id: string;
  createdDateTime?: string | null;
  deviceId?: string | null;
  volumeType?: string | null;
  key?: string | null;
};

export type LapsResponse = {
  laps: LapsCredentialInfo | null;
  error: string | null;
};

export type BitLockerKeysResponse = {
  keys: BitLockerRecoveryKeySummary[];
  error: string | null;
};

export type BitLockerKeyResponse = {
  key: BitLockerRecoveryKeySummary | null;
  error: string | null;
};

export type CapabilityStatus = {
  available: boolean;
  reason: string;
};

export type E8BaselineSource = {
  id: string;
  name: string;
  kind?: "github" | "local" | string;
  owner: string;
  repo: string;
  gitRef: string;
  path: string;
  localPath?: string;
  repositoryUrl: string;
  directoryUrl: string;
  apiUrl: string;
  hasToken?: boolean;
};

export type E8BaselineReference = {
  id: string;
  name: string;
  version: string | null;
  lastModifiedDateTime: string | null;
  repositoryLastModifiedDateTime: string | null;
  policyExportedDateTime: string | null;
  source: string;
  sourceUrl: string;
  downloadUrl: string;
  /** Catalog policies vs other pack objects. */
  artifactKind?: string;
};

export type E8BaselineReferencesResponse = {
  source: E8BaselineSource;
  references: E8BaselineReference[];
  warnings: string[];
  error: string | null;
};

export type BaselineReferenceSourceInput = {
  id?: string;
  name?: string;
  /** `github` (default) or `local`. */
  kind?: "github" | "local";
  /** Absolute folder on this machine when `kind` is `local`. */
  localPath?: string;
  /** GitHub repo URL, `owner/repo`, or a `/tree/ref/path` link. */
  url?: string;
  owner: string;
  repo: string;
  gitRef: string;
  path: string;
  /** When true, Axis sends the stored PAT with GitHub requests. */
  private?: boolean;
  /** GitHub PAT for this private repo. Stored locally on this machine only. Prefer a fine-grained token limited to the repository. */
  token?: string;
};

export type BaselineReferenceSourceLoad = {
  source: E8BaselineSource;
  references: E8BaselineReference[];
  warnings: string[];
  error: string | null;
};

export type BaselineReferenceSourcesResponse = {
  sources: BaselineReferenceSourceLoad[];
};

export type BaselineExportResponse = {
  document: Record<string, unknown> | unknown[] | null;
  error: string | null;
};

export type AppliedPolicySettings = {
  policyId: string;
  name?: string | null;
  settings: Record<string, unknown>[];
  error?: string | null;
  skipped: boolean;
};

export type AppliedPolicySettingsLoad = {
  policies: AppliedPolicySettings[];
  loaded: number;
  skipped: number;
  failed: number;
};

export type AppliedPolicySettingsResponse = {
  load: AppliedPolicySettingsLoad | null;
  error: string | null;
  mode: "live";
};

export type SettingsCatalogPlatform = "windows" | "macos";

export type CatalogDependentRef = {
  settingDefinitionId: string;
  required: boolean;
};

export type CatalogSettingOption = {
  itemId: string;
  displayName: string;
  description?: string | null;
  dependedOnBy: CatalogDependentRef[];
};

export type CatalogSettingSummary = {
  id: string;
  displayName: string;
  description?: string | null;
  helpText?: string | null;
  categoryId?: string | null;
  keywords: string[];
  platform?: string | null;
  technologies?: string | null;
  kind: string;
  visibility?: string | null;
  rootDefinitionId?: string | null;
  isRoot: boolean;
};

export type CatalogSettingDetail = CatalogSettingSummary & {
  options: CatalogSettingOption[];
  defaultOptionId?: string | null;
  valueType?: string | null;
  defaultString?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  maximumLength?: number | null;
  minimumLength?: number | null;
  minimumCount?: number | null;
  maximumCount?: number | null;
  "@odata.type"?: string;
  raw: Record<string, unknown>;
};

export type CatalogCategory = {
  id: string;
  displayName: string;
  description?: string | null;
  childCategoryIds: string[];
  parentCategoryId?: string | null;
  rootCategoryId?: string | null;
  platforms?: string | null;
  technologies?: string | null;
  settingUsage?: string | null;
};

export type CategorySettingsLoad = {
  categoryId: string;
  roots: CatalogSettingDetail[];
  byId: Record<string, CatalogSettingDetail>;
  settingCount: number;
};

export type CatalogSearchResult = {
  settings: CatalogSettingSummary[];
  mode: string;
};

export type CreatedCatalogPolicy = {
  id: string;
  name: string;
};

export type CreateCatalogPolicyResponse = {
  policy: CreatedCatalogPolicy | null;
  error: string | null;
  mode: "live";
};

export type CatalogCategoriesResponse = {
  categories: CatalogCategory[];
  error: string | null;
  mode: string;
};

export type CategorySettingsResponse = {
  load: CategorySettingsLoad | null;
  error: string | null;
  mode: string;
};

export type CatalogSearchResponse = {
  result: CatalogSearchResult;
  error: string | null;
  mode: string;
};

export type CatalogIndexStatus = "idle" | "loading" | "ready" | "error";

export type CatalogIndexState = {
  status: CatalogIndexStatus;
  platform: string;
  loaded: number;
  scanned: number;
  pages: number;
  complete: boolean;
  fromCache: boolean;
  cachedAt: number | null;
  expiresAt: number | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  areaCount: number;
  cachePath: string | null;
};

export type CreateCompliancePolicyInput = {
  platform: string;
  displayName: string;
  description?: string | null;
  gracePeriodHours?: number | null;
  settings?: Record<string, boolean>;
};

export type CreateCompliancePolicyResponse = {
  policy: CatalogPolicySummary | null;
  error: string | null;
};

export type CompliancePropertyDoc = {
  name: string;
  label?: string | null;
  typeName: string;
  description: string;
  options?: Array<{ value: string; label: string }>;
};

export type CompliancePropertyDocsResponse = {
  properties: CompliancePropertyDoc[];
  error: string | null;
};

export type ComplianceDeviceStatusOverview = {
  pendingCount?: number | null;
  notApplicableCount?: number | null;
  successCount?: number | null;
  errorCount?: number | null;
  failedCount?: number | null;
  conflictCount?: number | null;
  inGracePeriodCount?: number | null;
  unknownDeviceCount?: number | null;
  lastUpdateDateTime?: string | null;
};

export type ComplianceDeviceStatus = {
  id?: string | null;
  deviceId?: string | null;
  deviceDisplayName?: string | null;
  deviceModel?: string | null;
  userName?: string | null;
  userPrincipalName?: string | null;
  status?: string | null;
  lastReportedDateTime?: string | null;
  complianceGracePeriodExpirationDateTime?: string | null;
};

export type ComplianceUserStatus = {
  id?: string | null;
  userDisplayName?: string | null;
  userPrincipalName?: string | null;
  devicesCount?: number | null;
  status?: string | null;
  lastReportedDateTime?: string | null;
};

export type ComplianceSettingStatusSummary = {
  settingName?: string | null;
  settingId?: string | null;
  platformType?: string | null;
  numberOfCompliantDevices?: number | null;
  numberOfNonCompliantDevices?: number | null;
  numberOfUnknownDevices?: number | null;
  numberOfNotApplicableDevices?: number | null;
  numberOfErrorDevices?: number | null;
  numberOfConflictDevices?: number | null;
  numberOfOtherDevices?: number | null;
};

export type ComplianceSettingsReportState = {
  status: string;
  lastRefreshDateTime?: string | null;
  expirationDateTime?: string | null;
};

export type CompliancePolicyStatusReport = {
  policyId: string;
  devices: ComplianceDeviceStatus[];
  users?: ComplianceUserStatus[];
  settings?: ComplianceSettingStatusSummary[];
  truncated: boolean;
  usersTruncated?: boolean;
  fetchedAt: string;
  overview?: ComplianceDeviceStatusOverview | null;
  settingsReport?: ComplianceSettingsReportState | null;
};

export type CompliancePolicyStatusResponse = {
  report: CompliancePolicyStatusReport | null;
  error: string | null;
};

export type CreateTenantScriptInput = {
  kind: string;
  displayName: string;
  description?: string | null;
  runAsAccount?: string | null;
  fileName?: string | null;
  scriptText?: string | null;
  detectionScriptText?: string | null;
  remediationScriptText?: string | null;
  runAs32Bit?: boolean | null;
};

export type ScriptDiagnostic = {
  message: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  severity: string;
};

export type ScriptLintResult = {
  diagnostics: ScriptDiagnostic[];
  engine: string;
  engineError?: string | null;
};

export type CreateTenantScriptResponse = {
  script: TenantScriptSummary | null;
  error: string | null;
};

export type DuplicateGraphObjectResponse = {
  object: DuplicatedObject | null;
  error: string | null;
};

export type DuplicatedObject = {
  id: string;
  kind: string;
  title: string;
};

export type UpdatedObjectMetadata = {
  id: string;
  kind: string;
  title: string;
  description?: string | null;
};

export type UpdateObjectMetadataResponse = {
  object: UpdatedObjectMetadata | null;
  error: string | null;
};

export type GraphObjectDetail = {
  id: string;
  kind: string;
  title: string;
  object: Record<string, unknown>;
  assignments: Record<string, unknown>[];
  settings?: Record<string, unknown>[] | null;
  scriptText?: string | null;
  detectionScriptText?: string | null;
  remediationScriptText?: string | null;
  extras?: Record<string, unknown> | null;
  warnings: string[];
};

export type GraphObjectDetailResponse = {
  detail: GraphObjectDetail | null;
  error: string | null;
  mode: "live";
};

export type NavIconId =
  | "overview"
  | "devices"
  | "enrollment"
  | "settings"
  | "baselines"
  | "apps"
  | "apps-setup"
  | "policies"
  | "settings-catalog"
  | "endpoint-security"
  | "windows-update"
  | "reports";

export type NavItem = {
  href: string;
  label: string;
  icon?: NavIconId;
  children?: NavItem[];
  status?: "ready" | "planned";
  section?: string;
};
