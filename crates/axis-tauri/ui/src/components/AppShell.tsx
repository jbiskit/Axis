import { useEffect, useRef, useState, type ReactNode } from "react";
import type { NavIconId, NavItem } from "../types/inventory";
import type { SessionMode } from "../types/glance";
import type { ClientContainerStatus } from "../types/clientContainer";
import { ALL_NAV, NAV_MODULES, matchingNavItems, moduleForPath } from "../lib/nav";
import { navigate, type AppRoute } from "../lib/route";
import { moduleKey, recallRoute, rememberRoute } from "../lib/navMemory";
import { SHELL_BANNER_DISMISS_KEYS } from "../lib/readOnly";
import { useDensity, useTheme } from "../lib/theme";
import { AppSettingsView } from "./AppSettingsView";
import { ThrottleIndicator } from "./ThrottleIndicator";
import { GlobalSearch } from "./GlobalSearch";
import type { SearchSource } from "../lib/globalSearch";
import { TaskTracker } from "./TaskTracker";
import { openExternalUrl } from "../lib/tauri";

const APP_SETTINGS_PATH = "/intune/app-settings";
const SNOOZE_DAY_OPTIONS = [7, 14, 30] as const;

function SnoozeControl({
  busy,
  defaultDays,
  onSnooze,
}: {
  busy: boolean;
  defaultDays: number;
  onSnooze: (days: number) => void;
}) {
  const initial = SNOOZE_DAY_OPTIONS.includes(defaultDays as (typeof SNOOZE_DAY_OPTIONS)[number])
    ? defaultDays
    : 14;
  const [days, setDays] = useState(initial);
  return (
    <label className="shell-stale-snooze">
      <span className="muted">Don&apos;t remind for</span>
      <select
        className="axis-input"
        disabled={busy}
        value={days}
        onChange={(event) => setDays(Number(event.target.value))}
      >
        {SNOOZE_DAY_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option} days
          </option>
        ))}
      </select>
      <button
        type="button"
        className="axis-btn"
        disabled={busy}
        onClick={() => onSnooze(days)}
      >
        Snooze
      </button>
    </label>
  );
}

function ScopeBanner({
  variant,
  dismissKey,
  children,
}: {
  variant: "warning" | "info";
  dismissKey: string;
  children: ReactNode;
}) {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(dismissKey) === "1",
  );
  if (dismissed) return null;
  return (
    <div
      className={`shell-scope-banner is-${variant}`}
      role={variant === "warning" ? "alert" : "status"}
    >
      <div className="shell-scope-banner-icon" aria-hidden="true">
        {variant === "warning" ? (
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        ) : (
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        )}
      </div>
      <div className="shell-scope-banner-text">{children}</div>
      <button
        type="button"
        className="shell-scope-banner-dismiss axis-btn axis-btn-ghost"
        onClick={() => {
          sessionStorage.setItem(dismissKey, "1");
          setDismissed(true);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

function NavIcon({ name, className }: { name: NavIconId | "chevron"; className?: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "chevron":
      return (
        <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      );
    case "devices":
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M10 17h4" />
        </svg>
      );
    case "enrollment":
      return (
        <svg {...common}>
          <path d="M12 3v12" />
          <path d="M8 7l4-4 4 4" />
          <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      );
    case "baselines":
      return (
        <svg {...common}>
          <path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6" />
        </svg>
      );
    case "templates":
      return (
        <svg {...common}>
          <path d="M8 4h11v14H8z" />
          <path d="M6 7H5a1 1 0 0 0-1 1v11h12" />
          <path d="M11 8h5M11 12h5" />
        </svg>
      );
    case "apps":
      return (
        <svg {...common}>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12v9M12 12L4 7.5" />
        </svg>
      );
    case "apps-setup":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case "policies":
    case "settings-catalog":
      return (
        <svg {...common}>
          <path d="M7 4h10v16H7z" />
          <path d="M10 8h4M10 12h4M10 16h2" />
        </svg>
      );
    case "endpoint-security":
      return (
        <svg {...common}>
          <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z" />
        </svg>
      );
    case "windows-update":
      return (
        <svg {...common}>
          <path d="M12 5v10" />
          <path d="M8 9l4-4 4 4" />
          <path d="M5 19h14" />
        </svg>
      );
    case "reports":
      return (
        <svg {...common}>
          <path d="M5 19V9M10 19V5M15 19v-7M20 19V8" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
  }
}

function isActive(pathname: string, search: URLSearchParams, item: NavItem): boolean {
  const matches = matchingNavItems(pathname, search, ALL_NAV);
  if (matches.length === 0) return false;
  const best = matches[0];
  if (best.href === item.href) return true;
  const contains = (candidate: NavItem): boolean =>
    candidate.href === best.href || Boolean(candidate.children?.some(contains));
  return contains(item);
}

function isLeafActive(pathname: string, search: URLSearchParams, item: NavItem): boolean {
  return matchingNavItems(pathname, search, ALL_NAV)[0]?.href === item.href;
}

function NavChild({
  item,
  pathname,
  search,
  prevSection,
  depth = 1,
}: {
  item: NavItem;
  pathname: string;
  search: URLSearchParams;
  prevSection?: string;
  depth?: number;
}) {
  const active = isActive(pathname, search, item);
  const leaf = isLeafActive(pathname, search, item);
  const children = item.children ?? [];
  const planned = item.status === "planned";
  const showSection = depth === 1 && item.section && item.section !== prevSection;
  // Mark the row as the page (`active`) or as an ancestor of it (`ancestor`),
  // so the path through nested levels stays visible.
  const rowState = leaf ? "active" : active ? "ancestor" : "";

  return (
    <div className="shell-nav-branch">
      {showSection ? <p className="shell-nav-section">{item.section}</p> : null}
      <button
        type="button"
        className={`shell-nav-item nested depth-${depth} ${rowState} ${planned ? "disabled" : ""}`}
        disabled={planned}
        title={planned ? "Not in this desktop pass" : undefined}
        onClick={() => {
          // Coming back to an area reopens where you left it; clicking the area you're in goes to its top.
          if (!planned) navigate(active ? item.href : recallRoute(item.href, item.href));
        }}
      >
        <span className="shell-nav-label">{item.label}</span>
        {item.tag ? <span className="shell-nav-tag">{item.tag}</span> : null}
      </button>
      {active && children.length ? (
        <div className="shell-nav-nested">
          {children.map((child, index) => (
            <NavChild
              key={child.href}
              item={child}
              pathname={pathname}
              search={search}
              prevSection={index > 0 ? children[index - 1]?.section : undefined}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Top-level row in the context panel; expands its children when it is on the active path. */
function NavTopItem({
  item,
  pathname,
  search,
  hubOnly = false,
}: {
  item: NavItem;
  pathname: string;
  search: URLSearchParams;
  /** Render only the row (the panel lists the children itself). */
  hubOnly?: boolean;
}) {
  const active = isActive(pathname, search, item);
  const leaf = isLeafActive(pathname, search, item);
  const children = hubOnly ? [] : item.children ?? [];
  const planned = item.status === "planned";
  // `active` means "some child is showing"; `leaf` means this row is the page.
  const currentItem = leaf || (active && children.length === 0 && !hubOnly);
  return (
    <div>
      <button
        type="button"
        className={`shell-nav-item ${currentItem ? "active" : ""} ${
          active && !currentItem && !hubOnly ? "ancestor" : ""
        } ${planned ? "disabled" : ""}`}
        disabled={planned}
        title={planned ? "Not in this desktop pass" : undefined}
        onClick={() => {
          if (!planned) navigate(active ? item.href : recallRoute(item.href, item.href));
        }}
      >
        <NavIcon name={item.icon ?? "overview"} className="shell-nav-icon" />
        <span className="shell-nav-label">{hubOnly ? "Overview" : item.label}</span>
        {children.length && !planned ? (
          <span className={`shell-nav-chevron ${active ? "open" : ""}`}>
            <NavIcon name="chevron" />
          </span>
        ) : null}
      </button>
      {active && children.length
        ? children.map((child, index) => (
            <NavChild
              key={child.href}
              item={child}
              pathname={pathname}
              search={search}
              prevSection={index > 0 ? children[index - 1]?.section : undefined}
            />
          ))
        : null}
    </div>
  );
}

/* ---- Sidebar ----
   One sidebar for the active module (chosen in the titlebar). A module with a single
   hub item lists that hub's children; Intune groups its items by section. */

const SECTION_ORDER = ["Workspace", "Get Started", "Manage", "Library", "Tools"];

function moduleSections(nav: NavItem[]): Array<[string, NavItem[]]> {
  const sections = new Map<string, NavItem[]>();
  for (const item of nav) {
    const key = item.section ?? "Workspace";
    sections.set(key, [...(sections.get(key) ?? []), item]);
  }
  const names = [
    ...SECTION_ORDER.filter((name) => sections.has(name)),
    ...[...sections.keys()].filter((name) => !SECTION_ORDER.includes(name)),
  ];
  return names.map((name) => [name, sections.get(name)!]);
}

const RAIL_SETTINGS_ICON =
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z";

function RailIcon({ path }: { path: string }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const PANEL_COLLAPSED_KEY = "axis.navPanelCollapsed";

function loadPanelCollapsed(): boolean {
  try {
    return window.localStorage.getItem(PANEL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function savePanelCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

function accountInitials(accountName: string | null): string {
  if (!accountName) return "?";
  const base = accountName.split("@")[0];
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : base.slice(0, 2);
  return letters.toUpperCase();
}

export function AppShell({
  children,
  route,
  accountName,
  organizationName,
  mode = "read",
  usesGraphSignIn = false,
  readOnlyScopeExceedsRequest = false,
  exceededWriteScopes = [],
  appVersion,
  autoCheck,
  checkingForUpdate,
  updateStatus,
  onAutoCheckChange,
  onCheckForUpdate,
  onSwapContext,
  contextSwapBusy = false,
  onSignOut,
  clientContainer,
  clientContainerBusy = false,
  onOpenClientContainer,
  onCreateClientContainer,
  onCloseClientContainer,
  onExportClientSnapshot,
  onSnoozeClientStale,
  onCompareClientSnapshots,
  searchSources = [],
}: {
  children: ReactNode;
  route: AppRoute;
  accountName: string | null;
  organizationName: string | null;
  mode?: SessionMode;
  usesGraphSignIn?: boolean;
  readOnlyScopeExceedsRequest?: boolean;
  exceededWriteScopes?: string[];
  appVersion: string | null;
  autoCheck: boolean;
  checkingForUpdate: boolean;
  updateStatus: string | null;
  onAutoCheckChange: (value: boolean) => void;
  onCheckForUpdate: () => void;
  onSwapContext: () => void;
  contextSwapBusy?: boolean;
  onSignOut: () => void;
  clientContainer?: ClientContainerStatus | null;
  clientContainerBusy?: boolean;
  onOpenClientContainer?: () => void;
  onCreateClientContainer?: () => void;
  onCloseClientContainer?: () => void;
  onExportClientSnapshot?: () => void;
  onSnoozeClientStale?: (days: number) => void;
  onCompareClientSnapshots?: () => void;
  /** Tenant objects the titlebar search can match. */
  searchSources?: SearchSource[];
}) {
  const { pathname, search } = route;
  const onAppSettings = pathname === APP_SETTINGS_PATH;
  const activeModule = NAV_MODULES.find((module) => module.id === moduleForPath(pathname)) ?? NAV_MODULES[0];
  const hub = activeModule.nav.length === 1 && activeModule.nav[0].children?.length ? activeModule.nav[0] : null;

  // Remember this route for its module and every nav row it sits under (see navMemory).
  const searchText = search.toString();
  useEffect(() => {
    if (onAppSettings) return;
    const keys = [moduleKey(activeModule.id)];
    const walk = (items: NavItem[]) =>
      items.forEach((item) => {
        if (isActive(pathname, search, item)) keys.push(item.href);
        walk(item.children ?? []);
      });
    walk(activeModule.nav);
    rememberRoute(keys, searchText ? `${pathname}?${searchText}` : pathname);
    // `search` is a new object each render; `searchText` is its value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchText, onAppSettings, activeModule]);

  const [panelCollapsed, setPanelCollapsedState] = useState(() => loadPanelCollapsed());
  const setPanelCollapsed = (next: boolean | ((current: boolean) => boolean)) => {
    setPanelCollapsedState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      savePanelCollapsed(value);
      return value;
    });
  };

  const [openMenu, setOpenMenu] = useState<"client" | "account" | null>(null);
  const clientMenuRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const toggleMenu = (menu: "client" | "account") =>
    setOpenMenu((open) => (open === menu ? null : menu));
  const clientName = clientContainer?.manifest?.name ?? null;
  const clientActive = Boolean(clientContainer?.active && clientName);

  useEffect(() => {
    if (!openMenu) return;
    const ref = openMenu === "client" ? clientMenuRef : accountMenuRef;
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  const { theme, toggle: toggleTheme } = useTheme();
  const { density, setDensity } = useDensity();

  return (
    <div className="shell">
      <header className="shell-titlebar">
        <div className="shell-titlebar-brand">
          <button
            type="button"
            className="axis-btn axis-btn-ghost axis-btn-icon shell-sidebar-toggle"
            aria-label={panelCollapsed ? "Show sidebar" : "Hide sidebar"}
            aria-pressed={!panelCollapsed}
            title={panelCollapsed ? "Show sidebar" : "Hide sidebar"}
            onClick={() => setPanelCollapsed((collapsed) => !collapsed)}
          >
            <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
            </svg>
          </button>
          <span className="shell-mark" aria-hidden="true">
            AX
          </span>
          <nav className="shell-modules" aria-label="Modules">
            {NAV_MODULES.map((module) => {
              const isCurrent = !onAppSettings && module.id === activeModule.id;
              return (
                <button
                  key={module.id}
                  type="button"
                  className={`shell-module${isCurrent ? " is-active" : ""}`}
                  aria-current={isCurrent ? "page" : undefined}
                  onClick={() =>
                    navigate(isCurrent ? module.nav[0].href : recallRoute(moduleKey(module.id), module.nav[0].href))
                  }
                >
                  {module.label}
                </button>
              );
            })}
          </nav>
        </div>
        <GlobalSearch sources={searchSources} />
        <div className="shell-titlebar-actions">
          <div className="shell-client" ref={clientMenuRef}>
            <button
              type="button"
              className={`shell-client-switch${clientActive ? " is-active" : ""}${
                clientContainer?.tenantMismatch ? " is-mismatch" : ""
              }`}
              disabled={clientContainerBusy}
              aria-haspopup="menu"
              aria-expanded={openMenu === "client"}
              title={
                clientActive
                  ? `${clientName}${clientContainer?.root ? `\n${clientContainer.root}` : ""}`
                  : "Open or create a client container"
              }
              onClick={() => toggleMenu("client")}
            >
              <span className="shell-client-dot" aria-hidden="true" />
              <span className="shell-client-label">{clientActive ? clientName : "No client"}</span>
              <span className="shell-client-chevron" aria-hidden="true">
                ▾
              </span>
            </button>
            {openMenu === "client" ? (
              <div className="shell-client-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={clientContainerBusy}
                  onClick={() => {
                    setOpenMenu(null);
                    onOpenClientContainer?.();
                  }}
                >
                  Open container…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={clientContainerBusy}
                  onClick={() => {
                    setOpenMenu(null);
                    onCreateClientContainer?.();
                  }}
                >
                  Create container…
                </button>
                {clientActive ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={clientContainerBusy || clientContainer?.tenantMismatch}
                      title={
                        clientContainer?.tenantMismatch
                          ? "Signed-in tenant does not match this container"
                          : undefined
                      }
                      onClick={() => {
                        setOpenMenu(null);
                        onExportClientSnapshot?.();
                      }}
                    >
                      Export snapshot
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpenMenu(null);
                        onCompareClientSnapshots?.();
                      }}
                    >
                      Compare & restore…
                    </button>
                    {clientContainer?.root ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenu(null);
                          void openExternalUrl(clientContainer.root!);
                        }}
                      >
                        Open folder
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      disabled={clientContainerBusy}
                      onClick={() => {
                        setOpenMenu(null);
                        onCloseClientContainer?.();
                      }}
                    >
                      Close container
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          <span
            className={`shell-session-badge ${mode === "read" ? "is-readonly" : "is-admin"}`}
            title={mode === "read" ? "Write actions are disabled" : "Write actions are enabled"}
          >
            {mode === "read" ? "Read-only" : "Read & Write"}
          </span>
          <ThrottleIndicator />
          <TaskTracker />
          <div className="shell-view-toggles" role="group" aria-label="View">
            <button
              type="button"
              className={`axis-btn axis-btn-ghost axis-btn-icon${density === "compact" ? " is-on" : ""}`}
              aria-pressed={density === "compact"}
              aria-label="Compact view"
              title={density === "compact" ? "Compact view on" : "Compact view off"}
              onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                {density === "compact" ? (
                  <path d="M4 5h16M4 9h16M4 13h16M4 17h16" />
                ) : (
                  <path d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-ghost axis-btn-icon"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={toggleTheme}
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {theme === "dark" ? (
                  <path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                ) : (
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                )}
              </svg>
            </button>
          </div>
          <div className="shell-account" ref={accountMenuRef}>
            <button
              type="button"
              className="shell-account-button"
              aria-haspopup="menu"
              aria-expanded={openMenu === "account"}
              aria-label="Account"
              title={[organizationName, accountName].filter(Boolean).join("\n") || "Account"}
              onClick={() => toggleMenu("account")}
            >
              {accountInitials(accountName)}
            </button>
            {openMenu === "account" ? (
              <div className="shell-client-menu shell-account-menu" role="menu">
                <div className="shell-account-who">
                  <span className="shell-session-org">{organizationName ?? "Signed in"}</span>
                  <span className="shell-session-user">{accountName ?? ""}</span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  disabled={contextSwapBusy}
                  title={
                    usesGraphSignIn
                      ? mode === "read"
                        ? "Sign in again for Read & Write permissions"
                        : "Sign in again for read-only permissions"
                      : mode === "read"
                        ? "Switch to the saved Read & Write app for this tenant"
                        : "Switch to the saved read-only app for this tenant"
                  }
                  onClick={() => {
                    setOpenMenu(null);
                    onSwapContext();
                  }}
                >
                  {mode === "read" ? "Switch to Read & Write" : "Switch to read-only"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    navigate(APP_SETTINGS_PATH);
                  }}
                >
                  Settings
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    onSignOut();
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="shell-body">
        {panelCollapsed ? null : (
          <aside className="shell-context" aria-label={`${activeModule.label} navigation`}>
            <nav className="shell-rail-nav">
              {hub ? (
                <>
                  <NavTopItem item={hub} pathname={pathname} search={search} hubOnly />
                  {(hub.children ?? []).map((child, index, siblings) => (
                    <NavChild
                      key={child.href}
                      item={child}
                      pathname={pathname}
                      search={search}
                      prevSection={index > 0 ? siblings[index - 1]?.section : undefined}
                    />
                  ))}
                </>
              ) : (
                moduleSections(activeModule.nav).map(([section, items]) => (
                  <div key={section} className="shell-nav-group">
                    {section !== "Workspace" ? <p className="shell-nav-section">{section}</p> : null}
                    {items.map((item) => (
                      <NavTopItem key={item.href} item={item} pathname={pathname} search={search} />
                    ))}
                  </div>
                ))
              )}
            </nav>
            <button
              type="button"
              className={`shell-nav-item shell-nav-settings${onAppSettings ? " active" : ""}`}
              aria-current={onAppSettings ? "page" : undefined}
              onClick={() => navigate(APP_SETTINGS_PATH)}
            >
              <RailIcon path={RAIL_SETTINGS_ICON} />
              <span className="shell-nav-label">Settings</span>
            </button>
          </aside>
        )}

      <div className="shell-workspace">
        {mode === "read" && readOnlyScopeExceedsRequest ? (
          <ScopeBanner
            variant="warning"
            dismissKey={SHELL_BANNER_DISMISS_KEYS.scopeWarning}
          >
            <strong>Tenant scopes exceed requested read-only permissions.</strong> Axis requested
            only read permissions, but your Entra tenant has pre-consented write scopes for
            Microsoft Graph Command Line Tools
            {exceededWriteScopes.length ? <> ({exceededWriteScopes.join(", ")})</> : null}. The UI
            stays locked down so no write actions can run.
          </ScopeBanner>
        ) : mode === "read" ? (
          <ScopeBanner variant="info" dismissKey={SHELL_BANNER_DISMISS_KEYS.readonlyInfo}>
            <strong>Read-only mode.</strong> Creating, modifying, deleting, and device management
            actions are disabled for this session.
          </ScopeBanner>
        ) : null}
        {clientContainer?.tenantMismatch ? (
          <div className="shell-scope-banner is-warning" role="alert">
            <div className="shell-scope-banner-icon" aria-hidden="true">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div className="shell-scope-banner-text">
              <strong>Tenant mismatch.</strong> Client container{" "}
              <em>{clientContainer.manifest?.name}</em> is bound to a different Entra tenant than
              this session. Snapshot export is blocked until you swap sign-in or open another
              container.
            </div>
          </div>
        ) : null}
        {clientContainer?.stalePrompt && !clientContainer.tenantMismatch ? (
          <div className="shell-scope-banner is-info" role="status">
            <div className="shell-scope-banner-icon" aria-hidden="true">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div className="shell-scope-banner-text">
              <strong>Snapshot reminder.</strong>{" "}
              {clientContainer.staleReason ??
                `Export a tenant pack and environment as-built for ${clientContainer.manifest?.name ?? "this client"}.`}
            </div>
            <div className="shell-stale-actions">
              <button
                type="button"
                className="axis-btn axis-btn-primary"
                disabled={clientContainerBusy}
                onClick={() => onExportClientSnapshot?.()}
              >
                {clientContainerBusy ? "Working…" : "Export now"}
              </button>
              <SnoozeControl
                busy={clientContainerBusy}
                defaultDays={
                  clientContainer.manifest?.stalePrompt?.snoozeDays ??
                  clientContainer.staleAfterDays ??
                  14
                }
                onSnooze={(days) => onSnoozeClientStale?.(days)}
              />
            </div>
          </div>
        ) : null}
        <main className="shell-main axis-enter">
          {onAppSettings ? (
            <AppSettingsView
              theme={theme}
              onToggleTheme={toggleTheme}
              density={density}
              onDensityChange={setDensity}
              appVersion={appVersion}
              autoCheck={autoCheck}
              checkingForUpdate={checkingForUpdate}
              updateStatus={updateStatus}
              onAutoCheckChange={onAutoCheckChange}
              onCheckForUpdate={onCheckForUpdate}
            />
          ) : (
            children
          )}
        </main>
      </div>
      </div>
    </div>
  );
}
