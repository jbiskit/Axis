import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CatalogCategory,
  CatalogIndexState,
  CatalogPolicySummary,
  CatalogSettingDetail,
  CatalogSettingSummary,
  SettingsCatalogPlatform,
} from "../types/inventory";
import {
  ADMINISTRATIVE_TEMPLATES_CATEGORY_ID,
  ancestorCategoryIds,
  bundleFromCategoryMap,
  buildSettingInstance,
  categoryBreadcrumb,
  childCatalogCategories,
  defaultDraftForSetting,
  draftValueSummary,
  instancesReadyForGraph,
  isFreeformSettingsCatalogPolicyForPlatform,
  rootCatalogCategories,
  type SettingValueDraft,
} from "../lib/catalog";
import {
  addSettingsToPolicy,
  catalogIndexStatus,
  ensureCatalogIndex,
  listCatalogCategories,
  loadCategorySettings,
  pauseCatalogIndex,
  searchCatalogSettings,
  createSettingsCatalogPolicy,
} from "../lib/tauri";
import { INTUNE_PLATFORM_LABELS } from "../lib/platforms";
import { SettingDraftEditor } from "./workbench/SettingDraftEditor";
import { SettingSearchHit } from "./workbench/SettingSearchHit";

type CartItem = {
  detail: CatalogSettingDetail;
  draft: SettingValueDraft;
  dependents: Record<string, CatalogSettingDetail>;
  categoryPath: string;
};

function validateCartItem(item: CartItem) {
  try {
    return {
      valid: true,
      message: null as string | null,
      instance: buildSettingInstance(item.detail, item.draft, item.dependents),
    };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : "This setting is incomplete.",
      instance: null as Record<string, unknown> | null,
    };
  }
}

function CategoryTree({
  categories,
  parentId,
  depth,
  selectedCategoryId,
  expandedIds,
  filter,
  onToggle,
  onSelectCategory,
}: {
  categories: CatalogCategory[];
  parentId: string | null;
  depth: number;
  selectedCategoryId: string | null;
  expandedIds: Set<string>;
  filter: string;
  onToggle: (id: string) => void;
  onSelectCategory: (category: CatalogCategory) => void;
}) {
  const nodes =
    parentId == null ? rootCatalogCategories(categories) : childCatalogCategories(categories, parentId);
  const query = filter.trim().toLowerCase();

  return (
    <ul className="catalog-tree">
      {nodes.map((category) => {
        const haystack = `${category.displayName} ${category.description ?? ""}`.toLowerCase();
        const childMatch = childCatalogCategories(categories, category.id).some((child) =>
          `${child.displayName} ${child.description ?? ""}`.toLowerCase().includes(query),
        );
        if (query && !haystack.includes(query) && !childMatch) return null;
        const hasChildren = childCatalogCategories(categories, category.id).length > 0;
        const expanded = expandedIds.has(category.id);
        const selected = selectedCategoryId === category.id;
        return (
          <li key={category.id}>
            <div
              className={`catalog-tree-row${selected ? " selected" : ""}`}
              style={{ paddingLeft: `${Math.min(depth, 8) * 0.75}rem` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="axis-btn-ghost catalog-chevron"
                  aria-expanded={expanded}
                  onClick={() => onToggle(category.id)}
                >
                  {expanded ? "▾" : "▸"}
                </button>
              ) : (
                <span className="catalog-chevron" />
              )}
              <button
                type="button"
                className="catalog-tree-label"
                onClick={() => {
                  if (hasChildren && !expanded) onToggle(category.id);
                  onSelectCategory(category);
                }}
                title={category.description || category.displayName}
              >
                {category.displayName}
              </button>
            </div>
            {hasChildren && expanded ? (
              <CategoryTree
                categories={categories}
                parentId={category.id}
                depth={depth + 1}
                selectedCategoryId={selectedCategoryId}
                expandedIds={expandedIds}
                filter={filter}
                onToggle={onToggle}
                onSelectCategory={onSelectCategory}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function BrowseCatalogPanel({
  platform,
  policies,
  focusSettingId,
  focusCategoryId,
  focusQuery,
  onFocusHandled,
  onPolicyCreated,
  onSettingsAdded,
}: {
  platform: SettingsCatalogPlatform;
  policies: CatalogPolicySummary[];
  focusSettingId?: string | null;
  focusCategoryId?: string | null;
  focusQuery?: string | null;
  onFocusHandled?: () => void;
  onPolicyCreated: (id: string, name: string) => void;
  onSettingsAdded: (id: string) => void;
}) {
  const platformLabel = INTUNE_PLATFORM_LABELS[platform];
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [treeStatus, setTreeStatus] = useState<"loading" | "ready" | "error">("loading");
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeFilter, setTreeFilter] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState<CatalogCategory | null>(null);
  const [settings, setSettings] = useState<CatalogSettingDetail[]>([]);
  const [byId, setById] = useState<Record<string, CatalogSettingDetail>>({});
  const [settingCount, setSettingCount] = useState(0);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [settingFilter, setSettingFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CatalogSettingDetail | null>(null);
  const [dependents, setDependents] = useState<Record<string, CatalogSettingDetail>>({});
  const [draft, setDraft] = useState<SettingValueDraft | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [targetMode, setTargetMode] = useState<"new" | "existing">("new");
  const [targetPolicyId, setTargetPolicyId] = useState("");
  const [newName, setNewName] = useState(`New ${platformLabel} catalog policy`);
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<CatalogSettingSummary[]>([]);
  const [globalSearching, setGlobalSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<string>("");
  const [catalogIndex, setCatalogIndex] = useState<CatalogIndexState | null>(null);
  const [focusHandledFor, setFocusHandledFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const freeformPolicies = useMemo(
    () => policies.filter((policy) => isFreeformSettingsCatalogPolicyForPlatform(policy, platform)),
    [policies, platform],
  );

  useEffect(() => {
    setFocusHandledFor(null);
    setNewName(`New ${INTUNE_PLATFORM_LABELS[platform]} catalog policy`);
    setSelectedCategory(null);
    setSettings([]);
    setById({});
    setCart([]);
    setActiveId(null);
    setDetail(null);
    setDraft(null);
    setTargetPolicyId("");
  }, [platform]);

  useEffect(() => {
    if (!focusSettingId || categories.length === 0) return;
    const key = `${platform}:${focusCategoryId ?? ""}:${focusSettingId}`;
    if (focusHandledFor === key) return;
    const category =
      (focusCategoryId ? categories.find((entry) => entry.id === focusCategoryId) : null) ??
      categories.find((entry) => entry.id === byId[focusSettingId]?.categoryId) ??
      null;
    if (!category) {
      setError("Could not find the setting category in the loaded tree.");
      setFocusHandledFor(key);
      onFocusHandled?.();
      return;
    }
    setFocusHandledFor(key);
    if (focusQuery?.trim()) setGlobalQuery(focusQuery);
    void revealSetting({
      id: focusSettingId,
      categoryId: category.id,
      displayName: focusQuery?.trim() || focusSettingId,
      description: null,
      helpText: null,
      keywords: [],
      kind: "settingDefinition",
      isRoot: true,
      platform: null,
      technologies: null,
      visibility: null,
      rootDefinitionId: null,
    }).finally(() => onFocusHandled?.());
  }, [byId, categories, focusCategoryId, focusHandledFor, focusQuery, focusSettingId, onFocusHandled, platform]);

  useEffect(() => {
    let cancelled = false;
    setTreeStatus("loading");
    setTreeError(null);
    void listCatalogCategories(platform).then((response) => {
      if (cancelled) return;
      setCategories(response.categories);
      setTreeError(response.error);
      setTreeStatus(response.error && response.categories.length === 0 ? "error" : "ready");
    });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  useEffect(() => {
    let cancelled = false;
    void ensureCatalogIndex(platform).then((state) => {
      if (!cancelled) setCatalogIndex(state);
    });
    const timer = window.setInterval(() => {
      void catalogIndexStatus(platform).then((state) => {
        if (!cancelled) setCatalogIndex(state);
      });
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      void pauseCatalogIndex();
    };
  }, [platform]);

  useEffect(() => {
    if (categories.length === 0 || expandedIds.size > 0) return;
    const roots = rootCatalogCategories(categories);
    const start =
      roots.find((category) => category.id === ADMINISTRATIVE_TEMPLATES_CATEGORY_ID) ?? roots[0];
    if (start) setExpandedIds(new Set([start.id]));
  }, [categories, expandedIds.size]);

  useEffect(() => {
    const q = globalQuery.trim();
    if (q.length < 2) {
      setGlobalResults([]);
      setGlobalSearching(false);
      setSearchMode("");
      return;
    }
    const handle = window.setTimeout(() => {
      setGlobalSearching(true);
      void searchCatalogSettings(q, platform).then((response) => {
        setGlobalResults(response.result.settings);
        setSearchMode(response.mode);
        setGlobalSearching(false);
        if (response.error) setError(response.error);
      });
    }, 280);
    return () => window.clearTimeout(handle);
  }, [globalQuery, platform]);

  const loadCategory = useCallback(
    async (category: CatalogCategory, activeSettingId?: string) => {
      setSelectedCategory(category);
      setSettingFilter("");
      setLoadingSettings(true);
      setError(null);
      try {
        const response = await loadCategorySettings(category.id, platform);
        if (response.error) throw new Error(response.error);
        const load = response.load;
        setSettings(load?.roots ?? []);
        setById(load?.byId ?? {});
        setSettingCount(load?.settingCount ?? 0);
        if (activeSettingId && load?.byId[activeSettingId]) {
          const bundled = bundleFromCategoryMap(activeSettingId, load.byId);
          if (bundled) {
            setActiveId(activeSettingId);
            setDetail(bundled.detail);
            setDependents(bundled.dependents);
            setDraft(defaultDraftForSetting(bundled.detail, bundled.dependents));
          }
        }
        if ((load?.roots.length ?? 0) === 0) {
          setMessage(
            childCatalogCategories(categories, category.id).length > 0
              ? `No settings sit directly on “${category.displayName}”. Expand it and pick a subcategory — or keep this parent selected; some catalogs (macOS Edge) store settings on the root.`
              : `No settings in “${category.displayName}”.`,
          );
        } else {
          setMessage(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load settings");
        setSettings([]);
      } finally {
        setLoadingSettings(false);
      }
    },
    [categories, platform],
  );

  const filteredSettings = useMemo(() => {
    const q = settingFilter.trim().toLowerCase();
    if (!q) return settings;
    return settings.filter((setting) =>
      `${setting.displayName} ${setting.description ?? ""} ${setting.id} ${setting.keywords.join(" ")}`
        .toLowerCase()
        .includes(q),
    );
  }, [settings, settingFilter]);

  function openSetting(setting: CatalogSettingDetail) {
    const bundled = bundleFromCategoryMap(setting.id, byId) ?? {
      detail: setting,
      dependents: {},
    };
    setActiveId(setting.id);
    setDetail(bundled.detail);
    setDependents(bundled.dependents);
    const existing = cart.find((item) => item.detail.id === setting.id);
    setDraft(existing?.draft ?? defaultDraftForSetting(bundled.detail, bundled.dependents));
  }

  async function revealSetting(setting: CatalogSettingSummary) {
    const category = categories.find((entry) => entry.id === setting.categoryId);
    if (category) {
      const ancestors = ancestorCategoryIds(categories, category.id);
      setExpandedIds((current) => {
        const next = new Set(current);
        for (const id of ancestors) next.add(id);
        next.add(category.id);
        return next;
      });
      await loadCategory(category, setting.id);
    }
    setGlobalQuery("");
  }

  function addActiveToCart() {
    if (!detail || !draft) return;
    const path =
      (selectedCategory ? categoryBreadcrumb(categories, selectedCategory.id) : null) ||
      categoryBreadcrumb(categories, detail.categoryId) ||
      "Category unknown";
    setCart((current) => {
      const next = current.filter((item) => item.detail.id !== detail.id);
      next.push({ detail, draft, dependents, categoryPath: path });
      return next;
    });
    setMessage(`Queued “${detail.displayName}”.`);
  }

  async function applyCart() {
    if (cart.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const validations = cart.map(validateCartItem);
      const unsupported = validations.filter((item) => !item.valid);
      const instances = instancesReadyForGraph(
        cart.flatMap((item, index) => {
          const instance = validations[index]?.instance;
          if (!validations[index]?.valid || !instance) return [];
          return [
            {
              instance,
              detail: item.detail,
              byId: { ...byId, ...item.dependents, [item.detail.id]: item.detail },
            },
          ];
        }),
      );
      if (instances.length === 0) {
        throw new Error(unsupported[0]?.message ?? "No configurable settings to save.");
      }
      if (targetMode === "new") {
        const name = newName.trim();
        if (!name) throw new Error("Enter a name for the new policy.");
        const response = await createSettingsCatalogPolicy({
          name,
          platform,
          settings: instances,
        });
        if (response.error || !response.policy) throw new Error(response.error ?? "Create failed");
        onPolicyCreated(response.policy.id, response.policy.name);
        setMessage(`Created “${response.policy.name}” with ${instances.length} setting(s)`);
      } else {
        if (!targetPolicyId) throw new Error("Pick a target policy.");
        const target = policies.find((policy) => policy.id === targetPolicyId);
        if (!target || !isFreeformSettingsCatalogPolicyForPlatform(target, platform)) {
          throw new Error(
            `Pick a freeform ${platformLabel} Settings Catalog policy (no Endpoint Security / template family).`,
          );
        }
        const response = await addSettingsToPolicy(targetPolicyId, instances);
        if (response.error) throw new Error(response.error);
        onSettingsAdded(targetPolicyId);
        setMessage(`Added ${instances.length} setting(s) to the policy`);
      }
      if (unsupported.length) {
        setMessage((current) =>
          `${current ?? "Saved"} · ${unsupported.length} group-collection setting(s) skipped (unsupported editor).`,
        );
      }
      setCart([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const indexHint =
    !catalogIndex || catalogIndex.status === "idle"
      ? ""
      : catalogIndex.status === "loading" || (catalogIndex.loaded > 0 && !catalogIndex.complete)
        ? ` · indexing ${catalogIndex.loaded.toLocaleString()} settings (${catalogIndex.pages} pages)…`
        : catalogIndex.complete && catalogIndex.loaded > 0
          ? catalogIndex.fromCache
            ? ` · ${catalogIndex.loaded.toLocaleString()} settings cached`
            : ` · ${catalogIndex.loaded.toLocaleString()} settings ready`
          : catalogIndex.status === "error"
            ? " · setting index failed"
            : "";

  const indexingSearch =
    catalogIndex?.status === "loading" || (catalogIndex != null && catalogIndex.loaded > 0 && !catalogIndex.complete);

  return (
    <div className="catalog-browse">
      {error ? <div className="axis-alert axis-alert-danger catalog-banner">{error}</div> : null}
      {message ? <div className="axis-alert axis-alert-info catalog-banner">{message}</div> : null}

      <div className="catalog-grid">
        <aside className="catalog-pane">
          <div className="catalog-pane-head">
            <h3>Categories</h3>
            <input
              className="axis-input"
              placeholder="Search categories…"
              value={treeFilter}
              onChange={(event) => setTreeFilter(event.target.value)}
            />
            <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.6875rem" }}>
              {treeStatus === "loading"
                ? "Loading categories…"
                : `${categories.length.toLocaleString()} categories`}
              {indexHint}
              {treeError ? ` · ${treeError}` : ""}
            </p>
          </div>
          <div className="catalog-pane-body">
            {categories.length === 0 ? (
              <p className="muted" style={{ padding: "0.75rem" }}>
                {treeStatus === "loading" ? "Loading Intune categories…" : "No categories loaded."}
              </p>
            ) : (
              <CategoryTree
                categories={categories}
                parentId={null}
                depth={0}
                selectedCategoryId={selectedCategory?.id ?? null}
                expandedIds={expandedIds}
                filter={treeFilter}
                onToggle={(id) =>
                  setExpandedIds((current) => {
                    const next = new Set(current);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onSelectCategory={(category) => void loadCategory(category)}
              />
            )}
          </div>
        </aside>

        <section className="catalog-pane">
          <div className="catalog-pane-head">
            <h3>{selectedCategory ? selectedCategory.displayName : "Settings"}</h3>
            <p className="muted" style={{ margin: "0.2rem 0 0.5rem", fontSize: "0.75rem" }}>
              {selectedCategory
                ? `${categoryBreadcrumb(categories, selectedCategory.id) || selectedCategory.displayName} · ${
                    loadingSettings ? "Loading…" : `${settingCount} setting${settingCount === 1 ? "" : "s"}`
                  }`
                : "Select any category — parents are selectable (macOS Edge settings live on the root)."}
            </p>
            <div className="catalog-search">
              <input
                className="axis-input"
                placeholder={
                  indexingSearch && (catalogIndex?.loaded ?? 0) === 0
                    ? "Indexing catalog… search will use Graph until the cache is ready"
                    : 'Search all settings — e.g. “Configure the new tab page URL”'
                }
                value={globalQuery}
                onChange={(event) => setGlobalQuery(event.target.value)}
              />
              {indexingSearch ? (
                <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.6875rem" }}>
                  {searchMode === "live"
                    ? "Indexing… this search hit Graph; later queries use the local cache."
                    : "Indexing… matching against settings crawled so far."}
                </p>
              ) : searchMode === "index" || searchMode === "index-partial" ? (
                <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.6875rem" }}>
                  Searching local catalog cache (no Graph).
                </p>
              ) : null}
            </div>
            {selectedCategory && globalQuery.trim().length < 2 ? (
              <input
                className="axis-input"
                style={{ marginTop: "0.45rem" }}
                placeholder="Filter this category…"
                value={settingFilter}
                onChange={(event) => setSettingFilter(event.target.value)}
              />
            ) : null}
          </div>
          <div className="catalog-pane-body">
            {globalQuery.trim().length >= 2 ? (
              globalSearching && globalResults.length === 0 ? (
                <p className="muted" style={{ padding: "0.75rem" }}>
                  Searching…
                </p>
              ) : globalResults.length === 0 ? (
                <p className="muted" style={{ padding: "0.75rem" }}>
                  {indexingSearch
                    ? `No cached matches for “${globalQuery.trim()}” yet — indexing still running.`
                    : `No settings matched “${globalQuery.trim()}”.`}
                </p>
              ) : (
                globalResults.map((setting) => (
                  <SettingSearchHit
                    key={setting.id}
                    setting={setting}
                    categories={categories}
                    onSelect={() => void revealSetting(setting)}
                  />
                ))
              )
            ) : (
              <>
                {filteredSettings.map((setting) => {
                  const queued = cart.some((item) => item.detail.id === setting.id);
                  const group = /settingGroup/i.test(setting.kind);
                  return (
                    <SettingSearchHit
                      key={setting.id}
                      setting={setting}
                      categories={categories}
                      selected={activeId === setting.id}
                      onSelect={() => openSetting(setting)}
                      trailing={
                        <>
                          {group ? <span className="axis-pill axis-pill-warning">Group collection</span> : null}
                          {queued ? <span className="axis-pill">Queued</span> : null}
                        </>
                      }
                    />
                  );
                })}
                {selectedCategory && !loadingSettings && filteredSettings.length === 0 ? (
                  <p className="muted" style={{ padding: "0.75rem" }}>
                    No settings in this category.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </section>

        <aside className="catalog-pane catalog-inspector">
          <div className="catalog-pane-head">
            <h3>Configure</h3>
          </div>
          <div className="catalog-pane-body catalog-configure">
            {detail && draft ? (
              <>
                <p style={{ margin: 0, fontWeight: 500 }}>{detail.displayName}</p>
                {detail.description ? (
                  <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
                    {detail.description}
                  </p>
                ) : null}
                <SettingDraftEditor
                  detail={detail}
                  draft={draft}
                  dependents={dependents}
                  onChange={(next) => {
                    setDraft(next);
                    setCart((current) => {
                      const index = current.findIndex((item) => item.detail.id === detail.id);
                      if (index < 0) return current;
                      const copy = [...current];
                      copy[index] = { ...copy[index], draft: next };
                      return copy;
                    });
                  }}
                />
                <button type="button" className="axis-btn axis-btn-primary" onClick={addActiveToCart}>
                  {cart.some((item) => item.detail.id === detail.id) ? "Update selected" : "Add to policy"}
                </button>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Open a setting to configure a value, then add it to a new or existing policy.
              </p>
            )}
          </div>
          <div className="catalog-selected-tray">
            <div className="catalog-pane-head">
              <h3>Selected ({cart.length})</h3>
            </div>
            <div className="catalog-pane-body">
              {cart.length === 0 ? (
                <p className="muted" style={{ margin: 0, padding: "0.75rem" }}>
                  No settings queued.
                </p>
              ) : (
                <ul className="catalog-cart">
                  {cart.map((item) => (
                    <li key={item.detail.id}>
                      <div>
                        <strong>{item.detail.displayName}</strong>
                        <span className="muted">
                          {draftValueSummary(item.detail, item.draft, item.dependents)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="axis-btn-ghost"
                        onClick={() => setCart((current) => current.filter((row) => row.detail.id !== item.detail.id))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>
      </div>

      <footer className="catalog-footer">
        <div className="tab-row">
          <button
            type="button"
            className={`tab-btn${targetMode === "new" ? " active" : ""}`}
            onClick={() => setTargetMode("new")}
          >
            New policy
          </button>
          <button
            type="button"
            className={`tab-btn${targetMode === "existing" ? " active" : ""}`}
            onClick={() => setTargetMode("existing")}
          >
            Existing
          </button>
        </div>
        {targetMode === "new" ? (
          <label className="device-field catalog-footer-field">
            Policy name
            <input className="axis-input" value={newName} onChange={(event) => setNewName(event.target.value)} />
          </label>
        ) : (
          <label className="device-field catalog-footer-field">
            Freeform {platformLabel} policy
            <select
              className="axis-input"
              value={targetPolicyId}
              onChange={(event) => setTargetPolicyId(event.target.value)}
            >
              <option value="">Select a policy</option>
              {freeformPolicies.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="catalog-footer-actions">
          <button
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={busy || cart.length === 0}
            onClick={() => void applyCart()}
          >
            {busy ? "Saving…" : targetMode === "new" ? "Create policy" : "Add to policy"}
          </button>
          <p className="muted" style={{ margin: 0, fontSize: "0.6875rem" }}>
            {cart.length} setting{cart.length === 1 ? "" : "s"} queued
          </p>
        </div>
      </footer>
    </div>
  );
}
