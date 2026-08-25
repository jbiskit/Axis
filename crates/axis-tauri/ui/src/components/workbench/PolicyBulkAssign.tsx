import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  allFilteredAreSelected,
  clearSelectionIds,
  pruneSelectionIds,
  toggleSelectionId,
} from "../../lib/listSelection";
import { fetchGraphObjectDetail } from "../../lib/tauri";
import type { CatalogPolicySummary } from "../../types/inventory";
import { AssignmentsEditor } from "./AssignmentsEditor";

export function useCheckedIds(visibleIds: readonly string[]) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);
  const [bulkTargetIds, setBulkTargetIds] = useState<string[]>([]);
  const visibleKey = visibleIds.join("\0");

  useEffect(() => {
    const allowed = visibleKey.length === 0 ? [] : visibleKey.split("\0");
    setCheckedIds((current) => {
      const next = pruneSelectionIds(current, allowed);
      if (next.size === current.size && [...next].every((id) => current.has(id))) {
        return current;
      }
      return next;
    });
  }, [visibleKey]);

  const allSelected = allFilteredAreSelected(checkedIds, visibleIds);

  function toggle(id: string) {
    setCheckedIds((current) => toggleSelectionId(current, id));
  }

  function toggleAll() {
    if (allSelected) {
      setCheckedIds(clearSelectionIds());
      return;
    }
    setCheckedIds(new Set(visibleIds));
  }

  function clear() {
    setCheckedIds(clearSelectionIds());
    setBulkEditorOpen(false);
    setBulkTargetIds([]);
  }

  function openBulkEditor() {
    setBulkTargetIds([...checkedIds]);
    setBulkEditorOpen(true);
  }

  function closeBulkEditor() {
    setBulkEditorOpen(false);
    setBulkTargetIds([]);
  }

  return {
    checkedIds,
    bulkEditorOpen,
    bulkTargetIds,
    allSelected,
    toggle,
    toggleAll,
    clear,
    openBulkEditor,
    closeBulkEditor,
  };
}

export function SelectCheckbox({
  checked,
  indeterminate = false,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <label className="axis-check" onClick={(event) => event.stopPropagation()}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={label}
      />
    </label>
  );
}

export function BulkAssignBar({
  count,
  onEdit,
  onClear,
  extra,
}: {
  count: number;
  onEdit: () => void;
  onClear: () => void;
  extra?: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="bulk-assign-bar">
      <p className="bulk-assign-count">
        {count} selected
      </p>
      <div className="device-actions">
        {extra}
        <button
          type="button"
          className="axis-btn axis-btn-primary"
          onClick={onEdit}
        >
          Update assignments
        </button>
        <button type="button" className="axis-btn" onClick={onClear}>
          Clear selection
        </button>
      </div>
    </div>
  );
}

export function AssignmentsDialog({
  open,
  kind,
  policies,
  onClose,
  onSaved,
}: {
  open: boolean;
  kind: string;
  policies: CatalogPolicySummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [seed, setSeed] = useState<Record<string, unknown>[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const targetKey = policies.map((policy) => policy.id).join("\0");
  const odataType = policies[0]?.odataType ?? null;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setSeed(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    if (policies.length !== 1) {
      setSeed([]);
      return () => {
        cancelled = true;
      };
    }
    setSeed(null);
    const policy = policies[0];
    void fetchGraphObjectDetail(kind, policy.id)
      .then((response) => {
        if (cancelled) return;
        setSeed(response.detail?.assignments ?? []);
        setLoadError(response.error);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSeed([]);
        setLoadError(error instanceof Error ? error.message : "Failed to load assignments.");
      });
    return () => {
      cancelled = true;
    };
  }, [kind, open, targetKey]);

  const names = useMemo(
    () => policies.map((policy) => policy.name).join(", "),
    [policies],
  );

  if (!open || policies.length === 0) return null;

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="axis-modal axis-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assignments-dialog-title"
      >
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">{policies.length > 1 ? "Bulk" : "Assignments"}</p>
            <h2 id="assignments-dialog-title">
              {policies.length > 1
                ? `${policies.length} ${bulkNoun(kind, policies.length)}`
                : policies[0]?.name ?? "Assignments"}
            </h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              {policies.length > 1
                ? `Draft starts empty. Save replaces assignments on every selected ${bulkNoun(kind, 2)} with the same list (not a union of existing targets).`
                : "Save writes this assignment list to Graph."}
            </p>
            <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.75rem" }} title={names}>
              {policies.length <= 8
                ? names
                : `${policies
                    .slice(0, 8)
                    .map((policy) => policy.name)
                    .join(", ")} +${policies.length - 8} more`}
            </p>
          </div>
          <button type="button" className="axis-btn" onClick={onClose}>
            Close
          </button>
        </div>
        {loadError ? <div className="axis-alert axis-alert-warning">{loadError}</div> : null}
        {seed == null ? (
          <p className="muted">Loading current assignments…</p>
        ) : (
          <AssignmentsEditor
            kind={kind}
            targets={policies.map((policy) => ({ id: policy.id, title: policy.name }))}
            title={policies.length === 1 ? policies[0].name : `${policies.length} ${bulkNoun(kind, policies.length)}`}
            assignments={seed}
            objectOdataType={odataType}
            onSaved={onSaved}
          />
        )}
      </div>
    </div>
  );
}

function bulkNoun(kind: string, count: number): string {
  const plural = count !== 1;
  if (kind === "mobileApp") return plural ? "apps" : "app";
  return plural ? "policies" : "policy";
}
