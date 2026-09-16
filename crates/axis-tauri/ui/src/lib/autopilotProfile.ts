import { humanizeSettingToken } from "./catalogSettingDisplay";
import { matchesListQuery, type ListFilterOption } from "./listSelection";
import type { AutopilotDevice, AutopilotProfile } from "../types/inventory";
import { autopilotLocaleLabel, normalizeAutopilotLocale } from "./autopilotLocales";

export type AutopilotOverviewRow = { label: string; value: string };

export type AutopilotOverviewSection = {
  title: string;
  description?: string;
  rows: AutopilotOverviewRow[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function yesNo(value: boolean | null | undefined, empty = "—"): string {
  if (value == null) return empty;
  return value ? "Yes" : "No";
}

/** Graph / Intune Learn wording for known Autopilot enums. */
function enumLabel(value: string | null | undefined, map: Record<string, string>): string {
  if (!value) return "—";
  const key = value.trim();
  return map[key] ?? map[key.toLowerCase()] ?? humanizeSettingToken(key);
}

const JOIN_TYPE_LABELS: Record<string, string> = {
  entra: "Microsoft Entra joined",
  azureAD: "Microsoft Entra joined",
  hybrid: "Hybrid Microsoft Entra joined",
  activeDirectory: "Hybrid Microsoft Entra joined",
};

const DEVICE_TYPE_LABELS: Record<string, string> = {
  windowsPc: "Windows PC",
  holoLens: "HoloLens",
  surfaceHub2: "Surface Hub 2",
  surfaceHub2S: "Surface Hub 2S",
  virtualMachine: "Virtual machine",
};

const USER_TYPE_LABELS: Record<string, string> = {
  administrator: "Administrator",
  standard: "Standard",
};

const USAGE_TYPE_LABELS: Record<string, string> = {
  // Portal: Deployment mode
  singleUser: "User-driven",
  shared: "Self-Deploying",
};

export function autopilotOdataType(object: Record<string, unknown> | null | undefined): string {
  return text(object?.["@odata.type"]) ?? "";
}

export function isAutopilotProfileObject(
  object: Record<string, unknown> | null | undefined,
): boolean {
  return autopilotOdataType(object).toLowerCase().includes("windowsautopilotdeploymentprofile");
}

export function isAutopilotDeviceObject(
  object: Record<string, unknown> | null | undefined,
): boolean {
  return autopilotOdataType(object).toLowerCase().includes("windowsautopilotdeviceidentity");
}

/**
 * Join mode from profile `@odata.type` (Entra vs Hybrid).
 * Used by list summaries and Overview.
 */
export function autopilotJoinKindFromOdata(
  odataType: string | null | undefined,
): "entra" | "hybrid" | null {
  const lower = (odataType ?? "").toLowerCase();
  if (!lower.includes("windowsautopilotdeploymentprofile")) return null;
  if (lower.includes("activedirectory")) return "hybrid";
  if (lower.includes("azuread")) return "entra";
  // Generic base type — treat as Entra when ambiguous.
  return "entra";
}

export function autopilotJoinTypeLabel(odataType: string | null | undefined): string {
  const kind = autopilotJoinKindFromOdata(odataType);
  if (!kind) return "—";
  return JOIN_TYPE_LABELS[kind];
}

function pickOobe(object: Record<string, unknown>): Record<string, unknown> | null {
  return (
    asRecord(object.outOfBoxExperienceSetting) ??
    asRecord(object.outOfBoxExperienceSettings)
  );
}

function oobeBool(
  oobe: Record<string, unknown>,
  currentKey: string,
  legacyKey: string,
): boolean | null {
  const current = bool(oobe[currentKey]);
  if (current != null) return current;
  return bool(oobe[legacyKey]);
}

function localeValue(object: Record<string, unknown>): string {
  return autopilotLocaleLabel(text(object.locale) ?? text(object.language) ?? "os-default");
}

function pushRow(rows: AutopilotOverviewRow[], label: string, value: string | null | undefined) {
  if (value == null || value === "") return;
  rows.push({ label, value });
}

export function autopilotProfileSections(
  object: Record<string, unknown> | null | undefined,
): AutopilotOverviewSection[] {
  if (!object || !isAutopilotProfileObject(object)) return [];

  const odata = autopilotOdataType(object);
  const oobe = pickOobe(object);
  const esp = asRecord(object.enrollmentStatusScreenSettings);

  const joinRows: AutopilotOverviewRow[] = [];
  pushRow(joinRows, "Convert all targeted devices to", autopilotJoinTypeLabel(odata));
  if (autopilotJoinKindFromOdata(odata) === "hybrid") {
    pushRow(
      joinRows,
      "Skip domain connectivity check",
      yesNo(bool(object.hybridAzureADJoinSkipConnectivityCheck)),
    );
  }
  pushRow(
    joinRows,
    "Device type",
    enumLabel(text(object.deviceType), DEVICE_TYPE_LABELS),
  );
  pushRow(
    joinRows,
    "Apply device name template",
    text(object.deviceNameTemplate) ?? "Not configured",
  );

  const oobeRows: AutopilotOverviewRow[] = [];
  if (oobe) {
    pushRow(
      oobeRows,
      "User account type",
      enumLabel(text(oobe.userType), USER_TYPE_LABELS),
    );
    pushRow(
      oobeRows,
      "Deployment mode",
      enumLabel(text(oobe.deviceUsageType), USAGE_TYPE_LABELS),
    );
    pushRow(
      oobeRows,
      "Hide privacy settings",
      yesNo(oobeBool(oobe, "privacySettingsHidden", "hidePrivacySettings")),
    );
    pushRow(
      oobeRows,
      "Hide EULA",
      yesNo(oobeBool(oobe, "eulaHidden", "hideEULA")),
    );
    pushRow(
      oobeRows,
      "Skip keyboard selection page",
      yesNo(oobeBool(oobe, "keyboardSelectionPageSkipped", "skipKeyboardSelectionPage")),
    );
    pushRow(
      oobeRows,
      "Hide change account options",
      yesNo(oobeBool(oobe, "escapeLinkHidden", "hideEscapeLink")),
    );
  }

  const preprovision =
    bool(object.preprovisioningAllowed) ?? bool(object.enableWhiteGlove);
  const hardwareHash =
    bool(object.hardwareHashExtractionEnabled) ?? bool(object.extractHardwareHash);

  const languageRows: AutopilotOverviewRow[] = [];
  pushRow(languageRows, "Language (Region)", localeValue(object));

  const hardwareRows: AutopilotOverviewRow[] = [];
  pushRow(hardwareRows, "Convert all targeted devices to Autopilot", yesNo(hardwareHash));

  const preRows: AutopilotOverviewRow[] = [];
  pushRow(preRows, "Allow pre-provisioned deployment", yesNo(preprovision));

  const sections: AutopilotOverviewSection[] = [
    {
      title: "Join & device",
      description: "How Autopilot joins the device and names it during enrolment.",
      rows: joinRows,
    },
    {
      title: "Out-of-box experience",
      description: "Screens shown to the end user during OOBE.",
      rows: oobeRows,
    },
    {
      title: "Pre-provisioning",
      description: "Windows Autopilot for pre-provisioned deployment (white glove).",
      rows: preRows,
    },
    {
      title: "Language",
      rows: languageRows,
    },
    {
      title: "Hardware",
      rows: hardwareRows,
    },
  ];

  if (esp) {
    const espRows: AutopilotOverviewRow[] = [];
    pushRow(
      espRows,
      "Show installation progress",
      yesNo(
        bool(esp.hideInstallationProgress) == null
          ? null
          : !bool(esp.hideInstallationProgress)!,
      ),
    );
    pushRow(
      espRows,
      "Block device use until required apps install",
      yesNo(
        bool(esp.allowDeviceUseBeforeProfileAndAppInstallComplete) == null
          ? null
          : !bool(esp.allowDeviceUseBeforeProfileAndAppInstallComplete)!,
      ),
    );
    pushRow(
      espRows,
      "Allow device use on install failure",
      yesNo(bool(esp.allowDeviceUseOnInstallFailure)),
    );
    pushRow(
      espRows,
      "Block device setup retry by user",
      yesNo(bool(esp.blockDeviceSetupRetryByUser)),
    );
    pushRow(
      espRows,
      "Allow log collection on install failure",
      yesNo(bool(esp.allowLogCollectionOnInstallFailure)),
    );
    const timeout = esp.installProgressTimeoutInMinutes;
    if (typeof timeout === "number" && Number.isFinite(timeout)) {
      pushRow(espRows, "Install progress timeout (minutes)", String(timeout));
    }
    pushRow(espRows, "Custom error message", text(esp.customErrorMessage) ?? "—");
    sections.push({
      title: "Enrollment status screen (on profile)",
      description:
        "ESP settings embedded on this Autopilot profile. Standalone ESP configs live under Enrollment Status Page.",
      rows: espRows,
    });
  }

  return sections.filter((section) => section.rows.length > 0);
}

const ENROLLMENT_STATE_LABELS: Record<string, string> = {
  notContacted: "Not contacted",
  pendingReset: "Pending reset",
  resetFailed: "Reset failed",
  enrolled: "Enrolled",
  enrollmentInProgress: "Enrollment in progress",
  enrollmentFailed: "Enrollment failed",
  notEnrolled: "Not enrolled",
  unknown: "Unknown",
};

const PROFILE_ASSIGNMENT_LABELS: Record<string, string> = {
  unknown: "Unknown",
  availableForAssignment: "Available for assignment",
  pending: "Pending",
  assigned: "Assigned",
  failed: "Failed",
  unassignPending: "Unassign pending",
  unassignFailed: "Unassign failed",
};

export function autopilotDeviceSections(
  object: Record<string, unknown> | null | undefined,
): AutopilotOverviewSection[] {
  if (!object) return [];

  const identity: AutopilotOverviewRow[] = [];
  pushRow(identity, "Serial number", text(object.serialNumber));
  pushRow(identity, "Display name", text(object.displayName));
  pushRow(identity, "Group tag", text(object.groupTag) ?? "—");
  pushRow(identity, "Manufacturer", text(object.manufacturer));
  pushRow(identity, "Model", text(object.model));

  const enrollment: AutopilotOverviewRow[] = [];
  pushRow(
    enrollment,
    "Enrollment state",
    enumLabel(text(object.enrollmentState), ENROLLMENT_STATE_LABELS),
  );
  pushRow(
    enrollment,
    "Profile assignment status",
    enumLabel(
      text(object.deploymentProfileAssignmentStatus),
      PROFILE_ASSIGNMENT_LABELS,
    ),
  );
  pushRow(enrollment, "User", text(object.userPrincipalName) ?? "—");
  pushRow(enrollment, "Last contacted", text(object.lastContactedDateTime) ?? "—");

  const ids: AutopilotOverviewRow[] = [];
  pushRow(ids, "Autopilot device id", text(object.id));
  pushRow(ids, "Entra device id", text(object.azureActiveDirectoryDeviceId) ?? "—");
  pushRow(ids, "Managed device id", text(object.managedDeviceId) ?? "—");

  return [
    { title: "Hardware identity", rows: identity },
    { title: "Enrollment", rows: enrollment },
    { title: "Identifiers", rows: ids },
  ].filter((section) => section.rows.length > 0);
}

function uniqueFilterOptions(
  values: Iterable<string | null | undefined>,
  labelFor: (value: string) => string = (value) => value,
): ListFilterOption[] {
  const seen = new Set<string>();
  const options: ListFilterOption[] = [{ value: "all", label: "All" }];
  for (const raw of values) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ value: key, label: labelFor(value) });
  }
  return options;
}

export function autopilotDeviceStateFilterOptions(
  devices: AutopilotDevice[],
): ListFilterOption[] {
  return uniqueFilterOptions(
    devices.map((device) => device.enrollmentState),
    (value) => enumLabel(value, ENROLLMENT_STATE_LABELS),
  );
}

export function autopilotDeviceTagFilterOptions(
  devices: AutopilotDevice[],
): ListFilterOption[] {
  return uniqueFilterOptions(devices.map((device) => device.groupTag));
}

export function matchesAutopilotDeviceFilters(
  item: AutopilotDevice,
  query: string,
  stateFilter: string,
  tagFilter: string,
): boolean {
  if (stateFilter && stateFilter !== "all") {
    const state = (item.enrollmentState ?? "").trim().toLowerCase();
    if (state !== stateFilter) return false;
  }
  if (tagFilter && tagFilter !== "all") {
    const tag = (item.groupTag ?? "").trim().toLowerCase();
    if (tag !== tagFilter) return false;
  }
  return matchesListQuery(
    [
      item.serialNumber,
      item.displayName,
      item.groupTag,
      item.manufacturer,
      item.model,
      item.enrollmentState,
      enumLabel(item.enrollmentState, ENROLLMENT_STATE_LABELS),
      item.userPrincipalName,
      item.deploymentProfileAssignmentStatus,
      enumLabel(item.deploymentProfileAssignmentStatus, PROFILE_ASSIGNMENT_LABELS),
      item.id,
    ]
      .filter(Boolean)
      .join(" "),
    query,
  );
}

/** Graph rejects a second manual Autopilot sync within this window. */
export const AUTOPILOT_SYNC_COOLDOWN_MS = 10 * 60 * 1000;

export function autopilotSyncCooldownRemainingMs(
  lastManualSyncTriggerDateTime: string | null | undefined,
  now = Date.now(),
): number {
  if (!lastManualSyncTriggerDateTime) return 0;
  const then = Date.parse(lastManualSyncTriggerDateTime);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, then + AUTOPILOT_SYNC_COOLDOWN_MS - now);
}

export function formatAutopilotSyncCooldown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function autopilotSyncStatusLabel(status: string | null | undefined): string | null {
  const raw = (status ?? "").trim().toLowerCase();
  if (!raw || raw === "unknown") return null;
  if (raw === "inprogress") return "Sync in progress";
  if (raw === "completed") return "Last sync completed";
  if (raw === "failed") return "Last sync failed";
  return status?.trim() || null;
}

export function autopilotProfileJoinFilterOptions(
  profiles: AutopilotProfile[],
): ListFilterOption[] {
  const options: ListFilterOption[] = [{ value: "all", label: "All" }];
  const kinds = new Set<string>();
  for (const profile of profiles) {
    const kind =
      profile.deviceJoinType ??
      autopilotJoinKindFromOdata(profile.odataType) ??
      null;
    if (!kind || kinds.has(kind)) continue;
    kinds.add(kind);
    options.push({
      value: kind,
      label: JOIN_TYPE_LABELS[kind] ?? kind,
    });
  }
  return options;
}

export function matchesAutopilotProfileFilters(
  item: AutopilotProfile,
  query: string,
  joinFilter: string,
  joinLabel: string,
): boolean {
  if (joinFilter && joinFilter !== "all") {
    const kind =
      item.deviceJoinType ?? autopilotJoinKindFromOdata(item.odataType) ?? "";
    if (kind !== joinFilter) return false;
  }
  return matchesListQuery(
    [
      item.displayName,
      item.description,
      item.deviceNameTemplate,
      item.deviceJoinType,
      joinLabel,
      item.odataType,
      item.id,
    ]
      .filter(Boolean)
      .join(" "),
    query,
  );
}

export type AutopilotProfileDraft = {
  displayName: string;
  description: string;
  joinKind: "entra" | "hybrid";
  deviceType: string;
  deviceNameTemplate: string;
  locale: string;
  userType: string;
  deviceUsageType: string;
  privacySettingsHidden: boolean;
  eulaHidden: boolean;
  keyboardSelectionPageSkipped: boolean;
  escapeLinkHidden: boolean;
  preprovisioningAllowed: boolean;
  hardwareHashExtractionEnabled: boolean;
  hybridAzureAdJoinSkipConnectivityCheck: boolean;
  configureEsp: boolean;
  showInstallationProgress: boolean;
  blockDeviceUseUntilRequiredAppsInstall: boolean;
  allowDeviceUseOnInstallFailure: boolean;
  blockDeviceSetupRetryByUser: boolean;
  allowLogCollectionOnInstallFailure: boolean;
  installProgressTimeoutInMinutes: number;
  customErrorMessage: string;
};

export const AUTOPILOT_DEVICE_TYPE_OPTIONS: ListFilterOption[] = [
  { value: "windowsPc", label: DEVICE_TYPE_LABELS.windowsPc },
  { value: "holoLens", label: DEVICE_TYPE_LABELS.holoLens },
  { value: "virtualMachine", label: DEVICE_TYPE_LABELS.virtualMachine },
];

export const AUTOPILOT_JOIN_OPTIONS: ListFilterOption[] = [
  { value: "entra", label: JOIN_TYPE_LABELS.entra },
  { value: "hybrid", label: JOIN_TYPE_LABELS.hybrid },
];

export const AUTOPILOT_USAGE_OPTIONS: ListFilterOption[] = [
  { value: "singleUser", label: USAGE_TYPE_LABELS.singleUser },
  { value: "shared", label: USAGE_TYPE_LABELS.shared },
];

export const AUTOPILOT_USER_TYPE_OPTIONS: ListFilterOption[] = [
  { value: "administrator", label: USER_TYPE_LABELS.administrator },
  { value: "standard", label: USER_TYPE_LABELS.standard },
];

export function defaultAutopilotProfileDraft(): AutopilotProfileDraft {
  return {
    displayName: "",
    description: "",
    joinKind: "entra",
    deviceType: "windowsPc",
    deviceNameTemplate: "",
    locale: "os-default",
    userType: "standard",
    deviceUsageType: "singleUser",
    privacySettingsHidden: true,
    eulaHidden: true,
    keyboardSelectionPageSkipped: true,
    escapeLinkHidden: true,
    preprovisioningAllowed: false,
    hardwareHashExtractionEnabled: false,
    hybridAzureAdJoinSkipConnectivityCheck: false,
    configureEsp: false,
    showInstallationProgress: true,
    blockDeviceUseUntilRequiredAppsInstall: true,
    allowDeviceUseOnInstallFailure: false,
    blockDeviceSetupRetryByUser: false,
    allowLogCollectionOnInstallFailure: true,
    installProgressTimeoutInMinutes: 60,
    customErrorMessage: "",
  };
}

export function draftFromAutopilotObject(
  object: Record<string, unknown> | null | undefined,
): AutopilotProfileDraft {
  const base = defaultAutopilotProfileDraft();
  if (!object) return base;
  const oobe = pickOobe(object);
  const esp = asRecord(object.enrollmentStatusScreenSettings);
  const joinKind = autopilotJoinKindFromOdata(autopilotOdataType(object)) ?? "entra";
  return {
    ...base,
    displayName: text(object.displayName) ?? "",
    description: text(object.description) ?? "",
    joinKind,
    deviceType: text(object.deviceType) ?? "windowsPc",
    deviceNameTemplate: text(object.deviceNameTemplate) ?? "",
    locale: normalizeAutopilotLocale(text(object.locale) ?? text(object.language) ?? "os-default"),
    userType: text(oobe?.userType) ?? "standard",
    deviceUsageType: text(oobe?.deviceUsageType) ?? "singleUser",
    privacySettingsHidden:
      (oobe ? oobeBool(oobe, "privacySettingsHidden", "hidePrivacySettings") : null) ?? true,
    eulaHidden: (oobe ? oobeBool(oobe, "eulaHidden", "hideEULA") : null) ?? true,
    keyboardSelectionPageSkipped:
      (oobe ? oobeBool(oobe, "keyboardSelectionPageSkipped", "skipKeyboardSelectionPage") : null) ??
      true,
    escapeLinkHidden:
      (oobe ? oobeBool(oobe, "escapeLinkHidden", "hideEscapeLink") : null) ?? true,
    preprovisioningAllowed:
      bool(object.preprovisioningAllowed) ?? bool(object.enableWhiteGlove) ?? false,
    hardwareHashExtractionEnabled:
      bool(object.hardwareHashExtractionEnabled) ?? bool(object.extractHardwareHash) ?? false,
    hybridAzureAdJoinSkipConnectivityCheck:
      bool(object.hybridAzureADJoinSkipConnectivityCheck) ?? false,
    configureEsp: Boolean(esp),
    showInstallationProgress: esp
      ? !(bool(esp.hideInstallationProgress) ?? false)
      : true,
    blockDeviceUseUntilRequiredAppsInstall: esp
      ? !(bool(esp.allowDeviceUseBeforeProfileAndAppInstallComplete) ?? false)
      : true,
    allowDeviceUseOnInstallFailure: bool(esp?.allowDeviceUseOnInstallFailure) ?? false,
    blockDeviceSetupRetryByUser: bool(esp?.blockDeviceSetupRetryByUser) ?? false,
    allowLogCollectionOnInstallFailure:
      bool(esp?.allowLogCollectionOnInstallFailure) ?? true,
    installProgressTimeoutInMinutes:
      typeof esp?.installProgressTimeoutInMinutes === "number"
        ? esp.installProgressTimeoutInMinutes
        : 60,
    customErrorMessage: text(esp?.customErrorMessage) ?? "",
  };
}

export function draftsEqualAutopilot(
  a: AutopilotProfileDraft,
  b: AutopilotProfileDraft,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function toCreateAutopilotInput(draft: AutopilotProfileDraft) {
  return {
    displayName: draft.displayName.trim(),
    description: draft.description.trim() || null,
    joinKind: draft.joinKind,
    deviceType: draft.deviceType,
    deviceNameTemplate: draft.deviceNameTemplate.trim() || null,
    locale: normalizeAutopilotLocale(draft.locale),
    oobe: {
      userType: draft.userType,
      deviceUsageType: draft.deviceUsageType,
      privacySettingsHidden: draft.privacySettingsHidden,
      eulaHidden: draft.eulaHidden,
      keyboardSelectionPageSkipped: draft.keyboardSelectionPageSkipped,
      escapeLinkHidden: draft.escapeLinkHidden,
    },
    preprovisioningAllowed: draft.preprovisioningAllowed,
    hardwareHashExtractionEnabled: draft.hardwareHashExtractionEnabled,
    hybridAzureAdJoinSkipConnectivityCheck: draft.hybridAzureAdJoinSkipConnectivityCheck,
    esp: draft.configureEsp
      ? {
          showInstallationProgress: draft.showInstallationProgress,
          blockDeviceUseUntilRequiredAppsInstall: draft.blockDeviceUseUntilRequiredAppsInstall,
          allowDeviceUseOnInstallFailure: draft.allowDeviceUseOnInstallFailure,
          blockDeviceSetupRetryByUser: draft.blockDeviceSetupRetryByUser,
          allowLogCollectionOnInstallFailure: draft.allowLogCollectionOnInstallFailure,
          installProgressTimeoutInMinutes: draft.installProgressTimeoutInMinutes,
          customErrorMessage: draft.customErrorMessage.trim() || null,
        }
      : null,
  };
}

export function toUpdateAutopilotInput(
  id: string,
  odataType: string,
  draft: AutopilotProfileDraft,
) {
  return {
    id,
    odataType,
    displayName: draft.displayName.trim(),
    description: draft.description.trim(),
    deviceType: draft.deviceType,
    deviceNameTemplate: draft.deviceNameTemplate.trim() || null,
    locale: normalizeAutopilotLocale(draft.locale),
    oobe: {
      userType: draft.userType,
      deviceUsageType: draft.deviceUsageType,
      privacySettingsHidden: draft.privacySettingsHidden,
      eulaHidden: draft.eulaHidden,
      keyboardSelectionPageSkipped: draft.keyboardSelectionPageSkipped,
      escapeLinkHidden: draft.escapeLinkHidden,
    },
    preprovisioningAllowed: draft.preprovisioningAllowed,
    hardwareHashExtractionEnabled: draft.hardwareHashExtractionEnabled,
    hybridAzureAdJoinSkipConnectivityCheck:
      draft.joinKind === "hybrid" ? draft.hybridAzureAdJoinSkipConnectivityCheck : null,
    esp: draft.configureEsp
      ? {
          showInstallationProgress: draft.showInstallationProgress,
          blockDeviceUseUntilRequiredAppsInstall: draft.blockDeviceUseUntilRequiredAppsInstall,
          allowDeviceUseOnInstallFailure: draft.allowDeviceUseOnInstallFailure,
          blockDeviceSetupRetryByUser: draft.blockDeviceSetupRetryByUser,
          allowLogCollectionOnInstallFailure: draft.allowLogCollectionOnInstallFailure,
          installProgressTimeoutInMinutes: draft.installProgressTimeoutInMinutes,
          customErrorMessage: draft.customErrorMessage.trim() || null,
        }
      : null,
  };
}
