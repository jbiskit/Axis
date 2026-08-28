import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { useDocumentTabs, type DocumentTab, type TabDropPlace } from "../../hooks/useDocumentTabs";

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
            draggable={Boolean(onReorder)}
            onMouseDown={(event) => {
              if (event.button === 1) event.preventDefault();
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
            onDragEnd={() => {
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
