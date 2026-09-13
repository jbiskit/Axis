import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { CatalogSettingDetail } from "../types/inventory";
import type { SettingValueDraft } from "./catalog";

export type PendingSettingEdit = {
  detail: CatalogSettingDetail;
  dependents: Record<string, CatalogSettingDetail>;
  draft: SettingValueDraft;
  original: SettingValueDraft;
  /**
   * True when the setting is not yet on the policy, so `original` is only a
   * seeded draft derived from the Graph default rather than a stored value.
   * Choosing a value that equals that default still moves the setting from
   * "not configured" to enforced, so it must count as a change.
   */
  added: boolean;
};

export type StagedSettingRemove = {
  definitionId: string;
  displayName: string;
  valueSummary: string;
};

export type CachedPolicySettingsDraft = {
  edits: Record<string, PendingSettingEdit>;
  stagedRemoves: Record<string, StagedSettingRemove>;
  editingId: string | null;
};

const dirtyScopes = new Set<string>();
const policyDrafts = new Map<string, CachedPolicySettingsDraft>();
const complianceDrafts = new Map<string, Record<string, string>>();

const LEAVE_EVENT = "axis:unsaved-leave";

let pendingLeave: (() => void) | null = null;

function draftsEqual(left: SettingValueDraft, right: SettingValueDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function settingEditIsDirty(edit: PendingSettingEdit): boolean {
  // A setting that is not yet on the policy has no stored baseline to compare
  // against. Even when the chosen value equals the Graph default, writing it is
  // a real change: it turns "not configured" into an enforced value.
  if (edit.added) return true;
  return !draftsEqual(edit.draft, edit.original);
}

export function policySettingsDraftIsDirty(draft: CachedPolicySettingsDraft): boolean {
  if (Object.keys(draft.stagedRemoves).length > 0) return true;
  return Object.values(draft.edits).some(
    (edit) => settingEditIsDirty(edit) && !draft.stagedRemoves[edit.detail.id],
  );
}

export function setInspectorDirty(scope: string, dirty: boolean): void {
  if (dirty) dirtyScopes.add(scope);
  else dirtyScopes.delete(scope);
}

export function persistPolicySettingsDraft(policyId: string, draft: CachedPolicySettingsDraft): void {
  if (policySettingsDraftIsDirty(draft)) {
    policyDrafts.set(policyId, draft);
    setInspectorDirty(`settings:${policyId}`, true);
  } else {
    policyDrafts.delete(policyId);
    setInspectorDirty(`settings:${policyId}`, false);
  }
}

export function readPolicySettingsDraft(policyId: string): CachedPolicySettingsDraft | null {
  return policyDrafts.get(policyId) ?? null;
}

export function persistComplianceDraft(
  policyId: string,
  drafts: Record<string, string>,
  dirty: boolean,
): void {
  if (dirty) {
    complianceDrafts.set(policyId, drafts);
    setInspectorDirty(`compliance:${policyId}`, true);
  } else {
    complianceDrafts.delete(policyId);
    setInspectorDirty(`compliance:${policyId}`, false);
  }
}

export function readComplianceDraft(policyId: string): Record<string, string> | null {
  return complianceDrafts.get(policyId) ?? null;
}

export function hasUnsavedInspectorChanges(): boolean {
  if (dirtyScopes.size > 0) return true;
  for (const draft of policyDrafts.values()) {
    if (policySettingsDraftIsDirty(draft)) return true;
  }
  return complianceDrafts.size > 0;
}

export function discardUnsavedInspectorChanges(): void {
  dirtyScopes.clear();
  policyDrafts.clear();
  complianceDrafts.clear();
}

export function requestLeave(action: () => void): void {
  if (!hasUnsavedInspectorChanges()) {
    action();
    return;
  }
  pendingLeave = action;
  window.dispatchEvent(new Event(LEAVE_EVENT));
}

export function confirmPendingLeave(): void {
  discardUnsavedInspectorChanges();
  const action = pendingLeave;
  pendingLeave = null;
  action?.();
}

export function cancelPendingLeave(): void {
  pendingLeave = null;
}

export function subscribeUnsavedLeave(listener: () => void): () => void {
  window.addEventListener(LEAVE_EVENT, listener);
  return () => window.removeEventListener(LEAVE_EVENT, listener);
}

export function useInspectorDirty(scope: string, dirty: boolean): void {
  useEffect(() => {
    setInspectorDirty(scope, dirty);
    return () => setInspectorDirty(scope, false);
  }, [dirty, scope]);
}

export function usePersistedPolicySettingsDraft(policyId: string): {
  edits: Record<string, PendingSettingEdit>;
  setEdits: Dispatch<SetStateAction<Record<string, PendingSettingEdit>>>;
  stagedRemoves: Record<string, StagedSettingRemove>;
  setStagedRemoves: Dispatch<SetStateAction<Record<string, StagedSettingRemove>>>;
  editingId: string | null;
  setEditingId: Dispatch<SetStateAction<string | null>>;
} {
  const cached = readPolicySettingsDraft(policyId);
  const [edits, setEdits] = useState<Record<string, PendingSettingEdit>>(() => cached?.edits ?? {});
  const [stagedRemoves, setStagedRemoves] = useState<Record<string, StagedSettingRemove>>(
    () => cached?.stagedRemoves ?? {},
  );
  const [editingId, setEditingId] = useState<string | null>(() => cached?.editingId ?? null);
  const skipPersist = useRef(true);

  useEffect(() => {
    const next = readPolicySettingsDraft(policyId);
    setEdits(next?.edits ?? {});
    setStagedRemoves(next?.stagedRemoves ?? {});
    setEditingId(next?.editingId ?? null);
    skipPersist.current = true;
    if (next && policySettingsDraftIsDirty(next)) {
      setInspectorDirty(`settings:${policyId}`, true);
    }
  }, [policyId]);

  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    persistPolicySettingsDraft(policyId, { edits, stagedRemoves, editingId });
  }, [editingId, edits, policyId, stagedRemoves]);

  return { edits, setEdits, stagedRemoves, setStagedRemoves, editingId, setEditingId };
}
