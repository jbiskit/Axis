import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BrowserSignIn,
  GlanceResponse,
  SessionMode,
  StoredSignIn,
  TenantGlance,
} from "../types/glance";
import {
  browserLoginCancel,
  browserLoginStart,
  browserLoginWait,
  deviceSessionStatus,
  fetchGlance,
  forgetStoredSignIn,
  listStoredSignIns,
  rememberTenantName,
  openExternalUrl,
  refreshGlance,
  signOut,
  useStoredSignIn,
} from "../lib/tauri";
import {
  loadLastExtraScopes,
  saveLastExtraScopes,
  loadLastSessionMode,
  saveLastClientId,
  saveLastSessionMode,
  saveLastSignInApp,
} from "../lib/loginPrefs";
import { clearShellBannerDismissals } from "../lib/readOnly";
import { isPopoutRoute } from "../lib/popout";
import { parseHash } from "../lib/route";

function currentIsPopout() {
  return typeof window !== "undefined" && isPopoutRoute(parseHash().pathname);
}

const GRAPH_COMMAND_LINE_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";

function isGraphSignIn(clientId: string | null | undefined): boolean {
  const value = clientId?.trim();
  return !value || value.toLowerCase() === GRAPH_COMMAND_LINE_CLIENT_ID;
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = left?.trim().toLowerCase();
  const b = right?.trim().toLowerCase();
  return Boolean(a && b && a === b);
}

export function useSession() {
  const [signedIn, setSignedIn] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [mode, setMode] = useState<SessionMode>(() => loadLastSessionMode());
  const [clientId, setClientId] = useState<string | null>(null);
  const [readOnlyScopeExceedsRequest, setReadOnlyScopeExceedsRequest] = useState(false);
  const [exceededWriteScopes, setExceededWriteScopes] = useState<string[]>([]);
  const [browserSignIn, setBrowserSignIn] = useState<BrowserSignIn | null>(null);
  const [storedSignIns, setStoredSignIns] = useState<StoredSignIn[]>([]);
  const [contextSwapTarget, setContextSwapTarget] = useState<SessionMode | null>(null);
  const [missingContextTarget, setMissingContextTarget] = useState<SessionMode | null>(null);
  const [glance, setGlance] = useState<TenantGlance | null>(null);
  const [glanceLoading, setGlanceLoading] = useState(false);
  const [glanceError, setGlanceError] = useState<string | null>(null);
  const loginGeneration = useRef(0);

  const applyGlanceResponse = useCallback((response: GlanceResponse) => {
    setGlance(response.glance);
    setGlanceError(response.error);
  }, []);

  const reloadStoredSignIns = useCallback(async () => {
    try {
      setStoredSignIns(await listStoredSignIns());
    } catch {
      setStoredSignIns([]);
    }
  }, []);

  const loadGlance = useCallback(async () => {
    setGlanceLoading(true);
    try {
      const response = await fetchGlance();
      applyGlanceResponse(response);
      return response;
    } catch (error) {
      setGlanceError(error instanceof Error ? error.message : "Failed to load tenant data");
      return null;
    } finally {
      setGlanceLoading(false);
    }
  }, [applyGlanceResponse]);

  const finishSignIn = useCallback(
    async (accountName: string | null, signedInMode?: SessionMode) => {
      setSignedIn(true);
      setAccountName(accountName);
      if (signedInMode) {
        setMode(signedInMode);
      }
      let tenantId: string | null = null;
      try {
        const status = await deviceSessionStatus();
        setMode(status.mode);
        setReadOnlyScopeExceedsRequest(Boolean(status.readOnlyScopeExceedsRequest));
        setExceededWriteScopes(status.exceededWriteScopes ?? []);
        setClientId(status.clientId ?? null);
        tenantId = status.tenantId;
        if (status.mode === "admin") {
          clearShellBannerDismissals();
        }
      } catch {
        /* browser-only preview */
      }
      const response = await loadGlance();
      const tenantName = response?.glance.organizationName?.trim();
      if (tenantId && tenantName) {
        await rememberTenantName(tenantId, tenantName).catch(() => undefined);
      }
    },
    [loadGlance],
  );

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
        if (status.mode) {
          setMode(status.mode);
        }
        setReadOnlyScopeExceedsRequest(Boolean(status.readOnlyScopeExceedsRequest));
        setExceededWriteScopes(status.exceededWriteScopes ?? []);
        setClientId(status.clientId ?? null);
        if (status.signedIn && !currentIsPopout()) {
          const response = await loadGlance();
          const tenantName = response?.glance.organizationName?.trim();
          if (status.tenantId && tenantName) {
            await rememberTenantName(status.tenantId, tenantName).catch(() => undefined);
          }
        } else if (!status.signedIn) {
          await reloadStoredSignIns();
        }
      } catch {
        /* browser-only preview */
      } finally {
        setRestoring(false);
      }
    })();
  }, [loadGlance, reloadStoredSignIns]);

  const cancelLogin = useCallback(async () => {
    loginGeneration.current += 1;
    const flowId = browserSignIn?.flowId;
    setBrowserSignIn(null);
    setContextSwapTarget(null);
    if (flowId) {
      await browserLoginCancel(flowId).catch(() => undefined);
    }
  }, [browserSignIn]);

  const login = useCallback(
    async (
      requestedMode?: SessionMode,
      extraScopes?: string,
      options?: { deferModeUntilSignedIn?: boolean; clientId?: string | null },
    ) => {
      const generation = ++loginGeneration.current;
      const targetMode = requestedMode ?? loadLastSessionMode();
      saveLastSessionMode(targetMode);
      const requestedClientId = options?.clientId?.trim() || null;
      if (!options?.deferModeUntilSignedIn) {
        if (requestedClientId) {
          saveLastSignInApp("registration");
          saveLastClientId(requestedClientId);
        } else {
          saveLastSignInApp("graph");
        }
      }
      if (options?.deferModeUntilSignedIn) {
        setContextSwapTarget(targetMode);
      } else {
        setContextSwapTarget(null);
        setMode(targetMode);
      }

      const extras = extraScopes ?? loadLastExtraScopes();
      if (extraScopes !== undefined) {
        saveLastExtraScopes(extraScopes);
      }
      const start = await browserLoginStart(targetMode, extras, requestedClientId);
      if (generation !== loginGeneration.current) {
        await browserLoginCancel(start.flowId).catch(() => undefined);
        return;
      }
      setBrowserSignIn(start);
      try {
        await openExternalUrl(start.authorizeUrl);
        const result = await browserLoginWait(start.flowId);
        if (generation !== loginGeneration.current) return;
        if (result.status === "signedIn") {
          await finishSignIn(result.accountName ?? null, result.mode);
          return;
        }
        if (result.status === "failed") {
          throw new Error(result.error);
        }
        throw new Error("Sign-in did not finish. Try again.");
      } finally {
        if (generation === loginGeneration.current) {
          setBrowserSignIn(null);
          setContextSwapTarget(null);
          await browserLoginCancel(start.flowId).catch(() => undefined);
        }
      }
    },
    [finishSignIn],
  );

  const useStored = useCallback(
    async (client: StoredSignIn) => {
      const outcome = await useStoredSignIn(client.clientId);
      if (outcome.status === "signedIn") {
        await finishSignIn(outcome.accountName ?? null, outcome.mode);
        return;
      }
      await login(outcome.mode, outcome.extraScopes.join(" "), {
        clientId: client.graphCommandLine ? null : outcome.clientId,
      });
    },
    [finishSignIn, login],
  );

  const forgetStored = useCallback(
    async (clientId: string) => {
      await forgetStoredSignIn(clientId);
      await reloadStoredSignIns();
    },
    [reloadStoredSignIns],
  );

  const logout = useCallback(async () => {
    loginGeneration.current += 1;
    setBrowserSignIn(null);
    await signOut();
    setSignedIn(false);
    setAccountName(null);
    setGlance(null);
    setGlanceError(null);
    setReadOnlyScopeExceedsRequest(false);
    setExceededWriteScopes([]);
    setClientId(null);
    await reloadStoredSignIns();
  }, [reloadStoredSignIns]);

  const swapContext = useCallback(async () => {
    const targetMode: SessionMode = mode === "read" ? "admin" : "read";
    let currentClient = clientId;
    let tenantId: string | null = null;
    try {
      const status = await deviceSessionStatus();
      currentClient = status.clientId ?? currentClient;
      tenantId = status.tenantId ?? null;
    } catch {
      /* use the client id already on the session */
    }
    if (isGraphSignIn(currentClient)) {
      await login(targetMode, undefined, {
        deferModeUntilSignedIn: true,
        clientId: currentClient,
      });
      return;
    }
    if (!tenantId || !currentClient) {
      setMissingContextTarget(targetMode);
      return;
    }
    let saved: StoredSignIn[] = [];
    try {
      saved = await listStoredSignIns();
      setStoredSignIns(saved);
    } catch {
      setMissingContextTarget(targetMode);
      return;
    }
    const match = saved.find(
      (entry) =>
        !entry.graphCommandLine &&
        entry.mode === targetMode &&
        sameId(entry.tenantId, tenantId) &&
        !sameId(entry.clientId, currentClient),
    );
    if (!match) {
      setMissingContextTarget(targetMode);
      return;
    }
    const outcome = await useStoredSignIn(match.clientId);
    if (outcome.status === "signedIn") {
      await finishSignIn(outcome.accountName ?? null, outcome.mode);
      return;
    }
    await login(outcome.mode, outcome.extraScopes.join(" "), {
      deferModeUntilSignedIn: true,
      clientId: outcome.clientId,
    });
  }, [clientId, finishSignIn, login, mode]);

  const dismissMissingContext = useCallback(() => {
    setMissingContextTarget(null);
  }, []);

  const signInMissingContextWithGraph = useCallback(async () => {
    const targetMode = missingContextTarget;
    setMissingContextTarget(null);
    if (!targetMode) return;
    await login(targetMode, undefined, {
      deferModeUntilSignedIn: true,
      clientId: null,
    });
  }, [login, missingContextTarget]);

  const signOutToCreateRegistration = useCallback(async () => {
    const targetMode = missingContextTarget ?? "admin";
    setMissingContextTarget(null);
    saveLastSignInApp("registration");
    saveLastSessionMode(targetMode);
    saveLastClientId("");
    await logout();
  }, [logout, missingContextTarget]);

  const contextSwapActive = signedIn && browserSignIn != null && contextSwapTarget != null;

  return useMemo(
    () => ({
      signedIn,
      restoring,
      accountName,
      mode,
      usesGraphSignIn: isGraphSignIn(clientId),
      isReadOnly: mode === "read",
      readOnlyScopeExceedsRequest,
      exceededWriteScopes,
      browserSignIn,
      storedSignIns,
      contextSwapActive,
      contextSwapTargetMode: contextSwapTarget,
      missingContextTarget,
      dismissMissingContext,
      signInMissingContextWithGraph,
      signOutToCreateRegistration,
      glance,
      glanceLoading,
      glanceError,
      login,
      useStored,
      forgetStored,
      logout,
      cancelLogin,
      swapContext,
      reloadGlance,
    }),
    [
      accountName,
      cancelLogin,
      contextSwapActive,
      contextSwapTarget,
      dismissMissingContext,
      missingContextTarget,
      browserSignIn,
      storedSignIns,
      exceededWriteScopes,
      forgetStored,
      glance,
      glanceError,
      glanceLoading,
      login,
      logout,
      clientId,
      mode,
      readOnlyScopeExceedsRequest,
      reloadGlance,
      restoring,
      signedIn,
      signInMissingContextWithGraph,
      signOutToCreateRegistration,
      swapContext,
      useStored,
    ],
  );
}
