import { detectionNeedsValue, type Win32AppDraft, type Win32DetectionRule } from "./win32App";

export type CatalogDependency = {
  path: string;
  vendor: string;
  name: string;
  version: string;
};

export type CatalogPackageDraft = Win32AppDraft & {
  vendor: string;
  version: string;
  iconFile: string;
  iconType: string;
  iconValue: string;
  iconUrl: string;
  dependencies: CatalogDependency[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function putNumber(target: Record<string, unknown>, key: string, raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    delete target[key];
    return;
  }
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed)) target[key] = Math.trunc(parsed);
}

export function draftFromCatalogConfig(config: Record<string, unknown>): CatalogPackageDraft {
  const application = asRecord(config.application) ?? {};
  const installation = asRecord(config.installation) ?? {};
  const detection = asRecord(config.detection);
  const requirements = asRecord(application.requirements) ?? {};
  const rules = Array.isArray(detection?.rules) ? detection.rules : [];
  const timeout = typeof installation.timeout === "number" ? installation.timeout : 60;
  const icon = asRecord(application.icon) ?? {};
  return {
    vendor: text(application.vendor),
    version: text(application.version),
    displayName: text(application.name),
    description: text(application.description),
    publisher: text(application.publisher),
    displayVersion: text(application.displayVersion) || text(application.version),
    notes: text(application.notes),
    owner: text(application.owner),
    installCommandLine: text(application.installCommandLine) || text(installation.installCommand),
    uninstallCommandLine: text(application.uninstallCommandLine) || text(installation.uninstallCommand),
    allowedArchitectures: text(application.allowedArchitectures) || text(application.applicableArchitectures),
    minimumSupportedWindowsRelease: text(application.minimumSupportedWindowsRelease),
    allowAvailableUninstall: application.allowAvailableUninstall !== false,
    runAsAccount: text(installation.installBehavior) || "system",
    deviceRestartBehavior: text(installation.restartBehavior) || "allow",
    maxRunTimeInMinutes: timeout,
    minimumFreeDiskSpaceInMB: optionalNumber(requirements.minimumFreeDiskSpaceInMB),
    minimumMemoryInMB: optionalNumber(requirements.minimumMemoryInMB),
    minimumNumberOfProcessors: optionalNumber(requirements.minimumNumberOfProcessors),
    minimumCpuSpeedInMHz: optionalNumber(requirements.minimumCpuSpeedInMHz),
    iconFile: text(icon.file),
    iconType: text(icon.type) || "image/png",
    iconValue: text(icon.value),
    iconUrl: text(icon.url),
    dependencies: dependenciesFromConfig(config.dependencies),
    detectionRules: rules.flatMap((rule) => {
      const next = ruleFromCatalog(rule);
      return next ? [next] : [];
    }),
  };
}

export function applyDraftToCatalogConfig(
  config: Record<string, unknown>,
  draft: CatalogPackageDraft,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };
  const application = { ...(asRecord(config.application) ?? {}) };
  const installation = { ...(asRecord(config.installation) ?? {}) };
  const requirements = { ...(asRecord(application.requirements) ?? {}) };
  putNumber(requirements, "minimumFreeDiskSpaceInMB", draft.minimumFreeDiskSpaceInMB);
  putNumber(requirements, "minimumMemoryInMB", draft.minimumMemoryInMB);
  putNumber(requirements, "minimumNumberOfProcessors", draft.minimumNumberOfProcessors);
  putNumber(requirements, "minimumCpuSpeedInMHz", draft.minimumCpuSpeedInMHz);
  application.name = draft.displayName.trim();
  application.vendor = draft.vendor.trim();
  application.version = draft.version.trim();
  application.displayVersion = draft.displayVersion.trim() || draft.version.trim();
  application.description = draft.description;
  application.publisher = draft.publisher;
  application.notes = draft.notes;
  application.owner = draft.owner;
  application.allowedArchitectures = draft.allowedArchitectures;
  application.applicableArchitectures = draft.allowedArchitectures;
  application.installCommandLine = draft.installCommandLine;
  application.uninstallCommandLine = draft.uninstallCommandLine;
  application.minimumSupportedWindowsRelease = draft.minimumSupportedWindowsRelease;
  application.allowAvailableUninstall = draft.allowAvailableUninstall;
  application.requirements = requirements;
  const iconFile = draft.iconFile.trim();
  const iconValue = draft.iconValue.trim();
  const iconUrl = draft.iconUrl.trim();
  if (!iconFile && !iconValue && !iconUrl) {
    delete application.icon;
  } else {
    const icon: Record<string, unknown> = {
      type: draft.iconType.trim() || "image/png",
    };
    if (iconFile) icon.file = iconFile;
    if (iconValue) icon.value = iconValue;
    if (iconUrl) icon.url = iconUrl;
    application.icon = icon;
  }
  installation.installCommand = draft.installCommandLine;
  installation.uninstallCommand = draft.uninstallCommandLine;
  installation.installBehavior = draft.runAsAccount === "user" ? "user" : "system";
  installation.restartBehavior = draft.deviceRestartBehavior || "allow";
  installation.timeout = draft.maxRunTimeInMinutes;
  const detection = { ...(asRecord(config.detection) ?? {}) };
  let powershellIndex = 0;
  detection.rules = draft.detectionRules.map((rule) => {
    if (rule.type === "powershell") {
      powershellIndex += 1;
      return ruleToCatalog(rule, powershellIndex);
    }
    return ruleToCatalog(rule, 0);
  });
  next.application = application;
  next.installation = installation;
  next.detection = detection;
  if (draft.dependencies.length === 0) {
    delete next.dependencies;
  } else {
    next.dependencies = draft.dependencies.map((dependency) => ({
      path: dependency.path,
      vendor: dependency.vendor,
      name: dependency.name,
      version: dependency.version,
    }));
  }
  return next;
}

export function catalogArchitectureReady(value: string): boolean {
  return value.split(/[,;\s]+/).some((part) => {
    const token = part.toLowerCase();
    return token === "x86" || token === "x64" || token === "arm64";
  });
}

export function catalogMinimumOsReady(value: string): boolean {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  return trimmed !== "" && lower !== "none" && lower !== "notconfigured";
}

export function catalogRuleReady(rule: Win32DetectionRule): boolean {
  switch (rule.type) {
    case "file":
      return (
        rule.path.trim() !== "" &&
        rule.fileOrFolderName.trim() !== "" &&
        catalogComparisonReady(rule.detectionType, rule.detectionValue)
      );
    case "registry":
      return rule.keyPath.trim() !== "" && catalogComparisonReady(rule.detectionType, rule.detectionValue);
    case "msi": {
      if (rule.productCode.trim() === "") return false;
      const operator = rule.productVersionOperator.trim();
      if (operator === "" || operator.toLowerCase() === "notconfigured") return true;
      return rule.productVersion.trim() !== "";
    }
    case "powershell":
      return rule.scriptContent.trim() !== "";
    case "unknown":
      return Object.keys(rule.raw).length > 0;
  }
}

function catalogComparisonReady(detectionType: string, detectionValue: string): boolean {
  if (!detectionNeedsValue(detectionType)) return true;
  return detectionValue.trim() !== "";
}

function dependenciesFromConfig(value: unknown): CatalogDependency[] {
  if (!Array.isArray(value)) return [];
  const dependencies: CatalogDependency[] = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const vendor = text(row.vendor).trim();
    const name = text(row.name).trim();
    const version = text(row.version).trim();
    const path =
      text(row.path).trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/^Applications\//, "") ||
      (vendor && name && version ? `${vendor}/${name}/${version}` : "");
    if (!path || dependencies.some((dependency) => dependency.path.toLowerCase() === path.toLowerCase())) continue;
    dependencies.push({ path, vendor, name, version });
  }
  return dependencies;
}

function ruleFromCatalog(value: unknown): Win32DetectionRule | null {
  const rule = asRecord(value);
  if (!rule) return null;
  const type = text(rule.type);
  if (type === "file") {
    return {
      type: "file",
      path: text(rule.path),
      fileOrFolderName: text(rule.fileOrFolderName),
      detectionType: text(rule.detectionType) || "exists",
      operator: text(rule.operator) || "notConfigured",
      detectionValue: text(rule.detectionValue),
      check32BitOn64System: rule.check32BitOn64System === true,
    };
  }
  if (type === "registry") {
    return {
      type: "registry",
      keyPath: text(rule.keyPath),
      valueName: text(rule.valueName),
      detectionType: text(rule.detectionType) || "exists",
      operator: text(rule.operator) || "notConfigured",
      detectionValue: text(rule.detectionValue),
      check32BitOn64System: rule.check32BitOn64System === true,
    };
  }
  if (type === "msi") {
    return {
      type: "msi",
      productCode: text(rule.productCode),
      productVersion: text(rule.productVersion),
      productVersionOperator: text(rule.productVersionOperator) || "notConfigured",
    };
  }
  if (type === "powershell") {
    return {
      type: "powershell",
      scriptContent: text(rule.scriptContent),
      enforceSignatureCheck: rule.enforceSignatureCheck === true,
      runAs32Bit: rule.runAs32Bit === true,
    };
  }
  return { type: "unknown", raw: rule };
}

function ruleToCatalog(rule: Win32DetectionRule, powershellIndex: number): Record<string, unknown> {
  switch (rule.type) {
    case "file":
      return {
        type: "file",
        path: rule.path,
        fileOrFolderName: rule.fileOrFolderName,
        detectionType: rule.detectionType,
        operator: rule.operator,
        detectionValue: rule.detectionValue,
        check32BitOn64System: rule.check32BitOn64System,
      };
    case "registry":
      return {
        type: "registry",
        keyPath: rule.keyPath,
        valueName: rule.valueName,
        detectionType: rule.detectionType,
        operator: rule.operator,
        detectionValue: rule.detectionValue,
        check32BitOn64System: rule.check32BitOn64System,
      };
    case "msi":
      return {
        type: "msi",
        productCode: rule.productCode,
        productVersion: rule.productVersion,
        productVersionOperator: rule.productVersionOperator,
      };
    case "powershell":
      return {
        type: "powershell",
        scriptFile: powershellIndex <= 1 ? "detection.ps1" : `detection-${powershellIndex}.ps1`,
        scriptContent: rule.scriptContent,
        enforceSignatureCheck: rule.enforceSignatureCheck,
        runAs32Bit: rule.runAs32Bit,
      };
    case "unknown":
      return rule.raw;
  }
}
