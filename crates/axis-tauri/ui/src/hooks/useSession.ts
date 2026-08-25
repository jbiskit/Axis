import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeviceCodePrompt, GlanceResponse, TenantGlance } from "../types/glance";
import {
  deviceLoginCancel,
  deviceLoginPoll,
  deviceLoginStart,
  deviceSessionStatus,
  fetchGlance,
  openExternalUrl,
  refreshGlance,
  signOut,
} from "../lib/tauri";
import { loadLastExtraScopes, saveLastExtraScopes } from "../lib/loginPrefs";
import { isPopoutRoute } from "../lib/popout";
import { parseHash } from "../lib/route";

function currentIsPopout() {
  return typeof window !== "undefined" && isPopoutRoute(parseHash().pathname);
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useSession() {
  const [signedIn, setSignedIn] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<DeviceCodePrompt | null>(null);
  const [glance, setGlance] = useState<TenantGlance | null>(null);
  const [glanceLoading, setGlanceLoading] = useState(false);
  const [glanceError, setGlanceError] = useState<string | null>(null);
  const loginGeneration = useRef(0);

  const applyGlanceResponse = useCallback((response: GlanceResponse) => {
    setGlance(response.glance);
    setGlanceError(response.error);
  }, []);

  const loadGlance = useCallback(async () => {
    setGlanceLoading(true);
    try {
      applyGlanceResponse(await fetchGlance());
    } catch (error) {
      setGlanceError(error instanceof Error ? error.message : "Failed to load tenant data");
    } finally {
      setGlanceLoading(false);
    }
  }, [applyGlanceResponse]);

  const reloadGlance = useCallback(async () => {
    setGlanceLoading(true);
    try {
      applyGlanceResponse(await refreshGlance());
    } catch (error) {
      setGlanceError(error instanceof Error ? error.message : "Failed to refresh tenant data");
    } finally {
      setGlanceLoading(false);
    }
  }, [applyGlanceResponse]);

  useEffect(() => {
    void (async () => {
      try {
        const status = await deviceSessionStatus();
        setSignedIn(status.signedIn);
        setAccountName(status.accountName);
        if (status.signedIn && !currentIsPopout()) {
          await loadGlance();
        }
      } catch {
        /* browser-only preview */
      } finally {
        setRestoring(false);
      }
    })();
  }, [loadGlance]);

  const cancelLogin = useCallback(async () => {
    loginGeneration.current += 1;
    const flowId = deviceCode?.flowId;
    setDeviceCode(null);
    if (flowId) {
      await deviceLoginCancel(flowId).catch(() => undefined);
    }
  }, [deviceCode]);

  const login = useCallback(
    async (extraScopes?: string) => {
      const generation = ++loginGeneration.current;
      const extras = extraScopes ?? loadLastExtraScopes();
      if (extraScopes !== undefined) {
        saveLastExtraScopes(extraScopes);
      }
      const start = await deviceLoginStart(extras);
      if (generation !== loginGeneration.current) return;
      setDeviceCode(start);
      await openExternalUrl(start.verificationUri);

      const deadline = Date.now() + start.expiresInSeconds * 1000;
      try {
        while (Date.now() < deadline) {
          if (generation !== loginGeneration.current) return;
          await delay(start.intervalSeconds * 1000);
          if (generation !== loginGeneration.current) return;
          const result = await deviceLoginPoll(start.flowId);
          if (generation !== loginGeneration.current) return;
          if (result.status === "signedIn") {
            setSignedIn(true);
            setAccountName(result.accountName ?? null);
            await loadGlance();
            return;
          }
          if (result.status === "failed") {
            throw new Error(result.error);
          }
        }
        throw new Error("Sign-in timed out. Try again.");
      } finally {
        if (generation === loginGeneration.current) {
          setDeviceCode(null);
        }
      }
    },
    [loadGlance],
  );

  const logout = useCallback(async () => {
    loginGeneration.current += 1;
    setDeviceCode(null);
    await signOut();
    setSignedIn(false);
    setAccountName(null);
    setGlance(null);
    setGlanceError(null);
  }, []);

  return useMemo(
    () => ({
      signedIn,
      restoring,
      accountName,
      deviceCode,
      glance,
      glanceLoading,
      glanceError,
      login,
      logout,
      cancelLogin,
      reloadGlance,
    }),
    [
      accountName,
      cancelLogin,
      deviceCode,
      glance,
      glanceError,
      glanceLoading,
      login,
      logout,
      reloadGlance,
      restoring,
      signedIn,
    ],
  );
}
