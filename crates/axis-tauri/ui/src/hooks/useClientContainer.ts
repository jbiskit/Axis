import { useCallback, useEffect, useState } from "react";
import type { ClientContainerStatus } from "../types/clientContainer";
import {
  clientContainerClear,
  clientContainerCreate,
  clientContainerExportSnapshot,
  clientContainerPickCreate,
  clientContainerPickOpen,
  clientContainerSnoozeStale,
  clientContainerStatus,
} from "../lib/tauri";

export function useClientContainer(enabled: boolean) {
  const [status, setStatus] = useState<ClientContainerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createPath, setCreatePath] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      setStatus(await clientContainerStatus());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await clientContainerPickOpen();
      if (next) setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const beginCreate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await clientContainerPickCreate();
      if (path) setCreatePath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const finishCreate = useCallback(
    async (name: string, primaryDomain?: string) => {
      if (!createPath) return;
      setBusy(true);
      setError(null);
      try {
        const next = await clientContainerCreate({
          path: createPath,
          name,
          primaryDomain,
        });
        setStatus(next);
        setCreatePath(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [createPath],
  );

  const cancelCreate = useCallback(() => {
    setCreatePath(null);
  }, []);

  const clear = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await clientContainerClear());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const snooze = useCallback(async (days: number) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await clientContainerSnoozeStale(days));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const exportSnapshot = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await clientContainerExportSnapshot();
      setStatus(result.status);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status,
    loading,
    busy,
    error,
    createPath,
    refresh,
    open,
    beginCreate,
    finishCreate,
    cancelCreate,
    clear,
    snooze,
    exportSnapshot,
  };
}
