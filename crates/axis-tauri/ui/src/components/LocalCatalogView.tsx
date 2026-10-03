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
  const [collapsedApps, setCollapsedApps] = useState<Set<string>>(() => new Set());
  const [nameQuery, setNameQuery] = useState("");
  const { sort, toggle: toggleSort } = useColumnSort<"name" | "vendor">("vendor");
  const filteredApps = useMemo(() => {
    const query = nameQuery.trim().toLowerCase();
    if (!query) return apps;
    return apps.filter((app) => app.name.toLowerCase().includes(query));
  }, [apps, nameQuery]);
  const selectedApp = apps.find((app) => app.listId === selectedId) ?? null;
  const visibleIds = useMemo(() => filteredApps.map((app) => app.listId), [filteredApps]);
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
    const row = document.querySelector(`[data-catalog-version="${CSS.escape(selectedId)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [apps, selectedId]);

  function revealCreated(created: CatalogAppSummary, choice: CatalogChoice) {
    const vendor = (created.vendor.trim() || "Unknown").toLowerCase();
    const name = (created.name.trim() || "Application").toLowerCase();
    setCollapsedApps((current) => {
      const next = new Set(current);
      next.delete(`${choice.kind}\u0000${vendor}\u0000${name}`);
      return next;
    });
    setSelectedId(listedId(choice.kind, created.id));
  }

  async function chooseFolder() {
    const picked = await pickLocalPackFolder("Global Folder");
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
          catalogs.length > 0
            ? catalogs.map((choice) => choice.label).join(" · ")
            : "Choose a global folder, or open a client container."
        }
        onRefresh={() => void reload(tenantChoice, genericChoice)}
        refreshing={loading}
        actions={
          <>
            <button type="button" className="axis-btn" onClick={() => void chooseFolder()}>
              Global Folder
            </button>
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
              className="axis-btn axis-btn-danger"
              disabled={selected.length === 0}
              onClick={() => setDeleteTargets(selected)}
            >
              Delete
            </button>
          </>
        }
      />

      {error ? (
        <div className="axis-alert axis-alert-danger">{error}</div>
      ) : null}

      {catalogs.length === 0 ? (
        <p className="muted">
          Choose a global folder, or open a client container. Packages are stored as{" "}
          <code>Applications\Vendor\App\Version</code>.
        </p>
      ) : (
        <div className="app-house-split">
        <div className="axis-panel app-house">
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
          {loading ? <p className="muted">Loading catalog…</p> : null}
          <CatalogLane
            kind="tenant"
            title={tenantLabel}
            path={bound}
            note={bound ? null : "Open a client container to see its catalog."}
            apps={filteredApps.filter((app) => app.catalogKind === "tenant")}
            sourceCount={apps.filter((app) => app.catalogKind === "tenant").length}
            sort={sort}
            nameQuery={nameQuery}
            loading={loading}
            collapsedApps={collapsedApps}
            selectedId={selectedId}
            checkedIds={selection.checkedIds}
            onToggleApp={toggleApp}
            onSelect={setSelectedId}
            onToggle={selection.toggle}
            onSetMany={selection.setMany}
            createLabel="New tenant app"
            onCreate={bound ? () => setCreateChoice({ kind: "tenant", label: tenantLabel, root: bound }) : undefined}
          />
          <CatalogLane
            kind="generic"
            title="Global Folder"
            path={genericRoot}
            note={
              genericRoot
                ? null
                : repoRoot && bound && sameFolder(repoRoot, bound)
                  ? "The global folder is this tenant catalog. Choose a different folder to keep a separate catalog."
                  : "Choose a global folder."
            }
            apps={filteredApps.filter((app) => app.catalogKind === "generic")}
            sourceCount={apps.filter((app) => app.catalogKind === "generic").length}
            sort={sort}
            nameQuery={nameQuery}
            loading={loading}
            collapsedApps={collapsedApps}
            selectedId={selectedId}
            checkedIds={selection.checkedIds}
            onToggleApp={toggleApp}
            onSelect={setSelectedId}
            onToggle={selection.toggle}
            onSetMany={selection.setMany}
            createLabel="New global app"
            onCreate={
              genericRoot
                ? () => setCreateChoice({ kind: "generic", label: "Global Folder", root: genericRoot })
                : undefined
            }
          />
        </div>
        {selectedApp ? (
          <CatalogAppBuilder
            app={selectedApp}
            sourceRoot={selectedApp.sourceRoot}
            catalogApps={apps.filter((app) => sameFolder(app.sourceRoot, selectedApp.sourceRoot))}
            onSaved={() => void reload(tenantChoice, genericChoice)}
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

function CatalogLane({
  kind,
  title,
  path,
  note,
  apps,
  sourceCount,
  sort,
  nameQuery,
  loading,
  collapsedApps,
  selectedId,
  checkedIds,
  onToggleApp,
  onSelect,
  onToggle,
  onSetMany,
  createLabel,
  onCreate,
}: {
  kind: CatalogKind;
  title: string;
  path: string | null;
  note: string | null;
  apps: ListedCatalogApp[];
  sourceCount: number;
  sort: { key: "name" | "vendor"; dir: "asc" | "desc" };
  nameQuery: string;
  loading: boolean;
  collapsedApps: Set<string>;
  selectedId: string | null;
  checkedIds: Set<string>;
  onToggleApp: (key: string) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onSetMany: (ids: readonly string[], selected: boolean) => void;
  createLabel?: string;
  onCreate?: () => void;
}) {
  const groups = groupCatalogApps(apps, sort);
  return (
    <section className="app-house-catalog">
      <header>
        <div className="app-house-catalog-title">
          <h2>{title}</h2>
          {path ? <p title={path}>{path}</p> : null}
        </div>
        {onCreate && createLabel ? (
          <button type="button" className="axis-btn axis-btn-primary" onClick={onCreate}>
            {createLabel}
          </button>
        ) : null}
      </header>
      {note ? <p className="muted">{note}</p> : null}
      {path && !loading && sourceCount === 0 ? <p className="muted">No applications in this catalog yet.</p> : null}
      {path && !loading && sourceCount > 0 && apps.length === 0 && nameQuery.trim() ? (
        <p className="muted">No applications match that name.</p>
      ) : null}
      {groups.map((vendor) => {
        const vendorIds = vendor.apps.flatMap((app) => app.versions.map((version) => version.listId));
        const vendorAll = vendorIds.every((id) => checkedIds.has(id));
        const vendorSome = vendorIds.some((id) => checkedIds.has(id));
        return (
          <section key={`${kind}:${vendor.vendor || "all"}`} className="app-house-vendor">
            {vendor.vendor ? (
              <header>
                <SelectCheckbox
                  checked={vendorAll}
                  indeterminate={vendorSome && !vendorAll}
                  label={`Select ${vendor.vendor}`}
                  onChange={() => onSetMany(vendorIds, !vendorAll)}
                />
                <h3>{vendor.vendor}</h3>
              </header>
            ) : null}
            {vendor.apps.map((app) => {
              const collapseKey = `${kind}\u0000${app.key}`;
              const versionIds = app.versions.map((version) => version.listId);
              const appAll = versionIds.every((id) => checkedIds.has(id));
              const appSome = versionIds.some((id) => checkedIds.has(id));
              const expanded = !collapsedApps.has(collapseKey);
              const shared = sharedCatalogTone(app.versions);
              const worst = worstCatalogTone(app.versions);
              const cardTone = !expanded || shared ? worst : null;
              return (
                <div key={collapseKey} className={cardTone ? `app-house-app is-${cardTone}` : "app-house-app"}>
                  <div className="app-house-app-head">
                    <button
                      type="button"
                      className="axis-btn-ghost catalog-chevron"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "Collapse" : "Expand"} ${app.name}`}
                      onClick={() => onToggleApp(collapseKey)}
                    >
                      {expanded ? "▾" : "▸"}
                    </button>
                    <SelectCheckbox
                      checked={appAll}
                      indeterminate={appSome && !appAll}
                      label={`Select all versions of ${app.name}`}
                      onChange={() => onSetMany(versionIds, !appAll)}
                    />
                    <button
                      type="button"
                      className="app-house-name"
                      title={catalogToneTitle(worst)}
                      onClick={() => onToggleApp(collapseKey)}
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
                        const selected = selectedId === version.listId;
                        return (
                          <li
                            key={version.listId}
                            data-catalog-version={version.listId}
                            className={[selected ? "is-selected" : "", cardTone ? "" : `is-${tone}`]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <SelectCheckbox
                              checked={checkedIds.has(version.listId)}
                              label={`Select ${app.name} ${version.version}`}
                              onChange={() => onToggle(version.listId)}
                            />
                            <button
                              type="button"
                              className="app-house-version"
                              title={versionStatusTitle(version)}
                              onClick={() => onSelect(version.listId)}
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
    </section>
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
            <p className="axis-kicker">Local catalog</p>
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
