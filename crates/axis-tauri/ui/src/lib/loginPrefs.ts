import type { SessionMode } from "../types/glance";

const EXTRA_SCOPES_KEY = "axis.login.extraScopes";
const SESSION_MODE_KEY = "axis.login.sessionMode";
const SIGN_IN_APP_KEY = "axis.login.signInApp";
const CLIENT_ID_KEY = "axis.login.clientId";

export type SignInApp = "graph" | "registration";

const CLIENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loadLastSignInApp(): SignInApp {
  try {
    return window.localStorage.getItem(SIGN_IN_APP_KEY) === "registration"
      ? "registration"
      : "graph";
  } catch {
    return "graph";
  }
}

export function saveLastSignInApp(value: SignInApp): void {
  try {
    window.localStorage.setItem(SIGN_IN_APP_KEY, value);
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadLastClientId(): string {
  try {
    return window.localStorage.getItem(CLIENT_ID_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveLastClientId(value: string): void {
  try {
    const trimmed = value.trim();
    if (trimmed) {
      window.localStorage.setItem(CLIENT_ID_KEY, trimmed);
    } else {
      window.localStorage.removeItem(CLIENT_ID_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

export function isAppRegistrationClientId(value: string): boolean {
  return CLIENT_ID_PATTERN.test(value.trim());
}

export function loadLastExtraScopes(): string {
  try {
    return window.localStorage.getItem(EXTRA_SCOPES_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveLastExtraScopes(value: string): void {
  try {
    const trimmed = value.trim();
    if (trimmed) {
      window.localStorage.setItem(EXTRA_SCOPES_KEY, trimmed);
    } else {
      window.localStorage.removeItem(EXTRA_SCOPES_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadLastSessionMode(): SessionMode {
  try {
    const stored = window.localStorage.getItem(SESSION_MODE_KEY);
    if (stored === "admin" || stored === "read") {
      return stored;
    }
    return "read";
  } catch {
    return "read";
  }
}

export function saveLastSessionMode(mode: SessionMode): void {
  try {
    window.localStorage.setItem(SESSION_MODE_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
}
