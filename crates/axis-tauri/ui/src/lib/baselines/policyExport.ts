import { humanizeSettingToken } from "../catalogSettingDisplay";
import type { Baseline, BaselineCheck } from "./schema";
import { asRecord, leavesFromSettingRows } from "./settingLeaves";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function shortTitle(definitionId: string, displayName?: string): string {
  if (displayName?.trim()) return displayName.trim();
  const parts = definitionId.split("_").filter(Boolean);
  return humanizeSettingToken(parts.slice(-4).join(" ") || definitionId);
}

function hasSettingInstanceRow(value: unknown): boolean {
  const row = asRecord(value);
  if (!row) return false;
  const instance = asRecord(row.settingInstance);
  return Boolean(instance && typeof instance.settingDefinitionId === "string");
}

function isSettingsRowArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.some(hasSettingInstanceRow);
}

function looksLikeFullPolicy(value: unknown): boolean {
  const row = asRecord(value);
  return Boolean(row && isSettingsRowArray(row.settings));
}

export function looksLikeAxisBaselineSelection(raw: unknown): boolean {
  const row = asRecord(raw);
  return Boolean(row && Array.isArray(row.includes));
}

export function looksLikeAxisBaseline(raw: unknown): boolean {
  const row = asRecord(raw);
  return Boolean(row && (Array.isArray(row.checks) || Array.isArray(row.includes)));
}

export function baselineIncludePaths(raw: unknown): string[] {
  const row = asRecord(raw);
  if (!row || !Array.isArray(row.includes)) return [];
  return row.includes
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/\\/g, "/").trim())
    .filter(Boolean);
}

export function normalizeIntunePolicyExport(raw: unknown, fileLabel?: string): Record<string, unknown> {
  const where = fileLabel ? ` (${fileLabel})` : "";
  if (Array.isArray(raw)) {
    if (isSettingsRowArray(raw)) return { settings: raw };
    if (raw.length === 1 && looksLikeFullPolicy(raw[0])) {
      return normalizeIntunePolicyExport(raw[0], fileLabel);
    }
    throw new Error(`Unrecognized Intune export${where}: expected one configuration policy per file.`);
  }
  const row = asRecord(raw);
  if (!row) throw new Error(`Unrecognized Intune export${where}: root must be JSON.`);
  if (isSettingsRowArray(row.settings)) return row;
  if (isSettingsRowArray(row.value)) {
    return { ...row, settings: row.value };
  }
  if (Array.isArray(row.value) && row.value.length === 1 && looksLikeFullPolicy(row.value[0])) {
    return normalizeIntunePolicyExport(row.value[0], fileLabel);
  }
  throw new Error(
    `Unrecognized Intune export${where}: expected a configurationPolicy object or settings array.`,
  );
}

export function policyExportToBaseline(
  fileName: string,
  raw: unknown,
  options?: { idPrefix?: string; source?: Baseline["source"]; version?: string; originLabel?: string },
): Baseline {
  if (looksLikeAxisBaseline(raw) && !looksLikeAxisBaselineSelection(raw)) {
    const row = asRecord(raw)!;
    return {
      id: typeof row.id === "string" ? row.id : slugify(fileName),
      name: typeof row.name === "string" ? row.name : fileName,
      description: typeof row.description === "string" ? row.description : "",
      version: typeof row.version === "string" ? row.version : options?.version ?? "custom",
      source: options?.source ?? "custom",
      checks: Array.isArray(row.checks) ? (row.checks as BaselineCheck[]) : [],
    };
  }

  const policy = normalizeIntunePolicyExport(raw, fileName);
  const settings = Array.isArray(policy.settings) ? policy.settings : [];
  const byId = new Map<string, ReturnType<typeof leavesFromSettingRows>[number]>();
  for (const leaf of leavesFromSettingRows(settings)) {
    byId.set(leaf.definitionId, leaf);
  }

  const idPrefix = options?.idPrefix ?? "asd";
  const originLabel = options?.originLabel ?? "ASD Blueprint";
  const policyName =
    (typeof policy.name === "string" && policy.name.trim()) ||
    (typeof policy.displayName === "string" && policy.displayName.trim()) ||
    fileName.replace(/\.(txt|json)$/i, "");
  const stem = fileName.replace(/\.(txt|json)$/i, "");

  const checks: BaselineCheck[] = [...byId.entries()].map(([definitionId, leaf], index) => {
    if (leaf.presentOnly) {
      return {
        id: `${slugify(stem)}-${index + 1}`,
        title: shortTitle(definitionId, leaf.displayName),
        description: `${originLabel}: setting must be configured`,
        category: policyName,
        type: "settingPresent",
        target: definitionId,
      };
    }
    return {
      id: `${slugify(stem)}-${index + 1}`,
      title: shortTitle(definitionId, leaf.displayName),
      description: `${originLabel} export expectation`,
      category: policyName,
      type: "settingEquals",
      target: definitionId,
      expected: leaf.valueSummary,
      expectedRaw: leaf.rawValue,
    };
  });

  if (checks.length === 0) {
    throw new Error(
      `Intune export “${policyName}” has no comparable leaf setting values (simple/choice/collection).`,
    );
  }

  return {
    id: `${idPrefix}-${slugify(stem)}`,
    name: policyName,
    description:
      (typeof policy.description === "string" && policy.description.trim()) ||
      `Intune Settings Catalog export (${fileName}).`,
    version: options?.version ?? "asd-blueprint-main",
    source: options?.source ?? "asd",
    checks,
  };
}
