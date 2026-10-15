import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { CloseButton } from "./ui/CloseButton";
import { PageHeader } from "./ui/PageChrome";
import { SelectCheckbox, useCheckedIds } from "./workbench/PolicyBulkAssign";
import { useColumnSort } from "./workbench/shared";
import { APP_CATALOG_ROOT_KEY } from "../lib/baselines/sources";
import type { ClientContainerStatus } from "../types/clientContainer";
import { CatalogAppBuilder } from "./workbench/CatalogAppBuilder";
import {
  copyCatalogAppVersion,
  createCatalogApp,
  deleteCatalogApps,
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

function sameFolder(left: string, right: string): boolean {
  const norm = (value: string) => value.trim().replace(/[\\/]+$/, "").toLowerCase();
  return norm(left) === norm(right);
}

type CatalogKind = "tenant" | "generic";

type ListedCatalogApp = CatalogAppSummary & {
  catalogKind: CatalogKind;
  catalogLabel: string;
  sourceRoot: string;
  listId: string;
};

type CatalogScope = CatalogKind | "both";

type CatalogChoice = {
  kind: CatalogKind;
  label: string;
  root: string;
};

function listedId(kind: CatalogKind, id: string): string {
  return `${kind}::${id}`;
}

function toListed(row: CatalogAppSummary, choice: CatalogChoice): ListedCatalogApp {
  return {
    ...row,
    catalogKind: choice.kind,
    catalogLabel: choice.label,
    sourceRoot: choice.root,
    listId: listedId(choice.kind, row.id),
  };
}

type CatalogAppGroup<T extends CatalogAppSummary = CatalogAppSummary> = {
  key: string;
  vendor: string;
  name: string;
  versions: T[];
};

type CatalogVendorGroup<T extends CatalogAppSummary = CatalogAppSummary> = {
  vendor: string;
  apps: CatalogAppGroup<T>[];
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
function groupCatalogApps<T extends CatalogAppSummary>(
  apps: T[],
  sort: { key: "name" | "vendor"; dir: "asc" | "desc" },
): CatalogVendorGroup<T>[] {
  const byApp = new Map<string, CatalogAppGroup<T>>();
  for (const app of apps) {
    const vendor = app.vendor.trim() || "Unknown";
    const name = app.name.trim() || "Application";
    // Keep each catalog's copy of an app separate when both catalogs are listed together.
    const kind = (app as { catalogKind?: string }).catalogKind ?? "";
    const appKey = `${kind}\u0000${vendor.toLowerCase()}\u0000${name.toLowerCase()}`;
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
  const byVendor = new Map<string, CatalogAppGroup<T>[]>();
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
  const tenantLabel = container?.manifest?.name?.trim() || "Tenant catalog";
  const [repoRoot, setRepoRoot] = useState<string | null>(() => savedRepo());
  const genericRoot = repoRoot && bound && sameFolder(repoRoot, bound) ? null : repoRoot;
  const tenantChoice: CatalogChoice | null = bound ? { kind: "tenant", label: tenantLabel, root: bound } : null;
  const genericChoice: CatalogChoice | null = genericRoot
    ? { kind: "generic", label: "Global Folder", root: genericRoot }
    : null;
  const catalogs = [tenantChoice, genericChoice].filter((choice): choice is CatalogChoice => choice !== null);
  const [apps, setApps] = useState<ListedCatalogApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createChoice, setCreateChoice] = useState<CatalogChoice | null>(null);
  const [copyTarget, setCopyTarget] = useState<ListedCatalogApp | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<ListedCatalogApp[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scope, setScope] = useState<CatalogScope>(() => (bound && genericRoot ? "both" : bound ? "tenant" : "generic"));
  const [nameQuery, setNameQuery] = useState("");
  const { sort, toggle: toggleSort } = useColumnSort<"name" | "vendor">("vendor");
  const filteredApps = useMemo(() => {
    const query = nameQuery.trim().toLowerCase();
    if (!query) return apps;
    return apps.filter((app) => app.name.toLowerCase().includes(query));
  }, [apps, nameQuery]);
  const selectedApp = apps.find((app) => app.listId === selectedId) ?? null;
  const visibleIds = useMemo(
    () => filteredApps.filter((app) => scope === "both" || app.catalogKind === scope).map((app) => app.listId),
    [filteredApps, scope],
  );
  const selection = useCheckedIds(visibleIds);
  const selected = apps.filter((app) => selection.checkedIds.has(app.listId));

  const reload = useCallback(async (tenant: CatalogChoice | null, generic: CatalogChoice | null) => {
    const jobs = [tenant, generic].filter((choice): choice is CatalogChoice => choice !== null);
    if (jobs.length === 0) {
      setApps([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const settled = await Promise.all(
      jobs.map(async (choice) => {
        try {
          const rows = await listCatalogApps(choice.root);
          return { choice, rows, error: null as string | null };
        } catch (err) {
          return {
            choice,
            rows: [] as CatalogAppSummary[],
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    setApps(settled.flatMap((result) => result.rows.map((row) => toListed(row, result.choice))));
    const messages = settled.flatMap((result) =>
      result.error ? [`${result.choice.label}: ${result.error}`] : [],
    );
    setError(messages.length > 0 ? messages.join(" ") : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    setRepoRoot(savedRepo());
  }, [bound]);

  // Opening or closing a client container can remove the catalog the switch points at.
  useEffect(() => {
    const valid =
      scope === "both" ? Boolean(bound && genericRoot) : scope === "tenant" ? Boolean(bound) : Boolean(genericRoot);
    if (!valid) setScope(bound && genericRoot ? "both" : bound ? "tenant" : "generic");
  }, [bound, genericRoot, scope]);

  useEffect(() => {
    if (catalogs.length === 0) {
      setCreateChoice(null);
      setCopyTarget(null);
      setDeleteTargets(null);
      setSelectedId(null);
    }
    void reload(tenantChoice, genericChoice);
  }, [reload, bound, genericRoot, tenantLabel]);

  useEffect(() => {
    if (selectedId && !apps.some((app) => app.listId === selectedId)) setSelectedId(null);
  }, [apps, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const row = document.querySelector(".app-catalog-row.is-open");
    row?.scrollIntoView({ block: "nearest" });
  }, [apps, selectedId]);

  function revealCreated(created: CatalogAppSummary, choice: CatalogChoice) {
    if (scope !== "both" && scope !== choice.kind) setScope(choice.kind);
    setSelectedId(listedId(choice.kind, created.id));
  }

  async function chooseFolder() {
    const picked = await pickLocalPackFolder("Global Folder");
    const folder = picked?.trim();
    if (!folder) return;
    window.localStorage.setItem(APP_CATALOG_ROOT_KEY, folder);
    setRepoRoot(folder);
  }

  const scopedApps = filteredApps.filter((app) => scope === "both" || app.catalogKind === scope);
  const groups = groupCatalogApps(scopedApps, sort);
  const openGroup = selectedApp
    ? groupCatalogApps(
        apps.filter((app) => app.catalogKind === selectedApp.catalogKind && sameFolder(app.sourceRoot, selectedApp.sourceRoot)),
        sort,
      )
        .flatMap((vendor) => vendor.apps)
        .find((group) => group.versions.some((version) => version.listId === selectedApp.listId)) ?? null
    : null;
  const scopeCounts = {
    tenant: apps.filter((app) => app.catalogKind === "tenant").length,
    generic: apps.filter((app) => app.catalogKind === "generic").length,
  };
  const scopeOptions: Array<{ value: CatalogScope; label: string; count: number; disabled: boolean }> = [
    { value: "tenant", label: tenantLabel, count: scopeCounts.tenant, disabled: !tenantChoice },
    { value: "generic", label: "Global", count: scopeCounts.generic, disabled: !genericChoice },
    { value: "both", label: "Both", count: apps.length, disabled: catalogs.length < 2 },
  ];
  const createTarget: CatalogChoice | null =
    scope === "generic" ? genericChoice : scope === "tenant" ? tenantChoice : tenantChoice ?? genericChoice;

  return (
    <div className="stack app-catalog">
      <PageHeader
        eyebrow="Library"
        title="Local application catalog"
        description={
          catalogs.length > 0
            ? catalogs.map((choice) => `${choice.label}: ${choice.root}`).join(" · ")
            : "Choose a global folder, or open a client container."
        }
        onRefresh={() => void reload(tenantChoice, genericChoice)}
        refreshing={loading}
        actions={
          <button type="button" className="axis-btn" onClick={() => void chooseFolder()}>
            {genericRoot ? "Change Global Folder…" : "Choose Global Folder…"}
          </button>
        }
      />

      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}

      {catalogs.length === 0 ? (
        <p className="muted">
          Choose a global folder, or open a client container. Packages are stored as{" "}
          <code>Applications\Vendor\App\Version</code>.
        </p>
      ) : (
        <div className="app-catalog-split">
          <section className="axis-panel app-catalog-list" aria-label="Applications">
            <div className="app-catalog-list-head">
              <div className="app-catalog-scope" role="tablist" aria-label="Catalog">
                {scopeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={scope === option.value}
                    disabled={option.disabled}
                    className={scope === option.value ? "is-active" : undefined}
                    onClick={() => setScope(option.value)}
                  >
                    <span className="app-catalog-scope-label">{option.label}</span>
                    <span className="app-catalog-scope-count">{option.count}</span>
                  </button>
                ))}
              </div>
              <div className="app-catalog-tools">
                <input
                  className="axis-input"
                  value={nameQuery}
                  placeholder="Filter by name"
                  aria-label="Filter applications by name"
                  onChange={(event) => setNameQuery(event.target.value)}
                />
                <CatalogSortButton column="name" label="Name" sort={sort} onSort={toggleSort} />
                <CatalogSortButton column="vendor" label="Vendor" sort={sort} onSort={toggleSort} />
                <button
                  type="button"
                  className="axis-btn axis-btn-primary"
                  disabled={!createTarget}
                  title={createTarget ? `New app in ${createTarget.label}` : undefined}
                  onClick={() => createTarget && setCreateChoice(createTarget)}
                >
                  + New app
                </button>
              </div>
            </div>
            <div className="app-catalog-cols">
              <SelectCheckbox
                checked={selection.allSelected}
                indeterminate={selection.checkedIds.size > 0 && !selection.allSelected}
                disabled={scopedApps.length === 0}
                label={nameQuery.trim() ? "Select shown applications" : "Select all applications"}
                onChange={selection.toggleAll}
              />
              <span>Application</span>
              <span>Latest</span>
            </div>
            <div className="app-catalog-rows">
              {loading ? <p className="muted app-catalog-empty">Loading catalog…</p> : null}
              {!loading && scopedApps.length === 0 ? (
                <p className="muted app-catalog-empty">
                  {nameQuery.trim() ? "No applications match that name." : "No applications in this catalog yet."}
                </p>
              ) : null}
              {groups.map((vendor) => (
                <div key={vendor.vendor || "all"} className="app-catalog-vendor">
                  {vendor.vendor ? <p className="app-catalog-vendor-name">{vendor.vendor}</p> : null}
                  {vendor.apps.map((group) => {
                    const latest = group.versions[0];
                    const ids = group.versions.map((version) => version.listId);
                    const all = ids.every((id) => selection.checkedIds.has(id));
                    const some = ids.some((id) => selection.checkedIds.has(id));
                    const isOpen = Boolean(selectedApp && ids.includes(selectedApp.listId));
                    const tone = catalogTone(latest);
                    return (
                      <div key={`${latest.catalogKind}:${group.key}`} className={`app-catalog-row${isOpen ? " is-open" : ""}`}>
                        <SelectCheckbox
                          checked={all}
                          indeterminate={some && !all}
                          label={`Select ${group.name}`}
                          onChange={() => selection.setMany(ids, !all)}
                        />
                        <button type="button" className="app-catalog-row-main" onClick={() => setSelectedId(latest.listId)}>
                          <span className="app-catalog-icon" aria-hidden="true">
                            {(group.name.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase()}
                          </span>
                          <span className="app-catalog-row-copy">
                            <span className="app-catalog-row-name">{group.name}</span>
                            <span className="app-catalog-row-meta">
                              {[
                                scope === "both" ? latest.catalogLabel : null,
                                sort.key === "name" ? group.vendor : null,
                                `${group.versions.length} ${group.versions.length === 1 ? "version" : "versions"}`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </span>
                        </button>
                        <span className={`app-catalog-latest is-${tone}`} title={versionStatusTitle(latest)}>
                          <span className="app-catalog-dot" aria-hidden="true" />
                          {latest.version || "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {selected.length > 0 ? (
              <div className="app-catalog-bulk" role="toolbar" aria-label="Bulk actions">
                <b>
                  {selected.length} version{selected.length === 1 ? "" : "s"} selected
                </b>
                <button type="button" className="axis-btn axis-btn-ghost" onClick={selection.clear}>
                  Clear
                </button>
                <button type="button" className="axis-btn axis-btn-danger" onClick={() => setDeleteTargets(selected)}>
                  Delete…
                </button>
              </div>
            ) : null}
          </section>

          {selectedApp ? (
            <section className="app-catalog-detail" aria-label={selectedApp.name}>
              <header className="app-catalog-detail-head">
                <span className="app-catalog-icon is-large" aria-hidden="true">
                  {(selectedApp.name.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase()}
                </span>
                <div className="app-catalog-detail-title">
                  <div className="app-catalog-detail-tags">
                    <span className="axis-pill">{selectedApp.catalogLabel}</span>
                    <span className="axis-pill">Win32</span>
                  </div>
                  <h2>{selectedApp.name}</h2>
                  <p className="app-catalog-path" title={selectedApp.localPath}>
                    {selectedApp.relativePath}
                  </p>
                </div>
                <div className="app-catalog-detail-actions" role="toolbar" aria-label="Version actions">
                  <button
                    type="button"
                    className="axis-btn axis-btn-icon"
                    aria-label="Refresh"
                    title="Refresh"
                    onClick={() => void reload(tenantChoice, genericChoice)}
                  >
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                      <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
                    </svg>
                  </button>
                  <button type="button" className="axis-btn" onClick={() => void openExternalUrl(selectedApp.localPath)}>
                    Open folder
                  </button>
                  <button type="button" className="axis-btn" onClick={() => setCopyTarget(selectedApp)}>
                    New version…
                  </button>
                  <button
                    type="button"
                    className="axis-btn axis-btn-danger axis-btn-icon"
                    aria-label={`Delete ${selectedApp.name} ${selectedApp.version}`}
                    title="Delete this version"
                    onClick={() => setDeleteTargets([selectedApp])}
                  >
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                    </svg>
                  </button>
                </div>
              </header>
              {openGroup ? (
                <div className="app-catalog-versions" role="tablist" aria-label="Versions">
                  {openGroup.versions.map((version) => {
                    const tone = catalogTone(version);
                    return (
                      <button
                        key={version.listId}
                        type="button"
                        role="tab"
                        aria-selected={version.listId === selectedApp.listId}
                        className={`app-catalog-version is-${tone}${version.listId === selectedApp.listId ? " is-active" : ""}`}
                        title={versionStatusTitle(version)}
                        onClick={() => setSelectedId(version.listId)}
                      >
                        <span className="app-catalog-dot" aria-hidden="true" />
                        <span className="tabular">{version.version || "no version"}</span>
                        <span className="app-catalog-version-label">{versionStatusLabel(version)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <CatalogAppBuilder
                key={selectedApp.listId}
                app={selectedApp}
                sourceRoot={selectedApp.sourceRoot}
                catalogApps={apps.filter((app) => sameFolder(app.sourceRoot, selectedApp.sourceRoot))}
                onSaved={() => void reload(tenantChoice, genericChoice)}
              />
            </section>
          ) : (
            <section className="app-house-build app-house-build-empty">
              <p className="axis-kicker">Win32 package</p>
              <h2>Select an application</h2>
              <p className="muted">
                Each version is an Intune Win32 package. Open one to set the name, install commands,
                requirements, and detection rules stored in PackageInformation\config.json.
              </p>
            </section>
          )}
        </div>
      )}

      {createChoice ? (
        <CatalogAppDialog
          title={createChoice.kind === "tenant" ? "New tenant app" : "New global app"}
          kicker={createChoice.label}
          submitLabel="Create"
          initialVersion="1.0.0.0"
          showIdentity
          catalogs={[createChoice]}
          suggestions={apps}
          onClose={() => setCreateChoice(null)}
          onSubmit={async (draft) => {
            const created = await createCatalogApp({
              sourceRoot: draft.sourceRoot,
              vendor: draft.vendor,
              name: draft.name,
              version: draft.version,
              description: draft.description,
            });
            const choice = createChoice;
            setCreateChoice(null);
            revealCreated(created, choice);
            await reload(tenantChoice, genericChoice);
          }}
        />
      ) : null}

      {copyTarget ? (
        <CatalogAppDialog
          title={`Copy ${copyTarget.name}`}
          kicker={`${copyTarget.catalogLabel} · ${copyTarget.relativePath}`}
          submitLabel="Copy"
          initialVersion=""
          showIdentity={false}
          catalogs={[{ kind: copyTarget.catalogKind, label: copyTarget.catalogLabel, root: copyTarget.sourceRoot }]}
          onClose={() => setCopyTarget(null)}
          onSubmit={async (draft) => {
            const choice = {
              kind: copyTarget.catalogKind,
              label: copyTarget.catalogLabel,
              root: copyTarget.sourceRoot,
            };
            const created = await copyCatalogAppVersion({
              sourceAppPath: copyTarget.localPath,
              newVersion: draft.version,
              sourceRoot: copyTarget.sourceRoot,
            });
            setCopyTarget(null);
            revealCreated(created, choice);
            await reload(tenantChoice, genericChoice);
          }}
        />
      ) : null}

      {deleteTargets ? (
        <DeleteCatalogDialog
          targets={deleteTargets}
          onClose={() => setDeleteTargets(null)}
          onConfirm={async () => {
            const ids = new Set(deleteTargets.map((app) => app.listId));
            const byRoot = new Map<string, string[]>();
            for (const app of deleteTargets) {
              const paths = byRoot.get(app.sourceRoot) ?? [];
              paths.push(app.localPath);
              byRoot.set(app.sourceRoot, paths);
            }
            for (const [sourceRoot, appPaths] of byRoot) {
              await deleteCatalogApps({ sourceRoot, appPaths });
            }
            setDeleteTargets(null);
            selection.clear();
            if (selectedId && ids.has(selectedId)) setSelectedId(null);
            await reload(tenantChoice, genericChoice);
          }}
        />
      ) : null}
    </div>
  );
}

function DeleteCatalogDialog({
  targets,
  onClose,
  onConfirm,
}: {
  targets: ListedCatalogApp[];
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = [...targets].sort(
    (left, right) =>
      compareText(left.vendor, right.vendor) ||
      compareText(left.name, right.name) ||
      compareVersions(left.version, right.version),
  );
  const title = rows.length === 1 ? `Delete ${rows[0]?.name ?? "application"}` : `Delete ${rows.length} versions`;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="axis-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="axis-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Local application catalog</p>
            <h2>{title}</h2>
          </div>
          <CloseButton onClick={onClose} disabled={busy} />
        </div>
        <div className="create-script-form">
          <p className="muted">
            {rows.length === 1
              ? "This removes the package folder from the local catalog. The app in Intune stays."
              : "This removes these package folders from the local catalog. The apps in Intune stay."}
          </p>
          <ul className="catalog-delete-list">
            {rows.map((app) => (
              <li key={app.listId}>
                {[app.catalogLabel, app.vendor, app.name, app.version].filter(Boolean).join(" / ")}
              </li>
            ))}
          </ul>
          {error ? <p className="axis-alert axis-alert-danger">{error}</p> : null}
          <div className="page-header-actions">
            <button type="button" className="axis-btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="axis-btn axis-btn-danger" onClick={() => void confirm()} disabled={busy}>
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CatalogAppDialog({
  title,
  kicker,
  submitLabel,
  initialVersion,
  showIdentity,
  catalogs,
  suggestions = [],
  onClose,
  onSubmit,
}: {
  title: string;
  kicker: string;
  submitLabel: string;
  initialVersion: string;
  showIdentity: boolean;
  catalogs: CatalogChoice[];
  suggestions?: ListedCatalogApp[];
  onClose: () => void;
  onSubmit: (draft: {
    vendor: string;
    name: string;
    version: string;
    description: string;
    sourceRoot: string;
  }) => Promise<void>;
}) {
  const [vendor, setVendor] = useState("");
  const [name, setName] = useState("");
  const [version, setVersion] = useState(initialVersion);
  const [description, setDescription] = useState("");
  const [targetRoot, setTargetRoot] = useState(catalogs[0]?.root ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scoped = suggestions.filter((app) => sameFolder(app.sourceRoot, targetRoot));
  const vendorOptions = useMemo(() => uniqueLabels(scoped.map((app) => app.vendor)), [scoped]);
  const nameOptions = useMemo(() => {
    const query = vendor.trim().toLowerCase();
    const rows = query ? scoped.filter((app) => app.vendor.toLowerCase().startsWith(query)) : scoped;
    return uniqueLabels(rows.map((app) => app.name));
  }, [scoped, vendor]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ vendor, name, version, description, sourceRoot: targetRoot });
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
          {catalogs.length > 1 ? (
            <label className="device-field">
              Catalog
              <select className="axis-input" value={targetRoot} disabled={busy} onChange={(event) => setTargetRoot(event.target.value)}>
                {catalogs.map((choice) => (
                  <option key={choice.kind} value={choice.root}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
