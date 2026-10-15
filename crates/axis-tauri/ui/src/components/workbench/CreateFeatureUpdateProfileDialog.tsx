import { useEffect, useState } from "react";
import { createFeatureUpdateProfile, type FeatureUpdateProfile } from "../../lib/tauri";
import {
  draftFeatureUpdateProfile,
  FeatureUpdateProfileFields,
  featureUpdateProblem,
  useFeatureUpdateCatalog,
} from "./FeatureUpdateProfileFields";

export function CreateFeatureUpdateProfileDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (profile: FeatureUpdateProfile) => void;
}) {
  const [profile, setProfile] = useState<FeatureUpdateProfile>(() => draftFeatureUpdateProfile());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const catalog = useFeatureUpdateCatalog();

  useEffect(() => {
    if (!open) return;
    setProfile(draftFeatureUpdateProfile());
    setBusy(false);
    setError(null);
    setTouched(false);
  }, [open]);

  function patch(next: Partial<FeatureUpdateProfile>) {
    setProfile((current) => ({ ...current, ...next }));
    setTouched(true);
  }

  const problem = featureUpdateProblem(profile, true, catalog);

  async function create() {
    if (busy || problem) return;
    setBusy(true);
    setError(null);
    try {
      const response = await createFeatureUpdateProfile(profile);
      if (response.error || !response.profile) {
        throw new Error(response.error ?? "Could not create the deployment.");
      }
      onClose();
      onCreated(response.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the deployment.");
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
      <div className="axis-modal axis-modal-wide" role="dialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Windows Update</p>
            <h2>New feature update deployment</h2>
            <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.75rem" }}>
              Holds devices at the chosen Windows version and offers it on your schedule. It applies
              to nothing until it is assigned.
            </p>
          </div>
        </div>

        <div className="create-ring-body">
          <FeatureUpdateProfileFields profile={profile} saved={null} catalog={catalog} disabled={busy} onChange={patch} />
        </div>

        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {touched && problem ? (
          <p className="setting-field-error" style={{ margin: 0 }}>
            {problem}
          </p>
        ) : null}

        <div className="axis-modal-actions">
          <button type="button" className="axis-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={busy || problem != null}
            title={problem ?? undefined}
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create deployment"}
          </button>
        </div>
      </div>
    </div>
  );
}
