import { useEffect, useMemo, useState } from "react";
import { createTenantScript } from "../../lib/tauri";
import { scriptLanguageForKind } from "../../lib/scriptKinds";
import type { TenantScriptSummary } from "../../types/inventory";
import { ScriptCodeEditor } from "../ui/ScriptCodeEditor";

export type ScriptFamily = "platform" | "remediation" | "compliance";
export type CreateScriptKind = "platform-powershell" | "platform-shell" | "remediation" | "compliance";

const DEFAULT_POWERSHELL = "# Axis platform script\n";
const DEFAULT_SHELL = "#!/bin/zsh\n";
const DEFAULT_DETECTION = "$ok = $true\nif ($ok) { exit 0 } else { exit 1 }\n";
const DEFAULT_REMEDIATION = "# Remediation\n";

function defaultKind(family: ScriptFamily): CreateScriptKind {
  if (family === "remediation") return "remediation";
  if (family === "compliance") return "compliance";
  return "platform-powershell";
}

function dialogTitle(family: ScriptFamily): string {
  if (family === "remediation") return "New remediation";
  if (family === "compliance") return "New compliance script";
  return "New script";
}

function ScriptBodyField({
  label,
  value,
  onChange,
  disabled,
  language,
  height = "14rem",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  language: "powershell" | "bash";
  height?: string;
}) {
  return (
    <div className="device-field">
      <span>{label}</span>
      <ScriptCodeEditor
        value={value}
        onChange={onChange}
        language={language}
        readOnly={disabled}
        ariaLabel={label}
        height={height}
      />
    </div>
  );
}

export function CreateScriptDialog({
  open,
  family,
  onClose,
  onCreated,
}: {
  open: boolean;
  family: ScriptFamily;
  onClose: () => void;
  onCreated: (script: TenantScriptSummary) => void;
}) {
  const [kind, setKind] = useState<CreateScriptKind>(() => defaultKind(family));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [runAs, setRunAs] = useState<"system" | "user">("system");
  const [runAs32Bit, setRunAs32Bit] = useState(false);
  const [scriptText, setScriptText] = useState(DEFAULT_POWERSHELL);
  const [detectionText, setDetectionText] = useState(DEFAULT_DETECTION);
  const [remediationText, setRemediationText] = useState(DEFAULT_REMEDIATION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const nextKind = defaultKind(family);
    setKind(nextKind);
    setName("");
    setDescription("");
    setRunAs("system");
    setRunAs32Bit(false);
    setScriptText(nextKind === "platform-shell" ? DEFAULT_SHELL : DEFAULT_POWERSHELL);
    setDetectionText(DEFAULT_DETECTION);
    setRemediationText(DEFAULT_REMEDIATION);
    setBusy(false);
    setError(null);
  }, [open, family]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose, open]);

  const needsDetection = kind === "remediation" || kind === "compliance";
  const editorLanguage = scriptLanguageForKind(kind);
  const canCreate = useMemo(() => {
    if (!name.trim() || busy) return false;
    if (needsDetection) return Boolean(detectionText.trim());
    return true;
  }, [busy, detectionText, name, needsDetection]);

  function changePlatformKind(next: CreateScriptKind) {
    setKind(next);
    const current = scriptText;
    if (
      current === DEFAULT_POWERSHELL ||
      current === DEFAULT_SHELL ||
      current.trim() === ""
    ) {
      setScriptText(next === "platform-shell" ? DEFAULT_SHELL : DEFAULT_POWERSHELL);
    }
  }

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const response = await createTenantScript({
        kind,
        displayName: name.trim(),
        description: description.trim() || undefined,
        runAsAccount: runAs,
        runAs32Bit: kind === "platform-shell" ? undefined : runAs32Bit,
        scriptText: needsDetection ? undefined : scriptText,
        detectionScriptText: needsDetection ? detectionText : undefined,
        remediationScriptText: kind === "remediation" ? remediationText : undefined,
      });
      if (!response.script) {
        setError(response.error ?? "Could not create the script.");
        return;
      }
      const created = response.script;
      onClose();
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the script.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="axis-modal axis-modal-wide create-script-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-script-title"
      >
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Graph</p>
            <h2 id="create-script-title">{dialogTitle(family)}</h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              Creates the object in Intune, unassigned. Assign it from the inspector after save.
            </p>
          </div>
        </div>

        <div className="create-script-form">
          {family === "platform" ? (
            <label className="device-field">
              Type
              <select
                className="axis-input"
                value={kind}
                disabled={busy}
                onChange={(event) => changePlatformKind(event.target.value as CreateScriptKind)}
              >
                <option value="platform-powershell">Windows PowerShell</option>
                <option value="platform-shell">macOS shell</option>
              </select>
            </label>
          ) : null}
          <label className="device-field">
            Display name
            <input
              className="axis-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={family === "remediation" ? "e.g. Clear stale cache" : "e.g. Inventory hostname"}
              disabled={busy}
              autoFocus
            />
          </label>
          <label className="device-field">
            Description (optional)
            <input
              className="axis-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy}
            />
          </label>
          <div className="create-script-options">
            <label className="device-field">
              Run as
              <select
                className="axis-input"
                value={runAs}
                disabled={busy}
                onChange={(event) => setRunAs(event.target.value as "system" | "user")}
              >
                <option value="system">System</option>
                <option value="user">User</option>
              </select>
            </label>
            {kind !== "platform-shell" ? (
              <label className="app-update-auto" style={{ alignSelf: "end", marginBottom: "0.15rem" }}>
                <input
                  type="checkbox"
                  checked={runAs32Bit}
                  disabled={busy}
                  onChange={(event) => setRunAs32Bit(event.target.checked)}
                />
                Run as 32-bit
              </label>
            ) : null}
          </div>

          {needsDetection ? (
            <>
              <ScriptBodyField
                label="Detection"
                value={detectionText}
                onChange={setDetectionText}
                disabled={busy}
                language={editorLanguage}
                height="12rem"
              />
              {kind === "remediation" ? (
                <ScriptBodyField
                  label="Remediation"
                  value={remediationText}
                  onChange={setRemediationText}
                  disabled={busy}
                  language={editorLanguage}
                  height="12rem"
                />
              ) : null}
            </>
          ) : (
            <ScriptBodyField
              label="Script"
              value={scriptText}
              onChange={setScriptText}
              disabled={busy}
              language={editorLanguage}
              height="16rem"
            />
          )}
        </div>

        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        <div className="axis-modal-actions">
          <button type="button" className="axis-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={!canCreate}
            onClick={() => void create()}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
