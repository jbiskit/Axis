import { useEffect, useMemo, useState } from "react";
import {
  DEVICE_LIMIT_OPTIONS,
  deviceLimitFromObject,
  enrollmentOdataType,
} from "../../lib/enrollmentLimits";
import { updateEnrollmentLimit } from "../../lib/tauri";
import { requestObjectRefresh } from "../../lib/inspectorCache";
import { useInspectorDirty } from "../../lib/inspectorDrafts";
import { READ_ONLY_WRITE_HINT, useReadOnly } from "../../lib/readOnly";
import { useInspectorSaveAction } from "./inspectorSave";

export function EnrollmentLimitEditor({
  policyId,
  object,
}: {
  policyId: string;
  object: Record<string, unknown> | null;
}) {
  const readOnly = useReadOnly();
  const baseline = useMemo(() => deviceLimitFromObject(object), [object]);
  const [limit, setLimit] = useState(baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setLimit(baseline);
    setError(null);
    setMessage(null);
  }, [baseline, policyId]);

  const dirty = limit !== baseline;
  useInspectorDirty(`enrollment-limit:${policyId}`, dirty);

  async function save() {
    if (!object || !dirty) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await updateEnrollmentLimit({
        id: policyId,
        odataType: enrollmentOdataType(object),
        limit,
      });
      if (!response.ok) {
        setError(response.error ?? "Could not update the device limit.");
        return;
      }
      setMessage("Saved device limit to Graph.");
      requestObjectRefresh(policyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the device limit.");
    } finally {
      setBusy(false);
    }
  }

  useInspectorSaveAction({
    onSave: () => void save(),
    disabled: busy || !dirty || readOnly,
    busy,
    label: dirty ? "Save device limit" : undefined,
  });

  return (
    <div className="stack" style={{ marginTop: "1rem", gap: "0.75rem" }}>
      <div>
        <h3 style={{ margin: "0 0 0.35rem", fontSize: "0.95rem" }}>Device limit</h3>
        <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
          Maximum number of devices a user can enrol (Intune allows 1–15). Assignments are
          user/group scoped.
        </p>
      </div>
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {message ? <div className="axis-alert axis-alert-info">{message}</div> : null}
      <label className="device-field">
        Device limit
        <select
          className="axis-input"
          value={limit}
          disabled={busy || readOnly}
          title={readOnly ? READ_ONLY_WRITE_HINT : undefined}
          onChange={(event) => setLimit(Number(event.target.value))}
        >
          {DEVICE_LIMIT_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
