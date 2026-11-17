import { useSyncExternalStore } from "react";

const DEBUG_TOOLS_KEY = "axis.debugTools";
const CHANGE_EVENT = "axis-debug-tools";

export function loadDebugTools(): boolean {
  try {
    return window.localStorage.getItem(DEBUG_TOOLS_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveDebugTools(value: boolean): void {
  try {
    window.localStorage.setItem(DEBUG_TOOLS_KEY, value ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  // `storage` covers popout windows; the custom event covers this one.
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Raw payloads and diagnostic panels show only while Settings › Debug tools is on. */
export function useDebugTools(): boolean {
  return useSyncExternalStore(subscribe, loadDebugTools, () => false);
}
