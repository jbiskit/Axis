export type ComplianceFieldKind = "boolean" | "string" | "number" | "enum";

export type ComplianceDependency = {
  key: string;
  /** When set, the parent draft must be one of these raw values. */
  values?: string[];
};

export type ComplianceField = {
  key: string;
  label: string;
  group: string;
  kind: ComplianceFieldKind;
  description?: string;
  options?: Array<{ value: string; label: string }>;
  dependsOn?: ComplianceDependency[];
};

export type CompliancePropertyDoc = {
  name: string;
  label?: string | null;
  typeName: string;
  description: string;
  options?: Array<{ value: string; label: string }>;
};

export type ComplianceSettingRow = {
  field: ComplianceField;
  value: unknown;
  display: string;
  configured: boolean;
};

const META_KEYS = new Set([
  "id",
  "displayName",
  "name",
  "description",
  "createdDateTime",
  "lastModifiedDateTime",
  "version",
  "roleScopeTagIds",
  "supportsScopeTags",
  "lastModifiedBy",
  "createdBy",
  "@odata.context",
  "@odata.type",
  "@odata.etag",
  "@odata.id",
  "@odata.editLink",
  "scheduledActionsForRule",
  "assignments",
  "deviceStatuses",
  "userStatuses",
  "deviceStatusOverview",
  "userStatusOverview",
  "deviceSettingStateSummaries",
]);

const PASSWORD_TYPE = [
  { value: "deviceDefault", label: "Device default" },
  { value: "alphanumeric", label: "Alphanumeric" },
  { value: "numeric", label: "Numeric" },
];

const CHARACTER_SETS = [
  { value: "", label: "Not configured" },
  { value: "1", label: "Require digits" },
  { value: "2", label: "Require digits and lowercase" },
  { value: "3", label: "Require digits, lowercase, and uppercase" },
  { value: "4", label: "Require digits, lowercase, uppercase, and special characters" },
];

const THREAT_LEVEL = [
  { value: "unavailable", label: "Not configured" },
  { value: "notSet", label: "Not set" },
  { value: "secured", label: "Secured" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const GATEKEEPER = [
  { value: "notConfigured", label: "Not configured" },
  { value: "macAppStore", label: "Mac App Store" },
  { value: "macAppStoreAndIdentifiedDevelopers", label: "App Store and identified developers" },
  { value: "anywhere", label: "Anywhere" },
];

const ACTION_LABELS: Record<string, string> = {
  block: "Mark device noncompliant",
  notification: "Send email",
  notify: "Send email",
  retire: "Retire the device",
  wipe: "Wipe the device",
  remoteLock: "Remotely lock",
  pushNotification: "Push notification",
  removeResourceAccessProfiles: "Remove resource access",
  noAction: "No action",
};

const REQUIRES_PASSWORD: ComplianceDependency[] = [{ key: "passwordRequired" }];
const REQUIRES_PASSCODE: ComplianceDependency[] = [{ key: "passcodeRequired" }];
const REQUIRES_THREAT: ComplianceDependency[] = [{ key: "deviceThreatProtectionEnabled" }];
const REQUIRES_FIREWALL: ComplianceDependency[] = [{ key: "firewallEnabled" }];
const REQUIRES_ALPHANUMERIC_PASSWORD: ComplianceDependency[] = [
  { key: "passwordRequired" },
  { key: "passwordRequiredType", values: ["alphanumeric"] },
];
const REQUIRES_ALPHANUMERIC_PASSCODE: ComplianceDependency[] = [
  { key: "passcodeRequired" },
  { key: "passcodeRequiredType", values: ["alphanumeric"] },
];

const WINDOWS: ComplianceField[] = [
  { key: "passwordRequired", label: "Require a password", group: "Password", kind: "boolean" },
  {
    key: "passwordBlockSimple",
    label: "Block simple passwords",
    group: "Password",
    kind: "boolean",
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordRequiredToUnlockFromIdle",
    label: "Require password to unlock from idle",
    group: "Password",
    kind: "boolean",
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordMinutesOfInactivityBeforeLock",
    label: "Minutes of inactivity before lock",
    group: "Password",
    kind: "number",
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordExpirationDays",
    label: "Password expiration (days)",
    group: "Password",
    kind: "number",
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordMinimumLength",
    label: "Minimum password length",
    group: "Password",
    kind: "number",
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordMinimumCharacterSetCount",
    label: "Password complexity",
    group: "Password",
    kind: "enum",
    options: CHARACTER_SETS,
    dependsOn: REQUIRES_ALPHANUMERIC_PASSWORD,
  },
  {
    key: "passwordRequiredType",
    label: "Password type",
    group: "Password",
    kind: "enum",
    options: PASSWORD_TYPE,
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordPreviousPasswordBlockCount",
    label: "Number of previous passwords to prevent reuse",
    group: "Password",
    kind: "number",
    dependsOn: REQUIRES_PASSWORD,
  },
  { key: "osMinimumVersion", label: "Minimum OS version", group: "Operating system", kind: "string" },
  { key: "osMaximumVersion", label: "Maximum OS version", group: "Operating system", kind: "string" },
  { key: "bitLockerEnabled", label: "Require BitLocker", group: "Encryption and boot", kind: "boolean" },
  { key: "secureBootEnabled", label: "Require Secure Boot", group: "Encryption and boot", kind: "boolean" },
  { key: "codeIntegrityEnabled", label: "Require code integrity", group: "Encryption and boot", kind: "boolean" },
  { key: "tpmRequired", label: "Require TPM", group: "Encryption and boot", kind: "boolean" },
  {
    key: "storageRequireEncryption",
    label: "Require storage encryption",
    group: "Encryption and boot",
    kind: "boolean",
  },
  {
    key: "earlyLaunchAntiMalwareDriverEnabled",
    label: "Require early-launch antimalware",
    group: "Encryption and boot",
    kind: "boolean",
  },
  {
    key: "memoryIntegrityEnabled",
    label: "Require memory integrity (HVCI)",
    group: "Encryption and boot",
    kind: "boolean",
  },
  {
    key: "kernelDmaProtectionEnabled",
    label: "Require kernel DMA protection",
    group: "Encryption and boot",
    kind: "boolean",
  },
  {
    key: "virtualizationBasedSecurityEnabled",
    label: "Require virtualization-based security",
    group: "Encryption and boot",
    kind: "boolean",
  },
  {
    key: "firmwareProtectionEnabled",
    label: "Require firmware protection",
    group: "Encryption and boot",
    kind: "boolean",
  },
  { key: "activeFirewallRequired", label: "Require firewall", group: "Defender and antivirus", kind: "boolean" },
  { key: "defenderEnabled", label: "Require Microsoft Defender", group: "Defender and antivirus", kind: "boolean" },
  { key: "antivirusRequired", label: "Require antivirus", group: "Defender and antivirus", kind: "boolean" },
  { key: "antiSpywareRequired", label: "Require antispyware", group: "Defender and antivirus", kind: "boolean" },
  { key: "rtpEnabled", label: "Require real-time protection", group: "Defender and antivirus", kind: "boolean" },
  {
    key: "signatureOutOfDate",
    label: "Require up-to-date signatures",
    group: "Defender and antivirus",
    kind: "boolean",
  },
  { key: "defenderVersion", label: "Minimum Defender version", group: "Defender and antivirus", kind: "string" },
  {
    key: "requireHealthyDeviceReport",
    label: "Require healthy Device Health Attestation",
    group: "Device health",
    kind: "boolean",
  },
  {
    key: "configurationManagerComplianceRequired",
    label: "Require Configuration Manager compliance",
    group: "Device health",
    kind: "boolean",
  },
  {
    key: "deviceThreatProtectionEnabled",
    label: "Require device threat protection",
    group: "Threat protection",
    kind: "boolean",
  },
  {
    key: "deviceThreatProtectionRequiredSecurityLevel",
    label: "Maximum allowed threat level",
    group: "Threat protection",
    kind: "enum",
    options: THREAT_LEVEL,
    dependsOn: REQUIRES_THREAT,
  },
];

const MACOS: ComplianceField[] = [
  { key: "passwordRequired", label: "Require a password", group: "Password", kind: "boolean" },
  {
    key: "passwordBlockSimple",
    label: "Block simple passwords",
    group: "Password",
    kind: "boolean",
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordExpirationDays",
    label: "Password expiration (days)",
    group: "Password",
    kind: "number",
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordMinimumLength",
    label: "Minimum password length",
    group: "Password",
    kind: "number",
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordMinutesOfInactivityBeforeLock",
    label: "Minutes of inactivity before lock",
    group: "Password",
    kind: "number",
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordPreviousPasswordBlockCount",
    label: "Number of previous passwords to prevent reuse",
    group: "Password",
    kind: "number",
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordRequiredType",
    label: "Password type",
    group: "Password",
    kind: "enum",
    options: PASSWORD_TYPE,
    dependsOn: REQUIRES_PASSWORD,
  },
  { key: "osMinimumVersion", label: "Minimum OS version", group: "Operating system", kind: "string" },
  { key: "osMaximumVersion", label: "Maximum OS version", group: "Operating system", kind: "string" },
  {
    key: "systemIntegrityProtectionEnabled",
    label: "Require System Integrity Protection",
    group: "Device security",
    kind: "boolean",
  },
  { key: "storageRequireEncryption", label: "Require FileVault", group: "Device security", kind: "boolean" },
  { key: "firewallEnabled", label: "Require firewall", group: "Device security", kind: "boolean" },
  {
    key: "firewallBlockAllIncoming",
    label: "Block all incoming connections",
    group: "Device security",
    kind: "boolean",
    dependsOn: REQUIRES_FIREWALL,
  },
  {
    key: "firewallEnableStealthMode",
    label: "Enable stealth mode",
    group: "Device security",
    kind: "boolean",
    dependsOn: REQUIRES_FIREWALL,
  },
  {
    key: "gatekeeperAllowedAppSource",
    label: "Allowed app sources",
    group: "Device security",
    kind: "enum",
    options: GATEKEEPER,
  },
  {
    key: "deviceThreatProtectionEnabled",
    label: "Require device threat protection",
    group: "Threat protection",
    kind: "boolean",
  },
  {
    key: "deviceThreatProtectionRequiredSecurityLevel",
    label: "Maximum allowed threat level",
    group: "Threat protection",
    kind: "enum",
    options: THREAT_LEVEL,
    dependsOn: REQUIRES_THREAT,
  },
];

const IOS: ComplianceField[] = [
  { key: "passcodeRequired", label: "Require a passcode", group: "Passcode", kind: "boolean" },
  {
    key: "passcodeBlockSimple",
    label: "Block simple passcodes",
    group: "Passcode",
    kind: "boolean",
    dependsOn: REQUIRES_PASSCODE,
  },
  {
    key: "passcodeExpirationDays",
    label: "Passcode expiration (days)",
    group: "Passcode",
    kind: "number",
    dependsOn: REQUIRES_PASSCODE,
  },
  {
    key: "passcodeMinimumLength",
    label: "Minimum passcode length",
    group: "Passcode",
    kind: "number",
    dependsOn: REQUIRES_PASSCODE,
  },
  {
    key: "passcodeMinutesOfInactivityBeforeLock",
    label: "Minutes of inactivity before lock",
    group: "Passcode",
    kind: "number",
    dependsOn: REQUIRES_PASSCODE,
  },
  {
    key: "passcodePreviousPasscodeBlockCount",
    label: "Number of previous passcodes to prevent reuse",
    group: "Passcode",
    kind: "number",
    dependsOn: REQUIRES_PASSCODE,
  },
  {
    key: "passcodeMinimumCharacterSetCount",
    label: "Passcode complexity",
    group: "Passcode",
    kind: "enum",
    options: CHARACTER_SETS,
    dependsOn: REQUIRES_ALPHANUMERIC_PASSCODE,
  },
  {
    key: "passcodeRequiredType",
    label: "Passcode type",
    group: "Passcode",
    kind: "enum",
    options: PASSWORD_TYPE,
    dependsOn: REQUIRES_PASSCODE,
  },
  { key: "osMinimumVersion", label: "Minimum OS version", group: "Operating system", kind: "string" },
  { key: "osMaximumVersion", label: "Maximum OS version", group: "Operating system", kind: "string" },
  {
    key: "securityBlockJailbrokenDevices",
    label: "Block jailbroken devices",
    group: "Device security",
    kind: "boolean",
  },
  {
    key: "managedEmailProfileRequired",
    label: "Require managed email profile",
    group: "Device security",
    kind: "boolean",
  },
  {
    key: "deviceThreatProtectionEnabled",
    label: "Require device threat protection",
    group: "Threat protection",
    kind: "boolean",
  },
  {
    key: "deviceThreatProtectionRequiredSecurityLevel",
    label: "Maximum allowed threat level",
    group: "Threat protection",
    kind: "enum",
    options: THREAT_LEVEL,
    dependsOn: REQUIRES_THREAT,
  },
];

const ANDROID: ComplianceField[] = [
  { key: "passwordRequired", label: "Require a password", group: "Password", kind: "boolean" },
  {
    key: "passwordMinimumLength",
    label: "Minimum password length",
    group: "Password",
    kind: "number",
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordRequiredType",
    label: "Password type",
    group: "Password",
    kind: "enum",
    options: PASSWORD_TYPE,
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordMinutesOfInactivityBeforeLock",
    label: "Minutes of inactivity before lock",
    group: "Password",
    kind: "number",
    dependsOn: REQUIRES_PASSWORD,
  },
  {
    key: "passwordExpirationDays",
    label: "Password expiration (days)",
    group: "Password",
    kind: "number",
    dependsOn: REQUIRES_PASSWORD,
  },
  { key: "osMinimumVersion", label: "Minimum OS version", group: "Operating system", kind: "string" },
  { key: "osMaximumVersion", label: "Maximum OS version", group: "Operating system", kind: "string" },
  {
    key: "minAndroidSecurityPatchLevel",
    label: "Minimum security patch",
    group: "Operating system",
    kind: "string",
  },
  { key: "storageRequireEncryption", label: "Require encryption", group: "Device security", kind: "boolean" },
  {
    key: "securityBlockJailbrokenDevices",
    label: "Block rooted devices",
    group: "Device security",
    kind: "boolean",
  },
  {
    key: "securityRequireSafetyNetAttestationBasicIntegrity",
    label: "Require Play Integrity (basic)",
    group: "Device security",
    kind: "boolean",
  },
  {
    key: "securityRequireSafetyNetAttestationCertifiedDevice",
    label: "Require Play Integrity (certified)",
    group: "Device security",
    kind: "boolean",
  },
  {
    key: "securityRequireIntuneAppIntegrity",
    label: "Require Intune app integrity",
    group: "Device security",
    kind: "boolean",
  },
  {
    key: "deviceThreatProtectionEnabled",
    label: "Require device threat protection",
    group: "Threat protection",
    kind: "boolean",
  },
  {
    key: "deviceThreatProtectionRequiredSecurityLevel",
    label: "Maximum allowed threat level",
    group: "Threat protection",
    kind: "enum",
    options: THREAT_LEVEL,
    dependsOn: REQUIRES_THREAT,
  },
];

function titleCaseKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (ch) => ch.toUpperCase());
}

export function fieldsForComplianceObject(
  odataType: string | null | undefined,
  docs?: CompliancePropertyDoc[] | null,
): ComplianceField[] {
  const type = (odataType ?? "").toLowerCase();
  const catalog = type.includes("macos")
    ? MACOS
    : type.includes("ios")
      ? IOS
      : type.includes("android") || type.includes("aosp")
        ? ANDROID
        : WINDOWS;
  return applyCompliancePropertyDocs(catalog, docs);
}

export function labelFromOfficialDescription(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return "";
  const withoutRange = trimmed.split(/\. Valid values/i)[0] ?? trimmed;
  return withoutRange.replace(/\.$/, "").trim();
}

export function applyCompliancePropertyDocs(
  fields: ComplianceField[],
  docs: CompliancePropertyDoc[] | null | undefined,
): ComplianceField[] {
  if (!docs?.length) return fields;
  const byDoc = new Map(docs.map((doc) => [doc.name, doc]));
  return fields.map((field) => {
    const doc = byDoc.get(field.key);
    if (!doc) return field;
    const portalLabel = doc.label?.trim();
    const official = portalLabel || labelFromOfficialDescription(doc.description);
    return {
      ...field,
      label: official || field.label,
      description: doc.description.trim() || field.description,
    };
  });
}

function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "boolean") return value === false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return (
      trimmed === "" ||
      trimmed === "deviceDefault" ||
      trimmed === "unavailable" ||
      trimmed === "notSet" ||
      trimmed === "notConfigured"
    );
  }
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

export function formatComplianceValue(field: ComplianceField, value: unknown): string {
  if (isBlank(value) || (field.kind === "enum" && (value === 0 || value === "0"))) {
    return "Not configured";
  }
  if (field.kind === "boolean") return value === true ? "Required" : "Not configured";
  if (field.kind === "enum") {
    const key = String(value);
    return field.options?.find((option) => option.value === key)?.label ?? titleCaseKey(key);
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  return "Configured";
}

export function complianceSettingRows(
  object: Record<string, unknown>,
  odataType: string | null | undefined,
  docs?: CompliancePropertyDoc[] | null,
): ComplianceSettingRow[] {
  const catalog = fieldsForComplianceObject(odataType, docs);
  const seen = new Set(catalog.map((field) => field.key));
  const rows = catalog.map((field) => {
    const value = object[field.key];
    return {
      field,
      value,
      display: formatComplianceValue(field, value),
      configured:
        !isBlank(value) && !(field.kind === "enum" && (value === 0 || value === "0")),
    };
  });
  for (const [key, value] of Object.entries(object)) {
    if (seen.has(key) || META_KEYS.has(key)) continue;
    const field: ComplianceField = {
      key,
      label: titleCaseKey(key),
      group: "Other",
      kind:
        typeof value === "boolean"
          ? "boolean"
          : typeof value === "number"
            ? "number"
            : "string",
    };
    rows.push({
      field,
      value,
      display: formatComplianceValue(field, value),
      configured: !isBlank(value),
    });
  }
  return rows;
}

export function groupComplianceRows(rows: ComplianceSettingRow[]): Array<{
  group: string;
  rows: ComplianceSettingRow[];
}> {
  const groups: Array<{ group: string; rows: ComplianceSettingRow[] }> = [];
  const index = new Map<string, number>();
  for (const row of rows) {
    const existing = index.get(row.field.group);
    if (existing == null) {
      index.set(row.field.group, groups.length);
      groups.push({ group: row.field.group, rows: [row] });
    } else {
      groups[existing].rows.push(row);
    }
  }
  return groups;
}

export type ScheduledActionRow = {
  actionType: string;
  label: string;
  gracePeriodHours: number | null;
  when: string;
};

export function scheduledActionRows(extras: unknown): ScheduledActionRow[] {
  const root =
    extras && typeof extras === "object" && !Array.isArray(extras)
      ? (extras as Record<string, unknown>)
      : null;
  const rules = Array.isArray(root?.scheduledActions)
    ? root.scheduledActions
    : Array.isArray(extras)
      ? extras
      : [];
  const rows: ScheduledActionRow[] = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    const configs = (rule as { scheduledActionConfigurations?: unknown }).scheduledActionConfigurations;
    if (!Array.isArray(configs)) continue;
    for (const item of configs) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const actionType = typeof record.actionType === "string" ? record.actionType : "block";
      const grace =
        typeof record.gracePeriodHours === "number" ? record.gracePeriodHours : null;
      rows.push({
        actionType,
        label: ACTION_LABELS[actionType] ?? titleCaseKey(actionType),
        gracePeriodHours: grace,
        when:
          grace == null
            ? "—"
            : grace <= 0
              ? "Immediately"
              : `After ${grace} hour${grace === 1 ? "" : "s"}`,
      });
    }
  }
  return rows;
}

export function draftValueForField(field: ComplianceField, value: unknown): string {
  if (field.kind === "boolean") return value === true ? "true" : "";
  if (value == null) return "";
  if (field.kind === "enum" && (value === 0 || value === "0")) return "";
  return String(value);
}

export function parseDraftValue(field: ComplianceField, raw: string): unknown {
  if (field.kind === "boolean") return raw === "true" ? true : false;
  if (field.kind === "number") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "deviceDefault" || trimmed === "unavailable" || trimmed === "notConfigured") {
    return field.kind === "enum" ? trimmed || null : null;
  }
  if (field.kind === "enum") {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && String(parsed) === trimmed) return parsed;
  }
  return trimmed;
}

export function isDraftConfigured(field: ComplianceField, draft: string): boolean {
  return !isBlank(parseDraftValue(field, draft));
}

export function isComplianceFieldEnabled(
  field: ComplianceField,
  drafts: Record<string, string>,
  byKey: Map<string, ComplianceField>,
): boolean {
  for (const dep of field.dependsOn ?? []) {
    const parent = byKey.get(dep.key);
    const raw = drafts[dep.key] ?? "";
    if (dep.values?.length) {
      if (!dep.values.includes(raw)) return false;
      continue;
    }
    if (!parent) {
      if (!raw) return false;
      continue;
    }
    if (!isDraftConfigured(parent, raw)) return false;
  }
  return true;
}

export function clearedValueForField(field: ComplianceField): unknown {
  if (field.kind === "boolean") return false;
  if (field.kind === "enum") {
    const blank = field.options?.find((option) =>
      ["deviceDefault", "unavailable", "notSet", "notConfigured"].includes(option.value),
    );
    return blank?.value ?? null;
  }
  return null;
}
