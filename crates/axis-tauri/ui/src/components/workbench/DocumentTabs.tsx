import type { DocumentTab } from "../../hooks/useDocumentTabs";

export function DocumentTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onPopout,
  popoutDisabled,
}: {
  tabs: DocumentTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onPopout?: () => void;
  popoutDisabled?: boolean;
}) {
  if (tabs.length === 0 && !onPopout) return null;
  return (
    <div className="document-tab-row" role="tablist" aria-label="Open items">
      <div className="document-tab-list">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`document-tab${activeId === tab.id ? " active" : ""}`}
            role="tab"
            aria-selected={activeId === tab.id}
          >
            <button type="button" className="document-tab-label" onClick={() => onSelect(tab.id)}>
              {tab.title}
            </button>
            <button
              type="button"
              className="document-tab-close"
              aria-label={`Close ${tab.title}`}
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
