import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  canDuplicateGraphKind,
  canEditGraphMetadata,
  copyDisplayName,
} from "../../lib/duplicateObject";
import {
  assignObjectAssignments,
  duplicateGraphObject,
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

type PaneMode = "duplicate" | "metadata";
type PaneState = { mode: PaneMode; target: ObjectListTarget } | null;

export type ObjectListActionContext = {
  busy: boolean;
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

export function ObjectListMenuHost({
  children,
  extraActions,
  onDuplicated,
  onMetadataUpdated,
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
}) {
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [pane, setPane] = useState<PaneState>(null);
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
      {children}
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
      {toast ? <ContextMenuToast tone={toast.tone}>{toast.text}</ContextMenuToast> : null}
    </div>
  );
}
