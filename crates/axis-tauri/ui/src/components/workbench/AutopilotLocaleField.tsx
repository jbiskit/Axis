import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  autopilotLocaleLabel,
  filterAutopilotLocales,
  normalizeAutopilotLocale,
  type AutopilotLocaleOption,
} from "../../lib/autopilotLocales";

export function AutopilotLocaleField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (locale: string) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const normalized = normalizeAutopilotLocale(value);
  const selectedLabel = autopilotLocaleLabel(normalized);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selectedLabel);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    if (!open) setQuery(selectedLabel);
  }, [selectedLabel, open, normalized]);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const options = useMemo(() => filterAutopilotLocales(query), [query]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  function pick(option: AutopilotLocaleOption) {
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" && open && options[highlight]) {
      event.preventDefault();
      pick(options[highlight]);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setQuery(selectedLabel);
    }
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <input
        className="axis-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        disabled={disabled}
        value={query}
        placeholder="Search language or region…"
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Allow mousedown on options to fire first.
          window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) {
              setOpen(false);
              setQuery(selectedLabel);
            }
          }, 0);
        }}
      />
      {open && !disabled ? (
        <ul
          id={listId}
          role="listbox"
          className="axis-panel"
          style={{
            position: "absolute",
            zIndex: 20,
            left: 0,
            right: 0,
            margin: "0.25rem 0 0",
            padding: "0.25rem 0",
            maxHeight: "14rem",
            overflow: "auto",
            listStyle: "none",
          }}
        >
          {options.length === 0 ? (
            <li className="muted" style={{ padding: "0.5rem 0.75rem", fontSize: "0.8rem" }}>
              No matching languages.
            </li>
          ) : (
            options.map((option, index) => {
              const active = index === highlight;
              const selected =
                option.value.toLowerCase() === normalized.toLowerCase() &&
                option.value === normalized;
              const selectedEmpty = !normalized && !option.value;
              return (
                <li key={`${option.value || "user-select"}:${option.label}`} role="option">
                  <button
                    type="button"
                    className="axis-btn axis-btn-ghost"
                    style={{
                      width: "100%",
                      justifyContent: "flex-start",
                      borderRadius: 0,
                      background: active || selected || selectedEmpty ? "var(--axis-surface-2, transparent)" : undefined,
                      fontWeight: selected || selectedEmpty ? 600 : undefined,
                    }}
                    onMouseEnter={() => setHighlight(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      pick(option);
                    }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.1rem" }}>
                      <span>{option.label}</span>
                      {option.value ? (
                        <span className="muted" style={{ fontSize: "0.7rem" }}>
                          {option.value}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
