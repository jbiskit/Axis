import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { packArtifactKindLabel, packImportNavigateHref } from "../../lib/baselines/packArtifacts";
import { useWriteGate, WriteActionButton } from "../../lib/readOnly";
import { navigate } from "../../lib/route";
import { importPackJsonDocument, pickJsonFiles } from "../../lib/tauri";
import type { PickedJsonFile } from "../../types/inventory";

export type NativeJsonImportCreated = {
  id: string;
  kind: string;
  displayName: string;
};

type ImportSource = "file" | "paste";

type DraftRow = {
  key: string;
  label: string;
  include: boolean;
  name: string;
  description: string;
  document: Record<string, unknown> | null;
  detectedKind: string | null;
  error: string | null;
};

function displayNameFromDocument(document: Record<string, unknown>, fallback: string): string {
  if (typeof document.displayName === "string" && document.displayName.trim()) {
    return document.displayName.trim();
  }
  if (typeof document.name === "string" && document.name.trim()) {
    return document.name.trim();
  }
  const object = document.object;
  if (object && typeof object === "object" && object !== null) {
    const displayName = (object as { displayName?: unknown }).displayName;
    if (typeof displayName === "string" && displayName.trim()) return displayName.trim();
    const name = (object as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return fallback;
}

function descriptionFromDocument(document: Record<string, unknown>): string {
  if (typeof document.description === "string") return document.description;
  const object = document.object;
  if (object && typeof object === "object" && object !== null) {
    const description = (object as { description?: unknown }).description;
    if (typeof description === "string") return description;
  }
  return "";
}

function kindFromDocument(document: Record<string, unknown>): string | null {
  const axis = document.axisExport;
  if (axis && typeof axis === "object" && axis !== null) {
    const kind = (axis as { kind?: unknown }).kind;
    if (typeof kind === "string" && kind.trim()) return kind.trim();
  }
  if (Array.isArray(document.settings) || document.settingInstance) {
    if (typeof document["@odata.type"] !== "string") {
      return "catalogPolicy";
    }
  }
  const odata = document["@odata.type"];
  if (typeof odata === "string" && odata.trim()) {
    const lower = odata.trim().replace(/^#/, "").toLowerCase();
    if (lower.includes("windowsautopilotdeploymentprofile")) return "enrollment-autopilot";
    if (lower.includes("grouppolicyconfiguration")) return "group-policy";
    if (lower.includes("compliancepolicy")) return "compliancePolicy";
    if (lower.includes("windowsupdateforbusinessconfiguration")) return "windowsUpdate:rings";
    if (lower.includes("windowsfeatureupdateprofile")) return "windowsUpdate:feature";
    if (lower.includes("windowsqualityupdateprofile")) return "windowsUpdate:quality";
    if (lower.includes("windowsdriverupdateprofile")) return "windowsUpdate:drivers";
    if (lower.includes("deviceenrollment") && lower.includes("configuration")) {
      return "enrollmentConfiguration";
    }
    if (lower.includes("configurationpolicy")) return "catalogPolicy";
  }
  return null;
}

function kindAccepted(detected: string | null, acceptKinds: string[] | undefined): boolean {
  if (!acceptKinds?.length || !detected) return true;
  const needle = detected.toLowerCase();
  return acceptKinds.some((accept) => {
    const a = accept.toLowerCase();
    return needle === a || needle.startsWith(`${a}:`) || needle.includes(a);
  });
}

function rowFromDocument(
  key: string,
  label: string,
  document: unknown,
  acceptKinds?: string[],
): DraftRow {
  if (document == null || typeof document !== "object") {
    return {
      key,
      label,
      include: false,
      name: label,
      description: "",
      document: null,
      detectedKind: null,
      error: "Expected a JSON object.",
    };
  }
  const doc = document as Record<string, unknown>;
  const detectedKind = kindFromDocument(doc);
  const name = displayNameFromDocument(doc, label);
  const description = descriptionFromDocument(doc);
  if (acceptKinds?.length && detectedKind && !kindAccepted(detectedKind, acceptKinds)) {
    return {
      key,
      label,
      include: false,
      name,
      description,
      document: doc,
      detectedKind,
      error: `This export looks like ${packArtifactKindLabel(detectedKind)}, which does not match this list.`,
    };
  }
  return {
    key,
    label,
    include: true,
    name,
    description,
    document: doc,
    detectedKind,
    error: null,
  };
}

function rowsFromFiles(files: PickedJsonFile[], acceptKinds?: string[]): DraftRow[] {
  return files.map((file, index) => {
    const key = `${file.path}:${index}`;
    if (file.error || file.document == null) {
      return {
        key,
        label: file.fileName,
        include: false,
        name: file.fileName.replace(/\.json$/i, ""),
        description: "",
        document: null,
        detectedKind: null,
        error: file.error ?? "The file was empty.",
      };
    }
    return rowFromDocument(key, file.fileName, file.document, acceptKinds);
  });
}

function parsePaste(text: string, acceptKinds?: string[]): DraftRow | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const document = JSON.parse(trimmed) as unknown;
    return rowFromDocument("paste", "Pasted JSON", document, acceptKinds);
  } catch (error) {
    return {
      key: "paste",
      label: "Pasted JSON",
      include: false,
      name: "Pasted JSON",
      description: "",
      document: null,
      detectedKind: null,
      error: error instanceof Error ? error.message : "Invalid JSON.",
    };
  }
}

export function NativeJsonImportDialog({
  title,
  description,
  acceptKinds,
  onClose,
  onImported,
}: {
  title: string;
  description?: string;
  acceptKinds?: string[];
  onClose: () => void;
  onImported: (created: NativeJsonImportCreated) => void;
}) {
  const { writeDisabled, writeHint } = useWriteGate();
  const [source, setSource] = useState<ImportSource>("file");
  const [files, setFiles] = useState<PickedJsonFile[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingCreated = useRef<NativeJsonImportCreated | null>(null);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const closeDialog = useCallback(() => {
    const created = pendingCreated.current;
    pendingCreated.current = null;
    onClose();
    if (created) {
      window.setTimeout(() => onImportedRef.current(created), 0);
    }
  }, [onClose]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) closeDialog();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDialog, saving]);

  useEffect(() => {
    if (source === "file") {
      setRows(rowsFromFiles(files, acceptKinds));
      return;
    }
    const row = parsePaste(pasteText, acceptKinds);
    setRows(row ? [row] : []);
  }, [acceptKinds, files, pasteText, source]);

  const ready = useMemo(
    () =>
      rows.filter(
        (row) => row.include && !row.error && row.document != null && row.name.trim().length > 0,
      ),
    [rows],
  );

  function patchRow(key: string, patch: Partial<DraftRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function chooseFiles() {
    const picked = await pickJsonFiles(`Import ${title}`);
    if (!picked?.length) return;
    setSource("file");
    setFiles(picked);
    setError(null);
  }

  async function runImport() {
    if (ready.length === 0) return;
    setSaving(true);
    setError(null);
    const created: NativeJsonImportCreated[] = [];
    const failures: string[] = [];
    try {
      for (const [index, row] of ready.entries()) {
        setProgress(`Creating ${index + 1} of ${ready.length}…`);
        const response = await importPackJsonDocument({
          document: row.document,
          displayName: row.name.trim(),
          description: row.description,
        });
        if (response.error || !response.result) {
          failures.push(`${row.name}: ${response.error ?? "Import failed."}`);
          continue;
        }
        created.push({
          id: response.result.id,
          kind: response.result.kind,
          displayName: response.result.displayName || row.name.trim(),
        });
      }
      if (created.length === 0) {
        setError(failures[0] ?? "Import failed.");
        return;
      }
      pendingCreated.current = created[0] ?? null;
      if (failures.length > 0) {
        setError(
          `Imported ${created.length}. ${failures.length} issue${failures.length === 1 ? "" : "s"}: ${failures.slice(0, 3).join(" ")}`,
        );
        return;
      }
      if (created.length === 1 && created[0]) {
        navigate(packImportNavigateHref(created[0].kind, created[0].id));
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
            <h2>{title}</h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              {description ??
                "Choose Axis pack JSON or Graph Export JSON from an object inspector. Objects are created unassigned."}
            </p>
          </div>
          <button type="button" className="axis-btn" disabled={saving} onClick={closeDialog}>
            Close
          </button>
        </div>

        <div className="axis-seg" role="tablist" aria-label="Import source" style={{ marginBottom: "0.85rem" }}>
          <button
            type="button"
            className={`axis-seg-btn${source === "file" ? " is-active" : ""}`}
            role="tab"
            aria-selected={source === "file"}
            disabled={saving}
            onClick={() => setSource("file")}
          >
            File
          </button>
          <button
            type="button"
            className={`axis-seg-btn${source === "paste" ? " is-active" : ""}`}
            role="tab"
            aria-selected={source === "paste"}
            disabled={saving}
            onClick={() => setSource("paste")}
          >
            Paste JSON
          </button>
        </div>

        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {progress ? <p className="muted">{progress}</p> : null}

        {source === "file" ? (
          <div className="object-action-fields" style={{ marginBottom: "0.75rem" }}>
            <div className="device-actions" style={{ marginBottom: "0.65rem" }}>
              <button type="button" className="axis-btn axis-btn-primary" disabled={saving} onClick={() => void chooseFiles()}>
                {files.length ? "Choose different files…" : "Choose JSON files…"}
              </button>
            </div>
            {files.length === 0 ? (
              <p className="muted">Select one or more Axis pack export JSON files.</p>
            ) : null}
          </div>
        ) : (
          <label className="device-field" style={{ marginBottom: "0.75rem" }}>
            JSON
            <textarea
              className="axis-input object-action-description mono-code"
              rows={12}
              value={pasteText}
              disabled={saving}
              placeholder='Pack: { "axisExport": …, "object": … }  — or paste Graph Export JSON from an object inspector'
              spellCheck={false}
              onChange={(event) => setPasteText(event.target.value)}
            />
          </label>
        )}

        {rows.length > 0 ? (
          <div className="object-action-fields" style={{ maxHeight: "36vh", overflow: "auto" }}>
            <table className="axis-table">
              <thead>
                <tr>
                  <th>Import</th>
                  <th>Display name</th>
                  <th>Kind</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.include && !row.error}
                        disabled={saving || Boolean(row.error) || row.document == null}
                        onChange={(event) => patchRow(row.key, { include: event.target.checked })}
                        aria-label={`Import ${row.label}`}
                      />
                    </td>
                    <td>
                      <input
                        className="axis-input"
                        value={row.name}
                        disabled={saving || Boolean(row.error)}
                        onChange={(event) => patchRow(row.key, { name: event.target.value })}
                      />
                      <label className="device-field" style={{ marginTop: "0.35rem" }}>
                        Description
                        <textarea
                          className="axis-input"
                          rows={2}
                          value={row.description}
                          disabled={saving || Boolean(row.error)}
                          onChange={(event) => patchRow(row.key, { description: event.target.value })}
                        />
                      </label>
                      <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.7rem" }}>
                        {row.label}
                        {row.error ? ` — ${row.error}` : null}
                      </p>
                    </td>
                    <td className="muted">
                      {row.detectedKind ? packArtifactKindLabel(row.detectedKind) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="object-action-footer">
          <p className="muted">
            {ready.length === 0
              ? "Add a valid JSON export to continue."
              : `${ready.length} object${ready.length === 1 ? "" : "s"}, created unassigned.`}
          </p>
          <div className="device-actions">
            <button type="button" className="axis-btn" disabled={saving} onClick={closeDialog}>
              Cancel
            </button>
            <WriteActionButton
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={writeDisabled || saving || ready.length === 0}
              title={writeDisabled ? writeHint : undefined}
              onClick={() => void runImport()}
            >
              {saving
                ? "Importing…"
                : ready.length <= 1
                  ? "Import to Intune"
                  : `Import ${ready.length} objects`}
            </WriteActionButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export function useNativeJsonImport({
  title,
  description,
  acceptKinds,
  onImported,
}: {
  title: string;
  description?: string;
  acceptKinds?: string[];
  onImported: (created: NativeJsonImportCreated) => void;
}) {
  const [open, setOpen] = useState(false);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  const openDialog = useCallback(() => setOpen(true), []);
  const closeDialog = useCallback(() => setOpen(false), []);
  const notifyImported = useCallback((created: NativeJsonImportCreated) => {
    onImportedRef.current(created);
  }, []);

  const dialog = open ? (
    <NativeJsonImportDialog
      title={title}
      description={description}
      acceptKinds={acceptKinds}
      onClose={closeDialog}
      onImported={notifyImported}
    />
  ) : null;

  return { openDialog, dialog };
}
