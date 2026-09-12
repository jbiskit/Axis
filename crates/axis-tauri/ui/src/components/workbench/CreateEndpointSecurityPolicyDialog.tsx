import { useEffect, useMemo, useState } from "react";
import type { CatalogSettingDetail } from "../../types/inventory";
import {
  buildSettingInstance,
  bundleFromCategoryMap,
  defaultDraftForSetting,
  diffSettingDrafts,
  draftValueSummary,
  instancesReadyForGraph,
  parseConfigurationPolicyTemplate,
  type SettingValueDraft,
  type TemplateSettingNode,
} from "../../lib/catalog";
import {
  createEndpointSecurityPolicy,
  fetchConfigurationPolicyTemplate,
} from "../../lib/tauri";
import { SettingDescription } from "./SettingDescription";
import { SettingDraftEditor } from "./SettingDraftEditor";
import { SettingValueDiff } from "./SettingValueDiff";

type PendingEdit = {
  detail: CatalogSettingDetail;
  dependents: Record<string, CatalogSettingDetail>;
  draft: SettingValueDraft;
  original: SettingValueDraft;
};

function draftsEqual(left: SettingValueDraft, right: SettingValueDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function editIsDirty(edit: PendingEdit): boolean {
  return !draftsEqual(edit.draft, edit.original);
}

/**
 * Create a new template-backed Endpoint Security policy from its template:
 * name it, configure settings from the template's structure, then create.
 */
export function CreateEndpointSecurityPolicyDialog({
  family,
  templateId,
  onClose,
  onCreated,
}: {
  family: string;
  templateId: string;
  onClose: () => void;
  onCreated: (id: string, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nodes, setNodes] = useState<TemplateSettingNode[] | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, PendingEdit>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
  }, [templateId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

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
    upsertEdit(definitionId, detail, dependents, defaultDraftForSetting(detail, dependents));
  }

  const pending = useMemo(
    () => Object.values(edits).filter((edit) => editIsDirty(edit)),
    [edits],
  );

  async function create() {
    if (!name.trim() || pending.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const instances = instancesReadyForGraph(
        pending.map((edit) => ({
          instance: buildSettingInstance(edit.detail, edit.draft, edit.dependents),
          detail: edit.detail,
          byId,
        })),
        templateRefByDefinition,
      );
      if (instances.length === 0) throw new Error("Could not build a Graph payload for these settings.");
      const response = await createEndpointSecurityPolicy({
        name: name.trim(),
        description: description.trim() || undefined,
        platform: "windows",
        templateId,
        templateFamily: family,
        settings: instances,
      });
      if (response.error || !response.policy) {
        setError(response.error ?? "Create failed.");
        return;
      }
      onCreated(response.policy.id, response.policy.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  }

  function renderRow(definitionId: string, detail: CatalogSettingDetail | null, isChild: boolean) {
    const rowEdit = edits[definitionId];
    const rowEditing = editingId === definitionId && Boolean(rowEdit);
    const rowDirty = Boolean(rowEdit && editIsDirty(rowEdit));
    const displayName = detail?.displayName ?? definitionId;
    const description = detail?.description ?? detail?.helpText ?? undefined;
    const valueSummary =
      rowEdit && !rowEditing && !rowDirty
        ? draftValueSummary(rowEdit.detail, rowEdit.original, rowEdit.dependents)
        : "Not configured";
    return (
      <li
        key={`${isChild ? "child" : "setting"}:${definitionId}`}
        className={`setting-instance-row${rowEditing ? " is-editing" : ""}${rowDirty ? " is-dirty" : ""}${isChild ? " is-child" : ""}`}
      >
        <div className="setting-instance-head">
          <div className="setting-instance-title-block">
            <p className="setting-instance-name">{displayName}</p>
            {description ? <SettingDescription text={description} /> : null}
          </div>
          <div className="setting-instance-value">
            {rowEditing && rowEdit ? (
              <SettingDraftEditor
                detail={rowEdit.detail}
                draft={rowEdit.draft}
                dependents={rowEdit.dependents}
                onChange={(draft) => patchDraft(definitionId, draft)}
                compact
              />
            ) : rowDirty && rowEdit ? (
              <SettingValueDiff
                added
                lines={diffSettingDrafts(
                  rowEdit.detail,
                  rowEdit.original,
                  rowEdit.draft,
                  rowEdit.dependents,
                  { added: true },
                )}
              />
            ) : (
              <span className="muted">{valueSummary}</span>
            )}
            {rowEditing && rowDirty && rowEdit ? (
              <SettingValueDiff
                added
                lines={diffSettingDrafts(
                  rowEdit.detail,
                  rowEdit.original,
                  rowEdit.draft,
                  rowEdit.dependents,
                  { added: true },
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
                {rowEdit ? "Edit" : "Add"}
              </button>
            )}
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
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="axis-modal axis-modal-wide" role="dialog" aria-modal="true" aria-labelledby="create-es-policy-title">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Create Endpoint Security policy</p>
            <h2 id="create-es-policy-title">New policy</h2>
          </div>
          <button type="button" className="axis-btn" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {templateError ? <div className="axis-alert axis-alert-warning">{templateError}</div> : null}
        {nodes == null ? <p className="muted">Loading template…</p> : null}
        <div className="object-action-fields">
          <label className="device-field">
            Policy name
            <input
              className="axis-input"
              value={name}
              disabled={busy}
              placeholder="Required"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="device-field">
            Description
            <textarea
              className="axis-input object-action-description"
              value={description}
              rows={3}
              disabled={busy}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        {nodes != null && nodes.length > 0 ? (
          <div className="create-es-settings">
            <p className="axis-kicker">Settings</p>
            <ul className="setting-instance-list">
              {nodes.map((node) => {
                const detail = node.definitions[node.definitionId];
                const isGroup = node.children.length > 0;
                if (!isGroup) {
                  return renderRow(node.definitionId, detail, false);
                }
                return (
                  <li key={`group:${node.definitionId}`} className="setting-instance-row is-group">
                    <div className="setting-instance-head">
                      <div className="setting-instance-title-block">
                        <p className="setting-instance-name">
                          {detail?.displayName ?? node.definitionId}
                          <span className="axis-pill">
                            {node.children.filter((child) => edits[child.definitionId]).length} of{" "}
                            {node.children.length} configured
                          </span>
                        </p>
                        {detail?.description ? <SettingDescription text={detail.description} /> : null}
                      </div>
                    </div>
                    <ul className="setting-instance-children">
                      {node.children.map((child) =>
                        renderRow(child.definitionId, child.definition, true),
                      )}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <div className="axis-modal-actions">
          <button type="button" className="axis-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={busy || !name.trim() || pending.length === 0}
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create policy"}
          </button>
        </div>
      </div>
    </div>
  );
}