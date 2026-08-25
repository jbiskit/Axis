import { useEffect, useState } from "react";
import { hrefWithParam, navigate } from "../lib/route";
import { INTUNE_PLATFORM_LABELS } from "../lib/platforms";
import {
  catalogIndexStatus,
  ensureCatalogIndex,
  listCatalogCategories,
  searchCatalogSettings,
} from "../lib/tauri";
import type { CatalogCategory, CatalogIndexState, CatalogSettingSummary, SettingsCatalogPlatform } from "../types/inventory";
import { PageHeader } from "./ui/PageChrome";
import { SettingSearchHit } from "./workbench/SettingSearchHit";

export function SettingsSearchView() {
  const [platform, setPlatform] = useState<SettingsCatalogPlatform>("windows");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogSettingSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [indexState, setIndexState] = useState<CatalogIndexState | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);

  useEffect(() => {
    let cancelled = false;
    void ensureCatalogIndex(platform).then((state) => {
      if (!cancelled) setIndexState(state);
    });
    const timer = window.setInterval(() => {
      void catalogIndexStatus(platform).then((state) => {
        if (!cancelled) setIndexState(state);
      });
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [platform]);

  useEffect(() => {
    let cancelled = false;
    void listCatalogCategories(platform).then((response) => {
      if (!cancelled) setCategories(response.categories);
    });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchMode("");
      setError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      setError(null);
      void searchCatalogSettings(q, platform).then((response) => {
        setResults(response.result.settings);
        setSearchMode(response.mode);
        setSearching(false);
        if (response.error) setError(response.error);
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [platform, query]);

  function openInBrowse(setting: CatalogSettingSummary) {
    const params = new URLSearchParams();
    params.set("platform", platform);
    if (setting.categoryId) params.set("category", setting.categoryId);
    params.set("setting", setting.id);
    params.set("q", setting.displayName);
    navigate(`/intune/policies/browse?${params.toString()}`);
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Policies"
        title="Settings search"
        description="Search Settings Catalog definitions globally, then jump into Browse with the matching category and setting selected."
      />
      <div className="tab-row">
        {(["windows", "macos"] as const).map((slug) => (
          <button
            key={slug}
            type="button"
            className={`tab-btn${platform === slug ? " active" : ""}`}
            onClick={() => setPlatform(slug)}
          >
            {INTUNE_PLATFORM_LABELS[slug]}
          </button>
        ))}
      </div>
      <section className="axis-panel" style={{ padding: "0.85rem" }}>
        <label className="device-field">
          Search settings
          <input
            className="axis-input"
            type="search"
            placeholder='e.g. "BitLocker", "new tab page URL", "LAPS"'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <p className="muted" style={{ margin: "0.45rem 0 0", fontSize: "0.75rem" }}>
          {searching
            ? "Searching..."
            : `${results.length} result${results.length === 1 ? "" : "s"}`}
          {searchMode === "index" || searchMode === "index-partial"
            ? " · local cache"
            : searchMode === "live"
              ? " · live fallback"
              : ""}
          {indexState && (indexState.status === "loading" || (indexState.loaded > 0 && !indexState.complete))
            ? ` · indexing ${indexState.loaded.toLocaleString()} settings`
            : ""}
        </p>
        {error ? <div className="axis-alert axis-alert-danger" style={{ marginTop: "0.6rem" }}>{error}</div> : null}
      </section>
      <section className="axis-panel" style={{ overflow: "hidden" }}>
        <table className="axis-table">
          <thead>
            <tr>
              <th>Setting</th>
              <th>Kind</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {results.map((item) => (
              <tr key={item.id}>
                <td>
                  <SettingSearchHit
                    setting={item}
                    categories={categories}
                    onSelect={() => openInBrowse(item)}
                  />
                </td>
                <td className="muted">{item.kind}</td>
                <td>
                  <button type="button" className="axis-btn" onClick={() => openInBrowse(item)}>
                    Open in Browse
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!searching && query.trim().length >= 2 && results.length === 0 ? (
          <p className="muted" style={{ padding: "1rem" }}>
            No settings matched "{query.trim()}".
          </p>
        ) : null}
        {query.trim().length < 2 ? (
          <p className="muted" style={{ padding: "1rem" }}>
            Type at least 2 characters to search.
          </p>
        ) : null}
      </section>
      <p className="muted" style={{ margin: 0, fontSize: "0.6875rem" }}>
        Result opens `{hrefWithParam("/intune/policies/browse", new URLSearchParams(), "platform", platform)}` and pre-selects the setting when category data is loaded.
      </p>
    </div>
  );
}
