import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rowsFromScriptFiles, type ScriptImportFamily, type ScriptImportKind, type ScriptImportRow } from "../../lib/baselines/scriptImport";
import { inspectorKindForTenantScript } from "../../lib/scriptKinds";
import { assignObjectAssignments, createTenantScript, pickScriptFiles } from "../../lib/tauri";
import type { AssignmentDraft, PickedTextFile, TenantScriptSummary } from "../../types/inventory";
import { AssignmentsEditor } from "./AssignmentsEditor";
import { ScriptRunSettingsFields } from "./ScriptRunSettingsFields";

const EMPTY_GRAPH_ASSIGNMENTS: Record<string, unknown>[] = [];
const IMPORT_ASSIGNMENT_TARGETS = [{ id: "script-import-draft", title: "Imported scripts" }];

function familyTitle(family: ScriptImportFamily): string {
  if (family === "remediation") return "Remediations";
  if (family === "compliance") return "Compliance scripts";
  return "Scripts";
}

function pickerTitle(family: ScriptImportFamily): string {
  if (family === "remediation") return "Import remediations";
  if (family === "compliance") return "Import compliance scripts";
  return "Import scripts";
}

export function ScriptFileImportDialog({
  files,
  family,
  onClose,
  onImported,
}: {
  files: PickedTextFile[];
  family: ScriptImportFamily;
  onClose: () => void;
  onImported: (created: TenantScriptSummary[]) => void;
}) {
  const [rows, setRows] = useState<ScriptImportRow[]>(() => rowsFromScriptFiles(files, family));
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDraft[]>([]);
  const [assignmentsWritable, setAssignmentsWritable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingCreated = useRef<TenantScriptSummary[]>([]);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const handleDraftChange = useCallback((drafts: AssignmentDraft[], writable: boolean) => {
    setAssignmentDrafts(drafts);
    setAssignmentsWritable(writable);
  }, []);

  const closeDialog = useCallback(() => {
    const created = pendingCreated.current;
    pendingCreated.current = [];
    onClose();
    if (created.length > 0) {
      window.setTimeout(() => onImportedRef.current(created), 0);
    }
  }, [onClose]);

  useEffect(() => {
    setRows(rowsFromScriptFiles(files, family));
  }, [family, files]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) closeDialog();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDialog, saving]);

  const ready = useMemo(
    () => rows.filter((row) => row.include && !row.error && row.name.trim()),
    [rows],
  );
  const assignmentKind = inspectorKindForTenantScript(ready[0]?.kind ?? `${family === "platform" ? "platform-powershell" : family}`);

  function patchRow(key: string, patch: Partial<ScriptImportRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function importScripts() {
    if (ready.length === 0) return;
    setSaving(true);
    setError(null);
    const created: TenantScriptSummary[] = [];
    const failures: string[] = [];
    try {
      for (const [index, row] of ready.entries()) {
        setProgress(`Creating ${index + 1} of ${ready.length}…`);
        const needsDetection = row.kind === "remediation" || row.kind === "compliance";
        const response = await createTenantScript({
          kind: row.kind,
          displayName: row.name.trim(),
          description: row.description.trim() || undefined,
          publisher: row.publisher.trim() || undefined,
          runAsAccount: row.runAsAccount,
          runAs32Bit: row.kind === "platform-shell" ? undefined : row.runAs32Bit,
          enforceSignatureCheck: row.kind === "platform-shell" ? undefined : row.enforceSignatureCheck,
          scriptText: needsDetection ? undefined : row.scriptText,
          detectionScriptText: needsDetection ? row.detectionScriptText : undefined,
          remediationScriptText: row.kind === "remediation" ? row.remediationScriptText : undefined,
        });
        if (response.error || !response.script) {
          failures.push(`${row.name}: ${response.error ?? "Create failed."}`);
          continue;
        }
        created.push(response.script);
      }
      if (created.length > 0 && assignmentsWritable && assignmentDrafts.length > 0) {
        for (const [index, script] of created.entries()) {
          setProgress(`Assigning ${index + 1} of ${created.length}…`);
          const response = await assignObjectAssignments({
            kind: inspectorKindForTenantScript(script.kind),
            id: script.id,
            drafts: assignmentDrafts,
          });
          if (!response.ok) {
            failures.push(`${script.displayName}: assignments — ${response.error ?? "failed."}`);
          }
        }
      }
      if (created.length === 0) {
        setError(failures[0] ?? "Import failed.");
        return;
      }
      pendingCreated.current = created;
      if (failures.length > 0) {
        setError(
          `Imported ${created.length}. ${failures.length} issue${failures.length === 1 ? "" : "s"}: ${failures.slice(0, 4).join(" ")}`,
        );
        return;
      }
      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) closeDialog();
      }}
    >
      <div className="axis-modal axis-modal-wide" role="dialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Import</p>
            <h2>{familyTitle(family)}</h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              Names default to the file name. Pack files keep their <code>@axis-pack</code> metadata.
              The assignment list below is applied to every script you import.
            </p>
          </div>
          <button type="button" className="axis-btn" disabled={saving} onClick={closeDialog}>
            Close
          </button>
        </div>
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {progress ? <p className="muted">{progress}</p> : null}
        <div className="object-action-fields" style={{ maxHeight: "40vh", overflow: "auto" }}>
          <table className="axis-table">
            <thead>
              <tr>
                <th>Import</th>
                <th>Name</th>
                {family === "platform" ? <th>Kind</th> : null}
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.include && !row.error}
                      disabled={saving || Boolean(row.error)}
                      onChange={(event) => patchRow(row.key, { include: event.target.checked })}
                      aria-label={`Import ${row.fileName}`}
                    />
                  </td>
                  <td>
                    <input
                      className="axis-input"
                      value={row.name}
                      disabled={saving || Boolean(row.error)}
                      onChange={(event) => patchRow(row.key, { name: event.target.value })}
                    />
                    <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.7rem" }}>
                      {row.fileName}
                      {row.error ? ` — ${row.error}` : null}
                    </p>
                    <div className="inspector-form-grid" style={{ marginTop: "0.65rem" }}>
                      <ScriptRunSettingsFields
                        runAsUser={row.runAsAccount === "user"}
                        onRunAsUserChange={(runAsUser) =>
                          patchRow(row.key, { runAsAccount: runAsUser ? "user" : "system" })
                        }
                        enforceSignatureCheck={row.enforceSignatureCheck}
                        onEnforceSignatureCheckChange={(enforceSignatureCheck) =>
                          patchRow(row.key, { enforceSignatureCheck })
                        }
                        runAs64Bit={!row.runAs32Bit}
                        onRunAs64BitChange={(runAs64Bit) =>
                          patchRow(row.key, { runAs32Bit: !runAs64Bit })
                        }
                        showSignature={row.kind !== "platform-shell"}
                        show64Bit={row.kind !== "platform-shell"}
                        disabled={saving || Boolean(row.error)}
                      />
                    </div>
                  </td>
                  {family === "platform" ? (
                    <td>
                      <select
                        className="axis-input"
                        value={row.kind}
                        disabled={saving || Boolean(row.error)}
                        onChange={(event) =>
                          patchRow(row.key, { kind: event.target.value as ScriptImportKind })
                        }
                      >
                        <option value="platform-powershell">Windows PowerShell</option>
                        <option value="platform-shell">macOS shell</option>
                      </select>
                    </td>
                  ) : null}
                  <td className="muted">
                    {row.error
                      ? "—"
                      : row.kind === "remediation"
                        ? `${row.detectionScriptText.length + row.remediationScriptText.length} chars`
                        : `${(row.kind === "compliance" ? row.detectionScriptText : row.scriptText).length} chars`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AssignmentsEditor
          kind={assignmentKind}
          title="Imported scripts"
          targets={IMPORT_ASSIGNMENT_TARGETS}
          assignments={EMPTY_GRAPH_ASSIGNMENTS}
          draftMode
          draftHint="The same assignment list is applied to every script you import. Leave empty to create them unassigned."
          onDraftChange={handleDraftChange}
        />
        <div className="object-action-footer">
          <p className="muted">
            {ready.length === 0
              ? `Select at least one valid ${familyTitle(family).toLowerCase()} file.`
              : assignmentsWritable && assignmentDrafts.length > 0
                ? `${ready.length} script${ready.length === 1 ? "" : "s"} · ${assignmentDrafts.length} assignment${assignmentDrafts.length === 1 ? "" : "s"}.`
                : `${ready.length} script${ready.length === 1 ? "" : "s"}, unassigned.`}
          </p>
          <div className="device-actions">
            <button type="button" className="axis-btn" disabled={saving} onClick={closeDialog}>
              Cancel
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={saving || ready.length === 0}
              onClick={() => void importScripts()}
            >
              {saving ? "Importing…" : ready.length === 1 ? "Import script" : `Import ${ready.length} scripts`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useScriptFileImport(
  family: ScriptImportFamily,
  onImported: (created: TenantScriptSummary[]) => void,
) {
  const [files, setFiles] = useState<PickedTextFile[] | null>(null);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const openPicker = useCallback(async () => {
    const picked = await pickScriptFiles(pickerTitle(family));
    if (!picked?.length) return;
    setFiles(picked);
  }, [family]);

  const notifyImported = useCallback((created: TenantScriptSummary[]) => {
    onImportedRef.current(created);
  }, []);

  const closePicker = useCallback(() => setFiles(null), []);

  const dialog = files?.length ? (
    <ScriptFileImportDialog
      files={files}
      family={family}
      onClose={closePicker}
      onImported={notifyImported}
    />
  ) : null;

  return { openPicker, dialog };
}
