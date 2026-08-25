const EXTRA_SCOPES_KEY = "axis.login.extraScopes";

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
