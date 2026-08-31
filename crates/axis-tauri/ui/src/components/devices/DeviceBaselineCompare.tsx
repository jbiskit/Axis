import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AppliedPolicySettingsLoad,
  BaselineReferenceSourceInput,
  DevicePolicyState,
  E8BaselineReference,
  ManagedDeviceDetail,
} from "../../types/inventory";
import {
  evaluateDeviceBaseline,
  type AppliedSettingOccurrence,
} from "../../lib/baselines/deviceCompare";
import {
  baselineIncludePaths,
  looksLikeAxisBaselineSelection,
  policyExportToBaseline,
} from "../../lib/baselines/policyExport";
import { isBaselinePackArtifact, isCatalogPackArtifact, packRelativeDownloadUrl } from "../../lib/baselines/packArtifacts";
import type { Baseline } from "../../lib/baselines/schema";
import type { CheckResultStatus, DeviceBaselineEvaluation } from "../../lib/baselines/schema";
import { leavesFromSettingRows } from "../../lib/baselines/settingLeaves";
import {
  fetchAppliedPolicySettings,
  fetchBaselineExport,
  fetchBaselineReferenceSources,
} from "../../lib/tauri";
import { loadStoredSources, packTitle, tokenForSource } from "../../lib/baselines/sources";

const COMPARE_ALL_ID = "__all__";

type ResultFilter = "ok" | "conflict" | "fail" | "unknown";

const STATUS_LABEL: Record<CheckResultStatus, string> = {
  pass: "ok",
  warn: "ok",
  conflict: "conflict",
  fail: "fail",
  unknown: "unknown",
};

function flattenAppliedSettings(
  load: AppliedPolicySettingsLoad,
  states: DevicePolicyState[],
): AppliedSettingOccurrence[] {
  const names = new Map(states.map((state) => [state.id, state.displayName]));
  const out: AppliedSettingOccurrence[] = [];
  for (const policy of load.policies) {
    if (policy.error) continue;
    const policyName = names.get(policy.policyId) ?? policy.name ?? policy.policyId;
    for (const leaf of leavesFromSettingRows(policy.settings)) {
      out.push({ ...leaf, policyId: policy.policyId, policyName });
    }
  }
  return out;
}

function catalogPolicyIds(device: ManagedDeviceDetail): string[] {
  return device.configurationStates
    .filter((policy) => policy.source === "configurationPolicy" || Boolean(policy.id))
    .map((policy) => policy.id);
}

function csvEscape(cell: string | number | boolean | null | undefined): string {
  return `"${String(cell ?? "").replace(/"/g, '""')}"`;
}

function evaluationCsv(evaluations: DeviceBaselineEvaluation[]): string {
  const headers = ["Baseline", "Status", "Check", "Category", "Expected", "Actual", "Detail", "Evidence"];
  const rows = evaluations.flatMap((evaluation) =>
    evaluation.results.map((result) =>
      [
        evaluation.baseline.name,
        STATUS_LABEL[result.status],
        result.check.title,
        result.check.category,
        result.expectedDisplay ?? result.check.expected ?? "",
        result.actual ?? "",
        result.message,
        (result.evidence ?? [])
          .map((item) => (item.valueSummary ? `${item.policyName} (${item.valueSummary})` : item.policyName))
          .join("; "),
      ].map(csvEscape),
    ),
  );
  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\r\n");
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function normalizeFilter(status: CheckResultStatus): ResultFilter {
  if (status === "pass" || status === "warn") return "ok";
  if (status === "conflict") return "conflict";
  if (status === "fail") return "fail";
  return "unknown";
}

function countFor(evaluation: DeviceBaselineEvaluation, filter: ResultFilter): number {
  if (filter === "ok") return evaluation.summary.pass + evaluation.summary.warn;
  return evaluation.summary[filter];
}

function statusClass(status: CheckResultStatus): string {
  if (status === "pass" || status === "warn") return "axis-pill axis-pill-success";
  if (status === "conflict" || status === "fail") return "axis-pill axis-pill-danger";
  return "axis-pill";
}

export function DeviceBaselineCompare({ device }: { device: ManagedDeviceDetail }) {
  const [sources, setSources] = useState<BaselineReferenceSourceInput[]>(() => loadStoredSources());
  const [references, setReferences] = useState<
    Array<E8BaselineReference & { sourceId: string; sourceName: string }>
  >([]);
  const [referencesError, setReferencesError] = useState<string | null>(null);
  const [referencesLoading, setReferencesLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [evaluations, setEvaluations] = useState<DeviceBaselineEvaluation[]>([]);
  const [filters, setFilters] = useState<Set<ResultFilter>>(new Set());
  const [appliedCache, setAppliedCache] = useState<{
    deviceId: string;
    load: AppliedPolicySettingsLoad;
    occurrences: AppliedSettingOccurrence[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReferencesLoading(true);
    const stored = loadStoredSources();
    setSources(stored);
    void fetchBaselineReferenceSources(stored)
      .then((response) => {
        if (cancelled) return;
        const next = response.sources.flatMap((load) =>
          load.references.map((reference) => ({
            ...reference,
            sourceId: load.source.id,
            sourceName: packTitle(load.source),
          })),
        );
        setReferences(next);
        const errors = response.sources
          .map((load) => load.error)
          .filter((message): message is string => Boolean(message));
        setReferencesError(errors[0] ?? null);
      })
      .catch((err) => {
        if (!cancelled) setReferencesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setReferencesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadApplied = useCallback(async () => {
    if (appliedCache?.deviceId === device.id) return appliedCache;
    setProgress("Reading settings from policies applied to this device…");
    const response = await fetchAppliedPolicySettings(catalogPolicyIds(device));
    if (response.error || !response.load) {
      throw new Error(response.error ?? "Could not load applied policy settings.");
    }
    const occurrences = flattenAppliedSettings(response.load, device.configurationStates);
    const next = { deviceId: device.id, load: response.load, occurrences };
    setAppliedCache(next);
    return next;
  }, [appliedCache, device]);

  const runCompare = useCallback(
    async (baselineKey: string) => {
      setError(null);
      setEvaluations([]);
      if (!baselineKey) return;
      try {
        const applied = await loadApplied();
        const notes = [
          `Inferred ${applied.occurrences.length} configured setting${
            applied.occurrences.length === 1 ? "" : "s"
          } from ${applied.load.loaded} applied Settings Catalog ${
            applied.load.loaded === 1 ? "policy" : "policies"
          }.`,
        ];
        if (applied.load.skipped > 0) {
          notes.push(
            `Skipped ${applied.load.skipped} classic / non-catalog profile${
              applied.load.skipped === 1 ? "" : "s"
            } (Graph has no Settings Catalog instances for those).`,
          );
        }
        if (applied.load.failed > 0) {
          notes.push(`Failed to read ${applied.load.failed} policy setting collection${applied.load.failed === 1 ? "" : "s"}.`);
        }

        const catalog = references.filter((reference) => isCatalogPackArtifact(reference.artifactKind));
        const comparable = references.filter(
          (reference) =>
            isCatalogPackArtifact(reference.artifactKind) || isBaselinePackArtifact(reference.artifactKind),
        );
        const targets =
          baselineKey === COMPARE_ALL_ID
            ? catalog
            : comparable.filter((reference) => `${reference.sourceId}:${reference.id}` === baselineKey);
        if (targets.length === 0) throw new Error("Pick a baseline export to compare.");

        const nextEvaluations: DeviceBaselineEvaluation[] = [];
        for (let index = 0; index < targets.length; index++) {
          const reference = targets[index]!;
          setProgress(`Comparing ${index + 1} of ${targets.length}: ${reference.name}`);
          const token = tokenForSource(sources, reference.sourceId);
          const exportResponse = await fetchBaselineExport(reference.downloadUrl, token);
          if (exportResponse.error || exportResponse.document == null) {
            throw new Error(exportResponse.error ?? `Failed to download “${reference.name}”.`);
          }
          const originLabel = reference.sourceName || reference.source;
          const options = {
            idPrefix: reference.sourceId || "asd",
            source: "custom" as const,
            version: reference.version ?? "pack",
            originLabel,
          };
          const document = exportResponse.document;
          let baseline: Baseline;
          if (looksLikeAxisBaselineSelection(document)) {
            const packRoot = sources.find((row) => (row.id ?? "") === reference.sourceId)?.localPath;
            const included = baselineIncludePaths(document).filter((path) =>
              /\/policies\//i.test(`/${path}`),
            );
            if (included.length === 0) {
              throw new Error(
                `Baseline “${reference.name}” has no Settings Catalog includes under policies/.`,
              );
            }
            const parts: Baseline[] = [];
            for (const rel of included) {
              const url = packRelativeDownloadUrl(reference.downloadUrl, rel, packRoot);
              setProgress(`Comparing ${index + 1} of ${targets.length}: ${reference.name} (${rel})`);
              const includedExport = await fetchBaselineExport(url, token);
              if (includedExport.error || includedExport.document == null) {
                throw new Error(includedExport.error ?? `Failed to download included file “${rel}”.`);
              }
              parts.push(
                policyExportToBaseline(rel.split("/").pop() ?? rel, includedExport.document, options),
              );
            }
            const row = document as { id?: string; name?: string; description?: string; version?: string };
            baseline = {
              id: typeof row.id === "string" ? row.id : reference.id,
              name: typeof row.name === "string" ? row.name : reference.name,
              description: typeof row.description === "string" ? row.description : "",
              version: typeof row.version === "string" ? row.version : options.version,
              source: "custom",
              checks: parts.flatMap((part) => part.checks),
            };
          } else {
            const fileName = reference.downloadUrl.split(/[/\\]/).pop() ?? `${reference.name}.txt`;
            baseline = policyExportToBaseline(fileName, document, {
              ...options,
              source: "asd",
              version: reference.version ?? "asd-blueprint-main",
            });
          }
          nextEvaluations.push(evaluateDeviceBaseline(baseline, device, applied.occurrences, notes));
        }
        setEvaluations(nextEvaluations);
        setProgress("");
      } catch (err) {
        setProgress("");
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [device, loadApplied, references, sources],
  );

  useEffect(() => {
    setEvaluations([]);
    setAppliedCache(null);
    setError(null);
    setProgress("");
  }, [device.id]);

  const combined = useMemo<DeviceBaselineEvaluation | null>(() => {
    if (evaluations.length === 0) return null;
    if (evaluations.length === 1) return evaluations[0]!;
    const results = evaluations.flatMap((evaluation) => evaluation.results);
    return {
      baseline: {
        ...evaluations[0]!.baseline,
        id: COMPARE_ALL_ID,
        name: `${evaluations.length} baselines`,
      },
      deviceId: device.id,
      deviceName: device.deviceName,
      results,
      summary: {
        pass: results.filter((result) => result.status === "pass").length,
        warn: results.filter((result) => result.status === "warn").length,
        conflict: results.filter((result) => result.status === "conflict").length,
        fail: results.filter((result) => result.status === "fail").length,
        unknown: results.filter((result) => result.status === "unknown").length,
      },
      notes: evaluations[0]?.notes ?? [],
    };
  }, [device.deviceName, device.id, evaluations]);

  const visible = useMemo(() => {
    if (!combined) return [];
    if (filters.size === 0) return combined.results;
    return combined.results.filter((result) => filters.has(normalizeFilter(result.status)));
  }, [combined, filters]);

  const comparableReferences = useMemo(
    () =>
      references.filter(
        (reference) =>
          isCatalogPackArtifact(reference.artifactKind) || isBaselinePackArtifact(reference.artifactKind),
      ),
    [references],
  );

  const catalogReferences = useMemo(
    () => references.filter((reference) => isCatalogPackArtifact(reference.artifactKind)),
    [references],
  );

  const busy = Boolean(progress);
  const referenceGroups = useMemo(() => {
    const groups: Array<{
      id: string;
      title: string;
      references: typeof comparableReferences;
    }> = [];
    for (const reference of comparableReferences) {
      let group = groups.find((entry) => entry.id === reference.sourceId);
      if (!group) {
        group = { id: reference.sourceId, title: reference.sourceName, references: [] };
        groups.push(group);
      }
      group.references.push(reference);
    }
    return groups;
  }, [comparableReferences]);

  return (
    <section className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Compare this device against a Settings Catalog export or a pack baseline that selects those
        exports. Scripts, compliance, Endpoint Security, Windows Update, and Autopilot files in a
        pack are listed under Baselines only; they are not graded here.
      </p>
      <div className="device-toolbar baseline-compare-toolbar">
        <label className="device-field">
          Baseline
          <select
            className="axis-input"
            value={selectedId}
            disabled={referencesLoading || busy || comparableReferences.length === 0}
            onChange={(event) => {
              const next = event.target.value;
              setSelectedId(next);
              void runCompare(next);
            }}
          >
            <option value="">{referencesLoading ? "Loading baselines…" : "Select a baseline…"}</option>
            {comparableReferences.length > 1 ? (
              <option value={COMPARE_ALL_ID}>Compare all catalog policies ({catalogReferences.length})</option>
            ) : null}
            {referenceGroups.map((group) => (
              <optgroup key={group.id} label={group.title}>
                {group.references.map((reference) => (
                  <option key={`${reference.sourceId}:${reference.id}`} value={`${reference.sourceId}:${reference.id}`}>
                    {reference.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="axis-btn"
          disabled={!selectedId || busy}
          onClick={() => void runCompare(selectedId)}
        >
          {busy ? "Comparing…" : "Compare"}
        </button>
      </div>
      {referencesError ? <div className="axis-alert axis-alert-warning">{referencesError}</div> : null}
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {progress ? <p className="muted">{progress}</p> : null}

      {combined ? (
        <>
          <div className="baseline-compare-summary">
            {(["ok", "conflict", "fail", "unknown"] as ResultFilter[]).map((filter) => {
              const active = filters.has(filter);
              return (
                <button
                  key={filter}
                  type="button"
                  className={`axis-pill ${active ? "is-active" : ""} ${
                    filter === "ok"
                      ? "axis-pill-success"
                      : filter === "conflict" || filter === "fail"
                        ? "axis-pill-danger"
                        : ""
                  }`}
                  onClick={() => {
                    setFilters((current) => {
                      const next = new Set(current);
                      if (next.has(filter)) next.delete(filter);
                      else next.add(filter);
                      return next;
                    });
                  }}
                >
                  {countFor(combined, filter)} {filter}
                </button>
              );
            })}
            {filters.size > 0 ? (
              <button type="button" className="axis-btn axis-btn-ghost" onClick={() => setFilters(new Set())}>
                Clear
              </button>
            ) : null}
            <button
              type="button"
              className="axis-btn"
              onClick={() => {
                const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
                downloadCsv(
                  `baseline-${device.deviceName.replace(/[^\w.-]+/g, "_").slice(0, 48)}-${stamp}.csv`,
                  evaluationCsv(evaluations),
                );
              }}
            >
              Export CSV
            </button>
          </div>
          {combined.notes.map((note) => (
            <p key={note} className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
              {note}
            </p>
          ))}
          <div className="axis-panel" style={{ overflow: "hidden" }}>
            <table className="axis-table">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No checks match the current filter.
                    </td>
                  </tr>
                ) : (
                  visible.map((result) => (
                    <tr key={`${result.check.id}:${result.check.target ?? result.check.title}`}>
                      <td>
                        <div>{result.check.title}</div>
                        <div className="muted" style={{ fontSize: "0.6875rem" }}>
                          {evaluations.length > 1 ? `${result.check.category} · ` : null}
                          {result.expectedDisplay
                            ? `expects ${result.expectedDisplay}`
                            : result.check.type}
                        </div>
                      </td>
                      <td>
                        <span className={statusClass(result.status)}>{STATUS_LABEL[result.status]}</span>
                      </td>
                      <td>
                        <div>{result.message}</div>
                        {result.evidence && result.evidence.length > 0 ? (
                          <div className="muted" style={{ fontSize: "0.6875rem", marginTop: "0.2rem" }}>
                            {result.evidence
                              .slice(0, 3)
                              .map((item) =>
                                item.valueSummary ? `${item.policyName} (${item.valueSummary})` : item.policyName,
                              )
                              .join(" · ")}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : !busy && !error ? (
        <p className="muted">
          Select a baseline from the same GitHub sources as the Baselines workspace. Comparison uses
          this device’s applied policies, not a tenant-wide catalog scan.
        </p>
      ) : null}
    </section>
  );
}
