import { useEffect, useState } from "react";
import type { BaselineReferenceSourceInput, E8BaselineReference } from "../types/inventory";
import {
  isScriptPackArtifact,
  packArtifactKindLabel,
  packImportNavigateHref,
} from "../lib/baselines/packArtifacts";
import { tokenForSource } from "../lib/baselines/sources";
import { navigate } from "../lib/route";
import { useWriteGate } from "../lib/readOnly";
import {
  fetchBaselineExport,
  fetchPackArtifactText,
  importPackJsonDocument,
  importPackScriptText,
} from "../lib/tauri";

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

export function BaselineImportDialog({
  reference,
  sources,
  kicker,
  onClose,
}: {
  reference: E8BaselineReference & { sourceId: string; sourceName: string };
  sources: BaselineReferenceSourceInput[];
  kicker: string;
  onClose: () => void;
}) {
  const { writeDisabled, writeHint } = useWriteGate();
  const script = isScriptPackArtifact(reference.artifactKind);
  const [name, setName] = useState(reference.name);
  const [description, setDescription] = useState("");
  const [document, setDocument] = useState<unknown | null>(null);
  const [scriptText, setScriptText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const token = tokenForSource(sources, reference.sourceId);
    void (async () => {
      try {
        if (script) {
          const response = await fetchPackArtifactText(reference.downloadUrl, token);
          if (response.error || response.text == null) {
            throw new Error(response.error ?? "The script export was empty.");
          }
          if (cancelled) return;
          setScriptText(response.text);
          setDocument(null);
        } else {
          const response = await fetchBaselineExport(reference.downloadUrl, token);
          if (response.error || response.document == null) {
            throw new Error(response.error ?? "The pack export was empty.");
          }
          if (cancelled) return;
          const doc = response.document as Record<string, unknown>;
          setDocument(doc);
          setScriptText(null);
          setName(displayNameFromDocument(doc, reference.name));
          setDescription(descriptionFromDocument(doc));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load the pack export.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    reference.downloadUrl,
    reference.name,
    reference.sourceId,
    reference.artifactKind,
    sources,
    script,
  ]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function importArtifact() {
    setSaving(true);
    setError(null);
    try {
      const response = script
        ? await importPackScriptText({
            text: scriptText ?? "",
            displayName: name.trim(),
            description,
          })
        : await importPackJsonDocument({
            document,
            displayName: name.trim(),
            description,
          });
      if (response.error || !response.result) {
        setError(response.error ?? "Import failed.");
        return;
      }
      navigate(packImportNavigateHref(response.result.kind, response.result.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setSaving(false);
    }
  }

  const ready = script ? Boolean(scriptText?.trim()) : document != null;

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="axis-modal object-action-pane" role="dialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">{kicker}</p>
            <h2>{reference.name}</h2>
            <p className="muted" style={{ margin: "0.25rem 0 0" }}>
              {packArtifactKindLabel(reference.artifactKind)}
            </p>
          </div>
          <button type="button" className="axis-btn" disabled={saving} onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {loading ? <p className="muted">Downloading pack export…</p> : null}
        <div className="object-action-fields">
          <label className="device-field">
            Display name
            <input
              className="axis-input"
              value={name}
              disabled={loading || saving}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="device-field">
            Description
            <textarea
              className="axis-input object-action-description"
              value={description}
              rows={4}
              disabled={loading || saving}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        <div className="object-action-footer">
          <p className="muted">The imported object is created unassigned.</p>
          <div className="device-actions">
            <button type="button" className="axis-btn" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={writeDisabled || loading || saving || !name.trim() || !ready}
              title={writeDisabled ? writeHint : undefined}
              onClick={() => void importArtifact()}
            >
              {saving ? "Importing…" : "Import to Intune"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type BulkImportRow = {
  key: string;
  reference: E8BaselineReference & { sourceId: string; sourceName: string };
  include: boolean;
  name: string;
  description: string;
  error: string | null;
  status: "loading" | "ready" | "error";
};

export function BaselineBulkImportDialog({
  references,
  sources,
  kicker,
  onClose,
  onDone,
}: {
  references: Array<E8BaselineReference & { sourceId: string; sourceName: string }>;
  sources: BaselineReferenceSourceInput[];
  kicker: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { writeDisabled, writeHint } = useWriteGate();
  const referenceKey = references.map((reference) => `${reference.sourceId}:${reference.id}`).join("\0");
  const [rows, setRows] = useState<BulkImportRow[]>(() =>
    references.map((reference) => ({
      key: `ref:${reference.sourceId}:${reference.id}`,
      reference,
      include: true,
      name: reference.name,
      description: "",
      error: null,
      status: "loading" as const,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(
      references.map((reference) => ({
        key: `ref:${reference.sourceId}:${reference.id}`,
        reference,
        include: true,
        name: reference.name,
        description: "",
        error: null,
        status: "loading" as const,
      })),
    );
    void (async () => {
      for (const reference of references) {
        if (cancelled) return;
        const key = `ref:${reference.sourceId}:${reference.id}`;
        try {
          const token = tokenForSource(sources, reference.sourceId);
          if (isScriptPackArtifact(reference.artifactKind)) {
            const response = await fetchPackArtifactText(reference.downloadUrl, token);
            if (response.error || response.text == null) {
              throw new Error(response.error ?? "Empty script export.");
            }
          } else {
            const response = await fetchBaselineExport(reference.downloadUrl, token);
            if (response.error || response.document == null) {
              throw new Error(response.error ?? "Empty pack export.");
            }
            const doc = response.document as Record<string, unknown>;
            if (cancelled) return;
            setRows((current) =>
              current.map((row) =>
                row.key === key
                  ? {
                      ...row,
                      name: displayNameFromDocument(doc, reference.name),
                      description: descriptionFromDocument(doc),
                      status: "ready",
                      error: null,
                    }
                  : row,
              ),
            );
            continue;
          }
          if (cancelled) return;
          setRows((current) =>
            current.map((row) =>
              row.key === key ? { ...row, status: "ready", error: null } : row,
            ),
          );
        } catch (err: unknown) {
          if (cancelled) return;
          setRows((current) =>
            current.map((row) =>
              row.key === key
                ? {
                    ...row,
                    status: "error",
                    error: err instanceof Error ? err.message : String(err),
                    include: false,
                  }
                : row,
            ),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceKey, sources]);

  async function runImport() {
    const targets = rows.filter((row) => row.include && row.status === "ready");
    if (targets.length === 0) {
      setError("Select at least one ready export to import.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      for (let index = 0; index < targets.length; index++) {
        const row = targets[index]!;
        setProgress(`Importing ${index + 1} of ${targets.length}: ${row.name}`);
        const token = tokenForSource(sources, row.reference.sourceId);
        let response;
        if (isScriptPackArtifact(row.reference.artifactKind)) {
          const textResponse = await fetchPackArtifactText(row.reference.downloadUrl, token);
          if (textResponse.error || textResponse.text == null) {
            throw new Error(textResponse.error ?? `Failed to download “${row.name}”.`);
          }
          response = await importPackScriptText({
            text: textResponse.text,
            displayName: row.name.trim(),
            description: row.description,
          });
        } else {
          const exportResponse = await fetchBaselineExport(row.reference.downloadUrl, token);
          if (exportResponse.error || exportResponse.document == null) {
            throw new Error(exportResponse.error ?? `Failed to download “${row.name}”.`);
          }
          response = await importPackJsonDocument({
            document: exportResponse.document,
            displayName: row.name.trim(),
            description: row.description,
          });
        }
        if (response.error || !response.result) {
          throw new Error(response.error ?? `Import failed for “${row.name}”.`);
        }
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk import failed.");
    } finally {
      setProgress(null);
      setSaving(false);
    }
  }

  const readyCount = rows.filter((row) => row.include && row.status === "ready").length;

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="axis-modal object-action-pane" role="dialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">{kicker}</p>
            <h2>
              Import {references.length} pack item{references.length === 1 ? "" : "s"}
            </h2>
          </div>
          <button type="button" className="axis-btn" disabled={saving} onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {progress ? <p className="muted">{progress}</p> : null}
        <div className="object-action-fields" style={{ gap: "0.75rem" }}>
          {rows.map((row) => (
            <label key={row.key} className="baseline-bulk-row" style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={row.include}
                disabled={saving || row.status !== "ready"}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((item) =>
                      item.key === row.key ? { ...item, include: event.target.checked } : item,
                    ),
                  )
                }
              />
              <span>
                <strong>{row.name}</strong>
                <span className="muted"> · {packArtifactKindLabel(row.reference.artifactKind)}</span>
                {row.status === "loading" ? <span className="muted"> · Loading…</span> : null}
                {row.error ? (
                  <span className="muted" style={{ color: "var(--axis-danger, #b42318)" }}>
                    {" "}
                    · {row.error}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
        <div className="object-action-footer">
          <p className="muted">{readyCount} ready to import, unassigned.</p>
          <div className="device-actions">
            <button type="button" className="axis-btn" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={writeDisabled || saving || readyCount === 0}
              title={writeDisabled ? writeHint : undefined}
              onClick={() => void runImport()}
            >
              {saving ? "Importing…" : `Import ${readyCount}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
