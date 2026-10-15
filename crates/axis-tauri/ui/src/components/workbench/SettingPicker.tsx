import { useEffect, useMemo, useState } from "react";
import { listCatalogCategories, searchCatalogSettings } from "../../lib/tauri";
import { settingUsageLabel } from "../../hooks/useSettingUsage";
import type { SettingUsage } from "../../lib/tauri";
import type {
  CatalogCategory,
  CatalogSettingSummary,
  SettingsCatalogPlatform,
} from "../../types/inventory";
import { SettingSearchHit } from "./SettingSearchHit";

/**
 * Shared Settings Catalog search-and-pick list.
 *
 * Used by the catalog explorer and the policy editor's "Add settings" drawer so
 * there is one way to find settings. Typing searches the whole platform catalog;
 * with no query it shows `browseSettings` (e.g. the selected category).
 */
export function SettingPicker({
  platform,
  picked,
  onTogglePick,
  onTogglePickMany,
  onSelect,
  selectedId,
  disabledIds,
  disabledLabel = "On policy",
  usage,
  categories: categoriesProp,
  browseSettings,
  browseLabel,
  autoFocus = false,
  placeholder,
}: {
  platform: SettingsCatalogPlatform;
  picked: ReadonlyMap<string, CatalogSettingSummary>;
  onTogglePick: (setting: CatalogSettingSummary) => void;
  /** Pick or unpick every listed (enabled) row at once. */
  onTogglePickMany?: (settings: CatalogSettingSummary[], pick: boolean) => void;
  /** Row click; defaults to toggling the pick. */
  onSelect?: (setting: CatalogSettingSummary) => void;
  selectedId?: string | null;
  /** Settings that cannot be picked, e.g. already on the target policy. */
  disabledIds?: ReadonlySet<string>;
  disabledLabel?: string;
  /** Definition id → tenant usage; shows an "In tenant" column when present. */
  usage?: ReadonlyMap<string, SettingUsage>;
  categories?: CatalogCategory[];
  browseSettings?: CatalogSettingSummary[];
  browseLabel?: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogSettingSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedCategories, setLoadedCategories] = useState<CatalogCategory[]>([]);
  const categories = categoriesProp ?? loadedCategories;

  useEffect(() => {
    if (categoriesProp) return;
    let cancelled = false;
    void listCatalogCategories(platform).then((response) => {
      if (!cancelled) setLoadedCategories(response.categories);
    });
    return () => {
      cancelled = true;
    };
  }, [categoriesProp, platform]);

  const trimmed = query.trim();
  const searchingCatalog = trimmed.length >= 2;

  useEffect(() => {
    if (!searchingCatalog) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setError(null);
      void searchCatalogSettings(trimmed, platform).then((response) => {
        if (cancelled) return;
        setResults(response.result.settings);
        setSearching(false);
        if (response.error) setError(response.error);
      });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [platform, searchingCatalog, trimmed]);

  const rows = searchingCatalog ? results : browseSettings ?? [];
  const pickable = useMemo(() => rows.filter((row) => !disabledIds?.has(row.id)), [rows, disabledIds]);
  const pickedShown = pickable.filter((row) => picked.has(row.id)).length;
  const allPicked = pickable.length > 0 && pickedShown === pickable.length;

  const status = searchingCatalog
    ? searching
      ? "Searching…"
      : `${results.length} match${results.length === 1 ? "" : "es"}`
    : browseLabel ?? (rows.length ? `${rows.length} settings` : "Type at least 2 characters to search");

  return (
    <div className="setting-picker">
      <label className="setting-picker-search">
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />
        </svg>
        <input
          type="search"
          aria-label="Search the settings catalog"
          placeholder={placeholder ?? "Search settings by name, description or Graph ID"}
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="setting-picker-head">
        {onTogglePickMany ? (
          <input
            type="checkbox"
            aria-label="Pick every listed setting"
            checked={allPicked}
            ref={(node) => {
              if (node) node.indeterminate = pickedShown > 0 && !allPicked;
            }}
            disabled={pickable.length === 0}
            onChange={() => onTogglePickMany(pickable, !allPicked)}
          />
        ) : null}
        <span className="setting-picker-status">{status}</span>
        {usage ? <span className="setting-picker-usage-head">In tenant</span> : null}
      </div>

      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}

      <ul className="setting-picker-list">
        {rows.map((setting) => {
          const disabled = disabledIds?.has(setting.id) ?? false;
          const isPicked = picked.has(setting.id);
          const settingUsage = usage?.get(setting.id);
          return (
            <li
              key={setting.id}
              className={`setting-picker-row${isPicked ? " is-picked" : ""}${
                selectedId === setting.id ? " is-selected" : ""
              }`}
            >
              <SettingSearchHit
                setting={setting}
                categories={categories}
                alreadyOnPolicy={disabled}
                selected={selectedId === setting.id}
                leading={
                  <input
                    type="checkbox"
                    aria-label={`Pick ${setting.displayName}`}
                    checked={disabled || isPicked}
                    disabled={disabled}
                    onChange={() => onTogglePick(setting)}
                  />
                }
                trailing={
                  usage ? (
                    <span
                      className={`setting-picker-usage${
                        settingUsage?.conflict ? " is-conflict" : settingUsage ? " is-used" : ""
                      }`}
                    >
                      {settingUsageLabel(settingUsage)}
                    </span>
                  ) : disabled ? (
                    <span className="muted setting-picker-usage">{disabledLabel}</span>
                  ) : null
                }
                onSelect={() => (onSelect ? onSelect(setting) : !disabled && onTogglePick(setting))}
              />
            </li>
          );
        })}
      </ul>
      {searchingCatalog && !searching && results.length === 0 ? (
        <p className="muted setting-picker-empty">No settings matched “{trimmed}”.</p>
      ) : null}
    </div>
  );
}
