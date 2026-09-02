import { useCallback, useEffect, useMemo, useState } from "react";
import { closeThisWindow, popOutObject } from "../../lib/popout";
import { summarizeAssignmentDraft } from "../../lib/assignmentSummary";
import { intunePortalUrlForKind } from "../../lib/intune/portalLinks";
import {
  fetchGraphObjectDetail,
  loadAssignmentWorkspace,
  saveTextFile,
  updateScriptContent,
} from "../../lib/tauri";
import {
  clearCachedObject,
  readCachedAssignmentDrafts,
  readCachedObjectDetail,
  requestObjectRefresh,
  writeCachedAssignmentDrafts,
  writeCachedObjectDetail,
} from "../../lib/inspectorCache";
import { parseScriptInspectorKind } from "../../lib/scriptKinds";
import type { AssignmentDraft, GraphObjectDetail } from "../../types/inventory";
import { OpenInIntune } from "../intune/OpenInIntune";
import { ContextMenu, type ContextMenuState } from "../ui/ContextMenu";
import { ObjectDeleteButton } from "./ObjectListMenu";
import { ScriptCodeEditor } from "../ui/ScriptCodeEditor";
import { ScriptRunSettingsFields } from "./ScriptRunSettingsFields";
import { PageHeader } from "../ui/PageChrome";
import { CatalogSettingInstances } from "./CatalogSettingInstances";
import { CompliancePolicyStatus } from "./CompliancePolicyStatus";
import { ComplianceSettingsView } from "./ComplianceSettingsView";
import { InspectorSaveButton, InspectorSaveProvider } from "./inspectorSave";
import { PolicySettingsEditor } from "./PolicySettingsEditor";
import { AssignmentsDialog } from "./PolicyBulkAssign";
import { ScriptRunStatus } from "./RemediationDeviceStatus";
import { formatRelative, IncompleteBanner, InspectorErrorBoundary } from "./shared";

type InspectorTab = "overview" | "status" | "assignments" | "payload";

function text(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function exportPayload(detail: GraphObjectDetail): Record<string, unknown> {
  const object = { ...(asRecord(detail.object) ?? {}) };
  delete object.assignments;
  return {
    ...object,
    ...(detail.settings?.length ? { settings: detail.settings } : {}),
    ...(detail.extras ? { extras: detail.extras } : {}),
    ...(detail.scriptText != null ? { scriptText: detail.scriptText } : {}),
    ...(detail.detectionScriptText != null
      ? { detectionScriptText: detail.detectionScriptText }
      : {}),
    ...(detail.remediationScriptText != null
      ? { remediationScriptText: detail.remediationScriptText }
      : {}),
  };
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    /* fall through */
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(area);
  if (!ok) throw new Error("Clipboard copy was blocked.");
}

function ExportJsonDialog({
  open,
  title,
  json,
  onClose,
}: {
  open: boolean;
  title: string;
  json: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setSaved(false);
      setCopyError(null);
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function copyJson() {
    setCopyError(null);
    try {
      await copyText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "Could not copy JSON.");
    }
  }

  async function saveAs() {
    setCopyError(null);
    try {
      const path = await saveTextFile({
        contents: json,
        suggestedName: `${title.replace(/[<>:"/\\|?*]+/g, "-").slice(0, 120) || "export"}.json`,
        title: "Save export as",
      });
      if (!path) return;
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "Could not save JSON.");
    }
  }

  if (!open) return null;

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="axis-modal axis-modal-export"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-json-title"
      >
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Export</p>
            <h2 id="export-json-title">{title}</h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              Graph JSON for this object. Copy puts it on the clipboard. Save as writes a file.
            </p>
          </div>
          <div className="device-actions">
            <button type="button" className="axis-btn axis-btn-primary" onClick={() => void saveAs()}>
              {saved ? "Saved" : "Save as"}
            </button>
            <button type="button" className="axis-btn" onClick={() => void copyJson()}>
              {copied ? "Copied" : "Copy JSON"}
            </button>
            <button type="button" className="axis-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {copyError ? <div className="axis-alert axis-alert-danger">{copyError}</div> : null}
        <pre className="inspector-code export-json">{json}</pre>
      </div>
    </div>
  );
}

function overviewRows(detail: GraphObjectDetail): Array<{ label: string; value: string }> {
  const object = asRecord(detail.object) ?? {};
  const keys = [
    ["Description", "description"],
    ["Publisher", "publisher"],
    ["Version", "version"],
    ["Version", "displayVersion"],
    ["File", "fileName"],
    ["Package id", "packageIdentifier"],
    ["Publishing", "publishingState"],
    ["Platforms", "platforms"],
    ["Technologies", "technologies"],
    ["Settings", "settingCount"],
    ["Join type", "deviceJoinType"],
    ["Name template", "deviceNameTemplate"],
    ["Serial", "serialNumber"],
    ["Group tag", "groupTag"],
    ["Manufacturer", "manufacturer"],
    ["Model", "model"],
    ["Enrollment", "enrollmentState"],
    ["User", "userPrincipalName"],
    ["Profile status", "deploymentProfileAssignmentStatus"],
    ["Managed device", "managedDeviceId"],
    ["Type", "@odata.type"],
    ["Created", "createdDateTime"],
    ["Modified", "lastModifiedDateTime"],
  ] as const;
  const rows: Array<{ label: string; value: string }> = [
    { label: "Id", value: detail.id },
    { label: "Kind", value: detail.kind },
  ];
  const assigned =
    typeof object.isAssigned === "boolean"
      ? object.isAssigned
      : Array.isArray(detail.assignments)
        ? detail.assignments.length > 0
        : null;
  if (assigned != null) {
    rows.push({
      label: "Assigned",
      value:
        assigned && detail.assignments.length > 1
          ? `Yes (${detail.assignments.length})`
          : assigned
            ? "Yes"
            : "No",
    });
  }
  if (detail.kind.startsWith("script:")) {
    if (detail.kind === "script:remediation") {
      rows.push({
        label: "Detection script",
        value: detail.detectionScriptText?.trim() ? "Yes" : "No",
      });
      rows.push({
        label: "Remediation script",
        value: detail.remediationScriptText?.trim() ? "Yes" : "No",
      });
    }
    rows.push({
      label: "Run this script using the logged-on credentials",
      value: object.runAsAccount === "user" ? "Yes" : "No",
    });
    if (detail.kind !== "script:platform-shell") {
      rows.push({
        label: "Enforce script signature check",
        value: object.enforceSignatureCheck === true ? "Yes" : "No",
      });
      rows.push({
        label: "Run script in 64-bit PowerShell",
        value: object.runAs32Bit === true ? "No" : "Yes",
      });
    }
  }
  for (const [label, key] of keys) {
    const raw = object[key];
    if (raw == null || raw === "") continue;
    if (key.endsWith("DateTime") && typeof raw === "string") {
      rows.push({ label, value: formatRelative(raw) });
    } else if (typeof raw === "boolean") {
      rows.push({ label, value: raw ? "Yes" : "No" });
    } else {
      const value = text(raw);
      if (value) rows.push({ label, value });
    }
  }
  return rows;
}

function hasScript(detail: GraphObjectDetail): boolean {
  return Boolean(detail.scriptText || detail.detectionScriptText || detail.remediationScriptText);
}

function defaultInspectorTab(kind: string): InspectorTab {
  if (kind === "script:remediation" || kind.startsWith("script:platform-")) return "status";
  if (
    kind === "configurationPolicy" ||
    kind === "compliancePolicy" ||
    kind === "groupPolicyConfiguration" ||
    kind.startsWith("script:")
  ) {
    return "payload";
  }
  return "overview";
}

function applyDetailToEditor(
  detail: GraphObjectDetail | null,
  setScriptText: (value: string) => void,
  setDetectionText: (value: string) => void,
  setRemediationText: (value: string) => void,
  setScriptMeta: (value: ScriptMetaState) => void,
) {
  setScriptText(detail?.scriptText ?? "");
  setDetectionText(detail?.detectionScriptText ?? "");
  setRemediationText(detail?.remediationScriptText ?? "");
  setScriptMeta(scriptMetaFromDetail(detail));
}

type ScriptMetaState = {
  name: string;
  description: string;
  publisher: string;
  version: string;
  runAsUser: boolean;
  enforceSignatureCheck: boolean;
  runAs64Bit: boolean;
};

function scriptMetaFromDetail(detail: GraphObjectDetail | null): ScriptMetaState {
  const object = asRecord(detail?.object) ?? {};
  return {
    name: detail?.title ?? "",
    description: typeof object.description === "string" ? object.description : "",
    publisher: typeof object.publisher === "string" ? object.publisher : "",
    version: object.version == null || object.version === "" ? "" : String(object.version),
    runAsUser: object.runAsAccount === "user",
    enforceSignatureCheck: object.enforceSignatureCheck === true,
    runAs64Bit: object.runAs32Bit !== true,
  };
}

export function GraphObjectInspector({
  kind,
  id,
  fallbackTitle,
  incomplete,
  onClose,
  popout = false,
}: {
  kind: string;
  id: string;
  fallbackTitle?: string;
  incomplete?: string;
  onClose: () => void;
  popout?: boolean;
}) {
  const cached = readCachedObjectDetail(kind, id);
  const [detail, setDetail] = useState<GraphObjectDetail | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>(() => defaultInspectorTab(kind));
  const [assignOpen, setAssignOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [scriptText, setScriptText] = useState(cached?.scriptText ?? "");
  const [detectionText, setDetectionText] = useState(cached?.detectionScriptText ?? "");
  const [remediationText, setRemediationText] = useState(cached?.remediationScriptText ?? "");
  const [scriptMeta, setScriptMeta] = useState(() => scriptMetaFromDetail(cached));
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDraft[]>(
    () => readCachedAssignmentDrafts(kind, id) ?? [],
  );
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [headerMenu, setHeaderMenu] = useState<ContextMenuState>(null);

  useEffect(() => {
    let cancelled = false;
    const hit = readCachedObjectDetail(kind, id);
    setError(null);
    setAssignOpen(false);
    setExportOpen(false);
    setSaveMessage(null);
    setSaveError(null);
    setTab(defaultInspectorTab(kind));
    if (hit) {
      setDetail(hit);
      applyDetailToEditor(hit, setScriptText, setDetectionText, setRemediationText, setScriptMeta);
      setLoading(false);
      const cachedDrafts = readCachedAssignmentDrafts(kind, id);
      if (cachedDrafts) setAssignmentDrafts(cachedDrafts);
    } else {
      setDetail(null);
      setAssignmentDrafts([]);
      applyDetailToEditor(null, setScriptText, setDetectionText, setRemediationText, setScriptMeta);
      setLoading(true);
    }
    void fetchGraphObjectDetail(kind, id)
      .then((response) => {
        if (cancelled) return;
        if (response.detail) {
          writeCachedObjectDetail(response.detail);
          setDetail(response.detail);
          applyDetailToEditor(response.detail, setScriptText, setDetectionText, setRemediationText, setScriptMeta);
          setError(response.error);
        } else if (!hit) {
          setDetail(null);
          setError(response.error);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (hit) return;
        setDetail(null);
        setError(err instanceof Error ? err.message : "Failed to load object");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  const assignments = useMemo(
    () => (Array.isArray(detail?.assignments) ? detail.assignments : []),
    [detail?.assignments],
  );

  useEffect(() => {
    let cancelled = false;
    const cachedDrafts = readCachedAssignmentDrafts(kind, id);
    if (cachedDrafts) {
      setAssignmentDrafts(cachedDrafts);
      setAssignmentsLoading(false);
    }
    if (!detail || assignments.length === 0) {
      if (!cachedDrafts) {
        setAssignmentDrafts([]);
        setAssignmentsLoading(false);
      }
      return () => {
        cancelled = true;
      };
    }
    if (!cachedDrafts) setAssignmentsLoading(true);
    void loadAssignmentWorkspace(kind, assignments)
      .then((response) => {
        if (cancelled) return;
        setAssignmentDrafts(response.drafts);
        writeCachedAssignmentDrafts(kind, id, response.drafts);
      })
      .catch(() => {
        if (cancelled) return;
        if (!cachedDrafts) setAssignmentDrafts([]);
      })
      .finally(() => {
        if (!cancelled) setAssignmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, detail?.id, assignments]);

  const reloadDetail = useCallback(async () => {
    clearCachedObject(kind, id);
    setLoading(true);
    setError(null);
    try {
      const response = await fetchGraphObjectDetail(kind, id);
      if (response.detail) {
        writeCachedObjectDetail(response.detail);
        setDetail(response.detail);
        applyDetailToEditor(response.detail, setScriptText, setDetectionText, setRemediationText, setScriptMeta);
      } else {
        setDetail(null);
      }
      setError(response.error);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load object");
    } finally {
      setLoading(false);
    }
  }, [id, kind]);

  useEffect(() => {
    function onRefresh(event: Event) {
      const refreshId = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (refreshId === id) void reloadDetail();
    }
    window.addEventListener("axis:graph-object-refresh", onRefresh);
    return () => window.removeEventListener("axis:graph-object-refresh", onRefresh);
  }, [id, reloadDetail]);

  const scriptInfo = parseScriptInspectorKind(kind);
  const language = scriptInfo?.language ?? "powershell";
  const portalHref = intunePortalUrlForKind(kind, id, asRecord(detail?.object) ?? null);
  const payloadLabel = detail && hasScript(detail) ? "Scripts" : "Settings";
  const settings = Array.isArray(detail?.settings) ? detail.settings : [];
  const extras = detail?.extras ?? null;
  const rows = useMemo(() => (detail ? overviewRows(detail) : []), [detail]);
  const inspectorTabs: Array<[InspectorTab, string]> = [
    ["overview", "Overview"],
    ...(kind === "compliancePolicy" ||
    kind === "script:remediation" ||
    kind.startsWith("script:platform-")
      ? ([["status", "Device status"]] as Array<[InspectorTab, string]>)
      : []),
    ["assignments", `Assignments (${assignments.length})`],
    ["payload", `${payloadLabel}${settings.length ? ` (${settings.length})` : ""}`],
  ];
  const supportsRemediationSchedule = kind === "script:remediation";
  const canEditScripts = Boolean(scriptInfo);
  const canAssign = kind !== "autopilotDevice";
  const exportJson = detail ? pretty(exportPayload(detail)) : "";
  const savedMeta = scriptMetaFromDetail(detail);
  const dirty =
    canEditScripts &&
    (scriptText !== (detail?.scriptText ?? "") ||
      detectionText !== (detail?.detectionScriptText ?? "") ||
      remediationText !== (detail?.remediationScriptText ?? "") ||
      scriptMeta.name !== savedMeta.name ||
      scriptMeta.description !== savedMeta.description ||
      scriptMeta.publisher !== savedMeta.publisher ||
      scriptMeta.runAsUser !== savedMeta.runAsUser ||
      scriptMeta.enforceSignatureCheck !== savedMeta.enforceSignatureCheck ||
      scriptMeta.runAs64Bit !== savedMeta.runAs64Bit);

  const saveScripts = useCallback(async () => {
    if (!detail) return;
    setSaveBusy(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const response = await updateScriptContent({
        kind: detail.kind,
        id: detail.id,
        displayName: scriptMeta.name.trim() || detail.title,
        description: scriptMeta.description,
        publisher: scriptMeta.publisher,
        runAsAccount: scriptMeta.runAsUser ? "user" : "system",
        runAs32Bit: scriptInfo?.supports32Bit ? !scriptMeta.runAs64Bit : null,
        enforceSignatureCheck: scriptInfo?.supportsSignature ? scriptMeta.enforceSignatureCheck : null,
        scriptText: scriptInfo?.isPlatform ? scriptText : null,
        detectionScriptText:
          scriptInfo?.isRemediation || scriptInfo?.isCompliance ? detectionText : null,
        remediationScriptText: scriptInfo?.isRemediation ? remediationText : null,
      });
      if (!response.ok) {
        setSaveError(response.error ?? "Save failed");
        return;
      }
      const next = {
        ...detail,
        title: scriptMeta.name.trim() || detail.title,
        object: {
          ...detail.object,
          displayName: scriptMeta.name.trim() || detail.title,
          description: scriptMeta.description,
          publisher: scriptMeta.publisher,
          runAsAccount: scriptMeta.runAsUser ? "user" : "system",
          ...(scriptInfo?.supports32Bit ? { runAs32Bit: !scriptMeta.runAs64Bit } : {}),
          ...(scriptInfo?.supportsSignature
            ? { enforceSignatureCheck: scriptMeta.enforceSignatureCheck }
            : {}),
        },
        scriptText: detail.scriptText != null || scriptText ? scriptText : detail.scriptText,
        detectionScriptText:
          detail.detectionScriptText != null || detectionText
            ? detectionText
            : detail.detectionScriptText,
        remediationScriptText:
          detail.remediationScriptText != null || remediationText
            ? remediationText
            : detail.remediationScriptText,
      };
      writeCachedObjectDetail(next);
      setDetail(next);
      requestObjectRefresh(detail.id);
      setSaveMessage("Saved to Graph.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaveBusy(false);
    }
  }, [
    detectionText,
    detail,
    remediationText,
    scriptInfo?.isCompliance,
    scriptInfo?.isPlatform,
    scriptInfo?.isRemediation,
    scriptInfo?.supports32Bit,
    scriptInfo?.supportsSignature,
    scriptMeta,
    scriptText,
  ]);

  const scriptSaveAction = useMemo(() => {
    if (!canEditScripts || !detail) return null;
    return {
      onSave: () => void saveScripts(),
      disabled: saveBusy || !dirty,
      busy: saveBusy,
    };
  }, [canEditScripts, detail, dirty, saveBusy, saveScripts]);

  function handleClose() {
    if (popout) {
      void closeThisWindow();
      return;
    }
    onClose();
  }

  return (
    <InspectorSaveProvider action={scriptSaveAction}>
    <div className="stack inspector-body">
      <div className="inspector-chrome">
      <PageHeader
        eyebrow={popout ? "Popout" : "Inspector"}
        title={detail?.title ?? fallbackTitle ?? "Object"}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setHeaderMenu({
            x: event.clientX,
            y: event.clientY,
            items: [
              {
                id: "refresh",
                label: "Refresh",
                run: () => requestObjectRefresh(id),
              },
            ],
          });
        }}
        actions={
          <div className="device-actions">
            <InspectorSaveButton />
            {canAssign && detail ? (
              <button
                type="button"
                className="axis-btn"
                title="Update assignments without leaving this inspector"
                onClick={() => setAssignOpen(true)}
              >
                Update assignments
              </button>
            ) : null}
            {detail ? (
              <button
                type="button"
                className="axis-btn"
                title="Show Graph JSON, copy it, or save as a file"
                onClick={() => setExportOpen(true)}
              >
                Export
              </button>
            ) : null}
            {!popout ? (
              <button
                type="button"
                className="axis-btn"
                onClick={() =>
                  void popOutObject(kind, id, detail?.title ?? fallbackTitle)
                }
              >
                Pop out
              </button>
            ) : null}
            <button type="button" className="axis-btn" onClick={handleClose}>
              {popout ? "Close window" : "Close"}
            </button>
            {portalHref ? (
              <OpenInIntune href={portalHref} label={detail?.title ?? fallbackTitle} />
            ) : null}
            <ObjectDeleteButton
              target={{
                id,
                kind,
                title: detail?.title ?? fallbackTitle ?? "this object",
              }}
              onDeleted={() => handleClose()}
            />
          </div>
        }
      />
      <ContextMenu state={headerMenu} onClose={() => setHeaderMenu(null)} />
      {incomplete ? <IncompleteBanner>{incomplete}</IncompleteBanner> : null}
      {loading && !detail ? <p className="muted">Loading Graph object…</p> : null}
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {saveError ? <div className="axis-alert axis-alert-danger">{saveError}</div> : null}
      {saveMessage ? <div className="axis-alert axis-alert-info">{saveMessage}</div> : null}
      {detail?.warnings?.length ? (
        <div className="axis-alert axis-alert-warning">{detail.warnings.join(" · ")}</div>
      ) : null}
      {detail ? (
        <div className="tab-row">
          {inspectorTabs.map(([tabId, label]) => (
            <button
              key={tabId}
              type="button"
              className={`tab-btn${tab === tabId ? " active" : ""}`}
              onClick={() => setTab(tabId)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      </div>
      <div className="inspector-scroll">
      {detail ? (
        <>
          {tab === "overview" ? (
            <section className="axis-panel" style={{ padding: "0.85rem" }}>
              <dl className="meta-grid">
                {rows.map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          {tab === "status" && kind === "compliancePolicy" ? (
            <CompliancePolicyStatus policyId={detail.id} />
          ) : null}
          {tab === "status" &&
          (kind === "script:remediation" || kind.startsWith("script:platform-")) ? (
            <ScriptRunStatus kind={kind} scriptId={detail.id} />
          ) : null}
          {tab === "assignments" ? (
            <section className="axis-panel" style={{ padding: "0.85rem" }}>
              <div className="device-toolbar">
                <p className="muted" style={{ margin: 0 }}>
                  {assignments.length === 0
                    ? "No assignments on this object."
                    : `${assignments.length} assignment${assignments.length === 1 ? "" : "s"}.`}
                </p>
                {canAssign ? (
                  <button
                    type="button"
                    className="axis-btn axis-btn-primary"
                    onClick={() => setAssignOpen(true)}
                  >
                    Update assignments
                  </button>
                ) : null}
              </div>
              {assignmentsLoading ? (
                <p className="muted" style={{ marginTop: "0.75rem" }}>
                  Resolving group names…
                </p>
              ) : null}
              {!assignmentsLoading && assignments.length > 0 ? (
                <ul className="assignment-rows" style={{ marginTop: "0.75rem" }}>
                  {assignmentDrafts.map((draft, index) => (
                    <li key={`${draft.targetKind}:${draft.groupId ?? index}`} className="assignment-row">
                      {summarizeAssignmentDraft(draft, {
                        supportsSchedule: supportsRemediationSchedule,
                      })}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          {tab === "payload" ? (
            <div className="stack">
              {canEditScripts ? (
                <section className="axis-panel" style={{ padding: "1rem 1.1rem" }}>
                  <div className="inspector-form">
                    <div className="inspector-form-section">
                      <h2>Basics</h2>
                      <div className="inspector-form-grid">
                        <label className="inspector-form-row">
                          <span>Name</span>
                          <input
                            className="axis-input"
                            value={scriptMeta.name}
                            disabled={saveBusy}
                            onChange={(event) =>
                              setScriptMeta((current) => ({ ...current, name: event.target.value }))
                            }
                          />
                        </label>
                        <label className="inspector-form-row">
                          <span>Description</span>
                          <input
                            className="axis-input"
                            value={scriptMeta.description}
                            disabled={saveBusy}
                            onChange={(event) =>
                              setScriptMeta((current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="inspector-form-row">
                          <span>Publisher</span>
                          <input
                            className="axis-input"
                            value={scriptMeta.publisher}
                            placeholder="No Publisher"
                            disabled={saveBusy}
                            onChange={(event) =>
                              setScriptMeta((current) => ({
                                ...current,
                                publisher: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="inspector-form-row">
                          <span className="inspector-form-label">Version</span>
                          <span className="inspector-form-static">{scriptMeta.version || "—"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="inspector-form-section">
                      <h2>Settings</h2>
                      <div className="inspector-form-grid">
                        {scriptInfo?.isRemediation ? (
                          <>
                            <span className="inspector-form-label">Detection script</span>
                            <span className="inspector-form-static">
                              {detectionText.trim() ? "Yes" : "No"}
                            </span>
                            <span className="inspector-form-label">Remediation script</span>
                            <span className="inspector-form-static">
                              {remediationText.trim() ? "Yes" : "No"}
                            </span>
                          </>
                        ) : null}
                        <ScriptRunSettingsFields
                          runAsUser={scriptMeta.runAsUser}
                          onRunAsUserChange={(runAsUser) =>
                            setScriptMeta((current) => ({ ...current, runAsUser }))
                          }
                          enforceSignatureCheck={scriptMeta.enforceSignatureCheck}
                          onEnforceSignatureCheckChange={(enforceSignatureCheck) =>
                            setScriptMeta((current) => ({ ...current, enforceSignatureCheck }))
                          }
                          runAs64Bit={scriptMeta.runAs64Bit}
                          onRunAs64BitChange={(runAs64Bit) =>
                            setScriptMeta((current) => ({ ...current, runAs64Bit }))
                          }
                          showSignature={Boolean(scriptInfo?.supportsSignature)}
                          show64Bit={Boolean(scriptInfo?.supports32Bit)}
                          disabled={saveBusy}
                        />
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}
              {scriptInfo?.isPlatform ? (
                <section className="axis-panel" style={{ padding: "0.85rem" }}>
                  <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>Script</h2>
                  <ScriptCodeEditor
                    value={scriptText}
                    onChange={setScriptText}
                    language={language}
                    ariaLabel="Script body"
                    lintRole="platform"
                  />
                </section>
              ) : null}
              {scriptInfo?.isRemediation || scriptInfo?.isCompliance ? (
                <section className="axis-panel" style={{ padding: "0.85rem" }}>
                  <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>Detection</h2>
                  <ScriptCodeEditor
                    value={detectionText}
                    onChange={setDetectionText}
                    language={language}
                    ariaLabel="Detection script"
                    lintRole="detection"
                  />
                </section>
              ) : null}
              {scriptInfo?.isRemediation ? (
                <section className="axis-panel" style={{ padding: "0.85rem" }}>
                  <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>Remediation</h2>
                  <ScriptCodeEditor
                    value={remediationText}
                    onChange={setRemediationText}
                    language={language}
                    ariaLabel="Remediation script"
                    lintRole="remediation"
                  />
                </section>
              ) : null}
              {kind === "configurationPolicy" ? (
                <section className="axis-panel" style={{ padding: "0.85rem" }}>
                  <InspectorErrorBoundary>
                    <PolicySettingsEditor
                      policyId={detail.id}
                      object={detail.object}
                      settings={settings}
                      onSaved={() => void reloadDetail()}
                    />
                  </InspectorErrorBoundary>
                </section>
              ) : settings.length > 0 ? (
                <section className="axis-panel" style={{ padding: "0.85rem" }}>
                  <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                    Setting instances ({settings.length})
                  </h2>
                  <CatalogSettingInstances settings={settings} />
                </section>
              ) : null}
              {kind === "compliancePolicy" ? (
                <ComplianceSettingsView
                  policyId={detail.id}
                  object={detail.object}
                  extras={extras}
                  onSaved={() => void reloadDetail()}
                />
              ) : extras ? (
                <section className="axis-panel" style={{ padding: "0.85rem" }}>
                  <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>Related Graph data</h2>
                  <pre className="inspector-code">{pretty(extras)}</pre>
                </section>
              ) : null}
              {kind !== "configurationPolicy" &&
              kind !== "compliancePolicy" &&
              !hasScript(detail) &&
              settings.length === 0 &&
              !extras ? (
                <p className="muted">
                  No setting instances or script bodies on this object. Use Export for the Graph payload.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      </div>
      {canAssign ? (
        <AssignmentsDialog
          open={assignOpen && Boolean(detail)}
          kind={kind}
          policies={
            detail
              ? [
                  {
                    id: detail.id,
                    name: detail.title,
                    odataType: text(asRecord(detail.object)?.["@odata.type"]),
                  },
                ]
              : []
          }
          onClose={() => setAssignOpen(false)}
          onSaved={() => {
            setAssignOpen(false);
            void reloadDetail();
          }}
        />
      ) : null}
      <ExportJsonDialog
        open={exportOpen && Boolean(detail)}
        title={detail?.title ?? fallbackTitle ?? "Object"}
        json={exportJson}
        onClose={() => setExportOpen(false)}
      />
    </div>
    </InspectorSaveProvider>
  );
}
