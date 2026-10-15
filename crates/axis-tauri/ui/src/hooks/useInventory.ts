import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InventoryResponse } from "../types/inventory";

/** Loaded inventories stay fresh for an hour before a revisit refetches them. */
export const INVENTORY_TTL_MS = 60 * 60 * 1000;

type CacheEntry = {
  items: unknown[];
  truncated: boolean;
  fetchedAt: string | null;
  error: string | null;
  loadedAt: number;
};

/**
 * Module-level cache so an inventory survives unmount/remount — the workspace
 * mounts and unmounts each view as you navigate, and refetching every list on
 * every visit is wasteful. Keyed by the loader function identity, which is a
 * stable `useCallback` per inventory.
 */
const cache = new Map<() => Promise<InventoryResponse<unknown>>, CacheEntry>();

/** Drops every cached inventory. Called on sign-out so a new tenant starts clean. */
export function clearInventoryCache(): void {
  cache.clear();
}

function isFresh(entry: CacheEntry, now: number): boolean {
  return now - entry.loadedAt < INVENTORY_TTL_MS;
}

export function useInventory<T>(
  loader: () => Promise<InventoryResponse<T>>,
  enabled: boolean,
  signedIn: boolean,
) {
  const key = loader as () => Promise<InventoryResponse<unknown>>;
  const cached = cache.get(key);
  const [items, setItems] = useState<T[]>(() => (cached?.items as T[]) ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(cached?.error ?? null);
  const [truncated, setTruncated] = useState(cached?.truncated ?? false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(cached?.fetchedAt ?? null);
  const loadGen = useRef(0);

  const load = useCallback(
    async (force = false) => {
      const existing = cache.get(key);
      if (!force && existing && isFresh(existing, Date.now())) {
        setItems(existing.items as T[]);
        setTruncated(existing.truncated);
        setFetchedAt(existing.fetchedAt);
        setError(existing.error);
        return;
      }
      const gen = ++loadGen.current;
      setLoading(true);
      try {
        const response = await loader();
        if (gen !== loadGen.current) return;
        const entry: CacheEntry = {
          items: response.list.items,
          truncated: response.list.truncated,
          fetchedAt: response.list.fetchedAt,
          error: response.error,
          loadedAt: Date.now(),
        };
        cache.set(key, entry);
        setItems(response.list.items);
        setTruncated(response.list.truncated);
        setFetchedAt(response.list.fetchedAt);
        setError(response.error);
      } catch (err) {
        if (gen !== loadGen.current) return;
        const message = err instanceof Error ? err.message : "Failed to load inventory";
        cache.set(key, {
          items: [],
          truncated: false,
          fetchedAt: null,
          error: message,
          loadedAt: Date.now(),
        });
        setError(message);
        setItems([]);
      } finally {
        if (gen === loadGen.current) setLoading(false);
      }
    },
    [key, loader],
  );

  useEffect(() => {
    if (!signedIn) {
      setItems([]);
      setError(null);
    }
  }, [signedIn]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  return useMemo(
    () => ({
      items,
      loading,
      error,
      truncated,
      fetchedAt,
      reload: () => load(true),
    }),
    [error, fetchedAt, items, load, loading, truncated],
  );
}
