import { useEffect, useMemo, useState } from "react";
import { createEnrollmentPlatformRestriction } from "../../lib/tauri";
import type { CatalogPolicySummary } from "../../types/inventory";

type PlatformType = "windows" | "ios" | "android" | "androidForWork" | "mac";

/**
 * Create currently ships Windows only. Other Graph `platformType` values are listed
 * as TBA so we can extend the dialog without inventing a second create path later.
 */
const PLATFORM_OPTIONS: Array<{ value: PlatformType; label: string; tba?: boolean }> = [
  { value: "windows", label: "Windows" },
  // TBA: iOS / iPadOS single-platform create
  { value: "ios", label: "iOS / iPadOS (TBA)", tba: true },
  // TBA: Android device administrator single-platform create
  { value: "android", label: "Android (device administrator) (TBA)", tba: true },
  // TBA: Android Enterprise (androidForWork) single-platform create
  { value: "androidForWork", label: "Android Enterprise (TBA)", tba: true },
  // TBA: macOS (Graph platformType `mac`) single-platform create
  { value: "mac", label: "macOS (TBA)", tba: true },
];

export function CreateEnrollmentRestrictionDialog({
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
  const [platformType, setPlatformType] = useState<PlatformType>("windows");
  const [platformBlocked, setPlatformBlocked] = useState(false);
  const [personalBlocked, setPersonalBlocked] = useState(true);
  const [osMinimumVersion, setOsMinimumVersion] = useState("");
  const [osMaximumVersion, setOsMaximumVersion] = useState("");
  const [blockedManufacturers, setBlockedManufacturers] = useState("");
  const [blockedSkus, setBlockedSkus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setPlatformType("windows");
    setPlatformBlocked(false);
    setPersonalBlocked(true);
    setOsMinimumVersion("");
    setOsMaximumVersion("");
    setBlockedManufacturers("");
    setBlockedSkus("");
    setBusy(false);
    setError(null);
  }, [open]);

  const canSave = useMemo(() => !busy && name.trim().length > 0, [busy, name]);

  function parseCsv(value: string): string[] {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  async function create() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const response = await createEnrollmentPlatformRestriction({
        displayName: name.trim(),
        description: description.trim() || null,
        platformType,
        platformRestriction: {
          platformBlocked,
          personalDeviceEnrollmentBlocked: personalBlocked,
          osMinimumVersion: osMinimumVersion.trim() || null,
          osMaximumVersion: osMaximumVersion.trim() || null,
          blockedManufacturers: parseCsv(blockedManufacturers),
          blockedSkus: parseCsv(blockedSkus),
        },
      });
      if (!response.policy) {
        setError(response.error ?? "Could not create the enrollment restriction.");
        return;
      }
      onClose();
      onCreated(response.policy);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the enrollment restriction.");
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
      <div className="axis-modal axis-modal-wide create-script-dialog" role="dialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Graph</p>
            <h2>New platform restriction</h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              Creates a Windows single-platform enrollment restriction. Other platforms are TBA.
              Assign it from the inspector after save.
            </p>
          </div>
        </div>
        <div className="create-script-form">
          <div className="create-script-options">
            <label className="device-field">
              Platform
              <select
                className="axis-input"
                value={platformType}
                disabled={busy}
                onChange={(event) => setPlatformType(event.target.value as PlatformType)}
              >
                {PLATFORM_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.tba}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="device-field">
            Display name
            <input
              className="axis-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Restrict Personal Device Enrolment (Windows)"
              disabled={busy}
              autoFocus
            />
          </label>
          <label className="device-field">
            Description (optional)
            <input
              className="axis-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy}
            />
          </label>
          <div className="create-script-options">
            <label className="app-update-auto">
              <input
                type="checkbox"
                checked={platformBlocked}
                disabled={busy}
                onChange={(event) => {
                  const blocked = event.target.checked;
                  setPlatformBlocked(blocked);
                  if (blocked) setPersonalBlocked(false);
                }}
              />
              Block MDM enrollment
            </label>
            <label className="app-update-auto">
              <input
                type="checkbox"
                checked={personalBlocked}
                disabled={busy || platformBlocked}
                onChange={(event) => setPersonalBlocked(event.target.checked)}
              />
              Block personally owned devices
            </label>
          </div>
          <div className="create-script-options">
            <label className="device-field">
              Min OS (optional)
              <input
                className="axis-input"
                value={osMinimumVersion}
                disabled={busy || platformBlocked}
                onChange={(event) => setOsMinimumVersion(event.target.value)}
              />
            </label>
            <label className="device-field">
              Max OS (optional)
              <input
                className="axis-input"
                value={osMaximumVersion}
                disabled={busy || platformBlocked}
                onChange={(event) => setOsMaximumVersion(event.target.value)}
              />
            </label>
          </div>
          <div className="create-script-options">
            <label className="device-field">
              Blocked manufacturers (optional)
              <input
                className="axis-input"
                value={blockedManufacturers}
                disabled={busy || platformBlocked}
                placeholder="comma-separated"
                onChange={(event) => setBlockedManufacturers(event.target.value)}
              />
            </label>
            <label className="device-field">
              Blocked SKUs (optional)
              <input
                className="axis-input"
                value={blockedSkus}
                disabled={busy || platformBlocked}
                placeholder="comma-separated"
                onChange={(event) => setBlockedSkus(event.target.value)}
              />
            </label>
          </div>
        </div>
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        <div className="axis-modal-actions">
          <button type="button" className="axis-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="axis-btn axis-btn-primary" disabled={!canSave} onClick={() => void create()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
