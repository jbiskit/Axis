export type TenantGlance = {
  organizationName: string | null;
  devices: {
    total: number;
    byOs: Record<string, number>;
    byCompliance: Record<string, number>;
    active: number;
    stale: number;
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

export type DeviceCodePrompt = {
  flowId: string;
  userCode: string;
  verificationUri: string;
  message: string;
  intervalSeconds: number;
  expiresInSeconds: number;
};

export type PollResult =
  | { status: "pending" }
  | { status: "failed"; error: string }
  | {
      status: "signedIn";
      accessToken: string;
      expiresOn: number;
      accountName?: string | null;
      tenantId?: string | null;
      mode?: "admin";
    };

export type SessionStatus = {
  signedIn: boolean;
  accountName: string | null;
  mode: "admin";
};

export type GlanceResponse = {
  glance: TenantGlance;
  error: string | null;
  mode: "live";
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
