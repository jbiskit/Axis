import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../ui/PageChrome";
import { navigate } from "../../lib/route";
import {
  applyPackChanges,
  listPackItems,
  openExternalUrl,
  openPackWorkspaceFromSource,
  planPackCompare,
} from "../../lib/tauri";
import type { PackApplyChangesResult, PackComparePlan } from "../../lib/tauri";
import type { PackWorkspace } from "../../types/packs";
import type { RestoreCandidate, RestorePlanItem } from "../../types/clientContainer";
import { WriteActionButton } from "../../lib/readOnly";
import {
  isFlatPackSource,
  isKitPackSource,
  loadStoredSources,
  packTitle,
  sanitizeSource,
  sourceOpenUrl,
} from "../../lib/baselines/sources";
import {
  canCompareSource,
  compareCacheKey,
  DRIFT_LABELS,
  DRIFT_ORDER,
  driftCounts,
  driftStatus,
  localPackRoot,
  rememberCompare,
  type DriftStatus,
} from "./packCompare";
import { ApplyResult, PackPlanView } from "./PackPlanView";

const PLATFORM_LABELS: Record<string, string> = { windows: "Windows", macos: "macOS", android: "Android", ios: "iOS" };

function isActionable(status: DriftStatus) {
  return status === "missing" || status === "differs";
}

/** One pack compared with the signed-in tenant: what matches, differs, or is missing. */
export function PackDriftView({ sourceId, signedIn }: { sourceId: string; signedIn: boolean }) {
  const source = useMemo(
    () => loadStoredSources().find((row) => row.id === sourceId) ?? null,
    [sourceId],
  );
  const [workspace, setWorkspace] = useState<PackWorkspace | null>(null);
  const [kitRel, setKitRel] = useState<string>("");
  const [plan, setPlan] = useState<PackComparePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [comparedAt, setComparedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DriftStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [planKeys, setPlanKeys] = useState<string[] | null>(null);
  const [items, setItems] = useState<RestoreCandidate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<PackApplyChangesResult | null>(null);

  const comparable = source ? canCompareSource(source) : false;
  // Flat packs have no axis-pack.json, so there is no manifest or kits to open.
  const flat = source ? isFlatPackSource(source) : false;
  const packRoot = workspace?.pack.root ?? (source && comparable ? localPackRoot(source) : "");

  const loadWorkspace = useCallback(async () => {
    if (!source) return;
    setLoading(true);
    setError(null);
    try {
      let next: PackWorkspace | null = null;
      if (!flat) {
        try {
          next = await openPackWorkspaceFromSource(sanitizeSource(source));
        } catch (err) {
          // A local folder without axis-pack.json is still a usable flat pack.
          if (!canCompareSource(source)) throw err;
        }
      }
      setWorkspace(next);
      if (canCompareSource(source)) {
        setItems(await listPackItems(next?.pack.root ?? localPackRoot(source)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [flat, source]);

  /** Create the picked items straight away. Add mode skips anything already in the tenant. */
  async function importPicked(keys: string[]) {
    if (!keys.length || !packRoot) return;
    if (!window.confirm(`Create ${keys.length} item${keys.length === 1 ? "" : "s"} in this tenant? Items that already exist are skipped, and nothing is changed or deleted.`)) return;
    setImporting(true);
    setError(null);
    setImportResult(null);
    try {
      setImportResult(await applyPackChanges({ packRoot, kitRelPath: kitRel || null, addKeys: keys, updateKeys: [] }));
      setPicked(new Set());
      setPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  const compare = useCallback(async () => {
    if (!packRoot || !comparable || !signedIn) return;
    setComparing(true);
    setError(null);
    setImportResult(null);
    try {
      const next = await planPackCompare({ packRoot, kitRelPath: kitRel || null });
      setPlan(next);
      setComparedAt(new Date());
      setChecked(new Set());
      rememberCompare(compareCacheKey(sourceId, kitRel || null), next.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setComparing(false);
    }
  }, [comparable, kitRel, packRoot, signedIn, sourceId]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  // A different kit invalidates the last comparison; the user re-runs it when ready.
  useEffect(() => {
    setPlan(null);
    setComparedAt(null);
    setChecked(new Set());
    setPicked(new Set());
  }, [kitRel]);

  const rows = useMemo(
    () =>
      (plan?.items ?? [])
        .map((item) => ({ item, status: driftStatus(item) }))
        .sort((a, b) => DRIFT_ORDER.indexOf(a.status) - DRIFT_ORDER.indexOf(b.status) || a.item.displayName.localeCompare(b.item.displayName)),
    [plan],
  );
  const counts = useMemo(() => driftCounts(plan?.items ?? []), [plan]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (filter === "all" || row.status === filter) &&
        (!q || row.item.displayName.toLowerCase().includes(q) || row.item.kind.toLowerCase().includes(q)),
    );
  }, [filter, query, rows]);
  const actionableShown = shown.filter((row) => isActionable(row.status));
  const checkedShown = actionableShown.filter((row) => checked.has(row.item.key)).length;
  const allChecked = actionableShown.length > 0 && checkedShown === actionableShown.length;

  function toggle(key: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setChecked((current) => {
      const next = new Set(current);
      for (const row of actionableShown) {
        if (allChecked) next.delete(row.item.key);
        else next.add(row.item.key);
      }
      return next;
    });
  }

  if (!source) {
    return (
      <div className="stack">
        <PageHeader eyebrow="Policy Packs" title="Pack not found" description="This pack is no longer in your library." />
        <button type="button" className="axis-btn" onClick={() => navigate("/intune/packs")}>
          Back to all packs
        </button>
      </div>
    );
  }

  const kits = workspace?.kits ?? [];
  const selectedKit = kits.find((kit) => kit.relPath === kitRel) ?? null;
  const meta = [
    comparable ? "Local folder" : "GitHub",
    flat || (comparable && !workspace && !loading) ? "Flat pack" : "Kit pack",
    workspace?.pack.version ? `v${workspace.pack.version}` : null,
    workspace?.pack.platforms.map((p) => PLATFORM_LABELS[p] ?? p).join(" · ") || null,
    `${comparable ? items.length : workspace?.artifacts.length ?? 0} items`,
    kits.length ? `${kits.length} kits` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (planKeys && plan && packRoot) {
    return (
      <PackPlanView
        packName={workspace?.pack.name || packTitle(source)}
        kitName={selectedKit?.name ?? null}
        packRoot={packRoot}
        kitRelPath={kitRel || null}
        items={plan.items}
        initialKeys={planKeys}
        onCancel={() => setPlanKeys(null)}
        onDone={() => {
          setPlanKeys(null);
          void compare();
        }}
      />
    );
  }

  return (
    <div className="stack packs-drift">
      <PageHeader
        eyebrow={
          <button type="button" className="axis-link packs-back" onClick={() => navigate("/intune/packs")}>
            ← Policy Packs
          </button>
        }
        title={workspace?.pack.name || packTitle(source)}
        description={meta}
        onRefresh={() => void loadWorkspace()}
        refreshing={loading || comparing}
        actions={
          <div className="packs-drift-actions">
            <button type="button" className="axis-btn" onClick={() => void openExternalUrl(sourceOpenUrl(source))}>
              {comparable ? "Open folder" : "Open repository"}
            </button>
            {isKitPackSource(source) && comparable ? (
              <button
                type="button"
                className="axis-btn"
                onClick={() => navigate(`/intune/packs?kits=${encodeURIComponent(sourceId)}`)}
              >
                Edit kits
              </button>
            ) : null}
          </div>
        }
      />

      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {plan?.warnings.length ? <p className="muted packs-warnings">{plan.warnings.join(" · ")}</p> : null}

      {!comparable ? (
        <section className="axis-panel axis-panel-padded packs-readonly">
          <p className="packs-empty-title">Comparing needs a local copy</p>
          <p className="muted">
            GitHub packs are read-only in Axis. Clone the repository and add the folder as a local pack to compare it with
            this tenant and apply changes. You can still browse and import individual items.
          </p>
          <div className="packs-readonly-actions">
            <button type="button" className="axis-btn axis-btn-primary" onClick={() => navigate("/intune/packs?view=items")}>
              Browse items
            </button>
            {isKitPackSource(source) ? (
              <button type="button" className="axis-btn" onClick={() => navigate(`/intune/packs?kits=${encodeURIComponent(sourceId)}`)}>
                View kits
              </button>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          <div className="packs-compare-line">
            <span className="muted">Compare</span>
            <select
              className="axis-select"
              aria-label="Pack contents to compare"
              value={kitRel}
              disabled={comparing}
              onChange={(event) => setKitRel(event.target.value)}
            >
              <option value="">Whole pack</option>
              {kits.map((kit) => (
                <option key={kit.relPath} value={kit.relPath}>
                  Kit: {kit.name} ({kit.includeCount})
                </option>
              ))}
            </select>
            <span className="muted">with this tenant</span>
            <span className="packs-compare-when muted">
              {comparing ? "Comparing…" : comparedAt ? `Compared ${comparedAt.toLocaleTimeString()}` : signedIn ? "" : "Sign in to compare"}
            </span>
            <button
              type="button"
              className={`axis-btn${plan ? "" : " axis-btn-primary"}`}
              disabled={comparing || importing || !signedIn || !packRoot}
              onClick={() => void compare()}
            >
              {comparing ? "Comparing…" : plan ? "Compare again" : "Compare with tenant"}
            </button>
          </div>

          {importResult ? <ApplyResult result={importResult} /> : null}

          {!plan ? (
            <PackContents
              items={items}
              kitIncludes={selectedKit ? new Set(selectedKit.includes) : null}
              comparing={comparing}
              loading={loading}
              picked={picked}
              onPickedChange={setPicked}
              importing={importing}
              canImport={signedIn}
              onImport={(keys) => void importPicked(keys)}
            />
          ) : null}

          {plan ? (
          <>
          <div className="packs-filters">
            <button
              type="button"
              className={`packs-chip${filter === "all" ? " is-active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All <b>{rows.length}</b>
            </button>
            {DRIFT_ORDER.filter((status) => counts[status] > 0).map((status) => (
              <button
                key={status}
                type="button"
                className={`packs-chip is-${status}${filter === status ? " is-active" : ""}`}
                onClick={() => setFilter(status)}
              >
                <span className="packs-dot" aria-hidden="true" />
                {DRIFT_LABELS[status]} <b>{counts[status]}</b>
              </button>
            ))}
            <label className="packs-search packs-filters-search">
              <input
                type="search"
                aria-label="Filter items"
                placeholder="Filter items"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>

          <div className="axis-panel packs-drift-table">
            <table className="axis-table">
              <thead>
                <tr>
                  <th className="axis-table-check">
                    <input
                      type="checkbox"
                      aria-label="Select every listed item that can be applied"
                      checked={allChecked}
                      ref={(node) => {
                        if (node) node.indeterminate = checkedShown > 0 && !allChecked;
                      }}
                      disabled={actionableShown.length === 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>In the pack</th>
                  <th>Status</th>
                  <th>Detail</th>
                  <th className="packs-col-action" />
                </tr>
              </thead>
              <tbody>
                {shown.map(({ item, status }) => (
                  <DriftRow
                    key={item.key}
                    item={item}
                    status={status}
                    checked={checked.has(item.key)}
                    onToggle={() => toggle(item.key)}
                    onAct={() => setPlanKeys([item.key])}
                  />
                ))}
              </tbody>
            </table>
            {!comparing && shown.length === 0 ? <p className="muted packs-table-empty">Nothing matches this filter.</p> : null}
          </div>

            <div className="packs-drift-bar">
              <span>
                <b>
                  {counts.missing} not in tenant · {counts.differs} differ
                </b>
                <span className="muted"> · nothing is deleted</span>
              </span>
              <button
                type="button"
                className="axis-btn axis-btn-primary"
                disabled={counts.missing + counts.differs === 0}
                onClick={() =>
                  setPlanKeys(
                    checked.size
                      ? [...checked]
                      : rows.filter((row) => isActionable(row.status)).map((row) => row.item.key),
                  )
                }
              >
                {checked.size ? `Review ${checked.size} selected…` : "Review & apply…"}
              </button>
            </div>
          </>
          ) : null}
        </>
      )}
    </div>
  );
}

function DriftRow({
  item,
  status,
  checked,
  onToggle,
  onAct,
}: {
  item: RestorePlanItem;
  status: DriftStatus;
  checked: boolean;
  onToggle: () => void;
  onAct: () => void;
}) {
  const actionable = isActionable(status);
  return (
    <tr className={checked ? "selected" : undefined}>
      <td className="axis-table-check">
        {actionable ? (
          <input type="checkbox" aria-label={`Select ${item.displayName}`} checked={checked} onChange={onToggle} />
        ) : null}
      </td>
      <td>
        <span className="packs-item-name">{item.displayName}</span>
        <span className="packs-item-kind">{item.kind}</span>
      </td>
      <td>
        <span className={`packs-status is-${status}`}>
          <span className="packs-dot" aria-hidden="true" />
          {DRIFT_LABELS[status]}
        </span>
      </td>
      <td className="muted packs-item-detail">{item.message ?? ""}</td>
      <td className="packs-col-action">
        {actionable ? (
          <button type="button" className="axis-btn" onClick={onAct}>
            {status === "missing" ? "Create…" : "Update…"}
          </button>
        ) : null}
      </td>
    </tr>
  );
}


/** What is in the pack before any comparison. Items can be imported straight away. */
function PackContents({
  items,
  kitIncludes,
  comparing,
  loading,
  picked,
  onPickedChange,
  importing,
  canImport,
  onImport,
}: {
  items: RestoreCandidate[];
  kitIncludes: ReadonlySet<string> | null;
  comparing: boolean;
  loading: boolean;
  picked: ReadonlySet<string>;
  onPickedChange: (next: Set<string>) => void;
  importing: boolean;
  canImport: boolean;
  onImport: (keys: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const rows = items.filter(
    (item) =>
      (!kitIncludes || item.relPaths.some((rel) => kitIncludes.has(rel))) &&
      (!q || item.displayName.toLowerCase().includes(q) || item.kind.toLowerCase().includes(q)),
  );
  const importable = rows.filter((item) => item.restorable);
  const pickedShown = importable.filter((item) => picked.has(item.key)).length;
  const allPicked = importable.length > 0 && pickedShown === importable.length;

  function toggle(key: string) {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onPickedChange(next);
  }

  function toggleAll() {
    const next = new Set(picked);
    for (const item of importable) {
      if (allPicked) next.delete(item.key);
      else next.add(item.key);
    }
    onPickedChange(next);
  }

  return (
    <>
      <div className="packs-filters">
        <span className="muted packs-contents-note-inline">
          {comparing
            ? "Comparing with this tenant…"
            : loading
              ? "Reading the pack…"
              : `${rows.length} item${rows.length === 1 ? "" : "s"} · not compared yet`}
        </span>
        <label className="packs-search packs-filters-search">
          <input
            type="search"
            aria-label="Filter items"
            placeholder="Filter items"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="axis-panel packs-drift-table">
        <table className="axis-table">
          <thead>
            <tr>
              <th className="axis-table-check">
                <input
                  type="checkbox"
                  aria-label="Select every importable item"
                  checked={allPicked}
                  ref={(node) => {
                    if (node) node.indeterminate = pickedShown > 0 && !allPicked;
                  }}
                  disabled={importable.length === 0 || importing}
                  onChange={toggleAll}
                />
              </th>
              <th>In the pack</th>
              <th>Type</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.key} className={picked.has(item.key) ? "selected" : undefined}>
                <td className="axis-table-check">
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.displayName}`}
                    checked={picked.has(item.key)}
                    disabled={!item.restorable || importing}
                    onChange={() => toggle(item.key)}
                  />
                </td>
                <td>
                  <span className="packs-item-name" title={item.relPaths.join("\n")}>
                    {item.displayName}
                  </span>
                </td>
                <td className="muted">{item.kind}</td>
                <td className="muted packs-item-detail">{item.restorable ? "" : item.note ?? "Cannot be imported yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 ? <p className="muted packs-table-empty">No items in this pack.</p> : null}
      </div>
      {picked.size ? (
        <div className="packs-drift-bar">
          <span>
            <b>{picked.size} selected</b>
            <span className="muted"> · anything already in the tenant is skipped</span>
          </span>
          <WriteActionButton
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={importing || !canImport}
            onClick={() => onImport([...picked])}
          >
            {importing ? "Importing…" : `Import ${picked.size} to tenant`}
          </WriteActionButton>
        </div>
      ) : null}
    </>
  );
}
