import { graphLargeIcon } from "./appIcon";

export const WIN32_ARCHITECTURES = ["x64", "x86", "arm64"] as const;

export const WIN32_MIN_WINDOWS_RELEASES: Array<{ value: string; label: string }> = [
  { value: "1607", label: "Windows 10 1607" },
  { value: "1703", label: "Windows 10 1703" },
  { value: "1709", label: "Windows 10 1709" },
  { value: "1803", label: "Windows 10 1803" },
  { value: "1809", label: "Windows 10 1809" },
  { value: "1903", label: "Windows 10 1903" },
  { value: "1909", label: "Windows 10 1909" },
  { value: "2004", label: "Windows 10 2004" },
  { value: "2H20", label: "Windows 10 20H2" },
  { value: "21H1", label: "Windows 10 21H1" },
  { value: "Windows10_21H2", label: "Windows 10 21H2" },
  { value: "Windows10_22H2", label: "Windows 10 22H2" },
  { value: "Windows11_21H2", label: "Windows 11 21H2" },
  { value: "Windows11_22H2", label: "Windows 11 22H2" },
  { value: "Windows11_23H2", label: "Windows 11 23H2" },
  { value: "Windows11_24H2", label: "Windows 11 24H2" },
];

export const FILE_DETECTION_TYPES = [
  { value: "exists", label: "File or folder exists" },
  { value: "modifiedDate", label: "Date modified" },
  { value: "createdDate", label: "Date created" },
  { value: "version", label: "Version" },
  { value: "sizeInMB", label: "Size in MB" },
  { value: "doesNotExist", label: "File or folder does not exist" },
] as const;

export const REGISTRY_DETECTION_TYPES = [
  { value: "exists", label: "Key exists" },
  { value: "doesNotExist", label: "Key does not exist" },
  { value: "string", label: "String comparison" },
  { value: "integer", label: "Integer comparison" },
  { value: "version", label: "Version comparison" },
] as const;

export const DETECTION_OPERATORS = [
  { value: "notConfigured", label: "Not configured" },
  { value: "equal", label: "Equals" },
  { value: "notEqual", label: "Not equal to" },
  { value: "greaterThan", label: "Greater than" },
  { value: "greaterThanOrEqual", label: "Greater than or equal to" },
  { value: "lessThan", label: "Less than" },
  { value: "lessThanOrEqual", label: "Less than or equal to" },
] as const;

export type Win32DetectionRule =
  | {
      type: "file";
      path: string;
      fileOrFolderName: string;
      detectionType: string;
      operator: string;
      detectionValue: string;
      check32BitOn64System: boolean;
    }
  | {
      type: "registry";
      keyPath: string;
      valueName: string;
      detectionType: string;
      operator: string;
      detectionValue: string;
      check32BitOn64System: boolean;
    }
  | {
      type: "msi";
      productCode: string;
      productVersion: string;
      productVersionOperator: string;
    }
  | {
      type: "powershell";
      scriptContent: string;
      enforceSignatureCheck: boolean;
      runAs32Bit: boolean;
    }
  | {
      type: "unknown";
      raw: Record<string, unknown>;
    };

export type Win32AppDraft = {
  displayName: string;
  description: string;
  publisher: string;
  displayVersion: string;
  notes: string;
  owner: string;
  installCommandLine: string;
  uninstallCommandLine: string;
  allowedArchitectures: string;
  minimumSupportedWindowsRelease: string;
  allowAvailableUninstall: boolean;
  runAsAccount: string;
  deviceRestartBehavior: string;
  maxRunTimeInMinutes: number;
  minimumFreeDiskSpaceInMB: string;
  minimumMemoryInMB: string;
  minimumNumberOfProcessors: string;
  minimumCpuSpeedInMHz: string;
  detectionRules: Win32DetectionRule[];
  iconType: string;
  iconValue: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function isWin32LobApp(object: Record<string, unknown> | null): boolean {
  const odata = text(object?.["@odata.type"]);
  return odata.includes("win32LobApp");
}

export function draftFromWin32Object(object: Record<string, unknown> | null): Win32AppDraft {
  const install =
    object?.installExperience && typeof object.installExperience === "object"
      ? (object.installExperience as Record<string, unknown>)
      : {};
  const minutes =
    typeof install.maxRunTimeInMinutes === "number" ? install.maxRunTimeInMinutes : 60;
  const icon = graphLargeIcon(object);
  return {
    displayName: text(object?.displayName),
    description: text(object?.description),
    publisher: text(object?.publisher),
    displayVersion: text(object?.displayVersion),
    notes: text(object?.notes),
    owner: text(object?.owner),
    installCommandLine: text(object?.installCommandLine),
    uninstallCommandLine: text(object?.uninstallCommandLine),
    allowedArchitectures: text(object?.allowedArchitectures) || "x64",
    minimumSupportedWindowsRelease: text(object?.minimumSupportedWindowsRelease) || "1809",
    allowAvailableUninstall: object?.allowAvailableUninstall === true,
    runAsAccount: text(install.runAsAccount) || "system",
    deviceRestartBehavior: text(install.deviceRestartBehavior) || "allow",
    maxRunTimeInMinutes: minutes,
    minimumFreeDiskSpaceInMB: optionalNumber(object?.minimumFreeDiskSpaceInMB),
    minimumMemoryInMB: optionalNumber(object?.minimumMemoryInMB),
    minimumNumberOfProcessors: optionalNumber(object?.minimumNumberOfProcessors),
    minimumCpuSpeedInMHz: optionalNumber(object?.minimumCpuSpeedInMHz),
    detectionRules: detectionRulesFromGraph(object?.detectionRules),
    iconType: icon.iconType,
    iconValue: icon.iconValue,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function decodeGraphScript(raw: string): string {
  const compact = raw.trim().replace(/\s/g, "");
  if (!compact) return "";
  try {
    const binary = atob(compact);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    let encoded = "";
    for (const byte of bytes) encoded += String.fromCharCode(byte);
    const again = btoa(encoded).replace(/=+$/, "");
    if (again === compact.replace(/=+$/, "")) return text;
  } catch {
    return raw;
  }
  return raw;
}

function detectionRulesFromGraph(value: unknown): Win32DetectionRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const rule = asRecord(item);
    if (!rule) return [];
    const odata = text(rule["@odata.type"]).toLowerCase();
    if (odata.includes("filesystemdetection")) {
      return [
        {
          type: "file" as const,
          path: text(rule.path),
          fileOrFolderName: text(rule.fileOrFolderName),
          detectionType: text(rule.detectionType) || "exists",
          operator: text(rule.operator) || "notConfigured",
          detectionValue: text(rule.detectionValue),
          check32BitOn64System: rule.check32BitOn64System === true,
        },
      ];
    }
    if (odata.includes("registrydetection")) {
      return [
        {
          type: "registry" as const,
          keyPath: text(rule.keyPath),
          valueName: text(rule.valueName),
          detectionType: text(rule.detectionType) || "exists",
          operator: text(rule.operator) || "notConfigured",
          detectionValue: text(rule.detectionValue),
          check32BitOn64System: rule.check32BitOn64System === true,
        },
      ];
    }
    if (odata.includes("productcodedetection")) {
      return [
        {
          type: "msi" as const,
          productCode: text(rule.productCode),
          productVersion: text(rule.productVersion),
          productVersionOperator: text(rule.productVersionOperator) || "notConfigured",
        },
      ];
    }
    if (odata.includes("powershellscriptdetection")) {
      return [
        {
          type: "powershell" as const,
          scriptContent: decodeGraphScript(text(rule.scriptContent)),
          enforceSignatureCheck: rule.enforceSignatureCheck === true,
          runAs32Bit: rule.runAs32Bit === true,
        },
      ];
    }
    return [{ type: "unknown" as const, raw: rule }];
  });
}

export function emptyDetectionRule(type: "file" | "registry" | "msi" | "powershell"): Win32DetectionRule {
  switch (type) {
    case "file":
      return {
        type: "file",
        path: "",
        fileOrFolderName: "",
        detectionType: "exists",
        operator: "notConfigured",
        detectionValue: "",
        check32BitOn64System: false,
      };
    case "registry":
      return {
        type: "registry",
        keyPath: "",
        valueName: "",
        detectionType: "exists",
        operator: "notConfigured",
        detectionValue: "",
        check32BitOn64System: false,
      };
    case "msi":
      return {
        type: "msi",
        productCode: "",
        productVersion: "",
        productVersionOperator: "notConfigured",
      };
    case "powershell":
      return {
        type: "powershell",
        scriptContent: "",
        enforceSignatureCheck: false,
        runAs32Bit: false,
      };
  }
}

export function detectionNeedsValue(detectionType: string): boolean {
  return detectionType !== "exists" && detectionType !== "doesNotExist" && detectionType !== "notConfigured";
}

export function summarizeDetectionRule(rule: Win32DetectionRule): string {
  switch (rule.type) {
    case "file":
      return `File · ${[rule.path, rule.fileOrFolderName].filter(Boolean).join("\\") || "unset"}`;
    case "registry":
      return `Registry · ${rule.keyPath || "unset"}`;
    case "msi":
      return `MSI · ${rule.productCode || "unset"}`;
    case "powershell": {
      const preview = rule.scriptContent.trim().replace(/\s+/g, " ").slice(0, 72);
      return `PowerShell · ${preview || "empty script"}`;
    }
    case "unknown":
      return "Other detection rule";
  }
}

export function draftsEqualWin32(left: Win32AppDraft, right: Win32AppDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function optionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function toUpdateWin32Input(id: string, draft: Win32AppDraft, updateIcon = false) {
  return {
    id,
    displayName: draft.displayName,
    description: draft.description,
    publisher: draft.publisher,
    displayVersion: draft.displayVersion,
    notes: draft.notes,
    owner: draft.owner,
    installCommandLine: draft.installCommandLine,
    uninstallCommandLine: draft.uninstallCommandLine,
    allowedArchitectures: draft.allowedArchitectures,
    minimumSupportedWindowsRelease: draft.minimumSupportedWindowsRelease,
    allowAvailableUninstall: draft.allowAvailableUninstall,
    runAsAccount: draft.runAsAccount,
    deviceRestartBehavior: draft.deviceRestartBehavior,
    maxRunTimeInMinutes: draft.maxRunTimeInMinutes,
    minimumFreeDiskSpaceInMB: optionalInt(draft.minimumFreeDiskSpaceInMB),
    minimumMemoryInMB: optionalInt(draft.minimumMemoryInMB),
    minimumNumberOfProcessors: optionalInt(draft.minimumNumberOfProcessors),
    minimumCpuSpeedInMHz: optionalInt(draft.minimumCpuSpeedInMHz),
    detectionRules: draft.detectionRules,
    updateIcon,
    iconValue: draft.iconValue,
  };
}
