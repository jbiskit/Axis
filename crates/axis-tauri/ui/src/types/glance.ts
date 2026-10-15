export type TenantGlance = {
  organizationName: string | null;
  devices: {
    total: number;
    byOs: Record<string, number>;
    byCompliance: Record<string, number>;
    active: number;
    stale: number;
    /** Windows devices by release, largest first. */
    windowsReleases?: Array<{ label: string; count: number }>;
    encrypted?: number;
    /** Devices that report encryption at all. */
    encryptionReported?: number;
    /** managedDeviceOwnerType: company, personal, unknown. */
    byOwnership?: Record<string, number>;
    /** Enrollments per day for the last 30 days, oldest first. */
    enrolledLast30Days?: number[];
  };
  policies: {
    compliancePolicies: number;
    configurationProfiles: number;
    deviceConfigurations: number;
    groupPolicyConfigurations: number;
    endpointSecurity: number;
  };
  inventory: Array<{
    id: string;
    title: string;
    category: string;
    count: number;
    api: string;
    error?: string;
    permissionRelated?: boolean;
    status?: number;
    code?: string;
  }>;
  conflicts: {
    summaryCount: number;
    devicesImpacted: number;
    items: Array<{
      id: string;
      label: string;
      settingCount: number;
      policyCount: number;
      deviceCheckinsImpacted: number | null;
    }>;
    warning?: string;
  };
  failures: {
    appFailedDeviceCount: number | null;
    appFailureSampleSize: number | null;
    configNoncompliantDevices: number;
    configErrorDevices: number;
    warning?: string;
  };
  compliance: {
    compliant: number;
    noncompliant: number;
    inGracePeriod: number;
    unknown: number;
    ratePercent: number | null;
  };
  recentActivity: Array<{
    id: string;
    activityDateTime: string;
    activityDisplayName: string;
    category?: string;
    result?: string;
    operationType?: string;
    actor: {
      displayName?: string | null;
      userPrincipalName?: string | null;
      appDisplayName?: string | null;
    };
    targetResources: string[];
    changes?: Array<{
      displayName: string;
      oldValue?: string | null;
      newValue?: string | null;
    }>;
  }>;
  recentActivityWarning?: string;
  recentActivityPermissionRelated?: boolean;
  drift?: {
    baselineId: string;
    baselineName: string;
    pass: number;
    fail: number;
    unknown: number;
    incomplete: boolean;
    failingChecks: Array<{
      id: string;
      title: string;
      message: string;
    }>;
    warning?: string;
  };
  warnings: string[];
  permissionWarnings: string[];
  otherWarnings: string[];
  tokenScopes: string[];
  fetchedAt: string;
};

export type BrowserSignIn = {
  flowId: string;
  authorizeUrl: string;
};

export type StoredSignIn = {
  clientId: string;
  accountName?: string | null;
  tenantId?: string | null;
  tenantName?: string | null;
  tenantDomain?: string | null;
  mode: SessionMode;
  extraScopes: string[];
  graphCommandLine: boolean;
};

export type StoredSignInOutcome =
  | { status: "signedIn"; accountName?: string | null; mode: SessionMode }
  | { status: "needsBrowser"; clientId: string; mode: SessionMode; extraScopes: string[] };

export type SessionMode = "admin" | "read";

export type PollResult =
  | { status: "pending" }
  | { status: "failed"; error: string }
  | {
      status: "signedIn";
      accessToken: string;
      expiresOn: number;
      accountName?: string | null;
      tenantId?: string | null;
      mode?: SessionMode;
    };

export type SessionStatus = {
  signedIn: boolean;
  accountName: string | null;
  mode: SessionMode;
  readOnlyScopeExceedsRequest: boolean;
  exceededWriteScopes?: string[];
  tenantId?: string | null;
  clientId?: string | null;
};

export type GlanceResponse = {
  glance: TenantGlance;
  error: string | null;
  mode: "live";
};

export type IntuneAuditEvent = TenantGlance["recentActivity"][number];

export type IntuneAuditLogResponse = {
  events: IntuneAuditEvent[];
  error: string | null;
  truncated: boolean;
};

/** One Graph write Axis made, from the local write log. */
export type WriteLogEntry = {
  id: string;
  at: string;
  tenantId: string;
  actor: string | null;
  operation: string | null;
  method: string;
  path: string;
  version: string;
  requestBody: unknown;
  before: unknown;
  after: unknown;
  createdId: string | null;
  undoes: string | null;
  /** Why undo is not offered; null when it is. */
  undoBlocked: string | null;
  undoneBy: string | null;
  status: number | null;
  ok: boolean;
  error: string | null;
};

export type UndoOutcome = {
  ok: boolean;
  /** Fields that differ from the state Axis left. */
  conflicts: string[];
  /** The object could not be read after the write, so a later change cannot be ruled out. */
  unverified: boolean;
  error: string | null;
};

export type WriteLogResponse = {
  entries: WriteLogEntry[];
  tenantId: string | null;
  folder: string | null;
  truncated: boolean;
};

export type ManagedDeviceSummary = {
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
};

export type ManagedDeviceList = {
  devices: ManagedDeviceSummary[];
  truncated: boolean;
  fetchedAt: string;
};

export type DevicesResponse = {
  list: ManagedDeviceList;
  error: string | null;
  mode: "live";
};

export const STALE_DEVICE_DAYS = 7;
