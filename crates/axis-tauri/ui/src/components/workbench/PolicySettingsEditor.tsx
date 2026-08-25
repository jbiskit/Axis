import { useEffect, useMemo, useState } from "react";
import type { CatalogCategory, CatalogSettingDetail, CatalogSettingSummary } from "../../types/inventory";
import {
  bundleFromCategoryMap,
  buildSettingInstance,
  collectCatalogDetailsFromPolicySettings,
  defaultDraftForSetting,
  draftFromSettingInstance,
  draftValueSummary,
  instancesReadyForGraph,
  isFreeformSettingsCatalogPolicy,
  settingInstanceFromRow,
  settingsCatalogPlatformFromGraph,
  type SettingValueDraft,
} from "../../lib/catalog";
import { formatCatalogSettingRows } from "../../lib/catalogSettingDisplay";
import {
  addSettingsToPolicy,
  catalogIndexStatus,
  ensureCatalogIndex,
  listCatalogCategories,
  loadCategorySettings,
  pauseCatalogIndex,
  searchCatalogSettings,
} from "../../lib/tauri";
import { CatalogSettingInstances } from "./CatalogSettingInstances";
import { SettingDraftEditor } from "./SettingDraftEditor";
import { SettingSearchHit } from "./SettingSearchHit";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function templateFromObject(object: Record<string, unknown>) {
  const reference = asRecord(object.templateReference);
  return {
    templateId: text(reference?.templateId),
    templateFamily: text(reference?.templateFamily),
  };
}

export function PolicySettingsEditor({
  policyId,
  object,
  settings,
  onSaved,
}: {
  policyId: string;
  object: Record<string, unknown>;
  settings: Record<string, unknown>[];
  onSaved: () => void;
}) {
  const template = templateFromObject(object);
  const freeform = isFreeformSettingsCatalogPolicy(template);
  const platform = settingsCatalogPlatformFromGraph(text(object.platforms));
  const byId = useMemo(() => collectCatalogDetailsFromPolicySettings(settings), [settings]);
  const formatted = useMemo(() => formatCatalogSettingRows(settings), [settings]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDetail, setEditDetail] = useState<CatalogSettingDetail | null>(null);
  const [editDependents, setEditDependents] = useState<Record<string, CatalogSettingDetail>>({});
  const [editDraft, setEditDraft] = useState<SettingValueDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogSettingSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [indexHint, setIndexHint] = useState("");
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [catalogById, setCatalogById] = useState<Record<string, CatalogSettingDetail>>({});

  useEffect(() => {
    setEditingId(null);
    setEditDraft(null);
    setAdding(false);
    setQuery("");
    setResults([]);
    setError(null);
    setMessage(null);
  }, [policyId]);

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
    if (!adding) return;
    let cancelled = false;
    void ensureCatalogIndex(platform).then((state) => {
      if (!cancelled) {
        setIndexHint(
          state.status === "loading" || (state.loaded > 0 && !state.complete)
            ? `Indexing ${state.loaded.toLocaleString()} settings…`
            : state.complete
              ? `${state.loaded.toLocaleString()} settings searchable`
              : "",
        );
      }
    });
    const timer = window.setInterval(() => {
      void catalogIndexStatus(platform).then((state) => {
        if (cancelled) return;
        setIndexHint(
          state.status === "loading" || (state.loaded > 0 && !state.complete)
            ? `Indexing ${state.loaded.toLocaleString()} settings…`
            : state.complete
              ? `${state.loaded.toLocaleString()} settings searchable`
              : "",
        );
      });
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      void pauseCatalogIndex();
    };
  }, [adding, platform]);

  useEffect(() => {
    if (!adding) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const handle = window.setTimeout(() => {
      setSearching(true);
      void searchCatalogSettings(q, platform).then((response) => {
        setResults(response.result.settings);
        setSearching(false);
        if (response.error) setError(response.error);
      });
    }, 280);
    return () => window.clearTimeout(handle);
  }, [adding, platform, query]);

  function openExisting(definitionId: string, instance: Record<string, unknown>) {
    const bundled = bundleFromCategoryMap(definitionId, byId);
    const detail = bundled?.detail ?? byId[definitionId];
    if (!detail) {
      setError("This setting’s catalog definition was not returned with the policy.");
      return;
    }
    const dependents = bundled?.dependents ?? {};
    setAdding(false);
    setEditingId(definitionId);
    setEditDetail(detail);
    setEditDependents(dependents);
    setEditDraft(draftFromSettingInstance(instance, detail, dependents));
    setError(null);
    setMessage(null);
  }

  async function openCatalogSetting(summary: CatalogSettingSummary) {
    setError(null);
    setMessage(null);
    if (!summary.categoryId) {
      setError("This search hit has no category, so its editor cannot load yet.");
      return;
    }
    setBusy(true);
    try {
      const response = await loadCategorySettings(summary.categoryId, platform);
      if (response.error) throw new Error(response.error);
      const load = response.load;
      if (load?.byId) setCatalogById((current) => ({ ...current, ...load.byId }));
      const bundled = load ? bundleFromCategoryMap(summary.id, load.byId) : null;
      const detail = bundled?.detail ?? load?.byId[summary.id];
      if (!detail) throw new Error("Could not load that setting definition.");
      const dependents = bundled?.dependents ?? {};
      const existingInstance = settings
        .map((row) => settingInstanceFromRow(row))
        .find((row) => row?.settingDefinitionId === summary.id);
      setEditingId(summary.id);
      setEditDetail(detail);
      setEditDependents(dependents);
      setEditDraft(
        existingInstance
          ? draftFromSettingInstance(existingInstance, detail, dependents)
          : defaultDraftForSetting(detail, dependents),
      );
      setQuery("");
      setResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load setting");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!editDetail || !editDraft) return;
    if (editDraft.kind === "unsupported") {
      setError(editDraft.reason);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const [instance] = instancesReadyForGraph([
        {
          instance: buildSettingInstance(editDetail, editDraft, editDependents),
          detail: editDetail,
          byId: { ...byId, ...catalogById, ...editDependents },
        },
      ]);
      if (!instance) throw new Error("Could not build a Graph payload for this setting.");
      const response = await addSettingsToPolicy(policyId, [instance]);
      if (response.error) throw new Error(response.error);
      setMessage(`Saved “${editDetail.displayName}” to Graph.`);
      setEditingId(null);
      setEditDraft(null);
      setAdding(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const editorOpen = Boolean(editDetail && editDraft && editingId);
  const existingIds = new Set(
    settings
      .map((row) => settingInstanceFromRow(row)?.settingDefinitionId)
      .filter((id): id is string => typeof id === "string"),
  );

  return (
    <div className="stack">
      <div className="device-toolbar">
        <p className="muted" style={{ margin: 0 }}>
          {freeform
              ? "Change a configured value, or search the catalog to add another setting to this policy."
              : "Template-backed policy — existing values can be changed. Adding new catalog settings stays on a freeform policy."}
        </p>
        {freeform ? (
          <button
            type="button"
            className="axis-btn"
            onClick={() => {
              setAdding((open) => !open);
              setEditingId(null);
              setEditDraft(null);
              setError(null);
            }}
          >
            {adding ? "Close search" : "Add setting"}
          </button>
        ) : null}
      </div>
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {message ? <div className="axis-alert axis-alert-info">{message}</div> : null}
      {adding ? (
        <section className="policy-setting-editor">
          <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.75rem" }}>
            Search the catalog for this platform and save onto this policy.
            {indexHint ? ` ${indexHint}` : ""}
          </p>
          <input
            className="axis-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings…"
            aria-label="Search catalog settings"
          />
          {searching ? <p className="muted">Searching…</p> : null}
          {results.length > 0 ? (
            <ul className="policy-setting-search-list">
              {results.map((item) => (
                <li key={item.id}>
                  <SettingSearchHit
                    setting={item}
                    categories={categories}
                    alreadyOnPolicy={existingIds.has(item.id)}
                    disabled={busy}
                    onSelect={() => void openCatalogSetting(item)}
                  />
                </li>
              ))}
            </ul>
          ) : query.trim().length >= 2 && !searching ? (
            <p className="muted">No catalog matches.</p>
          ) : null}
        </section>
      ) : null}
      {editorOpen && editDetail && editDraft ? (
        <section className="policy-setting-editor">
          <div className="device-toolbar">
            <div>
              <p className="setting-instance-name" style={{ margin: 0 }}>
                {editDetail.displayName}
              </p>
              <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.75rem" }}>
                {draftValueSummary(editDetail, editDraft, editDependents)}
              </p>
            </div>
            <div className="device-actions">
              <button
                type="button"
                className="axis-btn"
                onClick={() => {
                  setEditingId(null);
                  setEditDraft(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="axis-btn axis-btn-primary"
                disabled={busy || editDraft.kind === "unsupported"}
                onClick={() => void saveDraft()}
              >
                {busy ? "Saving…" : "Save to Graph"}
              </button>
            </div>
          </div>
          {editDetail.description ? (
            <p className="muted" style={{ margin: "0.35rem 0 0.75rem" }}>
              {editDetail.description}
            </p>
          ) : null}
          <SettingDraftEditor
            detail={editDetail}
            draft={editDraft}
            dependents={editDependents}
            onChange={setEditDraft}
          />
        </section>
      ) : null}
      {formatted.length > 0 ? (
        <ul className="setting-instance-list">
          {formatted.map((row) => {
            const instance =
              settings
                .map((item) => settingInstanceFromRow(item))
                .find((item) => item && item.settingDefinitionId === row.definitionId) ?? {};
            const canEdit = Boolean(byId[row.definitionId]) && !row.unsupportedEditor;
            return (
              <li
                key={row.key}
                className={`setting-instance-row${editingId === row.definitionId ? " is-editing" : ""}`}
              >
                <div className="setting-instance-head">
                  <div className="setting-instance-title-block">
                    <p className="setting-instance-name">{row.displayName}</p>
                    {row.description ? (
                      <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.72rem" }}>
                        {row.description}
                      </p>
                    ) : null}
                  </div>
                  <p className="setting-instance-value">{row.valueSummary}</p>
                  <div className="setting-instance-actions">
                    {canEdit ? (
                      <button
                        type="button"
                        className="axis-btn"
                        onClick={() => openExisting(row.definitionId, instance)}
                      >
                        Edit
                      </button>
                    ) : (
                      <span className="muted" style={{ fontSize: "0.72rem" }}>
                        View only
                      </span>
                    )}
                  </div>
                </div>
                {row.unsupportedEditor ? (
                  <p className="setting-instance-note">
                    Group/collection editor is not in this pass — values stay as a summary.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : settings.length === 0 ? (
        <p className="muted">
          No settings on this policy yet.
          {freeform ? " Use Add setting to search the catalog and save here." : ""}
        </p>
      ) : (
        <CatalogSettingInstances settings={settings} />
      )}
    </div>
  );
}
