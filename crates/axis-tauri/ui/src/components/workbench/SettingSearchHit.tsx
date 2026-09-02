import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CatalogCategory, CatalogSettingSummary } from "../../types/inventory";
import {
  catalogSettingBlurb,
  catalogSettingSourceLabel,
  categoryBreadcrumb,
} from "../../lib/catalog";

const HOVER_DELAY_MS = 550;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

export function SettingSearchHit({
  setting,
  categories,
  alreadyOnPolicy = false,
  disabled = false,
  selected = false,
  trailing,
  onSelect,
}: {
  setting: CatalogSettingSummary;
  categories: CatalogCategory[];
  alreadyOnPolicy?: boolean;
  disabled?: boolean;
  selected?: boolean;
  trailing?: ReactNode;
  onSelect: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const source = catalogSettingSourceLabel(setting);
  const path = categoryBreadcrumb(categories, setting.categoryId);
  const blurb = catalogSettingBlurb(setting);
  const context = [source, path].filter(Boolean).join(" · ") || "Category unknown";
  const tipId = `setting-tip-${String(setting.id ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const detailsId = `${tipId}-details`;
  const hasDetails = Boolean(blurb.summary || blurb.detail || path || source);

  function clearHoverTimer() {
    if (hoverTimer.current != null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }

  function hideTooltip() {
    clearHoverTimer();
    setTipOpen(false);
  }

  function showTooltip() {
    if (expanded) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(380, Math.max(260, rect.width));
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
    const estimatedHeight = 220;
    const below = rect.bottom + 8;
    const top =
      below + estimatedHeight > window.innerHeight - 12
        ? Math.max(12, rect.top - estimatedHeight - 8)
        : below;
    setCoords({ top, left, width });
    setTipOpen(true);
  }

  function scheduleTooltip() {
    if (expanded || disabled) return;
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      showTooltip();
    }, HOVER_DELAY_MS);
  }

  function toggleDetails(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    hideTooltip();
    setExpanded((open) => !open);
  }

  useEffect(() => {
    return () => clearHoverTimer();
  }, []);

  useEffect(() => {
    if (!tipOpen) return;
    function hide() {
      setTipOpen(false);
    }
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [tipOpen]);

  return (
    <div
      ref={wrapRef}
      className={`setting-search-hit-wrap${expanded ? " is-expanded" : ""}`}
      onMouseEnter={scheduleTooltip}
      onMouseLeave={hideTooltip}
    >
      <div className="setting-search-hit-main">
        <button
          type="button"
          className={`setting-search-hit${selected ? " selected" : ""}`}
          disabled={disabled}
          aria-describedby={tipOpen ? tipId : expanded ? detailsId : undefined}
          onFocus={scheduleTooltip}
          onBlur={hideTooltip}
          onClick={onSelect}
        >
          <span className="setting-search-hit-copy">
            <span className="setting-search-hit-title">
              <strong>{setting.displayName}</strong>
              {source ? <span className="setting-search-hit-source">{source}</span> : null}
              {alreadyOnPolicy ? <span className="axis-pill">On policy</span> : null}
            </span>
            <span className="muted setting-search-hit-path">{context}</span>
            {!expanded && blurb.summary ? (
              <span className="setting-search-hit-blurb">{truncate(blurb.summary, 120)}</span>
            ) : null}
          </span>
        </button>
        {hasDetails ? (
          <button
            type="button"
            className={`setting-search-hit-toggle${expanded ? " is-expanded" : ""}`}
            aria-expanded={expanded}
            aria-controls={detailsId}
            title={expanded ? "Hide setting details" : "Show setting details"}
            onClick={toggleDetails}
          >
            <span className="setting-search-hit-toggle-chevron" aria-hidden>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M6 3.5 10.5 8 6 12.5" />
              </svg>
            </span>
            <span>{expanded ? "Hide" : "About"}</span>
          </button>
        ) : null}
        {trailing ? <div className="setting-search-hit-trailing">{trailing}</div> : null}
      </div>
      {expanded ? (
        <div id={detailsId} className="setting-search-hit-details">
          {source ? <p className="setting-search-tooltip-source">{source}</p> : null}
          {path ? <p className="setting-search-tooltip-path">{path}</p> : null}
          {blurb.summary ? (
            <p className="setting-search-tooltip-body">{blurb.summary}</p>
          ) : (
            <p className="muted">No catalog description for this setting.</p>
          )}
          {blurb.detail ? <p className="setting-search-tooltip-help">{blurb.detail}</p> : null}
        </div>
      ) : null}
      {tipOpen && coords && !expanded
        ? createPortal(
            <div
              id={tipId}
              className="setting-search-tooltip"
              role="tooltip"
              style={{ top: coords.top, left: coords.left, width: coords.width }}
            >
              {source ? <p className="setting-search-tooltip-source">{source}</p> : null}
              {path ? <p className="setting-search-tooltip-path">{path}</p> : null}
              {blurb.summary ? (
                <p className="setting-search-tooltip-body">{blurb.summary}</p>
              ) : (
                <p className="muted">No catalog description for this setting.</p>
              )}
              {blurb.detail ? <p className="setting-search-tooltip-help">{blurb.detail}</p> : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
