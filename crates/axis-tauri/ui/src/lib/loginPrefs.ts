import type { SessionMode } from "../types/glance";

const EXTRA_SCOPES_KEY = "axis.login.extraScopes";
const SESSION_MODE_KEY = "axis.login.sessionMode";

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
