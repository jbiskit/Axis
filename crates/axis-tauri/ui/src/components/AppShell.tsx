import { useEffect, useRef, useState, type ReactNode } from "react";
import type { NavIconId, NavItem } from "../types/inventory";
import type { SessionMode } from "../types/glance";
import type { ClientContainerStatus } from "../types/clientContainer";
import { INTUNE_NAV, matchingNavItems } from "../lib/nav";
import { navigate, type AppRoute } from "../lib/route";
import { SHELL_BANNER_DISMISS_KEYS } from "../lib/readOnly";
import { AppUpdateControls } from "./AppUpdateControls";
import { openExternalUrl } from "../lib/tauri";

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

function NavIcon({ name }: { name: NavIconId | "chevron" }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
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
  const matches = matchingNavItems(pathname, search, INTUNE_NAV);
  if (matches.length === 0) return false;
  const best = matches[0];
  if (best.href === item.href) return true;
  const contains = (candidate: NavItem): boolean =>
    candidate.href === best.href || Boolean(candidate.children?.some(contains));
  return contains(item);
}

function isLeafActive(pathname: string, search: URLSearchParams, item: NavItem): boolean {
  return matchingNavItems(pathname, search, INTUNE_NAV)[0]?.href === item.href;
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

  return (
    <div className="shell-nav-branch">
      {showSection ? <p className="shell-nav-section">{item.section}</p> : null}
      <button
        type="button"
        className={`shell-nav-item nested depth-${depth} ${leaf ? "active" : ""} ${active && children.length ? "branch" : ""} ${planned ? "disabled" : ""}`}
        disabled={planned}
        title={planned ? "Not in this desktop pass" : undefined}
        onClick={() => {
          if (!planned) navigate(item.href);
        }}
      >
        <span className="shell-nav-label">{item.label}</span>
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

export function AppShell({
  children,
  route,
  accountName,
  organizationName,
  mode = "read",
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
}: {
  children: ReactNode;
  route: AppRoute;
  accountName: string | null;
  organizationName: string | null;
  mode?: SessionMode;
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
}) {
  const { pathname, search } = route;
  const current = matchingNavItems(pathname, search, INTUNE_NAV)[0];
  const groups: Array<{ section?: string; items: NavItem[] }> = [];
  for (const item of INTUNE_NAV) {
    const last = groups[groups.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const clientName = clientContainer?.manifest?.name ?? null;
  const clientActive = Boolean(clientContainer?.active && clientName);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className="shell">
      <aside className="shell-rail">
        <div className="shell-rail-header">
          <span className="shell-mark">AX</span>
          <div className="shell-brand">
            <div className="shell-brand-name">Axis</div>
            <div className="shell-brand-meta">Intune workspace</div>
          </div>
        </div>
        <nav className="shell-rail-nav" aria-label="Intune navigation">
          {groups.map((group) => (
            <div key={group.section ?? group.items[0]?.href} className="shell-nav-group">
              {group.section ? <p className="shell-nav-section root">{group.section}</p> : null}
              {group.items.map((item) => {
                const active = isActive(pathname, search, item);
                const leaf = isLeafActive(pathname, search, item);
                const children = item.children ?? [];
                const planned = item.status === "planned";
                const currentItem = leaf || (active && children.length === 0);
                return (
                  <div key={item.href}>
                    <button
                      type="button"
                      className={`shell-nav-item ${currentItem ? "active" : ""} ${planned ? "disabled" : ""}`}
                      disabled={planned}
                      title={planned ? "Not in this desktop pass" : undefined}
                      onClick={() => {
                        if (!planned) navigate(item.href);
                      }}
                    >
                      <NavIcon name={item.icon ?? "overview"} />
                      <span className="shell-nav-label">{item.label}</span>
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
              })}
            </div>
          ))}
        </nav>
        <div className="shell-rail-footer">
          <div className="shell-client" ref={menuRef}>
            <button
              type="button"
              className={`shell-client-switch${clientActive ? " is-active" : ""}${
                clientContainer?.tenantMismatch ? " is-mismatch" : ""
              }`}
              disabled={clientContainerBusy}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title={
                clientActive
                  ? `${clientName}${clientContainer?.root ? `\n${clientContainer.root}` : ""}`
                  : "Open or create a client container"
              }
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="shell-client-label">{clientActive ? clientName : "No client"}</span>
              <span className="shell-client-chevron" aria-hidden="true">
                ▾
              </span>
            </button>
            {menuOpen ? (
              <div className="shell-client-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={clientContainerBusy}
                  onClick={() => {
                    setMenuOpen(false);
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
                    setMenuOpen(false);
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
                        setMenuOpen(false);
                        onExportClientSnapshot?.();
                      }}
                    >
                      Export snapshot
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
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
                          setMenuOpen(false);
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
                        setMenuOpen(false);
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
          <div className="shell-session">
            <span className="shell-session-org">{organizationName ?? "Signed in"}</span>
            {accountName ? <span className="shell-session-user">{accountName}</span> : null}
            <div className="shell-session-access">
              <span className={`shell-session-badge ${mode === "read" ? "is-readonly" : "is-admin"}`}>
                {mode === "read" ? "Read-only" : "Read & Write"}
              </span>
              <button
                type="button"
                className="shell-context-swap"
                disabled={contextSwapBusy}
                aria-label="Swap context"
                title={
                  mode === "read"
                    ? "Swap context — sign in again for Read & Write permissions"
                    : "Swap context — sign in again for read-only permissions"
                }
                onClick={onSwapContext}
              >
                <svg
                  width={14}
                  height={14}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 8 5 12l4 4" />
                  <path d="M15 8l4 4-4 4" />
                  <path d="M5 12h14" />
                </svg>
              </button>
            </div>
          </div>
          <AppUpdateControls
            appVersion={appVersion}
            autoCheck={autoCheck}
            checking={checkingForUpdate}
            status={updateStatus}
            onAutoCheckChange={onAutoCheckChange}
            onCheck={onCheckForUpdate}
          />
          <button type="button" className="axis-btn axis-btn-ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="shell-workspace">
        <header className="shell-titlebar">
          <h1>{current?.label ?? "Overview"}</h1>
        </header>
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
        <main className="shell-main axis-enter">{children}</main>
      </div>
    </div>
  );
}
