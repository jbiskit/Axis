import { useEffect, useMemo, useState } from "react";
import { closeThisWindow, popOutObject } from "../../lib/popout";
import { intunePortalUrlForKind } from "../../lib/intune/portalLinks";
import { fetchGraphObjectDetail, updateScriptContent } from "../../lib/tauri";
import type { GraphObjectDetail } from "../../types/inventory";
import { OpenInIntune } from "../intune/OpenInIntune";
import { ScriptCodeEditor, type ScriptCodeLanguage } from "../ui/ScriptCodeEditor";
import { PageHeader } from "../ui/PageChrome";
import { CatalogSettingInstances } from "./CatalogSettingInstances";
import { PolicySettingsEditor } from "./PolicySettingsEditor";
import { AssignmentsDialog } from "./PolicyBulkAssign";
import { formatRelative, IncompleteBanner } from "./shared";

type InspectorTab = "overview" | "assignments" | "payload";

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

function summarizeGraphAssignment(row: Record<string, unknown>): string {
  const target = asRecord(row.target);
  const odata = String(target?.["@odata.type"] ?? "");
  const groupId = text(target?.groupId);
  if (odata.includes("allLicensedUsers")) return "All users";
  if (odata.includes("allDevices")) return "All devices";
  if (odata.includes("exclusionGroup")) return `Exclude · ${groupId ?? "group"}`;
  if (groupId) return `Include · ${groupId}`;
  return "Assignment";
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function exportPayload(detail: GraphObjectDetail): Record<string, unknown> {
  return {
    ...detail.object,
    assignments: detail.assignments,
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
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCopied(false);
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
              Graph JSON for this object. Copy puts it on the clipboard.
            </p>
          </div>
          <div className="device-actions">
            <button type="button" className="axis-btn axis-btn-primary" onClick={() => void copyJson()}>
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
  const object = detail.object;
  const keys = [
    ["Description", "description"],
    ["Publisher", "publisher"],
    ["Version", "displayVersion"],
    ["File", "fileName"],
    ["Package id", "packageIdentifier"],
    ["Publishing", "publishingState"],
    ["Platforms", "platforms"],
    ["Technologies", "technologies"],
    ["Assigned", "isAssigned"],
    ["Settings", "settingCount"],
    ["Run as", "runAsAccount"],
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

function scriptLanguage(kind: string): ScriptCodeLanguage {
  return kind.includes("shell") ? "bash" : "powershell";
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
  const [detail, setDetail] = useState<GraphObjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>("overview");
  const [editingPolicy, setEditingPolicy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [scriptText, setScriptText] = useState("");
  const [detectionText, setDetectionText] = useState("");
  const [remediationText, setRemediationText] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTab("overview");
    setEditingPolicy(false);
    setAssignOpen(false);
    setExportOpen(false);
    setSaveMessage(null);
    setSaveError(null);
    void fetchGraphObjectDetail(kind, id)
      .then((response) => {
        if (cancelled) return;
        setDetail(response.detail);
        setError(response.error);
        setScriptText(response.detail?.scriptText ?? "");
        setDetectionText(response.detail?.detectionScriptText ?? "");
        setRemediationText(response.detail?.remediationScriptText ?? "");
        if (response.detail && (hasScript(response.detail) || kind.startsWith("script:"))) {
          setTab("payload");
        } else if (kind === "configurationPolicy" || kind === "groupPolicyConfiguration") {
          setTab("payload");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
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

  async function reloadDetail() {
    try {
      const response = await fetchGraphObjectDetail(kind, id);
      setDetail(response.detail);
      setError(response.error);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load object");
    }
  }

  const language = scriptLanguage(kind);
  const portalHref = intunePortalUrlForKind(kind, id, detail?.object ?? null);
  const payloadLabel = detail && hasScript(detail) ? "Scripts" : "Settings";
  const settings = detail?.settings ?? [];
  const extras = detail?.extras ?? null;
  const rows = useMemo(() => (detail ? overviewRows(detail) : []), [detail]);
  const canEditScripts = kind.startsWith("script:");
  const canEditPolicy = kind === "configurationPolicy";
  const canAssign = kind !== "autopilotDevice";
  const exportJson = detail ? pretty(exportPayload(detail)) : "";
  const dirty =
    canEditScripts &&
    (scriptText !== (detail?.scriptText ?? "") ||
      detectionText !== (detail?.detectionScriptText ?? "") ||
      remediationText !== (detail?.remediationScriptText ?? ""));

  async function saveScripts() {
    if (!detail) return;
    setSaveBusy(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const response = await updateScriptContent({
        kind: detail.kind,
        id: detail.id,
        scriptText:
          kind.includes("remediation") || kind.includes("compliance") ? null : scriptText,
        detectionScriptText:
          kind.includes("remediation") || kind.includes("compliance") ? detectionText : null,
        remediationScriptText: kind.includes("remediation") ? remediationText : null,
      });
      if (!response.ok) {
        setSaveError(response.error ?? "Save failed");
        return;
      }
      setDetail({
        ...detail,
        scriptText: detail.scriptText != null || scriptText ? scriptText : detail.scriptText,
        detectionScriptText:
          detail.detectionScriptText != null || detectionText
            ? detectionText
            : detail.detectionScriptText,
        remediationScriptText:
          detail.remediationScriptText != null || remediationText
            ? remediationText
            : detail.remediationScriptText,
      });
      setSaveMessage("Saved to Graph.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaveBusy(false);
    }
  }

  function handleClose() {
    if (popout) {
      void closeThisWindow();
      return;
    }
    onClose();
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow={popout ? "Popout" : editingPolicy ? "Edit policy" : "Inspector"}
        title={detail?.title ?? fallbackTitle ?? "Object"}
        actions={
          <div className="device-actions">
            {canEditPolicy && detail && !editingPolicy ? (
              <button
                type="button"
                className="axis-btn axis-btn-primary"
                title="Edit settings on this policy"
                onClick={() => setEditingPolicy(true)}
              >
                Edit
              </button>
            ) : null}
            {canAssign && detail && !editingPolicy ? (
              <button
                type="button"
                className="axis-btn"
                title="Update assignments without leaving this inspector"
                onClick={() => setAssignOpen(true)}
              >
                Update assignments
              </button>
            ) : null}
            {canEditPolicy && editingPolicy ? (
              <button type="button" className="axis-btn" onClick={() => setEditingPolicy(false)}>
                Done
              </button>
            ) : null}
            {detail ? (
              <button
                type="button"
                className="axis-btn"
                title="Show Graph JSON and copy it"
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
          </div>
        }
      />
      {incomplete && !editingPolicy ? <IncompleteBanner>{incomplete}</IncompleteBanner> : null}
      {loading ? <p className="muted">Loading Graph object…</p> : null}
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {saveError ? <div className="axis-alert axis-alert-danger">{saveError}</div> : null}
      {saveMessage ? <div className="axis-alert axis-alert-info">{saveMessage}</div> : null}
      {detail?.warnings.length ? (
        <div className="axis-alert axis-alert-warning">{detail.warnings.join(" · ")}</div>
      ) : null}
      {detail && editingPolicy ? (
        <section className="axis-panel" style={{ padding: "0.85rem" }}>
          <PolicySettingsEditor
            policyId={detail.id}
            object={detail.object}
            settings={settings}
            onSaved={() => void reloadDetail()}
          />
        </section>
      ) : detail ? (
        <>
          <div className="tab-row">
            {(
              [
                ["overview", "Overview"],
                ["assignments", `Assignments (${detail.assignments.length})`],
                ["payload", `${payloadLabel}${settings.length ? ` (${settings.length})` : ""}`],
              ] as const
            ).map(([tabId, label]) => (
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
          {tab === "assignments" ? (
            <section className="axis-panel" style={{ padding: "0.85rem" }}>
              <div className="device-toolbar">
                <p className="muted" style={{ margin: 0 }}>
                  {detail.assignments.length === 0
                    ? "No assignments on this object."
                    : `${detail.assignments.length} assignment${detail.assignments.length === 1 ? "" : "s"}.`}
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
              {detail.assignments.length > 0 ? (
                <ul className="assignment-rows" style={{ marginTop: "0.75rem" }}>
                  {detail.assignments.map((row, index) => (
                    <li key={text(row.id) ?? String(index)} className="assignment-row">
                      {summarizeGraphAssignment(row)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          {tab === "payload" ? (
            <div className="stack">
              {canEditScripts ? (
                <div className="device-toolbar">
                  <p className="muted" style={{ margin: 0 }}>
                    {dirty
                      ? "Unsaved edits in the buffer."
                      : "PowerShell/shell bodies from Graph."}
                  </p>
                  <button
                    type="button"
                    className="axis-btn axis-btn-primary"
                    disabled={saveBusy || !dirty}
                    onClick={() => void saveScripts()}
                  >
                    {saveBusy ? "Saving…" : "Save to Graph"}
                  </button>
                </div>
              ) : null}
              {kind.startsWith("script:") && !kind.includes("remediation") && !kind.includes("compliance") ? (
                <section className="axis-panel" style={{ padding: "0.85rem" }}>
                  <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>Script</h2>
                  <ScriptCodeEditor
                    value={scriptText}
                    onChange={setScriptText}
                    language={language}
                    ariaLabel="Script body"
                  />
                </section>
              ) : null}
              {kind.includes("remediation") || kind.includes("compliance") ? (
                <section className="axis-panel" style={{ padding: "0.85rem" }}>
                  <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>Detection</h2>
                  <ScriptCodeEditor
                    value={detectionText}
                    onChange={setDetectionText}
                    language={language}
                    ariaLabel="Detection script"
                  />
                </section>
              ) : null}
              {kind.includes("remediation") ? (
                <section className="axis-panel" style={{ padding: "0.85rem" }}>
                  <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>Remediation</h2>
                  <ScriptCodeEditor
                    value={remediationText}
                    onChange={setRemediationText}
                    language={language}
                    ariaLabel="Remediation script"
                  />
                </section>
              ) : null}
              {kind === "configurationPolicy" ? (
                <section className="axis-panel" style={{ padding: "0.85rem" }}>
                  <div className="device-toolbar">
                    <h2 style={{ margin: 0, fontSize: "0.85rem" }}>
                      Setting instances ({settings.length})
                    </h2>
                    <button
                      type="button"
                      className="axis-btn axis-btn-primary"
                      title="Open the policy editor"
                      onClick={() => setEditingPolicy(true)}
                    >
                      Edit
                    </button>
                  </div>
                  {settings.length > 0 ? (
                    <CatalogSettingInstances settings={settings} />
                  ) : (
                    <p className="muted">No setting instances on this policy.</p>
                  )}
                </section>
              ) : settings.length > 0 ? (
                <section className="axis-panel" style={{ padding: "0.85rem" }}>
                  <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                    Setting instances ({settings.length})
                  </h2>
                  <CatalogSettingInstances settings={settings} />
                </section>
              ) : null}
              {extras ? (
                <section className="axis-panel" style={{ padding: "0.85rem" }}>
                  <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>Related Graph data</h2>
                  <pre className="inspector-code">{pretty(extras)}</pre>
                </section>
              ) : null}
              {kind !== "configurationPolicy" &&
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
                    odataType: text(detail.object["@odata.type"]),
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
  );
}
