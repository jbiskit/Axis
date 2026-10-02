import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { PageHeader } from "./ui/PageChrome";
import { SelectCheckbox, useCheckedIds } from "./workbench/PolicyBulkAssign";
import { useColumnSort } from "./workbench/shared";
import { APP_CATALOG_ROOT_KEY } from "../lib/baselines/sources";
import type { ClientContainerStatus } from "../types/clientContainer";
import { CatalogAppBuilder } from "./workbench/CatalogAppBuilder";
import {
  copyCatalogAppVersion,
  createCatalogApp,
  listCatalogApps,
  openExternalUrl,
  pickLocalPackFolder,
  type CatalogAppSummary,
} from "../lib/tauri";

function CatalogSortButton({
  column,
  label,
  sort,
  onSort,
}: {
  column: "name" | "vendor";
  label: string;
  sort: { key: "name" | "vendor"; dir: "asc" | "desc" };
  onSort: (key: "name" | "vendor") => void;
}) {
  const active = sort.key === column;
  return (
    <button
      type="button"
      className="axis-btn app-house-sort-btn"
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      onClick={() => onSort(column)}
    >
      {label}
      {active ? <span aria-hidden>{sort.dir === "asc" ? "▲" : "▼"}</span> : null}
    </button>
  );
}

function containerRoot(container: ClientContainerStatus | null | undefined): string | null {
  if (!container?.active) return null;
  const root = container.root?.trim();
  return root || null;
}

function savedRepo(): string | null {
  return window.localStorage.getItem(APP_CATALOG_ROOT_KEY)?.trim() || null;
}

type CatalogAppGroup = {
  key: string;
  vendor: string;
  name: string;
  versions: CatalogAppSummary[];
};

type CatalogVendorGroup = {
  vendor: string;
  apps: CatalogAppGroup[];
};

function compareVersions(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function directed(cmp: number, dir: "asc" | "desc"): number {
  return dir === "asc" ? cmp : -cmp;
}

/** Group versions under vendor + application, then order by the active sort. */
function groupCatalogApps(
  apps: CatalogAppSummary[],
  sort: { key: "name" | "vendor"; dir: "asc" | "desc" },
): CatalogVendorGroup[] {
  const byApp = new Map<string, CatalogAppGroup>();
  for (const app of apps) {
    const vendor = app.vendor.trim() || "Unknown";
    const name = app.name.trim() || "Application";
    const appKey = `${vendor.toLowerCase()}\u0000${name.toLowerCase()}`;
    const existing = byApp.get(appKey);
    if (existing) existing.versions.push(app);
    else byApp.set(appKey, { key: appKey, vendor, name, versions: [app] });
  }
  const grouped = [...byApp.values()];
  for (const app of grouped) {
    app.versions.sort((left, right) => compareVersions(right.version || "", left.version || ""));
  }
  if (sort.key === "name") {
    grouped.sort(
      (left, right) =>
        directed(compareText(left.name, right.name) || compareText(left.vendor, right.vendor), sort.dir),
    );
    return [{ vendor: "", apps: grouped }];
  }
  const byVendor = new Map<string, CatalogAppGroup[]>();
  for (const app of grouped) {
    const vendorKey = app.vendor.toLowerCase();
    const bucket = byVendor.get(vendorKey);
    if (bucket) bucket.push(app);
    else byVendor.set(vendorKey, [app]);
  }
  const vendors = [...byVendor.values()].map((vendorApps) => {
    vendorApps.sort((left, right) => compareText(left.name, right.name));
    return { vendor: vendorApps[0]?.vendor ?? "Unknown", apps: vendorApps };
  });
  vendors.sort((left, right) => directed(compareText(left.vendor, right.vendor), sort.dir));
  return vendors;
}

export function LocalCatalogView({
  container,
}: {
  container: ClientContainerStatus | null;
}) {
  const bound = containerRoot(container);
  const [repoRoot, setRepoRoot] = useState<string | null>(() => savedRepo());
  const root = bound ?? repoRoot;
  const [apps, setApps] = useState<CatalogAppSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<CatalogAppSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsedApps, setCollapsedApps] = useState<Set<string>>(() => new Set());
  const [nameQuery, setNameQuery] = useState("");
  const { sort, toggle: toggleSort } = useColumnSort<"name" | "vendor">("vendor");
  const filteredApps = useMemo(() => {
    const query = nameQuery.trim().toLowerCase();
    if (!query) return apps;
    return apps.filter((app) => app.name.toLowerCase().includes(query));
  }, [apps, nameQuery]);
  const groups = useMemo(() => groupCatalogApps(filteredApps, sort), [filteredApps, sort]);
  const selectedApp = apps.find((app) => app.id === selectedId) ?? null;
  const visibleIds = useMemo(() => filteredApps.map((app) => app.id), [filteredApps]);
  const selection = useCheckedIds(visibleIds);
  const selected = apps.filter((app) => selection.checkedIds.has(app.id));

  const reload = useCallback(async (sourceRoot: string | null) => {
    if (!sourceRoot) {
      setApps([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setApps(await listCatalogApps(sourceRoot));
    } catch (err) {
      setApps([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (bound) return;
    setRepoRoot(savedRepo());
  }, [bound]);

  useEffect(() => {
    if (!root) {
      setCreateOpen(false);
      setCopyTarget(null);
      setSelectedId(null);
    }
    void reload(root);
  }, [reload, root]);

  useEffect(() => {
    if (selectedId && !apps.some((app) => app.id === selectedId)) setSelectedId(null);
  }, [apps, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const row = document.querySelector(`[data-catalog-version="${CSS.escape(selectedId)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [apps, selectedId]);

  function revealCreated(created: CatalogAppSummary) {
    const vendor = (created.vendor.trim() || "Unknown").toLowerCase();
    const name = (created.name.trim() || "Application").toLowerCase();
    setApps((current) => (current.some((app) => app.id === created.id) ? current : [...current, created]));
    setCollapsedApps((current) => {
      const next = new Set(current);
      next.delete(`${vendor}\u0000${name}`);
      return next;
    });
    setSelectedId(created.id);
  }

  async function chooseFolder() {
    const picked = await pickLocalPackFolder("Local application repo");
    const folder = picked?.trim();
    if (!folder) return;
    window.localStorage.setItem(APP_CATALOG_ROOT_KEY, folder);
    setRepoRoot(folder);
  }

  function toggleApp(key: string) {
    setCollapsedApps((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function openSelected() {
    const app = selected.length === 1 ? selected[0] : null;
    if (!app) return;
    await openExternalUrl(app.localPath);
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Library"
        title="Local catalog"
        description={
          root
            ? root
            : "Choose a local repo, or open a client container."
        }
        onRefresh={() => void reload(root)}
        refreshing={loading}
        actions={
          <>
            {bound ? null : (
              <button type="button" className="axis-btn" onClick={() => void chooseFolder()}>
                Choose folder
              </button>
            )}
            <button
              type="button"
              className="axis-btn"
              disabled={selected.length !== 1}
              onClick={() => void openSelected()}
            >
              Open folder
            </button>
            <button
              type="button"
              className="axis-btn"
              disabled={selected.length !== 1}
              onClick={() => setCopyTarget(selected[0] ?? null)}
            >
              Copy version
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={!root}
              onClick={() => setCreateOpen(true)}
            >
              New application
            </button>
          </>
        }
      />

      {error ? (
        <div className="axis-alert axis-alert-danger">{error}</div>
      ) : null}

      {!root ? (
        <p className="muted">
          Choose a local repo. Packages are stored there as{" "}
          <code>Applications\Vendor\App\Version</code>. An open client container is used while it
          is open, and closing it does not keep writing into that folder.
        </p>
      ) : (
        <div className="app-house-split">
        <div className="axis-panel app-house">
          {loading ? (
            <p className="muted">Loading catalog…</p>
          ) : apps.length === 0 ? (
            <p className="muted">No applications in this source yet.</p>
          ) : (
            <>
              <div className="app-house-summary">
                <SelectCheckbox
                  checked={selection.allSelected}
                  indeterminate={selection.checkedIds.size > 0 && !selection.allSelected}
                  disabled={filteredApps.length === 0}
                  label={nameQuery.trim() ? "Select shown applications" : "Select all applications"}
                  onChange={selection.toggleAll}
                />
                <input
                  className="axis-input app-house-filter"
                  value={nameQuery}
                  placeholder="Filter by name"
                  aria-label="Filter applications by name"
                  onChange={(event) => setNameQuery(event.target.value)}
                />
                <div className="app-house-sort">
                  <CatalogSortButton column="name" label="Name" sort={sort} onSort={toggleSort} />
                  <CatalogSortButton column="vendor" label="Vendor" sort={sort} onSort={toggleSort} />
                </div>
              </div>
              {filteredApps.length === 0 ? (
                <p className="muted">No applications match that name.</p>
              ) : null}
              {groups.map((vendor) => {
                const vendorIds = vendor.apps.flatMap((app) => app.versions.map((version) => version.id));
                const vendorAll = vendorIds.every((id) => selection.checkedIds.has(id));
                const vendorSome = vendorIds.some((id) => selection.checkedIds.has(id));
                return (
                  <section key={vendor.vendor || "all"} className="app-house-vendor">
                    {vendor.vendor ? (
                      <header>
                        <SelectCheckbox
                          checked={vendorAll}
                          indeterminate={vendorSome && !vendorAll}
                          label={`Select ${vendor.vendor}`}
                          onChange={() => selection.setMany(vendorIds, !vendorAll)}
                        />
                        <h3>{vendor.vendor}</h3>
                      </header>
                    ) : null}
                    {vendor.apps.map((app) => {
                      const versionIds = app.versions.map((version) => version.id);
                      const appAll = versionIds.every((id) => selection.checkedIds.has(id));
                      const appSome = versionIds.some((id) => selection.checkedIds.has(id));
                      const expanded = !collapsedApps.has(app.key);
                      const shared = sharedCatalogTone(app.versions);
                      const worst = worstCatalogTone(app.versions);
                      const cardTone = !expanded || shared ? worst : null;
                      return (
                        <div key={app.key} className={cardTone ? `app-house-app is-${cardTone}` : "app-house-app"}>
                          <div className="app-house-app-head">
                            <button
                              type="button"
                              className="axis-btn-ghost catalog-chevron"
                              aria-expanded={expanded}
                              aria-label={`${expanded ? "Collapse" : "Expand"} ${app.name}`}
                              onClick={() => toggleApp(app.key)}
                            >
                              {expanded ? "▾" : "▸"}
                            </button>
                            <SelectCheckbox
                              checked={appAll}
                              indeterminate={appSome && !appAll}
                              label={`Select all versions of ${app.name}`}
                              onChange={() => selection.setMany(versionIds, !appAll)}
                            />
                            <button
                              type="button"
                              className="app-house-name"
                              title={catalogToneTitle(worst)}
                              onClick={() => toggleApp(app.key)}
                            >
                              {app.name}
                              <span>
                                {sort.key === "name" ? `${app.vendor} · ` : ""}
                                {app.versions.length} {app.versions.length === 1 ? "version" : "versions"}
                              </span>
                            </button>
                          </div>
                          {expanded ? (
                            <ul className="app-house-versions">
                              {app.versions.map((version) => {
                                const tone = catalogTone(version);
                                const selected = selectedId === version.id;
                                return (
                                  <li
                                    key={version.id}
                                    data-catalog-version={version.id}
                                    className={[selected ? "is-selected" : "", cardTone ? "" : `is-${tone}`]
                                      .filter(Boolean)
                                      .join(" ")}
                                  >
                                    <SelectCheckbox
                                      checked={selection.checkedIds.has(version.id)}
                                      label={`Select ${app.name} ${version.version}`}
                                      onChange={() => selection.toggle(version.id)}
                                    />
                                    <button
                                      type="button"
                                      className="app-house-version"
                                      title={versionStatusTitle(version)}
                                      onClick={() => setSelectedId(version.id)}
                                    >
                                      <span className="tabular">{version.version || "no version"}</span>
                                      <span className={`app-house-status is-${tone}`}>{versionStatusLabel(version)}</span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </>
          )}
        </div>
        {selectedApp ? (
          <CatalogAppBuilder
            app={selectedApp}
            sourceRoot={root}
            catalogApps={apps}
            onSaved={() => void reload(root)}
          />
        ) : (
          <section className="app-house-build app-house-build-empty">
            <p className="axis-kicker">Win32 package</p>
            <h2>Select a version</h2>
            <p className="muted">
              Each version is an Intune Win32 package. Open one to set the name, install commands,
              requirements, and detection rules stored in PackageInformation\config.json.
            </p>
          </section>
        )}
        </div>
      )}

      {createOpen && root ? (
        <CatalogAppDialog
          title="New application"
          kicker="Local catalog"
          submitLabel="Create"
          initialVersion="1.0.0.0"
          showIdentity
          suggestions={apps}
          onClose={() => setCreateOpen(false)}
          onSubmit={async (draft) => {
            const created = await createCatalogApp({
              sourceRoot: root,
              vendor: draft.vendor,
              name: draft.name,
              version: draft.version,
              description: draft.description,
            });
            setCreateOpen(false);
            revealCreated(created);
            await reload(root);
          }}
        />
      ) : null}

      {copyTarget && root ? (
        <CatalogAppDialog
          title={`Copy ${copyTarget.name}`}
          kicker={copyTarget.relativePath}
          submitLabel="Copy"
          initialVersion=""
          showIdentity={false}
          onClose={() => setCopyTarget(null)}
          onSubmit={async (draft) => {
            const created = await copyCatalogAppVersion({
              sourceAppPath: copyTarget.localPath,
              newVersion: draft.version,
              sourceRoot: root,
            });
            setCopyTarget(null);
            revealCreated(created);
            await reload(root);
          }}
        />
      ) : null}
    </div>
  );
}

function CatalogAppDialog({
  title,
  kicker,
  submitLabel,
  initialVersion,
  showIdentity,
  suggestions = [],
  onClose,
  onSubmit,
}: {
  title: string;
  kicker: string;
  submitLabel: string;
  initialVersion: string;
  showIdentity: boolean;
  suggestions?: CatalogAppSummary[];
  onClose: () => void;
  onSubmit: (draft: { vendor: string; name: string; version: string; description: string }) => Promise<void>;
}) {
  const [vendor, setVendor] = useState("");
  const [name, setName] = useState("");
  const [version, setVersion] = useState(initialVersion);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vendorOptions = useMemo(() => uniqueLabels(suggestions.map((app) => app.vendor)), [suggestions]);
  const nameOptions = useMemo(() => {
    const query = vendor.trim().toLowerCase();
    const rows = query
      ? suggestions.filter((app) => app.vendor.toLowerCase().startsWith(query))
      : suggestions;
    return uniqueLabels(rows.map((app) => app.name));
  }, [suggestions, vendor]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ vendor, name, version, description });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="axis-modal-backdrop" onClick={onClose}>
      <div
        className="axis-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">{kicker}</p>
            <h2>{title}</h2>
          </div>
        </div>
        <div className="create-script-form">
          {showIdentity ? (
            <>
              <CompleteField label="Vendor" value={vendor} options={vendorOptions} onChange={setVendor} />
              <CompleteField label="Application" value={name} options={nameOptions} onChange={setName} />
            </>
          ) : (
            <p className="muted">Copies the package folder as a new version and skips Output and IntuneWin files.</p>
          )}
          <label className="device-field">
            Version
            <input className="axis-input" value={version} onChange={(event) => setVersion(event.target.value)} />
          </label>
          {showIdentity ? (
            <label className="device-field">
              Description
              <input
                className="axis-input"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          ) : null}
          {error ? <p className="axis-alert axis-alert-danger">{error}</p> : null}
          <div className="page-header-actions">
            <button type="button" className="axis-btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="axis-btn axis-btn-primary" onClick={() => void submit()} disabled={busy}>
              {busy ? "Saving…" : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type CatalogTone = "incomplete" | "ready" | "source";

function configGaps(version: CatalogAppSummary): string[] {
  return (version.missingRequired ?? []).filter((field) => field !== "File");
}

function catalogTone(version: CatalogAppSummary): CatalogTone {
  if (configGaps(version).length > 0) return "incomplete";
  if (version.hasIntuneWin) return "ready";
  return "source";
}

function sharedCatalogTone(versions: CatalogAppSummary[]): CatalogTone | null {
  if (versions.length === 0) return null;
  const first = catalogTone(versions[0]);
  return versions.every((version) => catalogTone(version) === first) ? first : null;
}

function worstCatalogTone(versions: CatalogAppSummary[]): CatalogTone {
  if (versions.some((version) => catalogTone(version) === "incomplete")) return "incomplete";
  if (versions.some((version) => catalogTone(version) === "source")) return "source";
  return "ready";
}

function catalogToneTitle(tone: CatalogTone): string {
  if (tone === "incomplete") return "Missing required information";
  if (tone === "ready") return "Ready";
  return "Source only";
}

function versionStatusLabel(version: CatalogAppSummary): string {
  if (configGaps(version).length > 0) return "Missing info";
  if (version.hasIntuneWin) return "Ready";
  return "Source only";
}

function versionStatusTitle(version: CatalogAppSummary): string {
  const missing = version.missingRequired ?? [];
  if (configGaps(version).length > 0) return `Missing ${missing.join(", ")}`;
  if (version.hasIntuneWin) return "Ready";
  return "Source only";
}

function uniqueLabels(values: string[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(trimmed);
  }
  labels.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return labels;
}

function prefixCompletion(value: string, options: string[]): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  const hits = options.filter((option) => {
    const text = option.toLowerCase();
    return text.startsWith(lower) && text !== lower;
  });
  hits.sort((a, b) => a.length - b.length || a.localeCompare(b, undefined, { sensitivity: "base" }));
  return hits[0] ?? null;
}

function CompleteField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const match = prefixCompletion(value, options);
  const rest = match ? match.slice(value.length) : "";

  function accept(event: KeyboardEvent<HTMLInputElement>) {
    if (!match) return;
    const input = event.currentTarget;
    const atEnd = input.selectionStart === value.length && input.selectionEnd === value.length;
    if (event.key === "ArrowRight" && !atEnd) return;
    if (event.key !== "Tab" && event.key !== "ArrowRight") return;
    event.preventDefault();
    onChange(match);
  }

  return (
    <label className="device-field">
      {label}
      <span className="catalog-complete">
        {rest ? (
          <span className="catalog-complete-ghost" aria-hidden="true">
            <span className="catalog-complete-typed">{value}</span>
            <span className="catalog-complete-rest">{rest}</span>
          </span>
        ) : null}
        <input
          className="axis-input"
          value={value}
          autoComplete="off"
          aria-autocomplete="inline"
          title={match ? `Tab to use ${match}` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={accept}
        />
      </span>
    </label>
  );
}
