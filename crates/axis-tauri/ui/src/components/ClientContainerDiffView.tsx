import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type {
  ClientContainerStatus,
  ClientSnapshotSummary,
  PackDiffChangeKind,
  PackDiffReport,
  PackObjectDiff,
  RestoreApplyResult,
} from "../types/clientContainer";
import { PageHeader } from "./ui/PageChrome";
import {
  clientContainerDiff,
  clientContainerListSnapshots,
  clientContainerRestoreApply,
} from "../lib/tauri";
import { packArtifactKindLabel } from "../lib/baselines/packArtifacts";
import {
  clearClientCompareCache,
  formatComparedAt,
  readClientCompareCache,
  writeClientCompareCache,
} from "../lib/clientCompareCache";
import { WriteActionButton, useWriteGate } from "../lib/readOnly";
import type { PackExportProgress } from "../types/inventory";

const LIVE = "live";

type Resolution = "unresolved" | "keep" | "take-left" | "take-right";

function changeLabel(change: PackDiffChangeKind): string {
  switch (change) {
    case "added":
      return "Only on right";
    case "removed":
      return "Only on left";
    case "changed":
      return "Both differ";
  }
}

function formatWhen(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString();
}

function sideOptions(snapshots: ClientSnapshotSummary[], allowLive: boolean) {
  const rows: Array<{ value: string; label: string }> = [];
  if (allowLive) {
    rows.push({ value: LIVE, label: "Live tenant (current)" });
  }
  for (const snap of snapshots) {
    const when = formatWhen(snap.exportedAt);
    const name = snap.packName?.trim();
    rows.push({
      value: snap.id,
      label: name ? `${when} — ${name}` : when,
    });
  }
  return rows;
}

function isRestorableKind(kind: string): boolean {
  const value = kind.trim().toLowerCase();
  return (
    value === "catalogpolicy" ||
    value.startsWith("script:") ||
    value === "platform-powershell" ||
    value === "platform-shell" ||
    value === "remediation" ||
    value === "compliance"
  );
}

function defaultResolutions(objects: PackObjectDiff[]): Record<string, Resolution> {
  const next: Record<string, Resolution> = {};
  for (const row of objects) {
    next[row.key] = "unresolved";
  }
  return next;
}

export function ClientContainerDiffView({
  container,
  onRefreshContainer,
}: {
  container: ClientContainerStatus | null;
  onRefreshContainer?: () => void;
}) {
  const { readOnly } = useWriteGate();
  const containerRoot = container?.root?.trim() || null;
  const cached = useMemo(
    () => readClientCompareCache(containerRoot),
    // Only re-read when the container path changes; later writes update the module cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [containerRoot],
  );
  const hydratedFromCache = useRef(Boolean(cached?.report));

  const [snapshots, setSnapshots] = useState<ClientSnapshotSummary[]>([]);
  const [left, setLeft] = useState(cached?.left ?? "");
  const [right, setRight] = useState(cached?.right ?? LIVE);
  const [filter, setFilter] = useState<"all" | "unresolved" | PackDiffChangeKind>(
    cached?.filter ?? "all",
  );
  const [query, setQuery] = useState(cached?.query ?? "");
  const [selectedKey, setSelectedKey] = useState<string | null>(cached?.selectedKey ?? null);
  const [report, setReport] = useState<PackDiffReport | null>(cached?.report ?? null);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>(
    cached?.resolutions ?? {},
  );
  const [comparedAt, setComparedAt] = useState<string | null>(cached?.comparedAt ?? null);
  const [loadingList, setLoadingList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<RestoreApplyResult | null>(
    cached?.applyResult ?? null,
  );

  const active = Boolean(container?.active);
  const mismatch = Boolean(container?.tenantMismatch);
  const allowLive = active && !mismatch;
  const leftIsSnapshot = Boolean(left && left !== LIVE);
  const rightIsSnapshot = Boolean(right && right !== LIVE);
  const rightIsLive = right === LIVE;
  const canRestore = leftIsSnapshot || rightIsSnapshot;
  const showingCached = Boolean(report && comparedAt);
  const cachedSidesStale = Boolean(
    cached && report && (cached.left !== left || cached.right !== right),
  );

  // Persist compare state so navigating away does not force a re-export.
  useEffect(() => {
    if (!containerRoot || !report || !comparedAt) return;
    writeClientCompareCache({
      containerRoot,
      left,
      right,
      report,
      resolutions,
      selectedKey,
      filter,
      query,
      comparedAt,
      applyResult,
    });
  }, [
    applyResult,
    comparedAt,
    containerRoot,
    filter,
    left,
    query,
    report,
    resolutions,
    right,
    selectedKey,
  ]);

  const reloadSnapshots = async () => {
    if (!active) {
      setSnapshots([]);
      return;
    }
    setLoadingList(true);
    try {
      const rows = await clientContainerListSnapshots();
      setSnapshots(rows);
      setError(null);
      // Keep cached sides when they still exist; otherwise fall back.
      setLeft((current) => {
        if (current && rows.some((row) => row.id === current)) return current;
        if (hydratedFromCache.current && cached?.left && rows.some((row) => row.id === cached.left)) {
          return cached.left;
        }
        return rows[0]?.id ?? "";
      });
      setRight((current) => {
        if (current === LIVE && allowLive) return LIVE;
        if (current && rows.some((row) => row.id === current)) return current;
        if (
          hydratedFromCache.current &&
          cached?.right &&
          (cached.right === LIVE ? allowLive : rows.some((row) => row.id === cached.right))
        ) {
          return cached.right;
        }
        if (allowLive) return LIVE;
        return rows[1]?.id ?? rows[0]?.id ?? "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    void reloadSnapshots();
    onRefreshContainer?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container?.root, container?.active, allowLive]);

  useEffect(() => {
    let unlistenExport: (() => void) | undefined;
    let unlistenRestore: (() => void) | undefined;
    void listen<PackExportProgress>("axis-pack-export-progress", (event) => {
      const payload = event.payload;
      const message = payload.message?.trim();
      if (!message) return;
      const total = payload.total ?? 0;
      const current = payload.current ?? 0;
      setProgress(total > 0 ? `${message} (${current}/${total})` : message);
    }).then((fn) => {
      unlistenExport = fn;
    });
    void listen<string>("axis-client-restore-progress", (event) => {
      setProgress(event.payload);
    }).then((fn) => {
      unlistenRestore = fn;
    });
    return () => {
      unlistenExport?.();
      unlistenRestore?.();
    };
  }, []);

  const options = useMemo(() => sideOptions(snapshots, allowLive), [snapshots, allowLive]);

  const filtered = useMemo(() => {
    if (!report) return [];
    const needle = query.trim().toLowerCase();
    return report.objects.filter((row) => {
      if (filter === "unresolved" && resolutions[row.key] !== "unresolved") return false;
      if (filter !== "all" && filter !== "unresolved" && row.change !== filter) return false;
      if (!needle) return true;
      return (
        row.displayName.toLowerCase().includes(needle) ||
        row.kind.toLowerCase().includes(needle) ||
        (row.sourceId ?? "").toLowerCase().includes(needle)
      );
    });
  }, [filter, query, report, resolutions]);

  const selected: PackObjectDiff | null =
    filtered.find((row) => row.key === selectedKey) ?? filtered[0] ?? null;

  const unresolvedCount = useMemo(
    () =>
      report
        ? report.objects.filter((row) => (resolutions[row.key] ?? "unresolved") === "unresolved")
            .length
        : 0,
    [report, resolutions],
  );

  const pendingTakes = useMemo(() => {
    if (!report) return { leftAdd: [] as string[], leftReplace: [] as string[], rightAdd: [] as string[], rightReplace: [] as string[] };
    const leftAdd: string[] = [];
    const leftReplace: string[] = [];
    const rightAdd: string[] = [];
    const rightReplace: string[] = [];
    for (const row of report.objects) {
      if (!isRestorableKind(row.kind)) continue;
      const resolution = resolutions[row.key] ?? "unresolved";
      if (resolution === "take-left") {
        if (row.change === "removed" || row.change === "changed") {
          if (row.change === "removed") leftAdd.push(row.key);
          else leftReplace.push(row.key);
        }
      }
      if (resolution === "take-right") {
        if (row.change === "added" || row.change === "changed") {
          if (row.change === "added") rightAdd.push(row.key);
          else rightReplace.push(row.key);
        }
      }
    }
    return { leftAdd, leftReplace, rightAdd, rightReplace };
  }, [report, resolutions]);

  const takeCount =
    pendingTakes.leftAdd.length +
    pendingTakes.leftReplace.length +
    pendingTakes.rightAdd.length +
    pendingTakes.rightReplace.length;

  function setResolution(key: string, value: Resolution) {
    setResolutions((current) => ({ ...current, [key]: value }));
    setApplyResult(null);
  }

  function resolveAll(value: "keep" | "take-left" | "take-right") {
    if (!report) return;
    setResolutions((current) => {
      const next = { ...current };
      for (const row of report.objects) {
        if (value === "take-left") {
          // Only meaningful when left has content for this object.
          if (row.change === "added") next[row.key] = "keep";
          else next[row.key] = isRestorableKind(row.kind) ? "take-left" : "keep";
        } else if (value === "take-right") {
          if (row.change === "removed") next[row.key] = "keep";
          else next[row.key] = isRestorableKind(row.kind) ? "take-right" : "keep";
        } else {
          next[row.key] = "keep";
        }
      }
      return next;
    });
    setApplyResult(null);
  }

  async function runCompare() {
    if (!left || !right) {
      setError("Pick both sides to compare.");
      return;
    }
    if (left === right) {
      setError("Pick two different sides.");
      return;
    }
    setBusy(true);
    setError(null);
    setApplyResult(null);
    setProgress(
      left === LIVE || right === LIVE
        ? "Exporting live tenant for compare…"
        : "Comparing snapshots…",
    );
    setReport(null);
    setComparedAt(null);
    setSelectedKey(null);
    try {
      const next = await clientContainerDiff(left, right);
      const stamped = new Date().toISOString();
      setReport(next);
      setResolutions(defaultResolutions(next.objects));
      setSelectedKey(next.objects[0]?.key ?? null);
      setComparedAt(stamped);
      hydratedFromCache.current = false;
      if (containerRoot) {
        writeClientCompareCache({
          containerRoot,
          left,
          right,
          report: next,
          resolutions: defaultResolutions(next.objects),
          selectedKey: next.objects[0]?.key ?? null,
          filter,
          query,
          comparedAt: stamped,
          applyResult: null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function discardCachedCompare() {
    clearClientCompareCache(containerRoot);
    setReport(null);
    setResolutions({});
    setSelectedKey(null);
    setComparedAt(null);
    setApplyResult(null);
    hydratedFromCache.current = false;
  }

  async function applyResolutions() {
    if (!canRestore || mismatch) {
      setError("Open a matching tenant session and include at least one snapshot side.");
      return;
    }
    if (takeCount === 0) {
      setError("Accept incoming changes on at least one object before applying.");
      return;
    }
    setBusy(true);
    setError(null);
    setApplyResult(null);
    try {
      let added = 0;
      let updated = 0;
      let skipped = 0;
      let failed = 0;
      const items: RestoreApplyResult["items"] = [];
      const warnings: string[] = [];

      async function runBatch(
        snapshotId: string,
        mode: "add" | "update",
        keys: string[],
      ) {
        if (!keys.length) return;
        setProgress(
          mode === "add"
            ? `Adding ${keys.length} from ${snapshotId === left ? "left" : "right"}…`
            : `Updating ${keys.length} from ${snapshotId === left ? "left" : "right"}…`,
        );
        const result = await clientContainerRestoreApply({
          snapshotId,
          mode,
          keys,
        });
        added += result.added;
        updated += result.updated;
        skipped += result.skipped;
        failed += result.failed;
        items.push(...result.items);
        warnings.push(...result.warnings);
      }

      if (leftIsSnapshot) {
        await runBatch(left, "add", pendingTakes.leftAdd);
        await runBatch(left, "update", pendingTakes.leftReplace);
      }
      if (rightIsSnapshot) {
        await runBatch(right, "add", pendingTakes.rightAdd);
        await runBatch(right, "update", pendingTakes.rightReplace);
      }

      setApplyResult({
        mode: "update",
        snapshotId: leftIsSnapshot ? left : right,
        items,
        added,
        updated,
        skipped,
        failed,
        warnings,
      });
      // Mark applied takes as resolved keep so the list settles.
      setResolutions((current) => {
        const next = { ...current };
        for (const key of [
          ...pendingTakes.leftAdd,
          ...pendingTakes.leftReplace,
          ...pendingTakes.rightAdd,
          ...pendingTakes.rightReplace,
        ]) {
          next[key] = "keep";
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const leftTitle = rightIsLive ? "Incoming (snapshot)" : "Left";
  const rightTitle = rightIsLive ? "Current (live)" : "Right";

  if (!active) {
    return (
      <div className="stack">
        <PageHeader
          eyebrow="Client container"
          title="Compare & restore"
          description="Open a client container, compare a snapshot to live, then accept or keep each change like a merge."
        />
        <p className="muted">No client container is open. Use the client switcher in the rail.</p>
      </div>
    );
  }

  return (
    <div className="stack client-diff">
      <PageHeader
        eyebrow={container?.manifest?.name ?? "Client container"}
        title="Compare & restore"
        description="Diff a snapshot against live (or another snapshot). Resolve each object like a merge conflict, then apply accepted restores."
        actions={
          <div className="baseline-actions">
            <button
              type="button"
              className="axis-btn"
              disabled={loadingList || busy}
              onClick={() => void reloadSnapshots()}
            >
              {loadingList ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={busy || options.length < 2}
              onClick={() => void runCompare()}
            >
              {busy && !takeCount ? "Working…" : "Compare"}
            </button>
          </div>
        }
      />

      {mismatch ? (
        <p className="axis-alert axis-alert-warning">
          Tenant mismatch — live compare and restore are blocked until the session matches this
          container.
        </p>
      ) : null}
      {readOnly ? (
        <p className="axis-alert axis-alert-info">
          Read-only session — you can compare and mark resolutions, but Apply stays locked.
        </p>
      ) : null}

      <div className="device-toolbar client-diff-toolbar">
        <label className="device-field">
          {leftTitle}
          <select
            className="axis-input"
            value={left}
            disabled={busy}
            onChange={(event) => {
              setLeft(event.target.value);
              // Keep the cached report until Compare is re-run; sides are labels only until then.
            }}
          >
            {options
              .filter((option) => option.value !== LIVE)
              .map((option) => (
                <option key={`l-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            {!options.some((option) => option.value !== LIVE) ? (
              <option value="">No snapshots yet</option>
            ) : null}
          </select>
        </label>
        <label className="device-field">
          {rightTitle}
          <select
            className="axis-input"
            value={right}
            disabled={busy}
            onChange={(event) => {
              setRight(event.target.value);
            }}
          >
            {options.map((option) => (
              <option key={`r-${option.value}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted" style={{ margin: 0, fontSize: "0.6875rem", alignSelf: "end" }}>
          Prefer snapshot on the left, live on the right.
        </p>
      </div>

      {progress ? <p className="muted client-diff-progress">{progress}</p> : null}
      {error ? <p className="axis-alert axis-alert-danger">{error}</p> : null}

      {showingCached && comparedAt ? (
        <div className="shell-scope-banner is-info" role="status">
          <div className="shell-scope-banner-text">
            <strong>Cached compare.</strong> Showing results from {formatComparedAt(comparedAt)}
            {cachedSidesStale ? " — sides changed; re-run Compare to refresh." : "."} Navigating away
            keeps this result until you re-run or discard it.
          </div>
          <div className="shell-stale-actions">
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={busy}
              onClick={() => void runCompare()}
            >
              Re-run compare
            </button>
            <button
              type="button"
              className="axis-btn"
              disabled={busy}
              onClick={discardCachedCompare}
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      {report ? (
        <>
          <div className="client-merge-toolbar">
            <div className="client-diff-summary">
              <span className="axis-pill axis-pill-warning">{report.summary.changed} conflict</span>
              <span className="axis-pill axis-pill-success">{report.summary.added} right-only</span>
              <span className="axis-pill axis-pill-danger">{report.summary.removed} left-only</span>
              <span className="axis-pill">{unresolvedCount} unresolved</span>
              <span className="muted client-diff-summary-meta">
                {report.leftLabel} ↔ {report.rightLabel}
              </span>
            </div>
            <div className="client-merge-actions">
              <button
                type="button"
                className="axis-btn"
                disabled={busy}
                onClick={() => resolveAll("keep")}
              >
                Keep all {rightIsLive ? "live" : "right"}
              </button>
              {leftIsSnapshot ? (
                <button
                  type="button"
                  className="axis-btn"
                  disabled={busy}
                  onClick={() => resolveAll("take-left")}
                >
                  Accept all left
                </button>
              ) : null}
              {rightIsSnapshot ? (
                <button
                  type="button"
                  className="axis-btn"
                  disabled={busy}
                  onClick={() => resolveAll("take-right")}
                >
                  Accept all right
                </button>
              ) : null}
              <WriteActionButton
                type="button"
                className="axis-btn axis-btn-primary"
                disabled={busy || takeCount === 0 || mismatch || !canRestore}
                onClick={() => void applyResolutions()}
              >
                {busy ? "Applying…" : `Apply ${takeCount} restore${takeCount === 1 ? "" : "s"}`}
              </WriteActionButton>
            </div>
          </div>

          {applyResult ? (
            <div className="client-diff-summary">
              <span className="axis-pill axis-pill-success">{applyResult.added} added</span>
              <span className="axis-pill axis-pill-warning">{applyResult.updated} updated</span>
              <span className="axis-pill">{applyResult.skipped} skipped</span>
              <span className="axis-pill axis-pill-danger">{applyResult.failed} failed</span>
            </div>
          ) : null}

          <div className="client-diff-body client-merge-body">
            <div className="client-diff-list axis-panel">
              <div className="device-toolbar" style={{ border: 0, boxShadow: "none", padding: "0.65rem" }}>
                <label className="device-field">
                  Search
                  <input
                    className="axis-input"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Name, kind, id…"
                  />
                </label>
                <label className="device-field device-field-filter">
                  Show
                  <select
                    className="axis-input"
                    value={filter}
                    onChange={(event) =>
                      setFilter(event.target.value as "all" | "unresolved" | PackDiffChangeKind)
                    }
                  >
                    <option value="all">All</option>
                    <option value="unresolved">Unresolved</option>
                    <option value="changed">Conflicts</option>
                    <option value="added">Right only</option>
                    <option value="removed">Left only</option>
                  </select>
                </label>
              </div>
              <ul className="device-card-list" style={{ border: 0, borderRadius: 0 }}>
                {filtered.map((row) => {
                  const resolution = resolutions[row.key] ?? "unresolved";
                  return (
                    <li key={row.key}>
                      <button
                        type="button"
                        className={`device-card client-merge-file${
                          selected?.key === row.key ? " selected" : ""
                        } is-${resolution}`}
                        onClick={() => setSelectedKey(row.key)}
                      >
                        <p className="device-card-name">{row.displayName}</p>
                        <p className="device-card-meta">
                          {packArtifactKindLabel(row.kind)} · {changeLabel(row.change)} ·{" "}
                          {resolution === "unresolved"
                            ? "unresolved"
                            : resolution === "keep"
                              ? rightIsLive
                                ? "keep live"
                                : "keep right"
                              : resolution === "take-left"
                                ? "take left"
                                : "take right"}
                        </p>
                      </button>
                    </li>
                  );
                })}
                {!filtered.length ? (
                  <li className="muted" style={{ padding: "0.85rem" }}>
                    No objects in this filter.
                  </li>
                ) : null}
              </ul>
            </div>

            <div className="client-diff-detail axis-panel">
              {selected ? (
                <MergeConflictCard
                  row={selected}
                  leftTitle={leftTitle}
                  rightTitle={rightTitle}
                  leftLabel={report.leftLabel}
                  rightLabel={report.rightLabel}
                  resolution={resolutions[selected.key] ?? "unresolved"}
                  leftIsSnapshot={leftIsSnapshot}
                  rightIsSnapshot={rightIsSnapshot}
                  rightIsLive={rightIsLive}
                  restorable={isRestorableKind(selected.kind)}
                  busy={busy}
                  onResolve={(value) => setResolution(selected.key, value)}
                />
              ) : (
                <p className="muted" style={{ padding: "1rem" }}>
                  Select a conflicted object.
                </p>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="muted">
          {snapshots.length < 1
            ? "Export at least one snapshot from the client menu, then compare it to live."
            : "Choose a snapshot on the left and live (or another snapshot) on the right, then Compare."}
        </p>
      )}
    </div>
  );
}

function MergeConflictCard({
  row,
  leftTitle,
  rightTitle,
  leftLabel,
  rightLabel,
  resolution,
  leftIsSnapshot,
  rightIsSnapshot,
  rightIsLive,
  restorable,
  busy,
  onResolve,
}: {
  row: PackObjectDiff;
  leftTitle: string;
  rightTitle: string;
  leftLabel: string;
  rightLabel: string;
  resolution: Resolution;
  leftIsSnapshot: boolean;
  rightIsSnapshot: boolean;
  rightIsLive: boolean;
  restorable: boolean;
  busy: boolean;
  onResolve: (value: Resolution) => void;
}) {
  const canTakeLeft =
    restorable && leftIsSnapshot && (row.change === "removed" || row.change === "changed");
  const canTakeRight =
    restorable && rightIsSnapshot && (row.change === "added" || row.change === "changed");

  return (
    <div className={`client-merge-card is-${resolution}`}>
      <div className="client-merge-card-head">
        <div>
          <p className="axis-kicker">{packArtifactKindLabel(row.kind)}</p>
          <h3>{row.displayName}</h3>
          <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "var(--axis-text-2xs)" }}>
            {changeLabel(row.change)}
            {row.sourceId ? ` · ${row.sourceId}` : ""}
          </p>
        </div>
        <div className="client-merge-resolve">
          <button
            type="button"
            className={`axis-btn${resolution === "keep" ? " is-active" : ""}`}
            disabled={busy}
            onClick={() => onResolve("keep")}
          >
            {rightIsLive ? "Keep live" : "Keep right"}
          </button>
          {canTakeLeft ? (
            <button
              type="button"
              className={`axis-btn axis-btn-primary${resolution === "take-left" ? " is-active" : ""}`}
              disabled={busy}
              onClick={() => onResolve("take-left")}
            >
              Accept left
            </button>
          ) : null}
          {canTakeRight ? (
            <button
              type="button"
              className={`axis-btn axis-btn-primary${resolution === "take-right" ? " is-active" : ""}`}
              disabled={busy}
              onClick={() => onResolve("take-right")}
            >
              Accept right
            </button>
          ) : null}
        </div>
      </div>

      {!restorable ? (
        <p className="axis-alert axis-alert-info" style={{ margin: "0.75rem" }}>
          This object type is compared only — restore is limited to Settings Catalog policies and
          scripts.
        </p>
      ) : null}

      <div className="client-merge-markers">
        <div className="client-merge-marker is-incoming">
          <code>{`<<<<<<< ${leftTitle}`}</code>
          <span className="muted">{leftLabel}</span>
        </div>
      </div>

      <div className="client-merge-panes">
        <div className="client-merge-pane is-left">
          <p className="client-merge-pane-title">{leftTitle}</p>
          {row.change === "added" ? (
            <p className="muted client-merge-empty">Not present on left</p>
          ) : (
            <ConflictHunks
              row={row}
              side="left"
            />
          )}
        </div>
        <div className="client-merge-divider" aria-hidden="true">
          <code>=======</code>
        </div>
        <div className="client-merge-pane is-right">
          <p className="client-merge-pane-title">{rightTitle}</p>
          {row.change === "removed" ? (
            <p className="muted client-merge-empty">Not present on right</p>
          ) : (
            <ConflictHunks
              row={row}
              side="right"
            />
          )}
        </div>
      </div>

      <div className="client-merge-markers">
        <div className="client-merge-marker is-current">
          <code>{`>>>>>>> ${rightTitle}`}</code>
          <span className="muted">{rightLabel}</span>
        </div>
      </div>
    </div>
  );
}

function ConflictHunks({
  row,
  side,
}: {
  row: PackObjectDiff;
  side: "left" | "right";
}) {
  if (!row.fieldChanges.length) {
    return <p className="muted client-merge-empty">No field details</p>;
  }
  return (
    <ul className="client-merge-hunks">
      {row.fieldChanges.map((change) => {
        const value = side === "left" ? change.before : change.after;
        const missing = value == null || value === "";
        return (
          <li
            key={`${side}:${change.path}:${change.before}:${change.after}`}
            className={`client-merge-hunk${missing ? " is-missing" : ""}`}
          >
            <span className="client-merge-hunk-path">{change.path}</span>
            <span className="client-merge-hunk-value">
              {missing ? "—" : value}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
