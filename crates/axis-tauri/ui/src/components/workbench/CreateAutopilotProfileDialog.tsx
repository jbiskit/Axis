import { useEffect, useMemo, useState } from "react";
import {
  defaultAutopilotProfileDraft,
  toCreateAutopilotInput,
  type AutopilotProfileDraft,
} from "../../lib/autopilotProfile";
import { createAutopilotProfile } from "../../lib/tauri";
import type { AutopilotProfile } from "../../types/inventory";
import { AutopilotProfileForm } from "./AutopilotProfileForm";

export function CreateAutopilotProfileDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (profile: AutopilotProfile) => void;
}) {
  const [draft, setDraft] = useState<AutopilotProfileDraft>(() => defaultAutopilotProfileDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(defaultAutopilotProfileDraft());
    setBusy(false);
    setError(null);
  }, [open]);

  const canSave = useMemo(
    () => !busy && draft.displayName.trim().length > 0,
    [busy, draft.displayName],
  );

  async function create() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const response = await createAutopilotProfile(toCreateAutopilotInput(draft));
      if (!response.profile) {
        setError(response.error ?? "Could not create the deployment profile.");
        return;
      }
      onClose();
      onCreated(response.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the deployment profile.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="axis-modal axis-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-autopilot-profile-title"
      >
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Enrollment · Autopilot</p>
            <h2 id="create-autopilot-profile-title">Create deployment profile</h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              Join type, deployment mode, and device type are set at create and cannot be changed
              later. Assign groups after create.
            </p>
          </div>
          <button type="button" className="axis-btn" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        <div style={{ maxHeight: "min(70vh, 40rem)", overflow: "auto", paddingRight: "0.25rem" }}>
          <AutopilotProfileForm
            draft={draft}
            disabled={busy}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          />
        </div>
        <div className="device-actions" style={{ marginTop: "1rem", justifyContent: "flex-end" }}>
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
