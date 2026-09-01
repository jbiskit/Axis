import type { CatalogPolicySummary, MobileAppSummary } from "../types/inventory";
import {
  INTUNE_PLATFORM_LABELS,
  INTUNE_PLATFORM_SLUGS,
  isIntunePlatform,
  matchesIntunePlatform,
} from "./platforms";

/** Client-side list filter: substring match across concatenated fields. */
export function matchesListQuery(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle);
}

export function assignedSearchToken(isAssigned?: boolean | null): string {
  return isAssigned ? "yes assigned" : "no unassigned";
}

export type AssignedFilter = "all" | "assigned" | "unassigned";

export type ListFilterOption = { value: string; label: string };

export function matchesAssignedFilter(
  isAssigned: boolean | null | undefined,
  filter: AssignedFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "assigned") return isAssigned === true;
  return isAssigned !== true;
}

export function policyPlatformHaystack(item: {
  platforms?: string | null;
  odataType?: string | null;
}): string {
  return `${item.platforms ?? ""} ${item.odataType ?? ""}`;
}

export function matchesPlatformFilter(haystack: string | null | undefined, filter: string): boolean {
  if (!filter || filter === "all") return true;
  if (isIntunePlatform(filter)) return matchesIntunePlatform(haystack, filter);
  return (haystack ?? "").toLowerCase().includes(filter.toLowerCase());
}

export function usualPlatformFilterOptions(): ListFilterOption[] {
  return [
    { value: "all", label: "All" },
    ...INTUNE_PLATFORM_SLUGS.map((slug) => ({
      value: slug,
      label: INTUNE_PLATFORM_LABELS[slug],
    })),
  ];
}

/** All + Windows/macOS/iOS/Android, plus any loaded platform strings that are not those four. */
export function platformFilterOptionsFromList(
  platforms: Iterable<string | null | undefined>,
): ListFilterOption[] {
  const options = usualPlatformFilterOptions();
  const seen = new Set(options.map((option) => option.value.toLowerCase()));
  for (const raw of platforms) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    if (INTUNE_PLATFORM_SLUGS.some((slug) => matchesIntunePlatform(value, slug))) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ value: key, label: value });
  }
  return options;
}

export function matchesCatalogPolicyQuery(item: CatalogPolicySummary, query: string): boolean {
  return matchesListQuery(
    `${item.name} ${item.description ?? ""} ${item.platforms ?? ""} ${item.templateFamily ?? ""} ${assignedSearchToken(item.isAssigned)}`,
    query,
  );
}

export function matchesCatalogPolicyFilters(
  item: CatalogPolicySummary,
  query: string,
  assigned: AssignedFilter,
  platform: string,
): boolean {
  return (
    matchesAssignedFilter(item.isAssigned, assigned) &&
    matchesPlatformFilter(policyPlatformHaystack(item), platform) &&
    matchesCatalogPolicyQuery(item, query)
  );
}

export function matchesAppQuery(item: MobileAppSummary, query: string): boolean {
  return matchesListQuery(
    `${item.displayName} ${item.publisher ?? ""} ${item.displayVersion ?? ""} ${item.kind ?? ""} ${item.appKind ?? ""} ${item.platform ?? ""} ${item.appTypeLabel ?? ""} ${assignedSearchToken(item.isAssigned)}`,
    query,
  );
}

export function matchesAppFilters(
  item: MobileAppSummary,
  query: string,
  assigned: AssignedFilter,
): boolean {
  return matchesAssignedFilter(item.isAssigned, assigned) && matchesAppQuery(item, query);
}

/** Add every id from the current filtered result set into the selection. */
export function selectAllFilteredIds(
  current: ReadonlySet<string>,
  filteredIds: Iterable<string>,
): Set<string> {
  const next = new Set(current);
  for (const id of filteredIds) next.add(id);
  return next;
}

export function clearSelectionIds(): Set<string> {
  return new Set();
}

export function allFilteredAreSelected(
  checkedIds: ReadonlySet<string>,
  filteredIds: Iterable<string>,
): boolean {
  let any = false;
  for (const id of filteredIds) {
    any = true;
    if (!checkedIds.has(id)) return false;
  }
  return any;
}

export function toggleSelectionId(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function pruneSelectionIds(
  current: ReadonlySet<string>,
  visibleIds: Iterable<string>,
): Set<string> {
  const allowed = new Set(visibleIds);
  const next = new Set<string>();
  for (const id of current) {
    if (allowed.has(id)) next.add(id);
  }
  return next;
}

export type SortDir = "asc" | "desc";

export type ColumnSort<K extends string> = { key: K; dir: SortDir };

export function compareText(a?: string | null, b?: string | null): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { numeric: true, sensitivity: "base" });
}

export function compareNumber(a?: number | null, b?: number | null): number {
  const av = a ?? Number.NEGATIVE_INFINITY;
  const bv = b ?? Number.NEGATIVE_INFINITY;
  return av === bv ? 0 : av < bv ? -1 : 1;
}

export function compareIso(a?: string | null, b?: string | null): number {
  const av = a ? Date.parse(a) : Number.NEGATIVE_INFINITY;
  const bv = b ? Date.parse(b) : Number.NEGATIVE_INFINITY;
  const left = Number.isNaN(av) ? Number.NEGATIVE_INFINITY : av;
  const right = Number.isNaN(bv) ? Number.NEGATIVE_INFINITY : bv;
  return left === right ? 0 : left < right ? -1 : 1;
}

export function compareBool(a?: boolean | null, b?: boolean | null): number {
  return Number(a === true) - Number(b === true);
}

export function sortRows<T>(
  rows: readonly T[],
  dir: SortDir,
  compare: (a: T, b: T) => number,
): T[] {
  return [...rows].sort((a, b) => {
    const n = compare(a, b);
    return dir === "asc" ? n : -n;
  });
}

export type CatalogPolicySortKey =
  | "name"
  | "platform"
  | "settings"
  | "assigned"
  | "family"
  | "modified";

export function compareCatalogPolicy(
  a: CatalogPolicySummary,
  b: CatalogPolicySummary,
  key: CatalogPolicySortKey,
): number {
  switch (key) {
    case "name":
      return compareText(a.name, b.name) || compareText(a.id, b.id);
    case "platform":
      return compareText(a.platforms, b.platforms) || compareText(a.name, b.name);
    case "settings":
      return compareNumber(a.settingCount, b.settingCount) || compareText(a.name, b.name);
    case "assigned":
      return compareBool(a.isAssigned, b.isAssigned) || compareText(a.name, b.name);
    case "family":
      return compareText(a.templateFamily ?? "none", b.templateFamily ?? "none") || compareText(a.name, b.name);
    case "modified":
      return compareIso(a.lastModifiedDateTime, b.lastModifiedDateTime) || compareText(a.name, b.name);
  }
}
