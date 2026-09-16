import { useEffect, useMemo, useState } from "react";
import {
  buildUpdateInput,
  draftsEqual,
  draftsFromEnrollmentObject,
  partitionRestrictionDrafts,
  type RestrictionDraft,
} from "../../lib/enrollmentRestrictions";
import { updateEnrollmentPlatformRestrictions } from "../../lib/tauri";
import { requestObjectRefresh } from "../../lib/inspectorCache";
import { useInspectorDirty } from "../../lib/inspectorDrafts";
import { READ_ONLY_WRITE_HINT, useReadOnly } from "../../lib/readOnly";
import { IncludeExcludeToggle } from "./IncludeExcludeToggle";
import { useInspectorSaveAction } from "./inspectorSave";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function AllowBlockPill({
  blocked,
  disabled,
  ariaLabel,
  title,
  onChange,
}: {
  blocked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  onChange: (blocked: boolean) => void;
}) {
  return (
    <span title={disabled ? title ?? READ_ONLY_WRITE_HINT : undefined}>
      <IncludeExcludeToggle
        value={blocked ? "exclude" : "include"}
        includeLabel="Allow"
        excludeLabel="Block"
        ariaLabel={ariaLabel}
        disabled={disabled}
        onChange={(value) => onChange(value === "exclude")}
      />
    </span>
  );
}

function RestrictionTable({
  rows,
  locked,
  readOnly,
  onUpdate,
}: {
  rows: RestrictionDraft[];
  locked: boolean;
  readOnly: boolean;
  onUpdate: (key: string, patch: Partial<RestrictionDraft>) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <table className="axis-table">
      <thead>
        <tr>
          <th>Platform</th>
          <th>MDM</th>
          <th>Personally owned</th>
          <th>Min OS</th>
          <th>Max OS</th>
          <th>Blocked manufacturers</th>
          <th>Blocked SKUs</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const detailLocked = locked || row.platformBlocked;
          const detailTitle = readOnly
            ? READ_ONLY_WRITE_HINT
            : row.platformBlocked
              ? "MDM is blocked for this platform — detail settings do not apply"
              : undefined;
          return (
            <tr key={row.key}>
              <td>{row.label}</td>
              <td>
                <AllowBlockPill
                  blocked={row.platformBlocked}
                  disabled={locked}
                  ariaLabel={`${row.label} MDM`}
                  onChange={(platformBlocked) => onUpdate(row.key, { platformBlocked })}
                />
              </td>
              <td>
                <AllowBlockPill
                  blocked={row.personalBlocked}
                  disabled={detailLocked}
                  title={detailTitle}
                  ariaLabel={`${row.label} personally owned`}
                  onChange={(personalBlocked) => onUpdate(row.key, { personalBlocked })}
                />
              </td>
              <td>
                <input
                  className="axis-input"
                  value={row.osMinimum}
                  disabled={detailLocked}
                  placeholder="—"
                  title={detailTitle}
                  onChange={(event) => onUpdate(row.key, { osMinimum: event.target.value })}
                />
              </td>
              <td>
                <input
                  className="axis-input"
                  value={row.osMaximum}
                  disabled={detailLocked}
                  placeholder="—"
                  title={detailTitle}
                  onChange={(event) => onUpdate(row.key, { osMaximum: event.target.value })}
                />
              </td>
              <td>
                <input
                  className="axis-input"
                  value={row.blockedManufacturers}
                  disabled={detailLocked}
                  placeholder="comma-separated"
                  title={detailTitle}
                  onChange={(event) =>
                    onUpdate(row.key, { blockedManufacturers: event.target.value })
                  }
                />
              </td>
              <td>
                <input
                  className="axis-input"
                  value={row.blockedSkus}
                  disabled={detailLocked}
                  placeholder="comma-separated"
                  title={detailTitle}
                  onChange={(event) => onUpdate(row.key, { blockedSkus: event.target.value })}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function EnrollmentRestrictionsEditor({
  policyId,
  object,
}: {
  policyId: string;
  object: Record<string, unknown> | null;
}) {
  const readOnly = useReadOnly();
  const baseline = useMemo(() => draftsFromEnrollmentObject(object), [object]);
  const [drafts, setDrafts] = useState<RestrictionDraft[]>(baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(baseline);
    setError(null);
    setMessage(null);
  }, [baseline, policyId]);

  const dirty = !draftsEqual(drafts, baseline);
  useInspectorDirty(`enrollment-restrictions:${policyId}`, dirty);

  const { portal, advanced } = useMemo(() => partitionRestrictionDrafts(drafts), [drafts]);

  function updateRow(key: string, patch: Partial<RestrictionDraft>) {
    setDrafts((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  async function save() {
    const record = asRecord(object);
    if (!record || !dirty) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await updateEnrollmentPlatformRestrictions(
        buildUpdateInput(policyId, record, drafts),
      );
      if (!response.ok) {
        setError(response.error ?? "Could not save enrolment restrictions.");
        return;
      }
      setMessage("Saved to Graph.");
      requestObjectRefresh(policyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save enrolment restrictions.");
    } finally {
      setBusy(false);
    }
  }

  useInspectorSaveAction({
    onSave: () => void save(),
    disabled: busy || !dirty || readOnly,
    busy,
  });

  if (drafts.length === 0) {
    return <p className="muted">No platform restriction settings on this object.</p>;
  }

  const locked = busy || readOnly;

  return (
    <div className="stack" style={{ marginTop: "1rem" }}>
      <div className="device-toolbar">
        <div>
          <h2 style={{ margin: 0, fontSize: "0.85rem" }}>Platform restrictions</h2>
          <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.75rem" }}>
            Platforms shown in the Intune admin center. Allow or block MDM enrolment and
            personally owned devices.
          </p>
        </div>
      </div>
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {message ? <div className="axis-alert axis-alert-info">{message}</div> : null}
      <RestrictionTable rows={portal} locked={locked} readOnly={readOnly} onUpdate={updateRow} />
      {advanced.length > 0 ? (
        <details className="stack" style={{ marginTop: "0.75rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}>
            Additional Graph platforms ({advanced.length})
          </summary>
          <p className="muted" style={{ margin: "0.35rem 0 0.5rem", fontSize: "0.75rem" }}>
            Graph also stores Windows Home SKU, Windows Mobile, and legacy Mac blobs on the
            default restriction. The Intune portal does not list these as separate platforms
            (Home is usually handled with assignment filters). Included here so you can inspect
            or change them without losing values on save.
          </p>
          <RestrictionTable
            rows={advanced}
            locked={locked}
            readOnly={readOnly}
            onUpdate={updateRow}
          />
        </details>
      ) : null}
    </div>
  );
}
