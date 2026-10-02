import { useEffect, useMemo, useState } from "react";
import type { MobileAppSummary } from "../../types/inventory";
import { useReadOnly } from "../../lib/readOnly";
import {
  linkCatalogDependency,
  listMobileAppRelationships,
  unlinkMobileAppDependency,
  type MobileAppDeleteLink,
} from "../../lib/tauri";
import { BooleanToggle } from "./BooleanToggle";
import { Pane } from "./Win32AppEditor";

const NODE_W = 176;
const NODE_H = 40;
const COL_GAP = 88;
const ROW_GAP = 18;
const PAD = 22;

function isWin32DependencyApp(app: MobileAppSummary): boolean {
  const type = (app.odataType ?? "").replace(/^#/, "").toLowerCase();
  return type.includes("win32");
}

export function appMayHaveRelationships(app: MobileAppSummary): boolean {
  const type = (app.odataType ?? "").replace(/^#/, "").toLowerCase();
  if (!type) return false;
  if (type.includes("winget") || type.includes("store")) return false;
  if (type.includes("office") || type.includes("edge")) return false;
  return (
    type.includes("win32") ||
    type.includes("lobapp") ||
    type.includes("msi") ||
    type.includes("macosdmg") ||
    type.includes("macospkg") ||
    type.includes("macoslob")
  );
}

export function useTenantAppRelationships(apps: MobileAppSummary[], reloadKey: number) {
  const ids = useMemo(
    () =>
      apps
        .filter(appMayHaveRelationships)
        .map((app) => app.id.trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [apps],
  );
  const key = ids.join("\n");
  const [links, setLinks] = useState<MobileAppDeleteLink[]>([]);
  const [ready, setReady] = useState(ids.length === 0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setLinks([]);
      setError(null);
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    setError(null);
    void listMobileAppRelationships(key.split("\n"))
      .then((rows) => {
        if (cancelled) return;
        setLinks(rows);
        setReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setLinks([]);
        setError(err instanceof Error ? err.message : String(err));
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key, reloadKey]);

  return { links, ready, error, enabled: ids.length > 0 };
}

export function appNameMap(apps: MobileAppSummary[]): Map<string, string> {
  return new Map(apps.map((app) => [app.id.toLowerCase(), app.displayName]));
}

function named(id: string, fallback: string, names: Map<string, string>): string {
  return names.get(id.toLowerCase()) || fallback || id;
}

export function describeAppLink(link: MobileAppDeleteLink, names: Map<string, string>): string {
  const parent = named(link.sourceId, link.sourceName, names);
  const child = named(link.targetId, link.targetName, names);
  if (link.relationship === "supersedence") {
    return link.relationshipType === "replace"
      ? `${parent} supersedes and replaces ${child}.`
      : `${parent} supersedes ${child}.`;
  }
  if (link.relationshipType === "autoInstall") {
    return `${child} is a dependency for ${parent}. Intune installs ${child} automatically before ${parent}.`;
  }
  return `${child} is a dependency for ${parent}. ${parent} requires ${child} to be installed already.`;
}

export function dependencySummary(
  appId: string,
  links: MobileAppDeleteLink[],
  names: Map<string, string>,
): string {
  const id = appId.toLowerCase();
  const requires: string[] = [];
  const dependencyFor: string[] = [];
  const supersedes: string[] = [];
  const supersededBy: string[] = [];
  for (const link of links) {
    const parent = named(link.sourceId, link.sourceName, names);
    const child = named(link.targetId, link.targetName, names);
    if (link.relationship === "supersedence") {
      if (link.sourceId.toLowerCase() === id) supersedes.push(child);
      else if (link.targetId.toLowerCase() === id) supersededBy.push(parent);
      continue;
    }
    if (link.sourceId.toLowerCase() === id) requires.push(child);
    else if (link.targetId.toLowerCase() === id) dependencyFor.push(parent);
  }
  const parts: string[] = [];
  if (requires.length) parts.push(requires.join(", "));
  if (dependencyFor.length) parts.push(`Dependency for ${dependencyFor.join(", ")}`);
  if (supersedes.length) parts.push(`Supersedes ${supersedes.join(", ")}`);
  if (supersededBy.length) parts.push(`Superseded by ${supersededBy.join(", ")}`);
  return parts.join(" · ");
}

export function linksTouching(appId: string, links: MobileAppDeleteLink[]): MobileAppDeleteLink[] {
  const id = appId.toLowerCase();
  return links.filter(
    (link) => link.sourceId.toLowerCase() === id || link.targetId.toLowerCase() === id,
  );
}

export function relationshipErrorText(error: string): string {
  if (/not found|not registered/i.test(error)) return "Restart the app to load dependency links.";
  return error;
}

function connectedLinks(focusId: string | null, links: MobileAppDeleteLink[]): MobileAppDeleteLink[] {
  if (!focusId) return links;
  const adjacent = new Map<string, MobileAppDeleteLink[]>();
  for (const link of links) {
    for (const id of [link.sourceId.toLowerCase(), link.targetId.toLowerCase()]) {
      const list = adjacent.get(id) ?? [];
      list.push(link);
      adjacent.set(id, list);
    }
  }
  const seen = new Set<string>();
  const queue = [focusId.toLowerCase()];
  const kept: MobileAppDeleteLink[] = [];
  const keptKeys = new Set<string>();
  while (queue.length) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const link of adjacent.get(id) ?? []) {
      const key = `${link.sourceId}|${link.targetId}|${link.relationship}|${link.relationshipType}`.toLowerCase();
      if (!keptKeys.has(key)) {
        keptKeys.add(key);
        kept.push(link);
      }
      const other = link.sourceId.toLowerCase() === id ? link.targetId.toLowerCase() : link.sourceId.toLowerCase();
      if (!seen.has(other)) queue.push(other);
    }
  }
  return kept;
}

function shortName(name: string): string {
  const text = name.trim() || "App";
  return text.length > 24 ? `${text.slice(0, 23)}…` : text;
}

type PlacedNode = { id: string; name: string; x: number; y: number };

function layoutLinks(links: MobileAppDeleteLink[], names: Map<string, string>) {
  const nodes = new Map<string, { id: string; name: string }>();
  for (const link of links) {
    if (!nodes.has(link.sourceId.toLowerCase())) {
      nodes.set(link.sourceId.toLowerCase(), {
        id: link.sourceId,
        name: named(link.sourceId, link.sourceName, names),
      });
    }
    if (!nodes.has(link.targetId.toLowerCase())) {
      nodes.set(link.targetId.toLowerCase(), {
        id: link.targetId,
        name: named(link.targetId, link.targetName, names),
      });
    }
  }
  const children = new Map<string, string[]>();
  for (const link of links) {
    const parent = link.sourceId.toLowerCase();
    const child = link.targetId.toLowerCase();
    const list = children.get(parent) ?? [];
    if (!list.includes(child)) list.push(child);
    children.set(parent, list);
  }
  const ranks = new Map<string, number>();
  const visiting = new Set<string>();
  function rank(id: string): number {
    const cached = ranks.get(id);
    if (cached != null) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let value = 0;
    for (const child of children.get(id) ?? []) value = Math.max(value, rank(child) + 1);
    visiting.delete(id);
    ranks.set(id, value);
    return value;
  }
  for (const id of nodes.keys()) rank(id);
  const minRank = Math.min(0, ...[...ranks.values()]);
  const columns = new Map<number, string[]>();
  for (const id of nodes.keys()) {
    const column = (ranks.get(id) ?? 0) - minRank;
    const list = columns.get(column) ?? [];
    list.push(id);
    columns.set(column, list);
  }
  let maxRows = 1;
  let maxRank = 0;
  for (const [column, list] of columns) {
    list.sort((left, right) => (nodes.get(left)?.name ?? "").localeCompare(nodes.get(right)?.name ?? ""));
    maxRows = Math.max(maxRows, list.length);
    maxRank = Math.max(maxRank, column);
  }
  const placed: PlacedNode[] = [];
  for (const [column, list] of columns) {
    list.forEach((id, index) => {
      const node = nodes.get(id);
      if (!node) return;
      placed.push({
        id: node.id,
        name: node.name,
        x: PAD + column * (NODE_W + COL_GAP),
        y: PAD + index * (NODE_H + ROW_GAP),
      });
    });
  }
  return {
    placed,
    width: PAD * 2 + (maxRank + 1) * NODE_W + maxRank * COL_GAP,
    height: PAD * 2 + maxRows * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP,
  };
}

function dependencyEdges(appId: string, links: MobileAppDeleteLink[]) {
  const id = appId.toLowerCase();
  const requires = links.filter(
    (link) => link.relationship === "dependency" && link.sourceId.toLowerCase() === id,
  );
  const dependencyFor = links.filter(
    (link) => link.relationship === "dependency" && link.targetId.toLowerCase() === id,
  );
  const other = linksTouching(appId, links).filter((link) => link.relationship !== "dependency");
  return { requires, dependencyFor, other };
}

function requiresReaches(fromId: string, toId: string, links: MobileAppDeleteLink[]): boolean {
  const next = new Map<string, string[]>();
  for (const link of links) {
    if (link.relationship !== "dependency") continue;
    const parent = link.sourceId.toLowerCase();
    const children = next.get(parent) ?? [];
    children.push(link.targetId.toLowerCase());
    next.set(parent, children);
  }
  const goal = toId.toLowerCase();
  const seen = new Set<string>();
  const queue = [fromId.toLowerCase()];
  while (queue.length) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const child of next.get(id) ?? []) {
      if (child === goal) return true;
      queue.push(child);
    }
  }
  return false;
}

function appWithVersion(app: Pick<MobileAppSummary, "displayName" | "displayVersion">): string {
  const version = app.displayVersion?.trim();
  return version ? `${app.displayName} · ${version}` : app.displayName;
}

function linkedAppLabel(
  id: string,
  fallback: string,
  apps: MobileAppSummary[],
  names: Map<string, string>,
): string {
  const match = apps.find((item) => item.id.toLowerCase() === id.toLowerCase());
  if (match) return appWithVersion(match);
  return named(id, fallback, names);
}

function DependencyEditRow({
  title,
  autoInstall,
  disabled,
  busy,
  onAutoInstall,
  onRemove,
}: {
  title: string;
  autoInstall: boolean;
  disabled: boolean;
  busy: boolean;
  onAutoInstall: (next: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <div className="app-dep-row">
      <strong>{title}</strong>
      <label className="app-dep-auto">
        <BooleanToggle
          checked={autoInstall}
          disabled={disabled || busy}
          ariaLabel={`Automatically install ${title}`}
          onChange={onAutoInstall}
        />
        <span>Install automatically</span>
      </label>
      <button type="button" className="axis-btn" disabled={disabled || busy} onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

function AddDependency({
  label,
  apps,
  disabled,
  onAdd,
}: {
  label: string;
  apps: MobileAppSummary[];
  disabled: boolean;
  onAdd: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<MobileAppSummary | null>(null);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? apps.filter((app) => appWithVersion(app).toLowerCase().includes(needle))
    : apps;
  const locked = disabled || apps.length === 0;
  return (
    <div className="app-dep-add">
      <div className="app-dep-combo">
        <input
          className="axis-input"
          value={picked && !open ? appWithVersion(picked) : query}
          placeholder={apps.length === 0 ? "No other Win32 apps" : label}
          disabled={locked}
          onFocus={() => {
            if (!locked) setOpen(true);
          }}
          onChange={(event) => {
            setPicked(null);
            setQuery(event.target.value);
            setOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
        />
        {open && !locked ? (
          <ul className="app-dep-combo-list">
            {shown.length === 0 ? <li className="muted">No matching Win32 apps</li> : null}
            {shown.map((app) => (
              <li key={app.id}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setPicked(app);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  {appWithVersion(app)}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <button
        type="button"
        className="axis-btn"
        disabled={locked || !picked}
        onClick={() => {
          if (!picked) return;
          const id = picked.id;
          setPicked(null);
          setQuery("");
          onAdd(id);
        }}
      >
        Add
      </button>
    </div>
  );
}

export function AppDependencyPane({
  app,
  apps,
  links,
  names,
  ready,
  error,
  onSelectApp,
  onChanged,
}: {
  app: MobileAppSummary;
  apps: MobileAppSummary[];
  links: MobileAppDeleteLink[];
  names: Map<string, string>;
  ready: boolean;
  error: string | null;
  onSelectApp?: (id: string) => void;
  onChanged: () => void;
}) {
  const readOnly = useReadOnly();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [graphOpen, setGraphOpen] = useState(false);
  const knownIds = useMemo(() => new Set(apps.map((item) => item.id.toLowerCase())), [apps]);
  const { requires, dependencyFor, other } = dependencyEdges(app.id, links);
  const canOwn = appMayHaveRelationships(app);
  const touched = requires.length + dependencyFor.length + other.length > 0;

  async function save(key: string, work: () => Promise<void>) {
    setBusyKey(key);
    setSaveError(null);
    try {
      await work();
      onChanged();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  if (!canOwn && !touched) return null;

  const takenChildren = new Set(requires.map((link) => link.targetId.toLowerCase()));
  const takenParents = new Set(dependencyFor.map((link) => link.sourceId.toLowerCase()));
  const byName = (left: MobileAppSummary, right: MobileAppSummary) =>
    left.displayName.localeCompare(right.displayName);
  const childChoices = apps
    .filter((candidate) => {
      const id = candidate.id.toLowerCase();
      return (
        isWin32DependencyApp(candidate) &&
        id !== app.id.toLowerCase() &&
        !takenChildren.has(id) &&
        !requiresReaches(id, app.id, links)
      );
    })
    .sort(byName);
  const parentChoices = apps
    .filter((candidate) => {
      const id = candidate.id.toLowerCase();
      return (
        isWin32DependencyApp(candidate) &&
        id !== app.id.toLowerCase() &&
        !takenParents.has(id) &&
        !requiresReaches(app.id, id, links)
      );
    })
    .sort(byName);

  const summary = dependencySummary(app.id, links, names);
  return (
    <Pane title="Dependencies" hint={!ready && !touched ? "Checking…" : summary || "None"}>
      {error ? <p className="muted">{relationshipErrorText(error)}</p> : null}
      {saveError ? <p className="axis-alert axis-alert-danger">{saveError}</p> : null}
      {!ready && !touched ? <p className="muted">Checking dependencies…</p> : null}
      <div className="app-dep-edit">
        {touched ? (
          <div className="app-dep-pane-actions">
            <button type="button" className="axis-btn" onClick={() => setGraphOpen(true)}>
              Graph
            </button>
          </div>
        ) : null}
        {canOwn ? (
          <div className="app-dep-section">
            <p className="app-dep-section-label">Dependencies for this app</p>
            {requires.map((link) => {
              const child = linkedAppLabel(link.targetId, link.targetName, apps, names);
              const key = `child:${link.targetId}`;
              return (
                <DependencyEditRow
                  key={key}
                  title={child}
                  autoInstall={link.relationshipType === "autoInstall"}
                  disabled={readOnly || busyKey != null}
                  busy={busyKey === key}
                  onAutoInstall={(autoInstall) =>
                    void save(key, () =>
                      linkCatalogDependency({
                        parentAppId: app.id,
                        targetAppId: link.targetId,
                        autoInstall,
                      }),
                    )
                  }
                  onRemove={() =>
                    void save(key, () =>
                      unlinkMobileAppDependency({
                        parentAppId: app.id,
                        targetAppId: link.targetId,
                      }),
                    )
                  }
                />
              );
            })}
            <AddDependency
              label="Add a dependency"
              apps={childChoices}
              disabled={readOnly || !ready || busyKey != null}
              onAdd={(targetAppId) =>
                void save(`add-child:${targetAppId}`, () =>
                  linkCatalogDependency({
                    parentAppId: app.id,
                    targetAppId,
                    autoInstall: true,
                  }),
                )
              }
            />
          </div>
        ) : null}
        <div className="app-dep-section">
          <p className="app-dep-section-label">This app is a dependency for</p>
          {dependencyFor.map((link) => {
            const parent = linkedAppLabel(link.sourceId, link.sourceName, apps, names);
            const key = `parent:${link.sourceId}`;
            return (
              <DependencyEditRow
                key={key}
                title={parent}
                autoInstall={link.relationshipType === "autoInstall"}
                disabled={readOnly || busyKey != null}
                busy={busyKey === key}
                onAutoInstall={(autoInstall) =>
                  void save(key, () =>
                    linkCatalogDependency({
                      parentAppId: link.sourceId,
                      targetAppId: app.id,
                      autoInstall,
                    }),
                  )
                }
                onRemove={() =>
                  void save(key, () =>
                    unlinkMobileAppDependency({
                      parentAppId: link.sourceId,
                      targetAppId: app.id,
                    }),
                  )
                }
              />
            );
          })}
          <AddDependency
            label="Required by"
            apps={parentChoices}
            disabled={readOnly || !ready || busyKey != null}
            onAdd={(parentAppId) =>
              void save(`add-parent:${parentAppId}`, () =>
                linkCatalogDependency({
                  parentAppId,
                  targetAppId: app.id,
                  autoInstall: true,
                }),
              )
            }
          />
        </div>
        {other.length > 0 ? (
          <ul className="app-dep-lines">
            {other.map((link) => (
              <li key={`${link.sourceId}|${link.targetId}|${link.relationship}|${link.relationshipType}`}>
                {describeAppLink(link, names)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {graphOpen ? (
        <AppDependencyGraphDialog
          links={links}
          names={names}
          knownIds={knownIds}
          focusId={app.id}
          selectedId={app.id}
          title={app.displayName}
          onSelect={(id) => onSelectApp?.(id)}
          onClose={() => setGraphOpen(false)}
        />
      ) : null}
    </Pane>
  );
}

export function AppDependencyGraphDialog({
  links,
  names,
  knownIds,
  focusId,
  selectedId,
  title,
  onSelect,
  onClose,
}: {
  links: MobileAppDeleteLink[];
  names: Map<string, string>;
  knownIds: Set<string>;
  focusId: string | null;
  selectedId: string | null;
  title: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const visible = useMemo(() => connectedLinks(focusId, links), [focusId, links]);
  const layout = useMemo(() => layoutLinks(visible, names), [names, visible]);
  const placed = new Map(layout.placed.map((node) => [node.id.toLowerCase(), node]));
  const focusName = focusId ? names.get(focusId.toLowerCase()) : null;
  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="axis-modal axis-modal-graph" role="dialog" aria-modal="true" aria-labelledby="app-dep-graph-title">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Dependencies</p>
            <h2 id="app-dep-graph-title">{focusName ? `${focusName} dependencies` : title}</h2>
          </div>
          <button type="button" className="axis-btn" onClick={onClose}>
            Close
          </button>
        </div>
        {visible.length === 0 ? (
          <p className="muted">No dependency or supersedence links in this view.</p>
        ) : (
          <>
            <p className="muted app-dep-legend">
              The app on the left is the dependency. The arrow points to the app that requires it.
              A dashed arrow is supersedence and points to the newer app.
            </p>
            <div className="app-dep-graph">
              <svg width={layout.width} height={layout.height} role="img" aria-label="Dependency graph">
                <defs>
                  <marker id="app-dep-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M 0 0 L 8 4 L 0 8 z" className="app-dep-arrow" />
                  </marker>
                  <marker id="app-dep-arrow-super" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M 0 0 L 8 4 L 0 8 z" className="app-dep-arrow is-supersedence" />
                  </marker>
                </defs>
                {visible.map((link, index) => {
                  const child = placed.get(link.targetId.toLowerCase());
                  const parent = placed.get(link.sourceId.toLowerCase());
                  if (!child || !parent) return null;
                  const samePair = visible.filter(
                    (other) =>
                      other.sourceId.toLowerCase() === link.sourceId.toLowerCase() &&
                      other.targetId.toLowerCase() === link.targetId.toLowerCase(),
                  );
                  const offset = (samePair.indexOf(link) - (samePair.length - 1) / 2) * 8;
                  const x1 = child.x + NODE_W;
                  const y1 = child.y + NODE_H / 2 + offset;
                  const x2 = parent.x;
                  const y2 = parent.y + NODE_H / 2 + offset;
                  const mid = (x1 + x2) / 2;
                  const supersedes = link.relationship === "supersedence";
                  return (
                    <path
                      key={`${link.sourceId}-${link.targetId}-${link.relationship}-${index}`}
                      d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                      className={supersedes ? "app-dep-edge is-supersedence" : "app-dep-edge"}
                      markerEnd={supersedes ? "url(#app-dep-arrow-super)" : "url(#app-dep-arrow)"}
                    >
                      <title>{describeAppLink(link, names)}</title>
                    </path>
                  );
                })}
                {layout.placed.map((node) => {
                  const known = knownIds.has(node.id.toLowerCase());
                  const selected = selectedId?.toLowerCase() === node.id.toLowerCase();
                  return (
                    <g
                      key={node.id}
                      className={known ? "app-dep-node-hit" : undefined}
                      onClick={() => {
                        if (known) onSelect(node.id);
                      }}
                    >
                      <title>{node.name}</title>
                      <rect
                        x={node.x}
                        y={node.y}
                        width={NODE_W}
                        height={NODE_H}
                        rx={8}
                        className={selected ? "app-dep-node is-selected" : "app-dep-node"}
                      />
                      <text
                        x={node.x + NODE_W / 2}
                        y={node.y + NODE_H / 2}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="app-dep-node-label"
                      >
                        {shortName(node.name)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <ul className="app-dep-lines">
              {visible.map((link) => (
                <li key={`${link.sourceId}|${link.targetId}|${link.relationship}|${link.relationshipType}`}>
                  {describeAppLink(link, names)}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
