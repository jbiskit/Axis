// Last route (path + query, so the open object comes back too) per nav area and module,
// so leaving Devices for Endpoint security and coming back lands where you left off.
// Kept for the session only; a fresh start opens areas at their landing page.

const STORAGE_KEY = "axis.navMemory";

function load(): Map<string, string> {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return new Map(raw ? (JSON.parse(raw) as Array<[string, string]>) : []);
  } catch {
    return new Map();
  }
}

const memory = load();

export function rememberRoute(keys: string[], route: string): void {
  for (const key of keys) memory.set(key, route);
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...memory]));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Where a nav area or module tab should open: the last route seen inside it, else its own href. */
export function recallRoute(key: string, fallback: string): string {
  return memory.get(key) ?? fallback;
}

export const moduleKey = (id: string) => `module:${id}`;
