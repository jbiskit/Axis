import { useEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../lib/route";
import { globalSearch, groupHits, type SearchSource } from "../lib/globalSearch";

/** The `type:` values the search understands, surfaced as a hint. */
const SEARCH_TYPES = [
  "policy",
  "compliance",
  "device",
  "app",
  "script",
  "autopilot",
  "profile",
  "update",
  "protection",
] as const;

export function GlobalSearch({ sources }: { sources: SearchSource[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const hits = useMemo(() => globalSearch(query, sources), [query, sources]);
  const groups = useMemo(() => groupHits(hits), [hits]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setHintsOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function choose(href: string) {
    setOpen(false);
    setHintsOpen(false);
    setQuery("");
    navigate(href);
  }

  function applyType(value: string) {
    setQuery(`type:${value} `);
    setHintsOpen(false);
    setOpen(true);
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setHintsOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, hits.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      const hit = hits[activeIndex];
      if (hit) choose(hit.href);
    }
  }

  const showPanel = open && query.trim().length >= 2;
  const showHints = hintsOpen && !showPanel;

  return (
    <div className="shell-search" ref={rootRef}>
      <div className="shell-search-field">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          className="shell-search-input"
          placeholder="Search devices, policies, apps…"
          value={query}
          aria-label="Search devices, policies, and apps"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className={`shell-search-hint-toggle${hintsOpen ? " is-open" : ""}`}
          aria-label="Search filters"
          aria-expanded={hintsOpen}
          title="Search filters — type:policy, type:compliance, …"
          onClick={() => setHintsOpen((value) => !value)}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
        <kbd>Ctrl K</kbd>
      </div>

      {showHints ? (
        <div className="shell-search-panel shell-search-hints">
          <p className="shell-search-group-label">Filter by type</p>
          <p className="shell-search-hint-copy">
            Add a filter to narrow results, then keep typing to match a name.
          </p>
          <div className="shell-search-hint-chips">
            {SEARCH_TYPES.map((value) => (
              <button
                key={value}
                type="button"
                className="shell-search-chip"
                onClick={() => applyType(value)}
              >
                type:{value}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showPanel ? (
        <div className="shell-search-panel" role="listbox">
          {hits.length === 0 ? (
            <p className="shell-search-empty">
              No matches. Try <code>type:policy</code>, <code>type:compliance</code>,{" "}
              <code>type:device</code>, <code>type:app</code>, or <code>type:script</code>.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.group} className="shell-search-group">
                <p className="shell-search-group-label">{group.group}</p>
                {group.hits.map((hit) => {
                  const index = hits.indexOf(hit);
                  return (
                    <button
                      key={hit.id}
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      className={`shell-search-hit${index === activeIndex ? " is-active" : ""}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(hit.href)}
                    >
                      <span className="shell-search-hit-title">{hit.title}</span>
                      {hit.meta ? <span className="shell-search-hit-meta">{hit.meta}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
