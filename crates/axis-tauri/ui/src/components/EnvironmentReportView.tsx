import { useCallback, useEffect, useMemo, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useInventory } from "../hooks/useInventory";
import {
  clearSelectionIds,
  matchesListQuery,
  toggleSelectionId,
} from "../lib/listSelection";
import {
  fetchAutopilotProfiles,
  fetchCompliancePolicies,
  fetchConfigurationPolicies,
  fetchEndpointSecurityIntents,
  fetchEnrollmentConfigurations,
  fetchGroupPolicyConfigurations,
  fetchMobileApps,
  fetchTenantScripts,
  generateEnvironmentReport,
  openExternalUrl,
  saveTextFile,
} from "../lib/tauri";
import type {
  AutopilotProfile,
  CatalogPolicySummary,
  EnvironmentReport,
  EnvironmentReportSelection,
  MobileAppSummary,
  PackExportProgress,
  TenantScriptSummary,
} from "../types/inventory";
import { PageHeader } from "./ui/PageChrome";

const DEFAULT_SELECTION: EnvironmentReportSelection = {
  summary: true,
  devices: true,
  groups: true,
  policies: true,
  updates: true,
  apps: true,
  enrollment: true,
  scripts: true,
  crossPlatform: true,
  windows: true,
  macos: true,
  ios: true,
  android: true,
  policyIds: null,
  appIds: null,
  scriptIds: null,
  enrollmentIds: null,
};

const CHAPTER_OPTIONS: { key: keyof EnvironmentReportSelection; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "devices", label: "Devices" },
  { key: "groups", label: "Groups" },
];

const CONTENT_OPTIONS: {
  key: "policies" | "updates" | "apps" | "enrollment" | "scripts";
  label: string;
  idsKey?: "policyIds" | "appIds" | "enrollmentIds" | "scriptIds";
}[] = [
  { key: "policies", label: "Policies", idsKey: "policyIds" },
  { key: "updates", label: "Updates" },
  { key: "apps", label: "Apps", idsKey: "appIds" },
  { key: "enrollment", label: "Enrollment", idsKey: "enrollmentIds" },
  { key: "scripts", label: "Scripts", idsKey: "scriptIds" },
];

const PLATFORM_OPTIONS: { key: keyof EnvironmentReportSelection; label: string }[] = [
  { key: "crossPlatform", label: "Cross-platform" },
  { key: "windows", label: "Windows" },
  { key: "macos", label: "macOS" },
  { key: "ios", label: "iOS" },
  { key: "android", label: "Android" },
];

type PickerRow = {
  id: string;
  name: string;
  meta: string;
};

function pathToFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(normalized)) {
    return `file:///${normalized}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${normalized}`;
  }
  return `file:///${normalized}`;
}

function SelectionCheck({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="environment-report-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function SelectionChip({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="environment-report-chip">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function scriptKindLabel(kind: string): string {
  switch (kind) {
    case "platform-powershell":
      return "PowerShell";
    case "platform-shell":
      return "Shell";
    case "remediation":
      return "Remediation";
    case "compliance":
      return "Compliance script";
    default:
      return kind;
  }
}

function policyKindLabel(kind: string, platforms?: string | null): string {
  const platform = platforms?.trim();
  return platform ? `${kind} · ${platform}` : kind;
}

function ReportItemPicker({
  allLabel,
  allMode,
  selectedIds,
  rows,
  loading,
  error,
  truncated,
  disabled,
  onAllChange,
  onSelectedIdsChange,
}: {
  allLabel: string;
  allMode: boolean;
  selectedIds: string[];
  rows: PickerRow[];
  loading: boolean;
  error: string | null;
  truncated?: boolean;
  disabled?: boolean;
  onAllChange: (all: boolean) => void;
  onSelectedIdsChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => {
    return rows.filter((row) => matchesListQuery(`${row.name} ${row.meta}`, query));
  }, [query, rows]);

  const setSelected = useCallback(
    (next: Set<string>) => {
      onSelectedIdsChange([...next]);
    },
    [onSelectedIdsChange],
  );

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((row) => selected.has(row.id));

  return (
    <div className="environment-report-item-picker">
      <SelectionCheck
        label={allLabel}
        checked={allMode}
        disabled={disabled}
        onChange={onAllChange}
      />
      {!allMode ? (
        <div className="environment-report-item-picker-body">
          <div className="environment-report-item-picker-toolbar">
            <input
              className="axis-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter…"
              disabled={disabled || loading}
            />
            <button
              type="button"
              className="axis-btn axis-btn-ghost"
              disabled={disabled || loading || filtered.length === 0}
              onClick={() => {
                if (allFilteredSelected) {
                  const next = new Set(selected);
                  for (const row of filtered) next.delete(row.id);
                  setSelected(next);
                  return;
                }
                const next = new Set(selected);
                for (const row of filtered) next.add(row.id);
                setSelected(next);
              }}
            >
              {allFilteredSelected ? "Clear visible" : "Select visible"}
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-ghost"
              disabled={disabled || selected.size === 0}
              onClick={() => setSelected(clearSelectionIds())}
            >
              Clear
            </button>
          </div>
          {loading ? <p className="muted environment-report-item-picker-status">Loading…</p> : null}
          {error ? <p className="axis-alert axis-alert-warning">{error}</p> : null}
          {!loading && !error && rows.length === 0 ? (
            <p className="muted environment-report-item-picker-status">No items in this tenant.</p>
          ) : null}
          {!loading && filtered.length > 0 ? (
            <ul className="environment-report-item-list">
              {filtered.map((row) => (
                <li key={row.id}>
                  <label className="environment-report-item-row">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      disabled={disabled}
                      onChange={() => setSelected(toggleSelectionId(selected, row.id))}
                    />
                    <span className="environment-report-item-name">{row.name}</span>
                    <span className="muted environment-report-item-meta">{row.meta}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          {!loading && rows.length > 0 && filtered.length === 0 ? (
            <p className="muted environment-report-item-picker-status">No matches.</p>
          ) : null}
          <p className="muted environment-report-item-picker-status">
            {`${selected.size} selected${truncated ? " · list may be truncated" : ""}`}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function EnvironmentReportView({
  signedIn,
  defaultPreparedFor,
  defaultPreparedBy,
}: {
  signedIn: boolean;
  defaultPreparedFor: string | null;
  defaultPreparedBy: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PackExportProgress | null>(null);
  const [report, setReport] = useState<EnvironmentReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [preparedFor, setPreparedFor] = useState("");
  const [preparedBy, setPreparedBy] = useState("");
  const [selection, setSelection] = useState<EnvironmentReportSelection>(DEFAULT_SELECTION);

  const loadPolicies = selection.policies && selection.policyIds !== null && selection.policyIds !== undefined;
  const loadApps = selection.apps && selection.appIds !== null && selection.appIds !== undefined;
  const loadScripts = selection.scripts && selection.scriptIds !== null && selection.scriptIds !== undefined;
  const loadEnrollment =
    selection.enrollment && selection.enrollmentIds !== null && selection.enrollmentIds !== undefined;

  const catalog = useInventory(fetchConfigurationPolicies, loadPolicies, signedIn);
  const compliance = useInventory(fetchCompliancePolicies, loadPolicies, signedIn);
  const endpointSecurity = useInventory(fetchEndpointSecurityIntents, loadPolicies, signedIn);
  const groupPolicy = useInventory(fetchGroupPolicyConfigurations, loadPolicies, signedIn);
  const apps = useInventory(
    useCallback(() => fetchMobileApps(), []),
    loadApps,
    signedIn,
  );
  const scripts = useInventory(fetchTenantScripts, loadScripts, signedIn);
  const enrollmentConfigs = useInventory(fetchEnrollmentConfigurations, loadEnrollment, signedIn);
  const autopilotProfiles = useInventory(fetchAutopilotProfiles, loadEnrollment, signedIn);

  const policyRows = useMemo((): PickerRow[] => {
    const rows: PickerRow[] = [];
    const push = (items: CatalogPolicySummary[], kind: string) => {
      for (const item of items) {
        rows.push({
          id: item.id,
          name: item.name,
          meta: policyKindLabel(kind, item.platforms),
        });
      }
    };
    push(catalog.items, "Settings Catalog");
    push(compliance.items, "Compliance");
    push(endpointSecurity.items, "Endpoint Security");
    push(groupPolicy.items, "Group Policy");
    rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return rows;
  }, [catalog.items, compliance.items, endpointSecurity.items, groupPolicy.items]);

  const appRows = useMemo((): PickerRow[] => {
    return apps.items
      .map((item: MobileAppSummary) => ({
        id: item.id,
        name: item.displayName,
        meta: [item.appTypeLabel ?? item.kind, item.platform].filter(Boolean).join(" · "),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [apps.items]);

  const scriptRows = useMemo((): PickerRow[] => {
    return scripts.items
      .map((item: TenantScriptSummary) => ({
        id: item.id,
        name: item.displayName,
        meta: scriptKindLabel(item.kind),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [scripts.items]);

  const enrollmentRows = useMemo((): PickerRow[] => {
    const rows: PickerRow[] = [
      ...enrollmentConfigs.items.map((item: CatalogPolicySummary) => ({
        id: item.id,
        name: item.name,
        meta: policyKindLabel("Enrollment", item.platforms ?? item.odataType),
      })),
      ...autopilotProfiles.items.map((item: AutopilotProfile) => ({
        id: item.id,
        name: item.displayName,
        meta: "Autopilot profile",
      })),
    ];
    rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return rows;
  }, [autopilotProfiles.items, enrollmentConfigs.items]);

  const policyLoading =
    catalog.loading || compliance.loading || endpointSecurity.loading || groupPolicy.loading;
  const policyError =
    catalog.error || compliance.error || endpointSecurity.error || groupPolicy.error;
  const policyTruncated =
    catalog.truncated || compliance.truncated || endpointSecurity.truncated || groupPolicy.truncated;
  const enrollmentLoading = enrollmentConfigs.loading || autopilotProfiles.loading;
  const enrollmentError = enrollmentConfigs.error || autopilotProfiles.error;
  const enrollmentTruncated = enrollmentConfigs.truncated || autopilotProfiles.truncated;

  useEffect(() => {
    if (defaultPreparedFor) {
      setPreparedFor((current) => current || defaultPreparedFor);
    }
  }, [defaultPreparedFor]);

  useEffect(() => {
    if (defaultPreparedBy) {
      setPreparedBy((current) => current || defaultPreparedBy);
    }
  }, [defaultPreparedBy]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    void listen<PackExportProgress>("axis-environment-report-progress", (event) => {
      if (!cancelled) setProgress(event.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const setSelectionKey = useCallback((key: keyof EnvironmentReportSelection, value: boolean) => {
    setSelection((current) => {
      const next = { ...current, [key]: value };
      if (key === "policies" && !value) next.policyIds = null;
      if (key === "apps" && !value) next.appIds = null;
      if (key === "scripts" && !value) next.scriptIds = null;
      if (key === "enrollment" && !value) next.enrollmentIds = null;
      return next;
    });
  }, []);

  const setIdFilter = useCallback(
    (key: "policyIds" | "appIds" | "scriptIds" | "enrollmentIds", ids: string[] | null) => {
      setSelection((current) => ({ ...current, [key]: ids }));
    },
    [],
  );

  const selectAllContent = useCallback(() => {
    setSelection(DEFAULT_SELECTION);
  }, []);

  const clearContent = useCallback(() => {
    setSelection({
      summary: false,
      devices: false,
      groups: false,
      policies: false,
      updates: false,
      apps: false,
      enrollment: false,
      scripts: false,
      crossPlatform: false,
      windows: false,
      macos: false,
      ios: false,
      android: false,
      policyIds: null,
      appIds: null,
      scriptIds: null,
      enrollmentIds: null,
    });
  }, []);

  const generate = useCallback(async () => {
    if (!signedIn || busy) return;
    setBusy(true);
    setError(null);
    setSavedPath(null);
    setProgress({ phase: "inventory", current: 0, total: 0, message: "Starting…" });
    try {
      const next = await generateEnvironmentReport({
        preparedFor,
        preparedBy,
        selection,
      });
      setReport(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [busy, preparedBy, preparedFor, selection, signedIn]);

  const save = useCallback(async () => {
    if (!report) return;
    const path = await saveTextFile({
      contents: report.html,
      suggestedName: report.suggestedName,
      title: "Save as-built report",
    });
    if (path) setSavedPath(path);
  }, [report]);

  const saveMarkdown = useCallback(async () => {
    if (!report) return;
    const path = await saveTextFile({
      contents: report.markdown,
      suggestedName: report.suggestedMarkdownName,
      title: "Save as-built Markdown",
    });
    if (path) setSavedPath(path);
  }, [report]);

  const openSaved = useCallback(async () => {
    if (!savedPath) return;
    await openExternalUrl(pathToFileUrl(savedPath));
  }, [savedPath]);

  const progressLabel = progress
    ? progress.total > 0
      ? `${progress.message} (${progress.current}/${progress.total})`
      : progress.message
    : null;

  const isAllMode = (ids: string[] | null | undefined) => ids == null;

  return (
    <div className="stack environment-report">
      <PageHeader
        title="Environment report"
        description="A portable HTML or Markdown as-built of how Intune is configured today. Choose what to include, set who the report is for, generate a snapshot, preview it here, then save a single file to share, archive, or print."
        actions={
          <>
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              onClick={() => void generate()}
              disabled={!signedIn || busy}
            >
              {busy ? "Generating…" : report ? "Regenerate" : "Generate"}
            </button>
            <button type="button" className="axis-btn" onClick={() => void save()} disabled={!report || busy}>
              Save HTML
            </button>
            <button
              type="button"
              className="axis-btn"
              onClick={() => void saveMarkdown()}
              disabled={!report || busy}
            >
              Save as Markdown
            </button>
            {savedPath ? (
              <button type="button" className="axis-btn" onClick={() => void openSaved()}>
                Open file
              </button>
            ) : null}
          </>
        }
      />
      {signedIn ? (
        <div className="environment-report-options axis-panel axis-panel-padded">
          <label className="environment-report-field">
            <span>Prepared for</span>
            <input
              className="axis-input"
              type="text"
              value={preparedFor}
              onChange={(event) => setPreparedFor(event.target.value)}
              placeholder={defaultPreparedFor ?? "Organization or customer name"}
              disabled={busy}
            />
          </label>
          <label className="environment-report-field">
            <span>Prepared by</span>
            <input
              className="axis-input"
              type="text"
              value={preparedBy}
              onChange={(event) => setPreparedBy(event.target.value)}
              placeholder={defaultPreparedBy ?? "Your name or team"}
              disabled={busy}
            />
          </label>
          <div className="environment-report-content">
            <div className="environment-report-content-head">
              <span>Include in report</span>
              <div className="environment-report-content-actions">
                <button type="button" className="axis-btn axis-btn-ghost" onClick={selectAllContent} disabled={busy}>
                  Select all
                </button>
                <button type="button" className="axis-btn axis-btn-ghost" onClick={clearContent} disabled={busy}>
                  Clear
                </button>
              </div>
            </div>
            <fieldset className="environment-report-fieldset" disabled={busy}>
              <legend>Chapters</legend>
              <div className="environment-report-chips">
                {CHAPTER_OPTIONS.map((option) => (
                  <SelectionChip
                    key={option.key}
                    label={option.label}
                    checked={Boolean(selection[option.key])}
                    onChange={(next) => setSelectionKey(option.key, next)}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset className="environment-report-fieldset" disabled={busy}>
              <legend>Content</legend>
              <p className="muted environment-report-hint">
                Applied across selected platforms. Policies includes catalog, compliance, Endpoint Security, and Group
                Policy. Enrollment includes connectors and Autopilot when Windows is selected and All enrollment is on.
                Uncheck All on a surface to pick specific objects.
              </p>
              <div className="environment-report-content-list">
                {CONTENT_OPTIONS.map((option) => {
                  const categoryOn = Boolean(selection[option.key]);
                  const manualIds = option.idsKey ? selection[option.idsKey] : null;
                  const manualCount = manualIds == null ? null : manualIds.length;
                  return (
                    <div
                      key={option.key}
                      className={`environment-report-content-block${categoryOn ? " is-active" : ""}`}
                    >
                      <div className="environment-report-content-block-head">
                        <SelectionCheck
                          label={option.label}
                          checked={categoryOn}
                          onChange={(next) => setSelectionKey(option.key, next)}
                        />
                        {categoryOn && manualCount != null ? (
                          <span className="environment-report-count">
                            {manualCount} selected
                          </span>
                        ) : null}
                      </div>
                      {option.idsKey && categoryOn ? (
                        <ReportItemPicker
                          allLabel={`All ${option.label.toLowerCase()}`}
                          allMode={isAllMode(selection[option.idsKey])}
                          selectedIds={selection[option.idsKey] ?? []}
                          rows={
                            option.idsKey === "policyIds"
                              ? policyRows
                              : option.idsKey === "appIds"
                                ? appRows
                                : option.idsKey === "scriptIds"
                                  ? scriptRows
                                  : enrollmentRows
                          }
                          loading={
                            option.idsKey === "policyIds"
                              ? policyLoading
                              : option.idsKey === "appIds"
                                ? apps.loading
                                : option.idsKey === "scriptIds"
                                  ? scripts.loading
                                  : enrollmentLoading
                          }
                          error={
                            option.idsKey === "policyIds"
                              ? policyError
                              : option.idsKey === "appIds"
                                ? apps.error
                                : option.idsKey === "scriptIds"
                                  ? scripts.error
                                  : enrollmentError
                          }
                          truncated={
                            option.idsKey === "policyIds"
                              ? policyTruncated
                              : option.idsKey === "appIds"
                                ? apps.truncated
                                : option.idsKey === "scriptIds"
                                  ? scripts.truncated
                                  : enrollmentTruncated
                          }
                          disabled={busy}
                          onAllChange={(all) => setIdFilter(option.idsKey!, all ? null : [])}
                          onSelectedIdsChange={(ids) => setIdFilter(option.idsKey!, ids)}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </fieldset>
            <fieldset className="environment-report-fieldset" disabled={busy}>
              <legend>Platforms</legend>
              <div className="environment-report-chips">
                {PLATFORM_OPTIONS.map((option) => (
                  <SelectionChip
                    key={option.key}
                    label={option.label}
                    checked={Boolean(selection[option.key])}
                    onChange={(next) => setSelectionKey(option.key, next)}
                  />
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      ) : (
        <p className="muted">Sign in to generate an as-built from the live tenant.</p>
      )}
      {progressLabel ? <p className="muted">{progressLabel}</p> : null}
      {error ? <p className="axis-alert axis-alert-warning">{error}</p> : null}
      {savedPath ? <p className="muted">Saved to {savedPath}</p> : null}
      {report ? (
        <>
          {report.warnings.length > 0 ? (
            <p className="muted">
              {report.objectCount} objects · {report.warnings.length} note
              {report.warnings.length === 1 ? "" : "s"} in the document
            </p>
          ) : (
            <p className="muted">{report.objectCount} objects in this snapshot</p>
          )}
          <iframe
            className="environment-report-preview"
            title="As-built preview"
            sandbox=""
            srcDoc={report.html}
          />
        </>
      ) : (
        <div className="axis-panel axis-panel-padded">
          <p style={{ margin: 0, fontWeight: 500 }}>No snapshot yet</p>
          <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", lineHeight: 1.45 }}>
            This is a point-in-time as-built, not a live Graph view. Catalog policies are expanded one
            by one, so a large tenant can take a few minutes. Deselect heavy surfaces (Apps, Policies,
            Scripts) or platforms you do not need before generating. Saved HTML and Markdown include
            script source — treat them as sensitive.
          </p>
        </div>
      )}
    </div>
  );
}
