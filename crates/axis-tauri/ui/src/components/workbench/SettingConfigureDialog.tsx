import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { CatalogSettingDetail } from "../../types/inventory";
import { SettingDraftEditor } from "./SettingDraftEditor";
import type { SettingValueDraft } from "../../lib/catalog";

/**
 * A wide modal for configuring one catalog setting. The three-pane catalog view
 * leaves the inspector too narrow for long descriptions and nested dependents,
 * so configuring happens here instead.
 */
export function SettingConfigureDialog({
  detail,
  draft,
  dependents,
  path,
  source,
  busy = false,
  onChange,
  onApply,
  onClose,
}: {
  detail: CatalogSettingDetail;
  draft: SettingValueDraft;
  dependents: Record<string, CatalogSettingDetail>;
  path?: string | null;
  source?: string | null;
  busy?: boolean;
  onChange: (next: SettingValueDraft) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const context = [source, path].filter(Boolean).join(" · ");

  return createPortal(
    <div
      className="setting-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="setting-dialog" role="dialog" aria-modal="true" aria-label={detail.displayName}>
        <header className="setting-dialog-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2>{detail.displayName}</h2>
            {context ? <p className="setting-dialog-path">{context}</p> : null}
          </div>
          <button
            type="button"
            className="axis-btn axis-btn-ghost"
            disabled={busy}
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </header>

        <div className="setting-dialog-body">
          {detail.description ? (
            <p className="setting-dialog-desc">{detail.description}</p>
          ) : (
            <p className="setting-dialog-help">No catalog description for this setting.</p>
          )}
          {detail.helpText ? <p className="setting-dialog-help">{detail.helpText}</p> : null}
          <SettingDraftEditor
            detail={detail}
            draft={draft}
            dependents={dependents}
            onChange={onChange}
          />
        </div>

        <footer className="setting-dialog-foot">
          <span className="muted" style={{ fontSize: "var(--axis-text-2xs)" }}>
            {detail.id}
          </span>
          <span className="spacer" />
          <button type="button" className="axis-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="axis-btn axis-btn-primary" disabled={busy} onClick={onApply}>
            {busy ? "Saving…" : "Apply"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
