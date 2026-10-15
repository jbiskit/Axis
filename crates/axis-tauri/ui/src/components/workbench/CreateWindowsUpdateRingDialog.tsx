import { useEffect, useState } from "react";
import { createWindowsUpdateRing, type WindowsUpdateRing } from "../../lib/tauri";
import { WindowsUpdateRingFields } from "./WindowsUpdateRingFields";

/** Blank ring — Graph fills anything left null with its own default. */
export function draftRing(): WindowsUpdateRing {
  return {
    id: "",
    displayName: "",
    description: "",
    isAssigned: false,
    microsoftUpdateServiceAllowed: true,
    driversExcluded: false,
    allowWindows11Upgrade: false,
    deliveryOptimizationMode: "userDefined",
    automaticUpdateMode: "windowsDefault",
    businessReadyUpdatesOnly: "userDefined",
    qualityUpdatesDeferralPeriodInDays: 0,
    featureUpdatesDeferralPeriodInDays: 0,
    featureUpdatesRollbackWindowInDays: 30,
    deadlineForQualityUpdatesInDays: 0,
    deadlineForFeatureUpdatesInDays: 0,
    deadlineGracePeriodInDays: 1,
    postponeRebootUntilAfterDeadline: true,
    skipChecksBeforeRestart: false,
    autoRestartNotificationDismissal: "notConfigured",
    userPauseAccess: "disabled",
    userWindowsUpdateScanAccess: "enabled",
    updateNotificationLevel: "defaultNotifications",
  };
}

/** The three OIB-style rings offered as a starting point. */
const PRESETS: { label: string; description: string; apply: (ring: WindowsUpdateRing) => void }[] = [
  {
    label: "Pilot",
    description: "Immediate updates, 1 day grace before a forced reboot.",
    apply: (ring) => {
      ring.qualityUpdatesDeferralPeriodInDays = 0;
      ring.featureUpdatesDeferralPeriodInDays = 0;
      ring.deadlineGracePeriodInDays = 1;
    },
  },
  {
    label: "Broad",
    description: "7 day quality and feature deferral, 2 day grace.",
    apply: (ring) => {
      ring.qualityUpdatesDeferralPeriodInDays = 7;
      ring.featureUpdatesDeferralPeriodInDays = 7;
      ring.deadlineGracePeriodInDays = 2;
    },
  },
  {
    label: "Production",
    description: "15 day quality, 30 day feature deferral, 3 day grace.",
    apply: (ring) => {
      ring.qualityUpdatesDeferralPeriodInDays = 15;
      ring.featureUpdatesDeferralPeriodInDays = 30;
      ring.deadlineGracePeriodInDays = 3;
    },
  },
];

export function CreateWindowsUpdateRingDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (ring: WindowsUpdateRing) => void;
}) {
  const [ring, setRing] = useState<WindowsUpdateRing>(() => draftRing());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRing(draftRing());
    setBusy(false);
    setError(null);
  }, [open]);

  function patch(next: Partial<WindowsUpdateRing>) {
    setRing((current) => ({ ...current, ...next }));
  }

  async function create() {
    if (busy || !ring.displayName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await createWindowsUpdateRing(ring);
      if (response.error || !response.ring) {
        throw new Error(response.error ?? "Could not create the ring.");
      }
      onClose();
      onCreated(response.ring);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the ring.");
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
            <h2>New update ring</h2>
            <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.75rem" }}>
              Creates a Windows Update for Business ring. Assign it once created.
            </p>
          </div>
        </div>

        <div className="create-ring-body">
          <div className="axis-panel axis-panel-padded">
            <p className="axis-kicker">Ring</p>
            <label className="device-field" style={{ marginTop: "0.5rem" }}>
              Name
              <input
                className="axis-input"
                value={ring.displayName}
                placeholder="e.g. Ring 2 — Broad"
                disabled={busy}
                onChange={(event) => patch({ displayName: event.target.value })}
              />
            </label>
            <label className="device-field">
              Description
              <textarea
                className="axis-input"
                rows={2}
                value={ring.description ?? ""}
                disabled={busy}
                onChange={(event) => patch({ description: event.target.value })}
              />
            </label>
            <div>
              <p className="axis-kicker">Start from</p>
              <div className="create-ring-presets">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="axis-btn create-ring-preset"
                    disabled={busy}
                    onClick={() =>
                      setRing((current) => {
                        const next = { ...current };
                        preset.apply(next);
                        return next;
                      })
                    }
                  >
                    <strong>{preset.label}</strong>
                    <span className="muted">{preset.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <WindowsUpdateRingFields ring={ring} disabled={busy} onChange={patch} />
        </div>

        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}

        <div className="axis-modal-actions">
          <button type="button" className="axis-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={busy || !ring.displayName.trim()}
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create ring"}
          </button>
        </div>
      </div>
    </div>
  );
}
