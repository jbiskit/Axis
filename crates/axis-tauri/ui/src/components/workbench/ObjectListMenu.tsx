import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { canDuplicateGraphKind } from "../../lib/duplicateObject";
import { duplicateGraphObject } from "../../lib/tauri";
import {
  ContextMenu,
  ContextMenuToast,
  type ContextMenuItem,
  type ContextMenuState,
} from "../ui/ContextMenu";

export type ObjectListTarget = {
  id: string;
  kind: string;
  title: string;
};

export type ObjectListActionContext = {
  busy: boolean;
  duplicate: (target: ObjectListTarget) => Promise<void>;
};

/** Built-in row actions. Add new entries here as the context menu grows. */
export type ObjectListActionDef = {
  id: string;
  label: string;
  danger?: boolean;
  separatorBefore?: boolean;
  available: (target: ObjectListTarget) => boolean;
  disabled?: (target: ObjectListTarget, ctx: ObjectListActionContext) => boolean;
  run: (target: ObjectListTarget, ctx: ObjectListActionContext) => void | Promise<void>;
};

export const OBJECT_LIST_ACTIONS: ObjectListActionDef[] = [
  {
    id: "duplicate",
    label: "Duplicate",
    available: (target) => canDuplicateGraphKind(target.kind),
    disabled: (_target, ctx) => ctx.busy,
    run: (target, ctx) => ctx.duplicate(target),
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
  const more = extra?.(target) ?? [];
  return [...items, ...more];
}

export function ObjectListMenuHost({
  children,
  extraActions,
  onDuplicated,
}: {
  children: ReactNode;
  extraActions?: (target: ObjectListTarget) => ContextMenuItem[];
  onDuplicated?: (created: { id: string; title: string; kind: string }, source: ObjectListTarget) => void;
}) {
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "info" | "danger" } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const duplicate = useCallback(
    async (target: ObjectListTarget) => {
      setBusy(true);
      setToast({ text: `Duplicating “${target.title}”…`, tone: "info" });
      try {
        const response = await duplicateGraphObject(target.kind, target.id);
        if (response.error || !response.object) {
          setToast({ text: response.error ?? "Duplicate failed.", tone: "danger" });
          return;
        }
        setToast({
          text: `Created “${response.object.title}” as an unassigned copy.`,
          tone: "info",
        });
        onDuplicated?.(
          {
            id: response.object.id,
            title: response.object.title,
            kind: response.object.kind,
          },
          target,
        );
      } catch (err) {
        setToast({
          text: err instanceof Error ? err.message : "Duplicate failed.",
          tone: "danger",
        });
      } finally {
        setBusy(false);
      }
    },
    [onDuplicated],
  );

  const ctx = useMemo<ObjectListActionContext>(
    () => ({ busy, duplicate }),
    [busy, duplicate],
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
      {toast ? <ContextMenuToast tone={toast.tone}>{toast.text}</ContextMenuToast> : null}
    </div>
  );
}
