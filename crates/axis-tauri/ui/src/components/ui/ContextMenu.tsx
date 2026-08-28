import { Fragment, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  run: () => void | Promise<void>;
};

export type ContextMenuState = {
  x: number;
  y: number;
  items: ContextMenuItem[];
} | null;

export function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    }
    function onScroll() {
      onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose, state]);

  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node || !state) return;
    const rect = node.getBoundingClientRect();
    const pad = 8;
    let left = state.x;
    let top = state.y;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }, [state]);

  if (!state || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      className="axis-context-menu"
      role="menu"
      style={{ left: state.x, top: state.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {state.items.map((item) => (
        <Fragment key={item.id}>
          {item.separatorBefore ? <div className="axis-context-menu-sep" role="separator" /> : null}
          <button
            type="button"
            role="menuitem"
            className={`axis-context-menu-item${item.danger ? " is-danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              void item.run();
            }}
          >
            {item.label}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}

export function ContextMenuToast({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "danger";
}) {
  return (
    <div
      className={`axis-alert ${tone === "danger" ? "axis-alert-danger" : "axis-alert-info"} axis-context-menu-toast`}
      role="status"
    >
      {children}
    </div>
  );
}
