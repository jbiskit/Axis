import type { ReactNode } from "react";
import type { NavIconId, NavItem } from "../types/inventory";
import { INTUNE_NAV, matchingNavItems } from "../lib/nav";
import { navigate, type AppRoute } from "../lib/route";

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
  onSignOut,
}: {
  children: ReactNode;
  route: AppRoute;
  accountName: string | null;
  organizationName: string | null;
  onSignOut: () => void;
}) {
  const { pathname, search } = route;
  const current = matchingNavItems(pathname, search, INTUNE_NAV)[0];
  const groups: Array<{ section?: string; items: NavItem[] }> = [];
  for (const item of INTUNE_NAV) {
    const last = groups[groups.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }

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
          <div className="shell-session">
            <span className="shell-session-org">{organizationName ?? "Signed in"}</span>
            {accountName ? <span className="shell-session-user">{accountName}</span> : null}
          </div>
          <button type="button" className="axis-btn axis-btn-ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="shell-workspace">
        <header className="shell-titlebar">
          <h1>{current?.label ?? "Overview"}</h1>
        </header>
        <main className="shell-main axis-enter">{children}</main>
      </div>
    </div>
  );
}
