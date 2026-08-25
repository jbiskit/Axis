import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { applyUpdateAndRelaunch, checkForUpdate, downloadUpdate } from "../lib/tauri";
import type { UpdateCheck, UpdateDownloadProgress } from "../types/updater";

export type UpdaterPhase = "idle" | "available" | "downloading" | "ready";

let launchCheckStarted = false;

export function useUpdater(enabled: boolean) {
  const [phase, setPhase] = useState<UpdaterPhase>("idle");
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [progress, setProgress] = useState<UpdateDownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    void listen<UpdateDownloadProgress>("axis-updater-progress", (event) => {
      if (!cancelled) setProgress(event.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || launchCheckStarted) return;
    launchCheckStarted = true;
    void (async () => {
      try {
        const result = await checkForUpdate();
        if (!result.available || !result.version) return;
        setUpdate(result);
        setPhase(result.downloaded ? "ready" : "available");
      } catch {
        /* offline or no release yet — stay quiet on launch */
      }
    })();
  }, [enabled]);

  const dismiss = useCallback(() => {
    setPhase("idle");
    setError(null);
    setBusy(false);
  }, []);

  const startDownload = useCallback(async () => {
    setBusy(true);
    setError(null);
    setPhase("downloading");
    setProgress({ downloaded: 0, total: null });
    try {
      const result = await downloadUpdate();
      setUpdate(result);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
      setPhase("available");
    } finally {
      setBusy(false);
    }
  }, []);

  const relaunch = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await applyUpdateAndRelaunch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not relaunch Axis.");
      setBusy(false);
    }
  }, []);

  return useMemo(
    () => ({
      phase,
      update,
      progress,
      error,
      busy,
      dismiss,
      startDownload,
      relaunch,
    }),
    [busy, dismiss, error, phase, progress, relaunch, startDownload, update],
  );
}
