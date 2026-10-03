import { useCallback, useEffect, useMemo, useState } from "react";
import { BooleanToggle } from "./workbench/BooleanToggle";
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
  noun?: string;
  idsKey?: "policyIds" | "appIds" | "enrollmentIds" | "scriptIds";
}[] = [
  { key: "policies", label: "Policies", noun: "policy", idsKey: "policyIds" },
  { key: "updates", label: "Updates" },
  { key: "apps", label: "Apps", noun: "app", idsKey: "appIds" },
  { key: "enrollment", label: "Enrollment", noun: "enrollment object", idsKey: "enrollmentIds" },
  { key: "scripts", label: "Scripts", noun: "script", idsKey: "scriptIds" },
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

const PREVIEW_LINK_GUARD = `<script>(function(){function reveal(el){var node=el;while(node){if(node.tagName==="DETAILS")node.open=true;node=node.parentElement;}el.scrollIntoView({block:"start"});}document.addEventListener("click",function(event){var link=event.target.closest&&event.target.closest("a[href^='#'], a[data-doclink]");if(!link)return;event.preventDefault();var id=link.getAttribute("data-doclink");if(!id){var raw=(link.getAttribute("href")||"").replace(/^#/,"");try{id=decodeURIComponent(raw);}catch(err){id=raw;}}var target=id?document.getElementById(id):null;if(target)reveal(target);},true);})();</script>`;

function previewDocument(html: string): string {
  const guarded = html.replace(/<a href="#([^"]*)">/g, '<a data-doclink="$1" tabindex="0">');
  if (guarded.includes("</body>")) {
    return guarded.replace("</body>", `${PREVIEW_LINK_GUARD}</body>`);
  }
  return `${guarded}${PREVIEW_LINK_GUARD}`;
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
      <BooleanToggle checked={checked} disabled={disabled} ariaLabel={label} onChange={onChange} />
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
    <button
      type="button"
      className={`environment-report-chip${checked ? " is-on" : ""}`}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      {label}
    </button>
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
  noun,
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
  noun: string;
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
      <div className="environment-report-scope" role="group" aria-label={`Which ${noun} to include`}>
        <button
          type="button"
          className={allMode ? "is-on" : ""}
          aria-pressed={allMode}
          disabled={disabled}
          onClick={() => {
            if (!allMode) onAllChange(true);
          }}
        >
          Everything
        </button>
        <button
          type="button"
          className={allMode ? "" : "is-on"}
          aria-pressed={!allMode}
          disabled={disabled}
          onClick={() => {
            if (allMode) onAllChange(false);
          }}
        >
          Choose
        </button>
      </div>
      {allMode ? (
        <p className="muted environment-report-item-picker-status">
          {`Every ${noun} in the selected platforms is included.`}
        </p>
      ) : (
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
      )}
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
  const canGenerate =
    selection.summary ||
    selection.devices ||
    selection.groups ||
    selection.policies ||
    selection.updates ||
    selection.apps ||
    selection.enrollment ||
    selection.scripts;
  const snapshotLabel =
    report == null
      ? null
      : report.warnings.length > 0
        ? `${report.objectCount} objects · ${report.warnings.length} note${report.warnings.length === 1 ? "" : "s"} in the document`
        : `${report.objectCount} objects in this snapshot`;

  return (
    <div className="stack environment-report">
      <PageHeader
        title="Environment report"
        description="A point-in-time as-built of this tenant. Set who it is for, choose what goes in, then generate a preview you can save."
      />
      {signedIn ? (
        <div className="environment-report-options axis-panel axis-panel-padded">
          <div className="environment-report-identity">
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
            <div className="environment-report-generate">
              <button
                type="button"
                className="axis-btn axis-btn-primary"
                onClick={() => void generate()}
                disabled={!canGenerate || busy}
              >
                {busy ? "Generating…" : report ? "Regenerate" : "Generate report"}
              </button>
              <p className="muted environment-report-generate-note">
                {canGenerate
                  ? "This reads the signed-in tenant and builds a snapshot. A large tenant can take a few minutes. Saved files include script source."
                  : "Turn on at least one chapter or area before generating."}
              </p>
            </div>
          </div>
          <div className="environment-report-content">
            <div className="environment-report-content-head">
              <div>
                <span>What to include</span>
                <p className="muted environment-report-hint">
                  Chapters open the document. Platforms limit the areas below. Each area can include every object, or
                  only the ones you choose.
                </p>
              </div>
              <div className="environment-report-content-actions">
                <button type="button" className="axis-btn axis-btn-ghost" onClick={selectAllContent} disabled={busy}>
                  Select all
                </button>
                <button type="button" className="axis-btn axis-btn-ghost" onClick={clearContent} disabled={busy}>
                  Clear
                </button>
              </div>
            </div>
            <div className="environment-report-include-grid">
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
            <fieldset className="environment-report-fieldset" disabled={busy}>
              <legend>Areas</legend>
              <div className="environment-report-content-list">
                {CONTENT_OPTIONS.map((option) => {
                  const categoryOn = Boolean(selection[option.key]);
                  const manualIds = option.idsKey ? selection[option.idsKey] : null;
                  const manualCount = manualIds == null ? null : manualIds.length;
                  return (
                    <div
                      key={option.key}
                      className={`environment-report-content-block${categoryOn ? " is-active" : ""}${
                        categoryOn && manualCount != null ? " is-picking" : ""
                      }`}
                    >
                      <div className="environment-report-content-block-head">
                        <SelectionCheck
                          label={option.label}
                          checked={categoryOn}
                          onChange={(next) => setSelectionKey(option.key, next)}
                        />
                        {categoryOn && manualCount != null ? (
                          <span className="environment-report-count">{manualCount} selected</span>
                        ) : null}
                      </div>
                      {option.idsKey && option.noun && categoryOn ? (
                        <ReportItemPicker
                          noun={option.noun}
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
          </div>
        </div>
      ) : (
        <p className="muted">Sign in to generate an as-built from the live tenant.</p>
      )}
      {progressLabel ? <p className="muted">{progressLabel}</p> : null}
      {error ? <p className="axis-alert axis-alert-warning">{error}</p> : null}
      {report ? (
        <section className="environment-report-output">
          <div className="environment-report-output-bar">
            <p className="muted">{snapshotLabel}</p>
            <div className="environment-report-output-actions">
              <button type="button" className="axis-btn" onClick={() => void save()} disabled={busy}>
                Save HTML
              </button>
              <button type="button" className="axis-btn" onClick={() => void saveMarkdown()} disabled={busy}>
                Save Markdown
              </button>
              {savedPath ? (
                <button type="button" className="axis-btn" onClick={() => void openSaved()}>
                  Open file
                </button>
              ) : null}
            </div>
          </div>
          {savedPath ? <p className="muted">Saved to {savedPath}</p> : null}
          <iframe
            className="environment-report-preview"
            title="As-built preview"
            sandbox="allow-scripts"
            srcDoc={previewDocument(report.html)}
          />
        </section>
      ) : null}
    </div>
  );
}
