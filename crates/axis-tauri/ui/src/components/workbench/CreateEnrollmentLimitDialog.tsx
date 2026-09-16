import { useEffect, useMemo, useState } from "react";
import {
  DEVICE_LIMIT_MAX,
  DEVICE_LIMIT_OPTIONS,
} from "../../lib/enrollmentLimits";
import { createEnrollmentLimit } from "../../lib/tauri";
import type { CatalogPolicySummary } from "../../types/inventory";

export function CreateEnrollmentLimitDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (policy: CatalogPolicySummary) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [limit, setLimit] = useState(DEVICE_LIMIT_MAX);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setLimit(DEVICE_LIMIT_MAX);
    setBusy(false);
    setError(null);
  }, [open]);

  const canSave = useMemo(() => !busy && name.trim().length > 0, [busy, name]);

  async function create() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const response = await createEnrollmentLimit({
        displayName: name.trim(),
        description: description.trim() || null,
        limit,
      });
      if (!response.policy) {
        setError(response.error ?? "Could not create the device limit restriction.");
        return;
      }
      onClose();
      onCreated(response.policy);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create the device limit restriction.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="axis-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-enrollment-limit-title"
      >
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Enrollment</p>
            <h2 id="create-enrollment-limit-title">Create device limit restriction</h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              Caps how many devices a user can enrol. Assign Entra groups after create (not All
              users / All devices).
            </p>
          </div>
          <button type="button" className="axis-btn" onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        <div className="stack" style={{ gap: "0.75rem" }}>
          <label className="device-field">
            Name
            <input
              className="axis-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Standard users — 5 devices"
              autoFocus
            />
          </label>
          <label className="device-field">
            Description
            <input
              className="axis-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="device-field">
            Device limit
            <select
              className="axis-input"
              value={limit}
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
        <div className="assignment-actions" style={{ marginTop: "1rem" }}>
          <button type="button" className="axis-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={!canSave}
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
