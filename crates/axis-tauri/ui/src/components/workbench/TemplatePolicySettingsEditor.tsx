import { useCallback, useEffect, useMemo, useState } from "react";
import type { CatalogSettingDetail } from "../../types/inventory";
import {
  buildGroupCollectionInstance,
  buildSettingInstance,
  bundleFromCategoryMap,
  collectConfiguredSettingIds,
  collectInstancesByDefinition,
  defaultDraftForSetting,
  draftFromSettingInstance,
  diffSettingDrafts,
  draftMatchesGraphDefault,
  draftValueSummary,
  groupInstanceChildren,
  instancesReadyForGraph,
  parseConfigurationPolicyTemplate,
  settingDraftSaveError,
  type SettingValueDraft,
  type TemplateSettingNode,
} from "../../lib/catalog";
import {
  addSettingsToPolicy,
  fetchConfigurationPolicyTemplate,
  removeSettingsFromPolicy,
} from "../../lib/tauri";
import { SettingValueWithDefaultCue } from "./SettingDefaultCue";
import { SettingDescription } from "./SettingDescription";
import { SettingDraftEditor } from "./SettingDraftEditor";
import { SettingValueDiff } from "./SettingValueDiff";
import { settingEditIsDirty, usePersistedPolicySettingsDraft } from "../../lib/inspectorDrafts";
import { useInspectorSaveAction } from "./inspectorSave";

function templateIdFromObject(object: Record<string, unknown>): string | null {
  const reference =
    object.templateReference && typeof object.templateReference === "object"
      ? (object.templateReference as Record<string, unknown>)
      : null;
  const id = reference?.templateId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * Template-aware editor for template-backed Settings Catalog policies
 * (Endpoint Security and other template families). Fetches the policy
 * template's setting templates so the full structure — including group
 * settings and their children — is represented, with configured values
 * overlaid from the live policy.
 */
export function TemplatePolicySettingsEditor({
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
  const templateId = templateIdFromObject(object);
  const [nodes, setNodes] = useState<TemplateSettingNode[] | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const { edits, setEdits, stagedRemoves, setStagedRemoves, editingId, setEditingId } =
    usePersistedPolicySettingsDraft(policyId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [showUnconfigured, setShowUnconfigured] = useState(false);

  useEffect(() => {
    setError(null);
    setMessage(null);
    setConfirmSave(false);
    if (!templateId) {
      setNodes([]);
      setTemplateError("This policy has no template reference, so its template cannot be loaded.");
      return;
    }
    let cancelled = false;
    setNodes(null);
    setTemplateError(null);
    void fetchConfigurationPolicyTemplate(templateId)
      .then((response) => {
        if (cancelled) return;
        if (response.error) {
          setNodes([]);
          setTemplateError(response.error);
          return;
        }
        setNodes(parseConfigurationPolicyTemplate(response.templates));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setNodes([]);
          setTemplateError(
            typeof err === "string"
              ? err
              : err instanceof Error
                ? err.message
                : "Could not load the policy template.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [policyId, templateId]);

  const instancesByDefinition = useMemo(() => collectInstancesByDefinition(settings), [settings]);
  const existingIds = useMemo(() => collectConfiguredSettingIds(settings), [settings]);
  const byId = useMemo(() => {
    const map: Record<string, CatalogSettingDetail> = {};
    for (const node of nodes ?? []) {
      for (const [id, detail] of Object.entries(node.definitions)) {
        map[id] = detail;
      }
    }
    return map;
  }, [nodes]);

  const templateRefByDefinition = useMemo(() => {
    const map: Record<string, string> = {};
    for (const node of nodes ?? []) {
      const nodeRef = node.instanceTemplate.settingInstanceTemplateId;
      if (typeof nodeRef === "string" && nodeRef.trim()) map[node.definitionId] = nodeRef.trim();
      for (const child of node.children) {
        const childRef = child.instanceTemplate.settingInstanceTemplateId;
        if (typeof childRef === "string" && childRef.trim()) {
          map[child.definitionId] = childRef.trim();
        }
      }
    }
    return map;
  }, [nodes]);

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

  function openEdit(definitionId: string) {
    const bundled = bundleFromCategoryMap(definitionId, byId);
    const detail = bundled?.detail ?? byId[definitionId];
    if (!detail) {
      setError("This setting’s catalog definition was not returned with the template.");
      return;
    }
    const dependents = bundled?.dependents ?? {};
    const instance = instancesByDefinition.get(definitionId);
    upsertEdit(
      definitionId,
      detail,
      dependents,
      instance
        ? draftFromSettingInstance(instance, detail, dependents)
        : defaultDraftForSetting(detail, dependents),
    );
  }

  function stageRemove(definitionId: string, displayName: string, valueSummary: string) {
    revertEdit(definitionId);
    setStagedRemoves((current) => ({
      ...current,
      [definitionId]: { definitionId, displayName, valueSummary },
    }));
  }

  const dirtyEdits = useMemo(
    () => Object.values(edits).filter((edit) => settingEditIsDirty(edit) && !stagedRemoves[edit.detail.id]),
    [edits, stagedRemoves],
  );
  const removedList = useMemo(() => Object.values(stagedRemoves), [stagedRemoves]);
  const pendingCount = dirtyEdits.length + removedList.length;

  const saveDrafts = useCallback(async () => {
    if (pendingCount === 0) return;
    const pending = Object.values(edits).filter(
      (edit) => settingEditIsDirty(edit) && !stagedRemoves[edit.detail.id],
    );
    const incomplete = pending
      .map((edit) => settingDraftSaveError(edit.detail, edit.draft, edit.dependents))
      .find((message) => message);
    if (incomplete) {
      setError(incomplete);
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
            byId,
          })),
          templateRefByDefinition,
        );
        if (instances.length === 0) throw new Error("Could not build a Graph payload for these settings.");
        const response = await addSettingsToPolicy(policyId, instances);
        if (response.error) throw new Error(response.error);
      }
      if (removedList.length > 0) {
        const topLevel: string[] = [];
        const groupRebuilds: Array<{ groupId: string; children: Record<string, unknown>[] }> = [];
        for (const item of removedList) {
          const detail = byId[item.definitionId];
          const parentId = detail?.rootDefinitionId?.trim();
          const parent = parentId ? byId[parentId] : null;
          const parentIsGroup = parent
            ? /settingGroup/i.test(parent.kind) || /SettingGroup/i.test(parent["@odata.type"] ?? "")
            : false;
          if (parentId && parent && parentIsGroup && parentId !== item.definitionId) {
            const groupInstance = instancesByDefinition.get(parentId);
            const children = groupInstance ? groupInstanceChildren(groupInstance) : [];
            const kept = children.filter(
              (child) => (child.settingDefinitionId ?? "") !== item.definitionId,
            );
            groupRebuilds.push({ groupId: parentId, children: kept });
          } else {
            topLevel.push(item.definitionId);
          }
        }
        for (const rebuild of groupRebuilds) {
          const groupDetail = byId[rebuild.groupId];
          if (!groupDetail) continue;
          const instance = buildGroupCollectionInstance(groupDetail, rebuild.children);
          const groupRef = templateRefByDefinition[rebuild.groupId];
          if (groupRef) {
            instance.settingInstanceTemplateReference = { settingInstanceTemplateId: groupRef };
          }
          const response = await addSettingsToPolicy(policyId, [instance]);
          if (response.error) throw new Error(response.error);
        }
        if (topLevel.length > 0) {
          const response = await removeSettingsFromPolicy(policyId, topLevel);
          if (response.error) throw new Error(response.error);
        }
      }
      const parts: string[] = [];
      if (pending.length === 1) parts.push(`saved “${pending[0].detail.displayName}”`);
      else if (pending.length > 1) parts.push(`saved ${pending.length} settings`);
      if (removedList.length === 1) parts.push(`marked “${removedList[0].displayName}” not configured`);
      else if (removedList.length > 1) parts.push(`marked ${removedList.length} settings not configured`);
      setMessage(`Wrote to Graph: ${parts.join(", ")}.`);
      setEditingId(null);
      setEdits({});
      setStagedRemoves({});
      setConfirmSave(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }, [byId, edits, instancesByDefinition, onSaved, pendingCount, policyId, removedList, templateRefByDefinition]);

  useInspectorSaveAction({
    onSave: () => setConfirmSave(true),
    disabled: busy || pendingCount === 0,
    busy,
  });

  const configuredCount = (node: TemplateSettingNode) => {
    if (node.children.length === 0) return existingIds.has(node.definitionId) ? 1 : 0;
    return node.children.filter((child) => existingIds.has(child.definitionId)).length;
  };

  const notConfiguredCount = useMemo(() => {
    let count = 0;
    for (const node of nodes ?? []) {
      if (node.children.length === 0) {
        if (!existingIds.has(node.definitionId)) count += 1;
      } else {
        count += node.children.filter((child) => !existingIds.has(child.definitionId)).length;
      }
    }
    return count;
  }, [existingIds, nodes]);

  const anyVisible = useMemo(() => {
    if (showUnconfigured) return (nodes?.length ?? 0) > 0;
    for (const node of nodes ?? []) {
      if (node.children.length === 0) {
        if (existingIds.has(node.definitionId)) return true;
      } else if (configuredCount(node) > 0) {
        return true;
      }
    }
    return false;
  }, [existingIds, nodes, showUnconfigured]);

  function renderRow(
    definitionId: string,
    detail: CatalogSettingDetail | null,
    instance: Record<string, unknown> | undefined,
    isChild: boolean,
  ) {
    const rowEdit = edits[definitionId];
    const rowEditing = editingId === definitionId && Boolean(rowEdit);
    const rowDirty = Boolean(rowEdit && settingEditIsDirty(rowEdit));
    const rowRemoved = Boolean(stagedRemoves[definitionId]);
    const configured = Boolean(instance);
    const canEdit = Boolean(detail) && !rowRemoved;
    const displayName = detail?.displayName ?? definitionId;
    const description = detail?.description ?? detail?.helpText ?? undefined;
    const configuredDraft =
      instance && detail ? draftFromSettingInstance(instance, detail, {}) : undefined;
    const valueSummary = instance
      ? detail && configuredDraft
        ? draftValueSummary(detail, configuredDraft, {})
        : "Configured"
      : "Not configured";
    const showGraphDefault = Boolean(
      instance && detail && configuredDraft && draftMatchesGraphDefault(detail, configuredDraft),
    );
    return (
      <li
        key={`${isChild ? "child" : "setting"}:${definitionId}`}
        className={`setting-instance-row${rowEditing ? " is-editing" : ""}${rowDirty ? " is-dirty" : ""}${rowRemoved ? " is-removed" : ""}${isChild ? " is-child" : ""}${canEdit ? " is-activatable" : ""}`}
        title={canEdit ? "Double-click to edit" : undefined}
        onMouseDown={(event) => {
          if (canEdit && event.detail > 1) event.preventDefault();
        }}
        onDoubleClick={(event) => {
          if (!canEdit) return;
          if (
            event.target instanceof Element &&
            event.target.closest("button, a, input, textarea, select, label")
          ) {
            return;
          }
          openEdit(definitionId);
        }}
      >
        <div className="setting-instance-head">
          <div className="setting-instance-title-block">
            <p className="setting-instance-name">
              {displayName}
              {rowRemoved ? (
                <span className="setting-unsaved-pill is-removed">Removed</span>
              ) : rowDirty ? (
                <span className="setting-unsaved-pill">Unsaved</span>
              ) : null}
            </p>
            {description ? <SettingDescription text={description} /> : null}
          </div>
          <div className="setting-instance-value">
            {rowRemoved ? (
              <SettingValueDiff
                removed
                lines={[{ label: "Value", before: valueSummary, after: "Not configured" }]}
              />
            ) : rowEditing && rowEdit ? (
              <SettingDraftEditor
                detail={rowEdit.detail}
                draft={rowEdit.draft}
                dependents={rowEdit.dependents}
                onChange={(draft) => patchDraft(definitionId, draft)}
                compact
              />
            ) : rowDirty && rowEdit ? (
              <SettingValueDiff
                added={!configured}
                lines={diffSettingDrafts(
                  rowEdit.detail,
                  rowEdit.original,
                  rowEdit.draft,
                  rowEdit.dependents,
                  { added: !configured },
                )}
              />
            ) : (
              <span className={configured ? undefined : "muted"}>
                <SettingValueWithDefaultCue show={showGraphDefault}>{valueSummary}</SettingValueWithDefaultCue>
              </span>
            )}
            {rowEditing && rowDirty && rowEdit ? (
              <SettingValueDiff
                added={!configured}
                lines={diffSettingDrafts(
                  rowEdit.detail,
                  rowEdit.original,
                  rowEdit.draft,
                  rowEdit.dependents,
                  { added: !configured },
                )}
              />
            ) : null}
          </div>
          <div className="setting-instance-actions">
            {rowEditing ? (
              <button type="button" className="axis-btn" onClick={() => revertEdit(definitionId)}>
                Revert
              </button>
            ) : (
              <button type="button" className="axis-btn" disabled={busy} onClick={() => openEdit(definitionId)}>
                {configured ? "Edit" : "Add"}
              </button>
            )}
            {configured && !rowEditing ? (
              <button
                type="button"
                className="axis-btn"
                disabled={busy || rowRemoved}
                onClick={() => stageRemove(definitionId, displayName, valueSummary)}
              >
                {rowRemoved ? "Undo" : "Not configured"}
              </button>
            ) : null}
          </div>
        </div>
        {rowEditing && rowEdit && rowEdit.draft.kind === "choice" && Object.keys(rowEdit.draft.children).length > 0 ? (
          <div className="policy-setting-inline-editor">
            <SettingDraftEditor
              detail={rowEdit.detail}
              draft={rowEdit.draft}
              dependents={rowEdit.dependents}
              onChange={(draft) => patchDraft(definitionId, draft)}
              dependentsOnly
            />
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <div className="stack">
      <div className="device-toolbar">
        <p className="muted" style={{ margin: 0 }}>
          {pendingCount > 0
            ? `${pendingCount} unsaved change${pendingCount === 1 ? "" : "s"}. Save from the object header.`
            : "Template-backed policy — edit a configured value, add a setting from this template, or mark one back as not configured."}
        </p>
        {notConfiguredCount > 0 ? (
          <button
            type="button"
            className="axis-btn"
            onClick={() => setShowUnconfigured((open) => !open)}
          >
            {showUnconfigured ? "Hide not configured" : `Show not configured (${notConfiguredCount})`}
          </button>
        ) : null}
      </div>
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {message ? <div className="axis-alert axis-alert-info">{message}</div> : null}
      {templateError ? <div className="axis-alert axis-alert-warning">{templateError}</div> : null}
      {nodes == null ? <p className="muted">Loading policy template…</p> : null}
      {nodes != null && nodes.length === 0 && !templateError ? (
        <p className="muted">This template defines no settings.</p>
      ) : null}
      <details className="template-settings-diagnostic">
        <summary>Raw settings ({settings.length})</summary>
        <pre className="inspector-code">{JSON.stringify(settings, null, 2)}</pre>
      </details>
      {nodes != null && nodes.length > 0 && anyVisible ? (
        <ul className="setting-instance-list">
          {nodes.map((node) => {
            const detail = node.definitions[node.definitionId];
            const isGroup = node.children.length > 0;
            if (!isGroup) {
              if (!showUnconfigured && !instancesByDefinition.has(node.definitionId)) return null;
              return renderRow(node.definitionId, detail, instancesByDefinition.get(node.definitionId), false);
            }
            const count = configuredCount(node);
            if (!showUnconfigured && count === 0) return null;
            const visibleChildren = node.children.filter(
              (child) => showUnconfigured || instancesByDefinition.has(child.definitionId),
            );
            return (
              <li key={`group:${node.definitionId}`} className="setting-instance-row is-group">
                <div className="setting-instance-head">
                  <div className="setting-instance-title-block">
                    <p className="setting-instance-name">
                      {detail?.displayName ?? node.definitionId}
                      <span className="axis-pill">
                        {count} of {node.children.length} configured
                      </span>
                    </p>
                    {detail?.description ? <SettingDescription text={detail.description} /> : null}
                  </div>
                </div>
                <ul className="setting-instance-children">
                  {visibleChildren.map((child) =>
                    renderRow(
                      child.definitionId,
                      child.definition,
                      instancesByDefinition.get(child.definitionId),
                      true,
                    ),
                  )}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : nodes != null && nodes.length > 0 ? (
        <p className="muted">
          No settings are configured on this policy yet. Show not configured settings to add from the
          template.
        </p>
      ) : null}
      {confirmSave && pendingCount > 0 ? (
        <div
          className="axis-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setConfirmSave(false);
          }}
        >
          <div className="axis-modal axis-modal-wide" role="dialog" aria-modal="true" aria-labelledby="template-save-title">
            <div className="assignment-dialog-head">
              <div>
                <p className="axis-kicker">Save to Graph</p>
                <h2 id="template-save-title">
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
                    lines={[{ label: "Value", before: item.valueSummary, after: "Not configured" }]}
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