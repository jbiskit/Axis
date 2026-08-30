import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { requestObjectRefresh } from "../../lib/inspectorCache";
import { useDocumentTabs, type DocumentTab, type TabDropPlace } from "../../hooks/useDocumentTabs";
import { ContextMenu, type ContextMenuState } from "../ui/ContextMenu";

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M20 12a8 8 0 1 1-2.2-5.4M20 4v5h-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DocumentTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onReorder,
  onPopout,
  popoutDisabled,
}: {
  tabs: DocumentTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onReorder?: (fromId: string, toId: string, place: TabDropPlace) => void;
  onPopout?: () => void;
  popoutDisabled?: boolean;
}) {
  const dragId = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hint, setHint] = useState<{ id: string; place: TabDropPlace } | null>(null);
  const [menu, setMenu] = useState<ContextMenuState>(null);

  if (tabs.length === 0 && !onPopout) return null;

  function placeForEvent(event: DragEvent<HTMLElement>): TabDropPlace {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
  }

  return (
    <div className="document-tab-row" role="tablist" aria-label="Open items">
      <div className="document-tab-list">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={[
              "document-tab",
              activeId === tab.id ? "active" : "",
              draggingId === tab.id ? "is-dragging" : "",
              hint?.id === tab.id ? `drop-${hint.place}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="tab"
            aria-selected={activeId === tab.id}
            draggable={false}
            onMouseDown={(event) => {
              if (event.button === 1) event.preventDefault();
              event.currentTarget.draggable = event.button === 0 && Boolean(onReorder);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenu({
                x: event.clientX,
                y: event.clientY,
                items: [
                  {
                    id: "refresh",
                    label: "Refresh",
                    run: () => {
                      onSelect(tab.id);
                      requestObjectRefresh(tab.id);
                    },
                  },
                  {
                    id: "close",
                    label: "Close",
                    run: () => onClose(tab.id),
                  },
                ],
              });
            }}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              event.stopPropagation();
              onClose(tab.id);
            }}
            onDragStart={(event) => {
              if (!onReorder) return;
              dragId.current = tab.id;
              setDraggingId(tab.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", tab.id);
              onSelect(tab.id);
            }}
            onDragEnd={(event) => {
              event.currentTarget.draggable = false;
              dragId.current = null;
              setDraggingId(null);
              setHint(null);
            }}
            onDragOver={(event) => {
              if (!onReorder || !dragId.current || dragId.current === tab.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const place = placeForEvent(event);
              setHint((current) =>
                current?.id === tab.id && current.place === place ? current : { id: tab.id, place },
              );
            }}
            onDrop={(event) => {
              event.preventDefault();
              const fromId = dragId.current ?? event.dataTransfer.getData("text/plain");
              const place = placeForEvent(event);
              setHint(null);
              dragId.current = null;
              setDraggingId(null);
              if (fromId && onReorder) onReorder(fromId, tab.id, place);
            }}
          >
            <button
              type="button"
              className="document-tab-label"
              title={tab.title}
              onClick={() => onSelect(tab.id)}
            >
              {tab.title}
            </button>
            <button
              type="button"
              className="document-tab-close"
              aria-label={`Close ${tab.title}`}
              title={`Close ${tab.title}`}
              draggable={false}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="axis-btn axis-btn-icon document-tab-refresh"
        disabled={!activeId}
        title={activeId ? "Refresh this object" : "Select a tab to refresh"}
        aria-label="Refresh"
        onClick={() => {
          if (activeId) requestObjectRefresh(activeId);
        }}
      >
        <RefreshIcon />
      </button>
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
      {onPopout ? (
        <button
          type="button"
          className="axis-btn"
          disabled={popoutDisabled || !activeId}
          onClick={onPopout}
          title="Open this inspector in a new window"
        >
          Pop out
        </button>
      ) : null}
    </div>
  );
}

export function InspectorWithDocumentTabs({
  selectedId,
  titleFor,
  onSelect,
  onClear,
  empty = null,
  children,
}: {
  selectedId: string | null;
  titleFor: (id: string) => string;
  onSelect: (id: string) => void;
  onClear: () => void;
  empty?: ReactNode;
  children: ReactNode | ((helpers: { closeActive: () => void }) => ReactNode);
}) {
  const { tabs, close, reorder } = useDocumentTabs(selectedId, titleFor);
  const closeActive = () => {
    if (!selectedId) {
      onClear();
      return;
    }
    const next = close(selectedId);
    if (next) onSelect(next);
    else onClear();
  };
  if (!selectedId) return empty;
  return (
    <div className="inspector-with-tabs">
      <DocumentTabs
        tabs={tabs}
        activeId={selectedId}
        onSelect={onSelect}
        onClose={(id) => {
          const next = close(id);
          if (next) onSelect(next);
          else onClear();
        }}
        onReorder={reorder}
      />
      {typeof children === "function" ? children({ closeActive }) : children}
    </div>
  );
}
