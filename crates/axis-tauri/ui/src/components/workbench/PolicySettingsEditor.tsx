import { useCallback, useEffect, useMemo, useState } from "react";
import type { CatalogCategory, CatalogSettingDetail, CatalogSettingSummary } from "../../types/inventory";
import {
  bundleFromCategoryMap,
  buildSettingInstance,
  collectCatalogDetailsFromPolicySettings,
  defaultDraftForSetting,
  draftFromSettingInstance,
  diffSettingDrafts,
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
  removeSettingsFromPolicy,
  searchCatalogSettings,
} from "../../lib/tauri";
import { CatalogSettingInstances } from "./CatalogSettingInstances";
import { useInspectorSaveAction } from "./inspectorSave";
import { SettingDescription } from "./SettingDescription";
import { SettingDraftEditor, settingDraftHasDependents } from "./SettingDraftEditor";
import { SettingSearchHit } from "./SettingSearchHit";
import { SettingValueDiff } from "./SettingValueDiff";

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

type PendingEdit = {
  detail: CatalogSettingDetail;
  dependents: Record<string, CatalogSettingDetail>;
  draft: SettingValueDraft;
  original: SettingValueDraft;
};

type StagedRemove = {
  definitionId: string;
  displayName: string;
  valueSummary: string;
};

function draftsEqual(left: SettingValueDraft, right: SettingValueDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function editIsDirty(edit: PendingEdit): boolean {
  return !draftsEqual(edit.draft, edit.original);
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
  const [edits, setEdits] = useState<Record<string, PendingEdit>>({});
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
  const [stagedRemoves, setStagedRemoves] = useState<Record<string, StagedRemove>>({});
  const [confirmSave, setConfirmSave] = useState(false);
  useEffect(() => {
    setEditingId(null);
    setEdits({});
    setAdding(false);
    setQuery("");
    setResults([]);
    setError(null);
    setMessage(null);
    setStagedRemoves({});
    setConfirmSave(false);
  }, [policyId]);

  useEffect(() => {
    let cancelled = false;
    void listCatalogCategories(platform).then((response) => {
      if (!cancelled) setCategories(response.categories ?? []);
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
    }, 2500);
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
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setSearching(true);
      void searchCatalogSettings(q, platform)
        .then((response) => {
          if (cancelled) return;
          const settings = response.result?.settings;
          setResults(
            Array.isArray(settings)
              ? settings.filter((item) => item?.id).slice(0, 25)
              : [],
          );
          setSearching(false);
          if (response.error) setError(response.error);
        })
        .catch((err) => {
          if (cancelled) return;
          setResults([]);
          setSearching(false);
          setError(err instanceof Error ? err.message : "Catalog search failed.");
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [adding, platform, query]);

  function upsertEdit(
    definitionId: string,
    detail: CatalogSettingDetail,
    dependents: Record<string, CatalogSettingDetail>,
    draft: SettingValueDraft,
  ) {
    setEdits((current) => {
      if (current[definitionId]) return current;
      return { ...current, [definitionId]: { detail, dependents, draft, original: draft } };
    });
    setEditingId(definitionId);
    setError(null);
    setMessage(null);
    setStagedRemoves((current) => {
      if (!current[definitionId]) return current;
      const next = { ...current };
      delete next[definitionId];
      return next;
    });
  }

  function patchDraft(definitionId: string, draft: SettingValueDraft) {
    setEdits((current) => {
      const existing = current[definitionId];
      if (!existing) return current;
      return { ...current, [definitionId]: { ...existing, draft } };
    });
  }

  function revertEdit(definitionId: string) {
    setEdits((current) => {
      const next = { ...current };
      delete next[definitionId];
      return next;
    });
    if (editingId === definitionId) setEditingId(null);
  }

  function openExisting(definitionId: string, instance: Record<string, unknown>) {
    const bundled = bundleFromCategoryMap(definitionId, byId);
    const detail = bundled?.detail ?? byId[definitionId];
    if (!detail) {
      setError("This setting’s catalog definition was not returned with the policy.");
      return;
    }
    const dependents = bundled?.dependents ?? {};
    setAdding(false);
    upsertEdit(definitionId, detail, dependents, draftFromSettingInstance(instance, detail, dependents));
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
      upsertEdit(
        summary.id,
        detail,
        dependents,
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

  const dirtyEdits = useMemo(
    () => Object.values(edits).filter((edit) => editIsDirty(edit) && !stagedRemoves[edit.detail.id]),
    [edits, stagedRemoves],
  );
  const removedList = useMemo(() => Object.values(stagedRemoves), [stagedRemoves]);
  const pendingCount = dirtyEdits.length + removedList.length;

  const saveDrafts = useCallback(async () => {
    const pending = Object.values(edits).filter(
      (edit) => editIsDirty(edit) && !stagedRemoves[edit.detail.id],
    );
    const removeIds = Object.keys(stagedRemoves);
    if (pending.length === 0 && removeIds.length === 0) return;
    const unsupported = pending.find((edit) => edit.draft.kind === "unsupported");
    if (unsupported) {
      setError(unsupported.draft.kind === "unsupported" ? unsupported.draft.reason : "Save failed");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (pending.length > 0) {
        const instances = instancesReadyForGraph(
          pending.map((edit) => ({
            instance: buildSettingInstance(edit.detail, edit.draft, edit.dependents),
            detail: edit.detail,
            byId: { ...byId, ...catalogById, ...edit.dependents },
          })),
        );
        if (instances.length === 0) throw new Error("Could not build a Graph payload for these settings.");
        const response = await addSettingsToPolicy(policyId, instances);
        if (response.error) throw new Error(response.error);
      }
      if (removeIds.length > 0) {
        const response = await removeSettingsFromPolicy(policyId, removeIds);
        if (response.error) throw new Error(response.error);
      }
      const parts: string[] = [];
      if (pending.length === 1) parts.push(`saved “${pending[0].detail.displayName}”`);
      else if (pending.length > 1) parts.push(`saved ${pending.length} settings`);
      if (removeIds.length === 1) parts.push(`removed “${stagedRemoves[removeIds[0]]!.displayName}”`);
      else if (removeIds.length > 1) parts.push(`removed ${removeIds.length} settings`);
      setMessage(`Wrote to Graph: ${parts.join(", ")}.`);
      setEditingId(null);
      setEdits({});
      setStagedRemoves({});
      setAdding(false);
      setConfirmSave(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }, [byId, catalogById, edits, onSaved, policyId, stagedRemoves]);

  useInspectorSaveAction({
    onSave: () => setConfirmSave(true),
    disabled: busy || pendingCount === 0,
    busy,
  });
  const existingIds = new Set(
    settings
      .map((row) => settingInstanceFromRow(row)?.settingDefinitionId)
      .filter((id): id is string => typeof id === "string"),
  );
  const lastSettingTitle = "Intune requires at least one setting on a Settings Catalog policy.";
  const remainingConfigured = (extraRemoveId?: string) => {
    const removeIds = new Set(Object.keys(stagedRemoves));
    if (extraRemoveId) removeIds.add(extraRemoveId);
    const kept = formatted.filter((row) => !removeIds.has(row.definitionId)).length;
    const adds = Object.values(edits).filter(
      (edit) =>
        editIsDirty(edit) && !existingIds.has(edit.detail.id) && !removeIds.has(edit.detail.id),
    ).length;
    return kept + adds;
  };
  const activeEdit = editingId ? edits[editingId] ?? null : null;
  const addingNewSetting = Boolean(
    activeEdit && !existingIds.has(activeEdit.detail.id) && !stagedRemoves[activeEdit.detail.id],
  );
  const pendingAdds = Object.values(edits).filter(
    (edit) =>
      !existingIds.has(edit.detail.id) &&
      !stagedRemoves[edit.detail.id] &&
      !(addingNewSetting && activeEdit?.detail.id === edit.detail.id),
  );

  return (
    <div className="stack">
      <div className="device-toolbar">
        <p className="muted" style={{ margin: 0 }}>
          {pendingCount > 0
            ? `${pendingCount} unsaved change${pendingCount === 1 ? "" : "s"}. Save from the object header.`
            : freeform
              ? "Change a configured value, remove a setting, or search the catalog to add another setting to this policy."
              : "Template-backed policy — existing values can be changed. Adding or removing catalog settings stays on a freeform policy."}
        </p>
        {freeform ? (
          <button
            type="button"
            className="axis-btn"
            onClick={() => {
              setAdding((open) => !open);
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
                <li key={String(item.id)}>
                  <SettingSearchHit
                    setting={item}
                    categories={categories ?? []}
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
      {addingNewSetting && activeEdit ? (
        <section className="policy-setting-editor is-added">
          <div className="device-toolbar">
            <div>
              <p className="setting-instance-name" style={{ margin: 0 }}>
                {activeEdit.detail.displayName}
                <span className="setting-unsaved-pill is-added">New</span>
              </p>
              <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.75rem" }}>
                {draftValueSummary(activeEdit.detail, activeEdit.draft, activeEdit.dependents)}
              </p>
            </div>
            <button
              type="button"
              className="axis-btn"
              onClick={() => revertEdit(activeEdit.detail.id)}
            >
              Cancel
            </button>
          </div>
          {activeEdit.detail.description ? (
            <SettingDescription
              key={activeEdit.detail.id}
              text={activeEdit.detail.description}
              className="policy-setting-editor-desc"
            />
          ) : null}
          <SettingDraftEditor
            detail={activeEdit.detail}
            draft={activeEdit.draft}
            dependents={activeEdit.dependents}
            onChange={(draft) => patchDraft(activeEdit.detail.id, draft)}
          />
          {editIsDirty(activeEdit) ? (
            <SettingValueDiff
              added
              lines={diffSettingDrafts(
                activeEdit.detail,
                activeEdit.original,
                activeEdit.draft,
                activeEdit.dependents,
                { added: true },
              )}
            />
          ) : null}
        </section>
      ) : null}
      {formatted.length > 0 || pendingAdds.length > 0 ? (
        <ul className="setting-instance-list">
          {pendingAdds.map((edit) => (
            <li key={`add:${edit.detail.id}`} className="setting-instance-row is-added">
              <div className="setting-instance-head">
                <div className="setting-instance-title-block">
                  <p className="setting-instance-name">
                    {edit.detail.displayName}
                    <span className="setting-unsaved-pill is-added">New</span>
                  </p>
                  {edit.detail.description ? <SettingDescription text={edit.detail.description} /> : null}
                </div>
                <div className="setting-instance-value">
                  {draftValueSummary(edit.detail, edit.draft, edit.dependents)}
                  {editIsDirty(edit) ? (
                    <SettingValueDiff
                      added
                      lines={diffSettingDrafts(
                        edit.detail,
                        edit.original,
                        edit.draft,
                        edit.dependents,
                        { added: true },
                      )}
                    />
                  ) : null}
                </div>
                <div className="setting-instance-actions">
                  <button
                    type="button"
                    className="axis-btn"
                    onClick={() => {
                      setEditingId(edit.detail.id);
                      setAdding(false);
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="axis-btn" onClick={() => revertEdit(edit.detail.id)}>
                    Cancel
                  </button>
                </div>
              </div>
            </li>
          ))}
          {formatted.map((row) => {
            const instance =
              settings
                .map((item) => settingInstanceFromRow(item))
                .find((item) => item && item.settingDefinitionId === row.definitionId) ?? {};
            const canEdit = Boolean(byId[row.definitionId]) && !row.unsupportedEditor;
            const rowRemoved = Boolean(stagedRemoves[row.definitionId]);
            const rowEdit = rowRemoved ? undefined : edits[row.definitionId];
            const rowEditing = !rowRemoved && editingId === row.definitionId && Boolean(rowEdit);
            const rowDirty = Boolean(rowEdit && editIsDirty(rowEdit));
            const canStageRemove = freeform && (rowRemoved || remainingConfigured(row.definitionId) >= 1);
            return (
              <li
                key={row.key}
                className={`setting-instance-row${rowEditing ? " is-editing" : ""}${rowDirty ? " is-dirty" : ""}${rowRemoved ? " is-removed" : ""}${canEdit && !rowRemoved ? " is-activatable" : ""}`}
                title={canEdit && !rowRemoved ? "Double-click to edit" : undefined}
                onMouseDown={(event) => {
                  if (canEdit && !rowRemoved && event.detail > 1) event.preventDefault();
                }}
                onDoubleClick={(event) => {
                  if (!canEdit || rowRemoved) return;
                  if (
                    event.target instanceof Element &&
                    event.target.closest("button, a, input, textarea, select, label")
                  ) {
                    return;
                  }
                  openExisting(row.definitionId, instance);
                }}
              >
                <div className="setting-instance-head">
                  <div className="setting-instance-title-block">
                    <p className="setting-instance-name">
                      {row.displayName}
                      {rowRemoved ? (
                        <span className="setting-unsaved-pill is-removed">Removed</span>
                      ) : rowDirty ? (
                        <span className="setting-unsaved-pill">Unsaved</span>
                      ) : null}
                    </p>
                    {row.description ? <SettingDescription text={row.description} /> : null}
                  </div>
                  <div className="setting-instance-value">
                    {rowRemoved ? (
                      <SettingValueDiff
                        removed
                        lines={[{ label: "Value", before: row.valueSummary, after: "Removed" }]}
                      />
                    ) : rowEditing && rowEdit ? (
                      <SettingDraftEditor
                        detail={rowEdit.detail}
                        draft={rowEdit.draft}
                        dependents={rowEdit.dependents}
                        onChange={(draft) => patchDraft(row.definitionId, draft)}
                        compact
                      />
                    ) : rowDirty && rowEdit ? (
                      <SettingValueDiff
                        lines={diffSettingDrafts(
                          rowEdit.detail,
                          rowEdit.original,
                          rowEdit.draft,
                          rowEdit.dependents,
                        )}
                      />
                    ) : rowEdit ? (
                      draftValueSummary(rowEdit.detail, rowEdit.draft, rowEdit.dependents)
                    ) : (
                      row.valueSummary
                    )}
                    {rowEditing && rowDirty && rowEdit ? (
                      <SettingValueDiff
                        lines={diffSettingDrafts(
                          rowEdit.detail,
                          rowEdit.original,
                          rowEdit.draft,
                          rowEdit.dependents,
                        )}
                      />
                    ) : null}
                  </div>
                  <div className="setting-instance-actions">
                    {canEdit && !rowRemoved ? (
                      <button
                        type="button"
                        className="axis-btn"
                        onClick={() => {
                          if (rowEditing) {
                            revertEdit(row.definitionId);
                            return;
                          }
                          openExisting(row.definitionId, instance);
                        }}
                      >
                        {rowEditing ? "Revert" : "Edit"}
                      </button>
                    ) : !rowRemoved ? (
                      <span className="muted" style={{ fontSize: "0.72rem" }}>
                        View only
                      </span>
                    ) : null}
                    {freeform ? (
                      <button
                        type="button"
                        className="axis-btn"
                        disabled={busy || !canStageRemove}
                        title={
                          !canStageRemove
                            ? lastSettingTitle
                            : rowRemoved
                              ? "Keep this setting on the policy"
                              : "Stage removal; save from the object header"
                        }
                        onClick={() => {
                          if (rowRemoved) {
                            setStagedRemoves((current) => {
                              const next = { ...current };
                              delete next[row.definitionId];
                              return next;
                            });
                            return;
                          }
                          revertEdit(row.definitionId);
                          setStagedRemoves((current) => ({
                            ...current,
                            [row.definitionId]: {
                              definitionId: row.definitionId,
                              displayName: row.displayName,
                              valueSummary: row.valueSummary,
                            },
                          }));
                        }}
                      >
                        {rowRemoved ? "Undo" : "Remove"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {row.unsupportedEditor ? (
                  <p className="setting-instance-note">
                    Group/collection editor is not in this pass — values stay as a summary.
                  </p>
                ) : null}
                {rowEditing && rowEdit && settingDraftHasDependents(rowEdit.draft) ? (
                  <div className="policy-setting-inline-editor">
                    <SettingDraftEditor
                      detail={rowEdit.detail}
                      draft={rowEdit.draft}
                      dependents={rowEdit.dependents}
                      onChange={(draft) => patchDraft(row.definitionId, draft)}
                      dependentsOnly
                    />
                  </div>
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
      {confirmSave && pendingCount > 0 ? (
        <div
          className="axis-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setConfirmSave(false);
          }}
        >
          <div className="axis-modal axis-modal-wide" role="dialog" aria-modal="true" aria-labelledby="save-settings-title">
            <div className="assignment-dialog-head">
              <div>
                <p className="axis-kicker">Save to Graph</p>
                <h2 id="save-settings-title">
                  Save {pendingCount} change{pendingCount === 1 ? "" : "s"}?
                </h2>
                <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
                  These values will be written to Intune. Review the before and after for each change.
                </p>
              </div>
            </div>
            <ul className="setting-save-summary">
              {dirtyEdits.map((edit) => {
                const added = !existingIds.has(edit.detail.id);
                return (
                  <li key={edit.detail.id} className={`setting-save-summary-item${added ? " is-added" : ""}`}>
                    <p className="setting-instance-name">
                      {edit.detail.displayName}
                      {added ? <span className="setting-unsaved-pill is-added">New</span> : null}
                    </p>
                    <SettingValueDiff
                      added={added}
                      lines={diffSettingDrafts(
                        edit.detail,
                        edit.original,
                        edit.draft,
                        edit.dependents,
                        { added },
                      )}
                    />
                  </li>
                );
              })}
              {removedList.map((item) => (
                <li key={item.definitionId} className="setting-save-summary-item is-removed">
                  <p className="setting-instance-name">
                    {item.displayName}
                    <span className="setting-unsaved-pill is-removed">Removed</span>
                  </p>
                  <SettingValueDiff
                    removed
                    lines={[{ label: "Value", before: item.valueSummary, after: "Removed" }]}
                  />
                </li>
              ))}
            </ul>
            <div className="axis-modal-actions">
              <button
                type="button"
                className="axis-btn"
                disabled={busy}
                onClick={() => setConfirmSave(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="axis-btn axis-btn-primary"
                disabled={busy}
                onClick={() => void saveDrafts()}
              >
                {busy ? "Saving…" : "Save to Graph"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
