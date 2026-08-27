const AUTO_CHECK_KEY = "axis.updater.autoCheck";

export function loadAutoCheckForUpdates(): boolean {
  try {
    const stored = window.localStorage.getItem(AUTO_CHECK_KEY);
    if (stored === "0" || stored === "false") return false;
    if (stored === "1" || stored === "true") return true;
  } catch {
    /* ignore quota / private mode */
  }
  return true;
}

export function saveAutoCheckForUpdates(value: boolean): void {
  try {
    window.localStorage.setItem(AUTO_CHECK_KEY, value ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}
