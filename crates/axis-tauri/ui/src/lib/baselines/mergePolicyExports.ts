import { formatCatalogSettingRows, humanizeSettingToken } from "../catalogSettingDisplay";
import { asRecord } from "./settingLeaves";

/** Volatile Graph export fields ignored when comparing setting values. */
const VOLATILE_KEYS = new Set([
  "id",
  "settingDefinitions",
  "settingDefinition",
  "settingInstanceTemplateReference",
  "settingValueTemplateReference",
  "auditRuleInformation",
  "@odata.context",
  "createdDateTime",
  "lastModifiedDateTime",
  "priorityMetaData",
  "creationSource",
]);

export type MergeSourcePolicy = {
  /** Stable selection / row key (e.g. `ref:sourceId:id`). */
  key: string;
  name: string;
  platform: "windows" | "macos";
  technologies?: string;
  templateFamily?: string;
  description?: string;
  /** Catalog setting rows (`settingInstance` present), as from `catalogSettingsFromPolicy`. */
  settings: Record<string, unknown>[];
};

export type MergeConflictSource = {
  sourceKey: string;
  sourceName: string;
  setting: Record<string, unknown>;
  valueSummary: string;
  fingerprint: string;
};

export type MergeConflict = {
  /** `settingInstance.settingDefinitionId` */
  settingKey: string;
  displayName: string;
  sources: MergeConflictSource[];
  /** Default winner: first selected policy that contributed this setting. */
  defaultSourceKey: string;
};

export type MergePlanOk = {
  ok: true;
  platform: "windows" | "macos";
  defaultName: string;
  description: string;
  /** Settings present in only one policy, or identical across all that have them. */
  agreedSettings: Record<string, unknown>[];
  conflicts: MergeConflict[];
  /** Count of distinct settingDefinitionIds across the union. */
  uniqueSettingCount: number;
  sourceCount: number;
};

export type MergePlanErr = {
  ok: false;
  error: string;
};

export type MergePlan = MergePlanOk | MergePlanErr;

export function settingDefinitionIdFromRow(row: Record<string, unknown>): string | null {
  const instance = asRecord(row.settingInstance) ?? row;
  const id = instance.settingDefinitionId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = asRecord(value);
  if (!record) return value;
  const out: Record<string, unknown> = {};
  const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    if (VOLATILE_KEYS.has(key)) continue;
    const next = canonicalize(record[key]);
    if (next === null || next === undefined) continue;
    out[key] = next;
  }
  return out;
}

/** Stable fingerprint of a setting row’s value payload (ignores volatile metadata). */
export function settingValueFingerprint(row: Record<string, unknown>): string {
  const instance = asRecord(row.settingInstance) ?? row;
  return JSON.stringify(canonicalize(instance));
}

export function settingDisplayLabel(row: Record<string, unknown>, settingKey: string): string {
  const formatted = formatCatalogSettingRows([row])[0];
  if (formatted?.displayName?.trim()) return formatted.displayName.trim();
  return humanizeSettingToken(settingKey);
}

export function settingValueSummary(row: Record<string, unknown>): string {
  const formatted = formatCatalogSettingRows([row])[0];
  return formatted?.valueSummary?.trim() || "Configured";
}

function templateFamilyOf(policy: MergeSourcePolicy): string {
  return (policy.templateFamily ?? "none").trim().toLowerCase() || "none";
}

function assertCompatibleSources(sources: MergeSourcePolicy[]): string | null {
  if (sources.length < 2) {
    return "Select at least two Settings Catalog policies to merge.";
  }
  for (const source of sources) {
    if (!source.settings.length) {
      return `“${source.name}” has no Settings Catalog instances.`;
    }
    const family = templateFamilyOf(source);
    if (family !== "none") {
      return `Cannot merge “${source.name}”: template family “${family}” is not a plain Settings Catalog policy (create path is catalog/mdm only).`;
    }
    const tech = (source.technologies ?? "mdm").toLowerCase();
    if (tech.includes("endpointsecurity") && !tech.split(/[,\s]+/).includes("mdm")) {
      return `Cannot merge “${source.name}”: technologies “${source.technologies}” are not Settings Catalog (mdm).`;
    }
  }
  const platform = sources[0].platform;
  const mismatch = sources.find((source) => source.platform !== platform);
  if (mismatch) {
    return `Cannot merge policies across platforms (${platform} vs ${mismatch.platform}). Select policies for one platform.`;
  }
  return null;
}

export function defaultMergedPolicyName(sourceNames: string[]): string {
  const first = sourceNames[0]?.trim() || "policy";
  const extra = Math.max(0, sourceNames.length - 1);
  return extra > 0 ? `Merged — ${first} +${extra}` : `Merged — ${first}`;
}

/**
 * Build a merge plan: union non-conflicting settings; list conflicts keyed by
 * `settingInstance.settingDefinitionId` when fingerprints differ.
 */
export function planPolicyMerge(sources: MergeSourcePolicy[]): MergePlan {
  const compatibilityError = assertCompatibleSources(sources);
  if (compatibilityError) return { ok: false, error: compatibilityError };

  type Entry = {
    sourceKey: string;
    sourceName: string;
    setting: Record<string, unknown>;
    fingerprint: string;
  };

  const byKey = new Map<string, Entry[]>();

  for (const source of sources) {
    const seenInSource = new Set<string>();
    for (const setting of source.settings) {
      const settingKey = settingDefinitionIdFromRow(setting);
      if (!settingKey) continue;
      if (seenInSource.has(settingKey)) continue;
      seenInSource.add(settingKey);
      const entry: Entry = {
        sourceKey: source.key,
        sourceName: source.name,
        setting,
        fingerprint: settingValueFingerprint(setting),
      };
      const list = byKey.get(settingKey);
      if (list) list.push(entry);
      else byKey.set(settingKey, [entry]);
    }
  }

  const agreedSettings: Record<string, unknown>[] = [];
  const conflicts: MergeConflict[] = [];

  for (const [settingKey, entries] of byKey) {
    const fingerprints = new Set(entries.map((entry) => entry.fingerprint));
    if (fingerprints.size <= 1) {
      agreedSettings.push(entries[0].setting);
      continue;
    }
    conflicts.push({
      settingKey,
      displayName: settingDisplayLabel(entries[0].setting, settingKey),
      sources: entries.map((entry) => ({
        sourceKey: entry.sourceKey,
        sourceName: entry.sourceName,
        setting: entry.setting,
        valueSummary: settingValueSummary(entry.setting),
        fingerprint: entry.fingerprint,
      })),
      defaultSourceKey: entries[0].sourceKey,
    });
  }

  const first = sources[0];
  const descriptionParts = sources
    .map((source) => source.description?.trim())
    .filter((value): value is string => Boolean(value));
  const uniqueDescriptions = [...new Set(descriptionParts)];

  return {
    ok: true,
    platform: first.platform,
    defaultName: defaultMergedPolicyName(sources.map((source) => source.name)),
    description:
      uniqueDescriptions.length === 1
        ? uniqueDescriptions[0]
        : uniqueDescriptions.length > 1
          ? `Merged from ${sources.length} policies.`
          : first.description ?? "",
    agreedSettings,
    conflicts,
    uniqueSettingCount: byKey.size,
    sourceCount: sources.length,
  };
}

/**
 * Resolve conflicts into a final settings array. `resolutions` maps
 * settingDefinitionId → winning source key. Missing keys use each conflict’s default.
 */
export function applyMergeResolutions(
  plan: MergePlanOk,
  resolutions: Record<string, string>,
): Record<string, unknown>[] {
  const merged: Record<string, unknown>[] = [...plan.agreedSettings];
  for (const conflict of plan.conflicts) {
    const winnerKey = resolutions[conflict.settingKey] ?? conflict.defaultSourceKey;
    const winner =
      conflict.sources.find((source) => source.sourceKey === winnerKey) ?? conflict.sources[0];
    if (winner) merged.push(winner.setting);
  }
  return merged;
}

/** True when every conflict has an explicit or default resolution. */
export function allConflictsResolved(
  plan: MergePlanOk,
  resolutions: Record<string, string>,
): boolean {
  return plan.conflicts.every((conflict) => {
    const key = resolutions[conflict.settingKey] ?? conflict.defaultSourceKey;
    return conflict.sources.some((source) => source.sourceKey === key);
  });
}

export function defaultResolutions(plan: MergePlanOk): Record<string, string> {
  const out: Record<string, string> = {};
  for (const conflict of plan.conflicts) {
    out[conflict.settingKey] = conflict.defaultSourceKey;
  }
  return out;
}
