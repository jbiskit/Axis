import type { RestorePlanItem } from "../../types/clientContainer";
import type { BaselineReferenceSourceInput } from "../../types/inventory";
import { isLocalSource } from "../../lib/baselines/sources";

/**
 * Drift buckets for a pack item compared with the tenant. The plan runs in
 * Add mode, so `willAdd` means missing and `settingsDiffer` means present
 * with different settings.
 */
export type DriftStatus = "missing" | "differs" | "match" | "present" | "unsupported";

export const DRIFT_ORDER: DriftStatus[] = ["differs", "missing", "match", "present", "unsupported"];

export const DRIFT_LABELS: Record<DriftStatus, string> = {
  differs: "Differs",
  missing: "Not in tenant",
  match: "Matches",
  present: "In tenant",
  unsupported: "Not comparable",
};

export function driftStatus(item: RestorePlanItem): DriftStatus {
  switch (item.status) {
    case "willAdd":
    case "skipMissing":
      return "missing";
    case "settingsDiffer":
    case "willUpdate":
      return "differs";
    case "identical":
      return "match";
    case "skipExists":
      return "present";
    default:
      return "unsupported";
  }
}

export type DriftCounts = Record<DriftStatus, number>;

export function driftCounts(items: RestorePlanItem[]): DriftCounts {
  const counts: DriftCounts = { missing: 0, differs: 0, match: 0, present: 0, unsupported: 0 };
  for (const item of items) counts[driftStatus(item)] += 1;
  return counts;
}

/** Last compare per pack (and kit) this session, so gallery cards can show coverage. */
const compareCache = new Map<string, { counts: DriftCounts; at: number }>();

export function compareCacheKey(sourceId: string, kitRelPath?: string | null): string {
  return kitRelPath ? `${sourceId}::${kitRelPath}` : sourceId;
}

export function rememberCompare(key: string, items: RestorePlanItem[]) {
  compareCache.set(key, { counts: driftCounts(items), at: Date.now() });
}

export function cachedCompare(key: string) {
  return compareCache.get(key) ?? null;
}

/** Only local folders can be compared or applied; GitHub packs are browse-only. */
export function canCompareSource(source: BaselineReferenceSourceInput): boolean {
  return isLocalSource(source) && Boolean(source.localPath?.trim());
}

/** Folder the planner reads for a local pack; flat packs may point at a subfolder. */
export function localPackRoot(source: BaselineReferenceSourceInput): string {
  const base = (source.localPath ?? "").trim().replace(/[\\/]+$/, "");
  const sub = (source.path ?? "").trim().replace(/^[\\/]+|[\\/]+$/g, "");
  return sub ? `${base}/${sub}` : base;
}

export function sameLocalPath(a: string, b: string): boolean {
  const norm = (value: string) => value.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  return norm(a) === norm(b);
}
