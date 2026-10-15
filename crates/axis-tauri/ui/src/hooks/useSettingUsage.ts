import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchSettingUsageIndex,
  type SettingUsage,
  type SettingUsageIndex,
  type SettingUsagePolicy,
} from "../lib/tauri";

/**
 * Tenant-wide "where used" index for Settings Catalog settings.
 *
 * The index walks every configurationPolicy, so it is read once and shared by
 * every caller (explorer, add-settings drawer) until `refresh()` or a different
 * `tenantKey` asks for a new read.
 */

type CacheEntry = { tenantKey: string; index: SettingUsageIndex; loadedAt: number };

let cache: CacheEntry | null = null;
let inflight: { tenantKey: string; promise: Promise<CacheEntry> } | null = null;

function load(tenantKey: string, force: boolean): Promise<CacheEntry> {
  if (!force && cache?.tenantKey === tenantKey) return Promise.resolve(cache);
  if (!force && inflight?.tenantKey === tenantKey) return inflight.promise;
  const promise = fetchSettingUsageIndex().then((response) => {
    if (!response.index) throw new Error(response.error ?? "Setting usage could not be read.");
    const entry = { tenantKey, index: response.index, loadedAt: Date.now() };
    cache = entry;
    return entry;
  });
  inflight = { tenantKey, promise };
  void promise.finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  return promise;
}

export type SettingUsageLookup = {
  /** Definition id → every policy that sets it. */
  byDefinition: ReadonlyMap<string, SettingUsage>;
  policiesById: ReadonlyMap<string, SettingUsagePolicy>;
  index: SettingUsageIndex | null;
  loadedAt: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useSettingUsage(tenantKey = "current", enabled = true): SettingUsageLookup {
  const [entry, setEntry] = useState<CacheEntry | null>(() =>
    cache?.tenantKey === tenantKey ? cache : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (force: boolean) => {
      setLoading(true);
      setError(null);
      load(tenantKey, force)
        .then(setEntry)
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    },
    [tenantKey],
  );

  useEffect(() => {
    if (!enabled) return;
    if (cache?.tenantKey === tenantKey) {
      setEntry(cache);
      return;
    }
    run(false);
  }, [enabled, tenantKey, run]);

  const byDefinition = useMemo(
    () => new Map((entry?.index.settings ?? []).map((usage) => [usage.definitionId, usage])),
    [entry],
  );
  const policiesById = useMemo(
    () => new Map((entry?.index.policies ?? []).map((policy) => [policy.id, policy])),
    [entry],
  );

  return {
    byDefinition,
    policiesById,
    index: entry?.index ?? null,
    loadedAt: entry?.loadedAt ?? null,
    loading,
    error,
    refresh: () => run(true),
  };
}

/** Short usage label for list rows: "Unused", "1 policy", "3 policies · conflict". */
export function settingUsageLabel(usage: SettingUsage | undefined): string {
  const count = usage?.usages.length ?? 0;
  if (count === 0) return "Unused";
  const base = `${count} ${count === 1 ? "policy" : "policies"}`;
  return usage?.conflict ? `${base} · conflict` : base;
}
