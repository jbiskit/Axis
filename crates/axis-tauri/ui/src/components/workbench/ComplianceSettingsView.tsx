import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  clearedValueForField,
  complianceSettingRows,
  draftValueForField,
  groupComplianceRows,
  isComplianceFieldEnabled,
  isDraftConfigured,
  parseDraftValue,
  scheduledActionRows,
  type ComplianceField,
  type CompliancePropertyDoc,
  type ComplianceSettingRow,
} from "../../lib/complianceSettings";
import { fetchCompliancePropertyDocs, updateCompliancePolicy } from "../../lib/tauri";
import { useInspectorSaveAction } from "./inspectorSave";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function SettingInfo({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  function show(target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    const width = Math.min(380, Math.max(240, rect.width + 160));
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
    const below = rect.bottom + 8;
    const top = below + 160 > window.innerHeight - 12 ? Math.max(12, rect.top - 168) : below;
    setCoords({ top, left, width });
    setOpen(true);
  }

  return (
    <span
      className="compliance-setting-info"
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="compliance-setting-info-btn"
        aria-label="Setting description"
        aria-expanded={open}
        onMouseEnter={(event) => show(event.currentTarget)}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (open) setOpen(false);
          else show(event.currentTarget);
        }}
      >
        i
      </button>
      {open && coords
        ? createPortal(
            <div
              className="setting-search-tooltip"
              role="tooltip"
              style={{ top: coords.top, left: coords.left, width: coords.width }}
            >
              <p className="setting-search-tooltip-source">Intune portal</p>
              <p className="setting-search-tooltip-body">{text}</p>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

function SettingControl({
  row,
  draft,
  disabled,
  onChange,
}: {
  row: ComplianceSettingRow;
  draft: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  if (row.field.kind === "boolean") {
    return (
      <select
        className="axis-input"
        value={draft}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Not configured</option>
        <option value="true">Required</option>
      </select>
    );
  }
  if (row.field.kind === "enum") {
    return (
      <select
        className="axis-input"
        value={draft}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {(row.field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className="axis-input"
      type={row.field.kind === "number" ? "number" : "text"}
      value={draft}
      disabled={disabled}
      placeholder="Not configured"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function ComplianceSettingsView({
  policyId,
  object,
  extras,
  onSaved,
}: {
  policyId: string;
  object: unknown;
  extras: unknown;
  onSaved: () => void;
}) {
  const record = asRecord(object);
  const odataType = typeof record["@odata.type"] === "string" ? record["@odata.type"] : null;
  const [docs, setDocs] = useState<CompliancePropertyDoc[] | null>(null);
  const rows = useMemo(
    () => complianceSettingRows(asRecord(object), odataType, docs),
    [object, odataType, docs],
  );
  const groups = useMemo(() => groupComplianceRows(rows), [rows]);
  const fieldsByKey = useMemo(() => {
    const map = new Map<string, ComplianceField>();
    for (const row of rows) map.set(row.field.key, row.field);
    return map;
  }, [rows]);
  const actions = useMemo(() => scheduledActionRows(extras), [extras]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!odataType) {
      setDocs(null);
      return;
    }
    let cancelled = false;
    void fetchCompliancePropertyDocs(odataType).then((response) => {
      if (cancelled) return;
      setDocs(response.properties?.length ? response.properties : null);
    });
    return () => {
      cancelled = true;
    };
  }, [odataType]);

  const lastPolicyId = useRef(policyId);
  useEffect(() => {
    const reset = lastPolicyId.current !== policyId;
    lastPolicyId.current = policyId;
    setDrafts((current) => {
      const next: Record<string, string> = {};
      for (const row of rows) {
        const fresh = draftValueForField(row.field, row.value);
        next[row.field.key] = reset ? fresh : (current[row.field.key] ?? fresh);
      }
      return next;
    });
    if (reset) {
      setError(null);
      setMessage(null);
      setOpenGroups({});
    }
  }, [policyId, rows]);

  const dirtyKeys = rows.filter((row) => {
    if (!isComplianceFieldEnabled(row.field, drafts, fieldsByKey)) return false;
    const current = drafts[row.field.key] ?? "";
    return current !== draftValueForField(row.field, row.value);
  });
  const dirty = dirtyKeys.length > 0;

  async function save() {
    if (!odataType || !dirty) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const settings: Record<string, unknown> = {};
      const dirtySet = new Set(dirtyKeys.map((row) => row.field.key));
      for (const row of dirtyKeys) {
        settings[row.field.key] = parseDraftValue(row.field, drafts[row.field.key] ?? "");
      }
      for (const row of rows) {
        if (settings[row.field.key] !== undefined) continue;
        if (isComplianceFieldEnabled(row.field, drafts, fieldsByKey)) continue;
        if (!(row.field.dependsOn ?? []).some((dep) => dirtySet.has(dep.key))) continue;
        settings[row.field.key] = clearedValueForField(row.field);
      }
      const response = await updateCompliancePolicy({
        id: policyId,
        odataType,
        settings,
      });
      if (!response.ok) {
        setError(response.error ?? "Could not save compliance settings.");
        return;
      }
      setMessage("Saved to Graph.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save compliance settings.");
    } finally {
      setBusy(false);
    }
  }

  useInspectorSaveAction({
    onSave: () => void save(),
    disabled: busy || !dirty,
    busy,
  });

  return (
    <div className="stack compliance-settings-view">
      <section className="axis-panel" style={{ padding: "0.85rem" }}>
        <div className="device-toolbar">
          <div>
            <h2 style={{ margin: 0, fontSize: "0.85rem" }}>Actions for noncompliance</h2>
            <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.75rem" }}>
              These actions are set when the policy is created. Graph does not allow changing them
              on a PATCH.
            </p>
          </div>
        </div>
        {actions.length === 0 ? (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            No scheduled actions on this policy.
          </p>
        ) : (
          <ul className="setting-instance-list" style={{ marginTop: "0.5rem" }}>
            {actions.map((action, index) => (
              <li key={`${action.actionType}-${index}`} className="setting-instance-row">
                <div className="setting-instance-head">
                  <p className="setting-instance-name">{action.label}</p>
                  <p className="setting-instance-value">{action.when}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="axis-panel compliance-settings-panel" style={{ padding: "0.85rem" }}>
        <div className="device-toolbar">
          <div>
            <h2 style={{ margin: 0, fontSize: "0.85rem" }}>Compliance settings</h2>
            <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.75rem" }}>
              {dirty
                ? `${dirtyKeys.length} unsaved change${dirtyKeys.length === 1 ? "" : "s"}.`
                : "Required settings are sent to Graph. Not configured is left unset."}
            </p>
          </div>
        </div>
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {message ? <div className="axis-alert axis-alert-info">{message}</div> : null}
        {groups.map((group) => {
          const configured = group.rows.filter((row) => {
            if (!isComplianceFieldEnabled(row.field, drafts, fieldsByKey)) return false;
            return isDraftConfigured(row.field, drafts[row.field.key] ?? "");
          }).length;
          const groupDirty = group.rows.some((row) =>
            dirtyKeys.some((dirty) => dirty.field.key === row.field.key),
          );
          return (
            <details
              key={`${policyId}:${group.group}`}
              className="compliance-setting-group"
              open={openGroups[group.group] ?? (configured > 0 || groupDirty)}
              onToggle={(event) => {
                const next = event.currentTarget.open;
                setOpenGroups((current) =>
                  current[group.group] === next ? current : { ...current, [group.group]: next },
                );
              }}
            >
              <summary className="compliance-setting-group-title">
                <span className="compliance-setting-group-chevron" aria-hidden="true">
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M6 3.5 10.5 8 6 12.5" />
                  </svg>
                </span>
                <span>{group.group}</span>
                <span className="compliance-setting-group-count">
                  {configured}/{group.rows.length} configured
                </span>
              </summary>
              <ul className="setting-instance-list">
                {group.rows.map((row) => {
                  const enabled = isComplianceFieldEnabled(row.field, drafts, fieldsByKey);
                  const child = (row.field.dependsOn?.length ?? 0) > 0;
                  return (
                    <li
                      key={row.field.key}
                      className={`setting-instance-row${enabled ? "" : " is-locked"}`}
                    >
                      <div
                        className={`setting-instance-head compliance-setting-head${
                          child ? " is-child" : ""
                        }`}
                      >
                        <p className="setting-instance-name">
                          {row.field.label}
                          {row.field.description ? <SettingInfo text={row.field.description} /> : null}
                        </p>
                        <SettingControl
                          row={row}
                          draft={drafts[row.field.key] ?? ""}
                          disabled={!enabled}
                          onChange={(value) =>
                            setDrafts((current) => ({ ...current, [row.field.key]: value }))
                          }
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </section>
    </div>
  );
}
