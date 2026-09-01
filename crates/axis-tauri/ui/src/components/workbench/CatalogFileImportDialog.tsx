import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  catalogDescriptionFromPolicy,
  catalogPlatformFromPolicy,
  catalogSettingsFromPolicy,
  fileStemLabel,
  normalizeIntunePolicyExport,
} from "../../lib/baselines/policyExport";
import {
  assignObjectAssignments,
  createSettingsCatalogPolicy,
  pickJsonFiles,
} from "../../lib/tauri";
import type { AssignmentDraft, PickedJsonFile } from "../../types/inventory";
import { AssignmentsEditor } from "./AssignmentsEditor";

const EMPTY_GRAPH_ASSIGNMENTS: Record<string, unknown>[] = [];
const IMPORT_ASSIGNMENT_TARGETS = [{ id: "catalog-import-draft", title: "Imported policies" }];

export type CatalogImportCreated = {
  id: string;
  name: string;
};

export type CatalogImportRow = {
  key: string;
  fileName: string;
  include: boolean;
  name: string;
  description: string;
  platform: "windows" | "macos";
  settings: Record<string, unknown>[];
  error: string | null;
};

function rowsFromFiles(
  files: PickedJsonFile[],
  defaultPlatform: "windows" | "macos" = "windows",
): CatalogImportRow[] {
  return files.map((file, index) => {
    const key = `${file.path}:${index}`;
    const name = fileStemLabel(file.fileName);
    if (file.error || file.document == null) {
      return {
        key,
        fileName: file.fileName,
        include: false,
        name,
        description: "",
        platform: defaultPlatform,
        settings: [],
        error: file.error ?? "The file was empty.",
      };
    }
    try {
      const policy = normalizeIntunePolicyExport(file.document, file.fileName);
      const settings = catalogSettingsFromPolicy(policy);
      if (settings.length === 0) {
        return {
          key,
          fileName: file.fileName,
          include: false,
          name,
          description: catalogDescriptionFromPolicy(policy),
          platform: catalogPlatformFromPolicy(policy),
          settings,
          error: "No Settings Catalog instances in this file.",
        };
      }
      return {
        key,
        fileName: file.fileName,
        include: true,
        name,
        description: catalogDescriptionFromPolicy(policy),
        platform: catalogPlatformFromPolicy(policy),
        settings,
        error: null,
      };
    } catch (error) {
      return {
        key,
        fileName: file.fileName,
        include: false,
        name,
        description: "",
        platform: defaultPlatform,
        settings: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

export function CatalogFileImportDialog({
  files,
  defaultPlatform,
  onClose,
  onImported,
}: {
  files: PickedJsonFile[];
  defaultPlatform?: "windows" | "macos";
  onClose: () => void;
  onImported: (created: CatalogImportCreated[]) => void;
}) {
  const [rows, setRows] = useState<CatalogImportRow[]>(() =>
    rowsFromFiles(files, defaultPlatform),
  );
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDraft[]>([]);
  const [assignmentsWritable, setAssignmentsWritable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingCreated = useRef<CatalogImportCreated[]>([]);
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
    setRows(rowsFromFiles(files, defaultPlatform));
  }, [defaultPlatform, files]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) closeDialog();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDialog, saving]);

  const ready = useMemo(
    () => rows.filter((row) => row.include && !row.error && row.name.trim() && row.settings.length > 0),
    [rows],
  );

  function patchRow(key: string, patch: Partial<CatalogImportRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function importPolicies() {
    if (ready.length === 0) return;
    setSaving(true);
    setError(null);
    const created: Array<{ id: string; name: string }> = [];
    const failures: string[] = [];
    try {
      for (const [index, row] of ready.entries()) {
        setProgress(`Creating ${index + 1} of ${ready.length}…`);
        const response = await createSettingsCatalogPolicy({
          name: row.name.trim(),
          description: row.description,
          platform: row.platform,
          settings: row.settings,
        });
        if (response.error || !response.policy) {
          failures.push(`${row.name}: ${response.error ?? "Create failed."}`);
          continue;
        }
        created.push(response.policy);
      }
      if (created.length > 0 && assignmentsWritable && assignmentDrafts.length > 0) {
        for (const [index, policy] of created.entries()) {
          setProgress(`Assigning ${index + 1} of ${created.length}…`);
          const response = await assignObjectAssignments({
            kind: "configurationPolicy",
            id: policy.id,
            drafts: assignmentDrafts,
          });
          if (!response.ok) {
            failures.push(`${policy.name}: assignments — ${response.error ?? "failed."}`);
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
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="axis-modal axis-modal-wide" role="dialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Import</p>
            <h2>Settings Catalog</h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              Names default to the file name. The assignment list below is applied to every policy
              you import.
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
                <th>Policy name</th>
                <th>Platform</th>
                <th>Settings</th>
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
                  </td>
                  <td>
                    <select
                      className="axis-input"
                      value={row.platform}
                      disabled={saving || Boolean(row.error)}
                      onChange={(event) =>
                        patchRow(row.key, { platform: event.target.value as "windows" | "macos" })
                      }
                    >
                      <option value="windows">Windows</option>
                      <option value="macos">macOS</option>
                    </select>
                  </td>
                  <td className="muted">{row.error ? "—" : row.settings.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AssignmentsEditor
          kind="configurationPolicy"
          title="Imported policies"
          targets={IMPORT_ASSIGNMENT_TARGETS}
          assignments={EMPTY_GRAPH_ASSIGNMENTS}
          draftMode
          draftHint="The same assignment list is applied to every policy you import. Leave empty to create them unassigned."
          onDraftChange={handleDraftChange}
        />
        <div className="object-action-footer">
          <p className="muted">
            {ready.length === 0
              ? "Select at least one valid Settings Catalog file."
              : assignmentsWritable && assignmentDrafts.length > 0
                ? `${ready.length} polic${ready.length === 1 ? "y" : "ies"} · ${assignmentDrafts.length} assignment${assignmentDrafts.length === 1 ? "" : "s"}.`
                : `${ready.length} polic${ready.length === 1 ? "y" : "ies"}, unassigned.`}
          </p>
          <div className="device-actions">
            <button type="button" className="axis-btn" disabled={saving} onClick={closeDialog}>
              Cancel
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={saving || ready.length === 0}
              onClick={() => void importPolicies()}
            >
              {saving ? "Importing…" : ready.length === 1 ? "Import policy" : `Import ${ready.length} policies`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useCatalogFileImport(
  onImported: (created: CatalogImportCreated[]) => void,
  defaultPlatform?: "windows" | "macos",
) {
  const [files, setFiles] = useState<PickedJsonFile[] | null>(null);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const openPicker = useCallback(async () => {
    const picked = await pickJsonFiles("Import Settings Catalog policies");
    if (!picked?.length) return;
    setFiles(picked);
  }, []);

  const notifyImported = useCallback((created: CatalogImportCreated[]) => {
    onImportedRef.current(created);
  }, []);

  const closePicker = useCallback(() => setFiles(null), []);

  const dialog = files?.length ? (
    <CatalogFileImportDialog
      files={files}
      defaultPlatform={defaultPlatform}
      onClose={closePicker}
      onImported={notifyImported}
    />
  ) : null;

  return { openPicker, dialog };
}
