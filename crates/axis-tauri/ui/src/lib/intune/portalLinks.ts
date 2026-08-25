/**
 * Intune admin center deep links (intune.microsoft.com hash routes).
 * Prefer these over Graph Explorer URLs so users land in the right tenant blade.
 */

const INTUNE_ORIGIN = "https://intune.microsoft.com";

export function intuneDevicesListUrl(): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/devices`;
}

/** Single device — new ManagedDeviceMenu overview (preview device page). */
export function intuneDeviceUrl(deviceId: string): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_ManagedDevices/ManagedDeviceMenu.MenuView/~/overview/managedDeviceId/${encodeURIComponent(
    deviceId,
  )}`;
}

/** Devices → Configuration (Settings Catalog + classic profiles list). */
export function intuneConfigurationPoliciesListUrl(): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/configurationPolicies`;
}

export type IntuneConfigurationPolicyLinkOptions = {
  isAssigned?: boolean | null;
  technologies?: string | null;
  platforms?: string | null;
  templateId?: string | null;
};

function firstCsvToken(value?: string | null): string {
  if (!value?.trim()) return "";
  return value.split(/[,;]/)[0]?.trim() ?? "";
}

function stringField(object: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = object?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Configuration policy summary — matches Intune Workflows PolicySummaryBlade.
 */
export function intuneConfigurationPolicyUrl(
  policyId: string,
  options?: IntuneConfigurationPolicyLinkOptions,
): string {
  const isAssigned = options?.isAssigned === false ? "false" : "true";
  const technology = firstCsvToken(options?.technologies) || "mdm";
  const templateId = options?.templateId?.trim() ?? "";
  const platformName = firstCsvToken(options?.platforms) || "windows10";

  return (
    `${INTUNE_ORIGIN}/#view/Microsoft_Intune_Workflows/PolicySummaryBlade` +
    `/policyId/${encodeURIComponent(policyId)}` +
    `/isAssigned~/${isAssigned}` +
    `/technology/${encodeURIComponent(technology)}` +
    `/templateId/${templateId ? encodeURIComponent(templateId) : ""}` +
    `/platformName/${encodeURIComponent(platformName)}`
  );
}

export function intuneAppsListUrl(): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_Apps/SettingsMenu/~/allApps`;
}

export function intuneAppUrl(appId: string): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_Apps/SettingsMenu/~/0/appId/${encodeURIComponent(
    appId,
  )}`;
}

/** Devices → Scripts and remediations → Platform scripts. */
export function intunePlatformScriptsListUrl(): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/powershell`;
}

/** Devices → Scripts and remediations → Remediations (list). */
export function intuneRemediationsListUrl(): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/scripts`;
}

/** Devices → Compliance → Scripts (custom compliance discovery scripts list). */
export function intuneComplianceScriptsListUrl(): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_DeviceSettings/DevicesComplianceMenu/~/scripts`;
}

/**
 * ConfigureWMPolicyMenuBlade object URL.
 * ARM hash `policyType~/N` is an integer (the `~` marks a typed number).
 *
 * Confirmed values:
 * - 0 = Windows device management PowerShell (`deviceManagementScripts`)
 *   User example + IntuneStuff / Get-ClientIntunePolicyResult deep links.
 * - 1 = macOS shell (`deviceShellScripts`)
 *   IntuneLogWatch portal builder.
 */
export function intuneWmPolicyMenuUrl(policyId: string, policyType: number): string {
  return (
    `${INTUNE_ORIGIN}/#view/Microsoft_Intune_DeviceSettings/ConfigureWMPolicyMenuBlade` +
    `/~/overview/policyId/${encodeURIComponent(policyId)}/policyType~/${policyType}`
  );
}

/** Single Windows PowerShell platform script. */
export function intunePlatformScriptUrl(policyId: string): string {
  return intuneWmPolicyMenuUrl(policyId, 0);
}

/** Single macOS shell platform script. */
export function intuneShellScriptUrl(policyId: string): string {
  return intuneWmPolicyMenuUrl(policyId, 1);
}

export type IntuneRemediationLinkOptions = {
  displayName?: string | null;
  isGlobalScript?: boolean | null;
};

/**
 * Single Remediation / device health script object blade.
 * Current admin center uses Enrollment UXAnalyticsScriptMenu (not ConfigureWMPolicyMenuBlade).
 * Pattern from haavarstein/intune-dashboard (observed Intune hash route).
 */
export function intuneRemediationScriptUrl(
  scriptId: string,
  options?: IntuneRemediationLinkOptions,
): string {
  const name = encodeURIComponent(options?.displayName?.trim() ?? "");
  const firstParty = options?.isGlobalScript === true ? "true" : "false";
  return (
    `${INTUNE_ORIGIN}/#view/Microsoft_Intune_Enrollment/UXAnalyticsScriptMenu` +
    `/~/overview/id/${encodeURIComponent(scriptId)}` +
    `/scriptName/${name}` +
    `/isFirstParty~/${firstParty}`
  );
}

/**
 * Custom compliance discovery script object blade.
 * Uses ConfigureWMPolicyMenuBlade like platform scripts (policyId + policyType).
 * 0 = Windows PowerShell and 1 = macOS shell are confirmed. Public samples do
 * not document the compliance integer; 3 is the next script-kind slot after
 * those two (remediations use UXAnalyticsScriptMenu instead of this blade).
 */
export function intuneComplianceScriptUrl(scriptId: string): string {
  return intuneWmPolicyMenuUrl(scriptId, 3);
}

/** Enrollment → Autopilot devices blade. */
export function intuneAutopilotDevicesListUrl(): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_Enrollment/AutopilotDevicesBlade`;
}

/** Enrollment → Autopilot deployment profiles blade. */
export function intuneAutopilotProfilesListUrl(): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_Enrollment/AutopilotProfilesBlade`;
}

/** Enrollment → Windows enrollment hub. */
export function intuneEnrollmentWindowsUrl(): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/windowsEnrollment`;
}

export function intuneImportAdmxUrl(): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/configuration`;
}

export function intuneAdminTemplatesListUrl(): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_DeviceSettings/DevicesMenu/~/configuration`;
}

export function intuneAdminTemplatePolicyUrl(policyId: string): string {
  return intuneConfigurationPolicyUrl(policyId, {
    isAssigned: true,
    technologies: "mdm",
    platforms: "windows10",
  });
}

export function intuneCompliancePoliciesListUrl(): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_DeviceSettings/DevicesComplianceMenu/~/policies`;
}

export function intuneCompliancePolicyUrl(policyId: string): string {
  return `${INTUNE_ORIGIN}/#view/Microsoft_Intune_DeviceSettings/CompliancePolicyOverviewBlade/${encodeURIComponent(
    policyId,
  )}`;
}

function configurationOptionsFromObject(
  object?: Record<string, unknown> | null,
): IntuneConfigurationPolicyLinkOptions {
  const templateRef = asRecord(object?.templateReference);
  const isAssigned = object?.isAssigned;
  return {
    isAssigned: typeof isAssigned === "boolean" ? isAssigned : null,
    technologies: stringField(object, "technologies"),
    platforms: stringField(object, "platforms"),
    templateId:
      stringField(object, "templateId") ??
      stringField(templateRef, "templateId") ??
      stringField(templateRef, "templateFamily"),
  };
}

/**
 * Best-effort portal URL for a Tauri Graph inspector kind.
 * Object-specific blades when we have them; otherwise the matching list blade.
 */
export function intunePortalUrlForKind(
  kind: string,
  id: string,
  object?: Record<string, unknown> | null,
): string | null {
  if (!id.trim()) return null;
  if (kind === "device") return intuneDeviceUrl(id);
  if (kind === "configurationPolicy" || kind.startsWith("windowsUpdate:")) {
    return intuneConfigurationPolicyUrl(id, configurationOptionsFromObject(object));
  }
  if (kind === "groupPolicyConfiguration") return intuneAdminTemplatePolicyUrl(id);
  if (kind === "compliancePolicy") return intuneCompliancePolicyUrl(id);
  if (kind === "deviceConfiguration") return intuneConfigurationPoliciesListUrl();
  if (kind === "enrollmentConfiguration") return intuneEnrollmentWindowsUrl();
  if (kind === "mobileApp") return intuneAppUrl(id);
  if (kind === "appProtection") return intuneAppsListUrl();
  if (kind.startsWith("script:remediation")) {
    return intuneRemediationScriptUrl(id, {
      displayName: stringField(object, "displayName"),
      isGlobalScript: object?.isGlobalScript === true,
    });
  }
  if (kind.startsWith("script:compliance")) return intuneComplianceScriptUrl(id);
  if (kind.startsWith("script:platform-shell")) return intuneShellScriptUrl(id);
  if (kind.startsWith("script:")) return intunePlatformScriptUrl(id);
  if (kind === "autopilotDevice") return intuneAutopilotDevicesListUrl();
  if (kind === "autopilotProfile") return intuneAutopilotProfilesListUrl();
  return null;
}
