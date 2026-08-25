import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchManagedDevices } from "../lib/tauri";
import type { ManagedDeviceSummary } from "../types/glance";

export function useDevices(enabled: boolean, signedIn: boolean) {
  const [devices, setDevices] = useState<ManagedDeviceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchManagedDevices();
      setDevices(response.list.devices);
      setTruncated(response.list.truncated);
      setFetchedAt(response.list.fetchedAt);
      setError(response.error);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load managed devices");
      setDevices([]);
      setTruncated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setLoaded(false);
      setDevices([]);
      setError(null);
      setTruncated(false);
      setFetchedAt(null);
    }
  }, [signedIn]);

  useEffect(() => {
    if (enabled && !loaded) {
      void load();
    }
  }, [enabled, loaded, load]);

  return useMemo(
    () => ({
      devices,
      loading,
      error,
      truncated,
      fetchedAt,
      reload: load,
    }),
    [devices, error, fetchedAt, load, loading, truncated],
  );
}
