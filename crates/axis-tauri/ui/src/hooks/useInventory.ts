import { useCallback, useEffect, useMemo, useState } from "react";
import type { InventoryResponse } from "../types/inventory";

export function useInventory<T>(
  loader: () => Promise<InventoryResponse<T>>,
  enabled: boolean,
  signedIn: boolean,
) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await loader();
      setItems(response.list.items);
      setTruncated(response.list.truncated);
      setFetchedAt(response.list.fetchedAt);
      setError(response.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [loader]);

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
    () => ({ items, loading, error, truncated, fetchedAt, reload: load }),
    [error, fetchedAt, items, load, loading, truncated],
  );
}
