import { getVersion } from "@tauri-apps/api/app";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyUpdateAndRelaunch, checkForUpdate, downloadUpdate } from "../lib/tauri";
import { loadAutoCheckForUpdates, saveAutoCheckForUpdates } from "../lib/updaterPrefs";
import type { UpdateCheck, UpdateDownloadProgress } from "../types/updater";

export type UpdaterPhase = "idle" | "available" | "downloading" | "ready";

let launchCheckStarted = false;

function errorMessage(err: unknown, fallback: string) {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export function useUpdater(enabled: boolean) {
  const [phase, setPhase] = useState<UpdaterPhase>("idle");
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [progress, setProgress] = useState<UpdateDownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [autoCheck, setAutoCheckState] = useState(loadAutoCheckForUpdates);
  const autoCheckRef = useRef(autoCheck);
  autoCheckRef.current = autoCheck;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void getVersion()
      .then((version) => {
        if (!cancelled) setAppVersion(version);
      })
      .catch(() => {
        if (!cancelled) setAppVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

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

  const applyCheckResult = useCallback((result: UpdateCheck, quiet: boolean) => {
    if (result.currentVersion) setAppVersion(result.currentVersion);
    if (result.available && result.version) {
      setUpdate(result);
      setPhase(result.downloaded ? "ready" : "available");
      setStatus(null);
      return;
    }
    setUpdate(result);
    if (!quiet) {
      setStatus(
        result.version
          ? `You're on the latest version (${result.currentVersion}).`
          : "You're on the latest version.",
      );
    }
  }, []);

  const runCheck = useCallback(
    async (quiet: boolean) => {
      setChecking(true);
      if (!quiet) setStatus(null);
      try {
        const result = await checkForUpdate();
        applyCheckResult(result, quiet);
      } catch (err) {
        if (!quiet) setStatus(errorMessage(err, "Could not check for updates."));
      } finally {
        setChecking(false);
      }
    },
    [applyCheckResult],
  );

  useEffect(() => {
    if (!enabled || !autoCheck || launchCheckStarted) return;
    launchCheckStarted = true;
    void runCheck(true);
  }, [autoCheck, enabled, runCheck]);

  const setAutoCheck = useCallback((value: boolean) => {
    const wasOff = !autoCheckRef.current;
    autoCheckRef.current = value;
    setAutoCheckState(value);
    saveAutoCheckForUpdates(value);
    if (enabled && value && wasOff) {
      launchCheckStarted = true;
      void runCheck(true);
    }
  }, [enabled, runCheck]);

  const checkNow = useCallback(() => runCheck(false), [runCheck]);

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
      setError(errorMessage(err, "Download failed."));
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
      setError(errorMessage(err, "Could not relaunch Axis."));
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
      checking,
      status,
      appVersion,
      autoCheck,
      setAutoCheck,
      checkNow,
      dismiss,
      startDownload,
      relaunch,
    }),
    [
      appVersion,
      autoCheck,
      busy,
      checkNow,
      checking,
      dismiss,
      error,
      phase,
      progress,
      relaunch,
      setAutoCheck,
      startDownload,
      status,
      update,
    ],
  );
}
