import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  canDeleteGraphKind,
  canDuplicateGraphKind,
  canEditGraphMetadata,
  copyDisplayName,
} from "../../lib/duplicateObject";
import {
  assignObjectAssignments,
  deleteGraphObject,
  duplicateGraphObject,
  exportSelectedObjects,
  fetchGraphObjectDetail,
  updateObjectMetadata,
} from "../../lib/tauri";
import type { AssignmentDraft } from "../../types/inventory";
import {
  ContextMenu,
  ContextMenuToast,
  type ContextMenuItem,
  type ContextMenuState,
} from "../ui/ContextMenu";
import { AssignmentsEditor } from "./AssignmentsEditor";

export type ObjectListTarget = {
  id: string;
  kind: string;
  title: string;
};

const ObjectDeleteContext = createContext<((target: ObjectListTarget) => void) | null>(null);

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </svg>
  );
}

export function ObjectDeleteButton({
  target,
  onDeleted,
}: {
  target: ObjectListTarget;
  onDeleted?: (target: ObjectListTarget) => void;
}) {
  const openDelete = useContext(ObjectDeleteContext);
  const [localOpen, setLocalOpen] = useState(false);
  if (!canDeleteGraphKind(target.kind)) return null;

  return (
    <>
      <button
        type="button"
        className="axis-btn axis-btn-icon object-delete-icon"
        aria-label={`Delete ${target.title}`}
        title={`Delete ${target.title}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (openDelete) openDelete(target);
          else setLocalOpen(true);
        }}
      >
        <TrashIcon />
      </button>
      {localOpen ? (
        <DeleteObjectDialog
          target={target}
          onClose={() => setLocalOpen(false)}
          onDeleted={onDeleted}
        />
      ) : null}
    </>
  );
}

type PaneMode = "duplicate" | "metadata";
type PaneState = { mode: PaneMode; target: ObjectListTarget } | null;

export type ObjectListActionContext = {
  busy: boolean;
  openDelete: (target: ObjectListTarget) => void;
  openDuplicate: (target: ObjectListTarget) => void;
  openMetadata: (target: ObjectListTarget) => void;
};

export type ObjectListActionDef = {
  id: string;
  label: string;
  danger?: boolean;
  separatorBefore?: boolean;
  available: (target: ObjectListTarget) => boolean;
  disabled?: (target: ObjectListTarget, ctx: ObjectListActionContext) => boolean;
  run: (target: ObjectListTarget, ctx: ObjectListActionContext) => void | Promise<void>;
};

/** Shared row actions. Add future object actions here. */
export const OBJECT_LIST_ACTIONS: ObjectListActionDef[] = [
  {
    id: "edit-metadata",
    label: "Edit details…",
    available: (target) => canEditGraphMetadata(target.kind),
    disabled: (_target, ctx) => ctx.busy,
    run: (target, ctx) => ctx.openMetadata(target),
  },
  {
    id: "duplicate",
    label: "Duplicate…",
    available: (target) => canDuplicateGraphKind(target.kind),
    disabled: (_target, ctx) => ctx.busy,
    run: (target, ctx) => ctx.openDuplicate(target),
  },
  {
    id: "delete",
    label: "Delete…",
    danger: true,
    separatorBefore: true,
    available: (target) => canDeleteGraphKind(target.kind),
    disabled: (_target, ctx) => ctx.busy,
    run: (target, ctx) => ctx.openDelete(target),
  },
];

export function listTargetProps(id: string, title: string, kind: string) {
  return {
    "data-list-id": id,
    "data-list-title": title,
    "data-list-kind": kind,
  };
}

export function targetFromContextEvent(event: MouseEvent): ObjectListTarget | null {
  const el = (event.target as HTMLElement | null)?.closest("[data-list-id]");
  if (!(el instanceof HTMLElement)) return null;
  const id = el.dataset.listId?.trim();
  const kind = el.dataset.listKind?.trim();
  if (!id || !kind) return null;
  return {
    id,
    kind,
    title: el.dataset.listTitle?.trim() || id,
  };
}

function itemsForTarget(
  target: ObjectListTarget,
  ctx: ObjectListActionContext,
  extra?: (target: ObjectListTarget) => ContextMenuItem[],
): ContextMenuItem[] {
  const items: ContextMenuItem[] = OBJECT_LIST_ACTIONS.filter((action) =>
    action.available(target),
  ).map((action) => ({
    id: action.id,
    label: action.label,
    danger: action.danger,
    separatorBefore: action.separatorBefore,
    disabled: action.disabled?.(target, ctx) ?? false,
    run: () => action.run(target, ctx),
  }));
  return [...items, ...(extra?.(target) ?? [])];
}

function ObjectActionPane({
  state,
  onClose,
  onDuplicated,
  onMetadataUpdated,
  setBusy,
  showToast,
}: {
  state: Exclude<PaneState, null>;
  onClose: () => void;
  onDuplicated?: (
    created: { id: string; title: string; kind: string },
    source: ObjectListTarget,
  ) => void;
  onMetadataUpdated?: (
    updated: { id: string; title: string; kind: string; description?: string | null },
    source: ObjectListTarget,
  ) => void;
  setBusy: (busy: boolean) => void;
  showToast: (text: string, tone?: "info" | "danger") => void;
}) {
  const { mode, target } = state;
  const [name, setName] = useState(
    mode === "duplicate" ? copyDisplayName(target.title) : target.title,
  );
  const [description, setDescription] = useState("");
  const [sourceAssignments, setSourceAssignments] = useState<Record<string, unknown>[]>([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDraft[]>([]);
  const [assignmentsWritable, setAssignmentsWritable] = useState(false);
  const [assignmentsReady, setAssignmentsReady] = useState(mode !== "duplicate");
  const [objectOdataType, setObjectOdataType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchGraphObjectDetail(target.kind, target.id)
      .then((response) => {
        if (cancelled) return;
        if (!response.detail) {
          setError(response.error ?? "Could not load object details.");
          return;
        }
        const value = response.detail.object.description;
        setDescription(typeof value === "string" ? value : "");
        setSourceAssignments(response.detail.assignments ?? []);
        const odata = response.detail.object["@odata.type"];
        setObjectOdataType(typeof odata === "string" ? odata : null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load object details.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target.id, target.kind]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function submit() {
    const nextName = name.trim();
    if (!nextName) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setBusy(true);
    setError(null);
    try {
      if (mode === "duplicate") {
        const response = await duplicateGraphObject(target.kind, target.id, {
          displayName: nextName,
          description,
          copyAssignments: false,
        });
        if (response.error || !response.object) {
          setError(response.error ?? "Duplicate failed.");
          return;
        }
        let assignmentError: string | null = null;
        if (assignmentsWritable && assignmentDrafts.length > 0) {
          const assignmentResponse = await assignObjectAssignments({
            kind: target.kind,
            id: response.object.id,
            drafts: assignmentDrafts,
            objectOdataType,
          });
          assignmentError = assignmentResponse.ok
            ? null
            : assignmentResponse.error ?? "Assignment update failed.";
        }
        showToast(
          assignmentError
            ? `Created “${response.object.title}”, but assignments failed: ${assignmentError}`
            : `Created “${response.object.title}”.`,
          assignmentError ? "danger" : "info",
        );
        onDuplicated?.(
          {
            id: response.object.id,
            title: response.object.title,
            kind: response.object.kind,
          },
          target,
        );
      } else {
        const response = await updateObjectMetadata({
          kind: target.kind,
          id: target.id,
          name: nextName,
          description,
        });
        if (response.error || !response.object) {
          setError(response.error ?? "Update failed.");
          return;
        }
        showToast(`Updated “${response.object.title}”.`);
        onMetadataUpdated?.(response.object, target);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
      setBusy(false);
    }
  }

  const handleDraftChange = useCallback((drafts: AssignmentDraft[], writable: boolean) => {
    setAssignmentDrafts(drafts);
    setAssignmentsWritable(writable);
    setAssignmentsReady(true);
  }, []);

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
            <p className="axis-kicker">{mode === "duplicate" ? "Duplicate" : "Metadata"}</p>
            <h2>{mode === "duplicate" ? `Copy ${target.title}` : target.title}</h2>
          </div>
          <button type="button" className="axis-btn" disabled={saving} onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {loading ? <p className="muted">Loading object details…</p> : null}
        <div className="object-action-fields">
          <label className="device-field">
            Name
            <input
              className="axis-input"
              value={name}
              disabled={saving}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="device-field">
            Description
            <textarea
              className="axis-input object-action-description"
              value={description}
              disabled={saving || loading}
              rows={5}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          {mode === "duplicate" && !loading ? (
            <AssignmentsEditor
              kind={target.kind}
              title={name.trim() || target.title}
              assignments={sourceAssignments}
              objectOdataType={objectOdataType}
              draftMode
              onDraftChange={handleDraftChange}
            />
          ) : null}
        </div>
        <div className="object-action-footer">
          <p className="muted">
            {mode === "duplicate"
              ? assignmentsWritable && assignmentDrafts.length > 0
                ? `${assignmentDrafts.length} assignment${assignmentDrafts.length === 1 ? "" : "s"} will be applied.`
                : "The copy will be created unassigned."
              : "Changes are written directly to Microsoft Graph."}
          </p>
          <div className="device-actions">
            <button type="button" className="axis-btn" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={saving || loading || !assignmentsReady || !name.trim()}
              onClick={() => void submit()}
            >
              {saving ? "Saving…" : mode === "duplicate" ? "Create copy" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteObjectDialog({
  target,
  onClose,
  onDeleted,
  setBusy,
  showToast,
}: {
  target: ObjectListTarget;
  onClose: () => void;
  onDeleted?: (target: ObjectListTarget) => void;
  setBusy?: (busy: boolean) => void;
  showToast?: (text: string, tone?: "info" | "danger") => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setDeleting(true);
    setBusy?.(true);
    setError(null);
    try {
      const response = await deleteGraphObject(target.kind, target.id);
      if (!response.ok) {
        setError(response.error ?? "Delete failed.");
        return;
      }
      showToast?.(`Deleted “${target.title}”.`);
      window.dispatchEvent(
        new CustomEvent("axis:graph-object-deleted", { detail: { id: target.id } }),
      );
      onDeleted?.(target);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
      setBusy?.(false);
    }
  }

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onClose();
      }}
    >
      <div className="axis-modal object-action-pane" role="alertdialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Delete</p>
            <h2>Delete {target.title}?</h2>
          </div>
          <button type="button" className="axis-btn" disabled={deleting} onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        <p>
          This permanently deletes the object from Microsoft Intune. This action cannot be undone.
        </p>
        <div className="object-action-footer">
          <span />
          <div className="device-actions">
            <button type="button" className="axis-btn" disabled={deleting} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-danger"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BulkExportAction({ targets }: { targets: ObjectListTarget[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (targets.length === 0) return null;

  async function runExport() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await exportSelectedObjects(
        targets.map((target) => ({
          kind: target.kind,
          id: target.id,
          title: target.title,
        })),
      );
      if (!result) return;
      const warning =
        result.warnings.length > 0
          ? ` ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}.`
          : "";
      setDone(
        result.filesWritten === 1
          ? `Saved ${result.path}.${warning}`
          : `Saved ${result.filesWritten} files to ${result.path}.${warning}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="axis-btn"
        disabled={busy}
        title={
          targets.length === 1
            ? "Save this object as JSON"
            : "Save each selected object as JSON in a folder"
        }
        onClick={() => void runExport()}
      >
        {busy ? "Exporting…" : targets.length === 1 ? "Export" : `Export ${targets.length}`}
      </button>
      {error ? (
        <span className="muted" style={{ color: "var(--axis-danger)", fontSize: "0.75rem" }}>
          {error}
        </span>
      ) : null}
      {done && !busy ? (
        <span className="muted" style={{ fontSize: "0.75rem" }} title={done}>
          Saved
        </span>
      ) : null}
    </>
  );
}

export function BulkListActions({
  targets,
  onDeleted,
}: {
  targets: ObjectListTarget[];
  onDeleted?: (deleted: ObjectListTarget[]) => void;
}) {
  return (
    <>
      <BulkExportAction targets={targets} />
      {onDeleted ? <BulkDeleteAction targets={targets} onDeleted={onDeleted} /> : null}
    </>
  );
}

export function BulkDeleteAction({
  targets,
  onDeleted,
}: {
  targets: ObjectListTarget[];
  onDeleted: (deleted: ObjectListTarget[]) => void;
}) {
  const deletableTargets = targets.filter((target) => canDeleteGraphKind(target.kind));
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setDeleting(true);
    setProgress(0);
    setError(null);
    const deleted: ObjectListTarget[] = [];
    const failures: string[] = [];
    for (const target of deletableTargets) {
      try {
        const response = await deleteGraphObject(target.kind, target.id);
        if (response.ok) deleted.push(target);
        else failures.push(`${target.title}: ${response.error ?? "Delete failed."}`);
      } catch (err) {
        failures.push(`${target.title}: ${err instanceof Error ? err.message : "Delete failed."}`);
      }
      setProgress((value) => value + 1);
    }
    for (const target of deleted) {
      window.dispatchEvent(
        new CustomEvent("axis:graph-object-deleted", { detail: { id: target.id } }),
      );
    }
    if (deleted.length > 0) onDeleted(deleted);
    setDeleting(false);
    if (failures.length > 0) {
      setError(
        `${deleted.length} deleted; ${failures.length} failed. ${failures.slice(0, 3).join(" ")}`,
      );
      return;
    }
    setOpen(false);
  }

  return (
    <>
      {deletableTargets.length === 0 ? null : (
      <button
        type="button"
        className="axis-btn bulk-delete-button"
        onClick={() => {
          setError(null);
          setProgress(0);
          setOpen(true);
        }}
      >
        <TrashIcon />
        Delete
      </button>
      )}
      {open ? (
        <div
          className="axis-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting) setOpen(false);
          }}
        >
          <div className="axis-modal object-action-pane" role="alertdialog" aria-modal="true">
            <div className="assignment-dialog-head">
              <div>
                <p className="axis-kicker">Bulk delete</p>
                <h2>Delete {deletableTargets.length} selected objects?</h2>
              </div>
              <button
                type="button"
                className="axis-btn"
                disabled={deleting}
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
            <p>
              These objects will be permanently deleted from Microsoft Intune. This action cannot
              be undone.
            </p>
            {deleting ? (
              <p className="muted">
                Deleting {progress} of {deletableTargets.length}…
              </p>
            ) : null}
            <div className="object-action-footer">
              <span />
              <div className="device-actions">
                <button
                  type="button"
                  className="axis-btn"
                  disabled={deleting}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="axis-btn axis-btn-danger"
                  disabled={deleting}
                  onClick={() => void confirmDelete()}
                >
                  {deleting ? "Deleting…" : `Delete ${deletableTargets.length}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function ObjectListMenuHost({
  children,
  extraActions,
  onDuplicated,
  onMetadataUpdated,
  onDeleted,
}: {
  children: ReactNode;
  extraActions?: (target: ObjectListTarget) => ContextMenuItem[];
  onDuplicated?: (
    created: { id: string; title: string; kind: string },
    source: ObjectListTarget,
  ) => void;
  onMetadataUpdated?: (
    updated: { id: string; title: string; kind: string; description?: string | null },
    source: ObjectListTarget,
  ) => void;
  onDeleted?: (target: ObjectListTarget) => void;
}) {
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [pane, setPane] = useState<PaneState>(null);
  const [deleteTarget, setDeleteTarget] = useState<ObjectListTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "info" | "danger" } | null>(
    null,
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((text: string, tone: "info" | "danger" = "info") => {
    setToast({ text, tone });
  }, []);

  const ctx = useMemo<ObjectListActionContext>(
    () => ({
      busy,
      openDelete: (target) => setDeleteTarget(target),
      openDuplicate: (target) => setPane({ mode: "duplicate", target }),
      openMetadata: (target) => setPane({ mode: "metadata", target }),
    }),
    [busy],
  );

  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    const target = targetFromContextEvent(event);
    if (!target) return;
    const items = itemsForTarget(target, ctx, extraActions);
    if (items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items });
  }

  return (
    <div className="object-list-menu-host" onContextMenu={onContextMenu}>
      <ObjectDeleteContext.Provider value={(target) => setDeleteTarget(target)}>
        {children}
      </ObjectDeleteContext.Provider>
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
      {pane ? (
        <ObjectActionPane
          key={`${pane.mode}:${pane.target.kind}:${pane.target.id}`}
          state={pane}
          onClose={() => setPane(null)}
          onDuplicated={onDuplicated}
          onMetadataUpdated={onMetadataUpdated}
          setBusy={setBusy}
          showToast={showToast}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteObjectDialog
          key={`${deleteTarget.kind}:${deleteTarget.id}`}
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={onDeleted}
          setBusy={setBusy}
          showToast={showToast}
        />
      ) : null}
      {toast ? <ContextMenuToast tone={toast.tone}>{toast.text}</ContextMenuToast> : null}
    </div>
  );
}
