import { useEffect, useId, useState } from "react";
import {
  fetchFeatureUpdateCatalog,
  fetchFeatureUpdateEligibility,
  type FeatureUpdateCatalogItem,
  type FeatureUpdateEligibility,
  type FeatureUpdateProfile,
} from "../../lib/tauri";
import { BooleanToggle } from "./BooleanToggle";

/** Versions Intune can deploy. Intune rejects any other `featureUpdateVersion`. */
export type FeatureUpdateCatalog = {
  items: FeatureUpdateCatalogItem[];
  loading: boolean;
  error: string | null;
};

export function useFeatureUpdateCatalog(): FeatureUpdateCatalog {
  const [catalog, setCatalog] = useState<FeatureUpdateCatalog>({ items: [], loading: true, error: null });
  useEffect(() => {
    let cancelled = false;
    void fetchFeatureUpdateCatalog()
      .then((response) => {
        if (!cancelled) setCatalog({ items: response.items, loading: false, error: response.error });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCatalog({ items: [], loading: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return catalog;
}

type RolloutMode = "asSoonAsPossible" | "onDate" | "gradually";

export function rolloutMode(profile: FeatureUpdateProfile): RolloutMode {
  // Either field marks a gradual rollout, so clearing one input does not change mode.
  if (profile.offerIntervalInDays != null || !isUnsetDate(profile.offerEndDateTimeInUtc)) return "gradually";
  if (!isUnsetDate(profile.offerStartDateTimeInUtc)) return "onDate";
  return "asSoonAsPossible";
}

/** `0001-01-01` is Graph's "never"; show it as unset rather than a date. */
function isUnsetDate(value?: string | null): boolean {
  return !value || value.startsWith("0001-01-01");
}

export function fmtDate(value?: string | null): string {
  if (isUnsetDate(value)) return "—";
  const date = new Date(value!);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

/** `2026-10-10T00:00:00Z` → `2026-10-10`, for a date input. */
function dateInputValue(value?: string | null): string {
  if (isUnsetDate(value)) return "";
  return value!.slice(0, 10);
}

/** `2026-10-10` → `2026-10-10T00:00:00.000Z`, the form the portal sends. */
function toGraphDate(value: string): string | null {
  if (!value) return null;
  return `${value}T00:00:00.000Z`;
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(input: string, days: number): string {
  const date = new Date(`${input}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/** A blank deployment, offered as soon as possible and required. */
export function draftFeatureUpdateProfile(): FeatureUpdateProfile {
  return {
    id: "",
    displayName: "",
    description: "",
    featureUpdateVersion: null,
    isAssigned: false,
    installFeatureUpdatesOptional: false,
    installLatestWindows10OnWindows11IneligibleDevice: false,
    offerStartDateTimeInUtc: null,
    offerEndDateTimeInUtc: null,
    offerIntervalInDays: null,
  };
}

/**
 * Why `profile` cannot be sent, or `null` when it can. `isNew` also rejects a
 * first date in the past, which only makes sense for an existing rollout.
 */
export function featureUpdateProblem(
  profile: FeatureUpdateProfile,
  isNew: boolean,
  catalog: FeatureUpdateCatalog,
): string | null {
  if (!profile.displayName.trim()) return "Enter a name.";
  if (!profile.featureUpdateVersion) return "Choose the feature update to deploy.";
  if (
    !catalog.loading &&
    catalog.items.length > 0 &&
    !catalog.items.some((item) => item.version === profile.featureUpdateVersion)
  ) {
    return "Intune no longer offers that feature update. Choose one from the list.";
  }
  const mode = rolloutMode(profile);
  if (mode === "asSoonAsPossible") return null;
  const start = dateInputValue(profile.offerStartDateTimeInUtc);
  if (!start) return "Choose the first date the update is available.";
  if (isNew && start < todayInput()) return "The first available date cannot be in the past.";
  if (mode === "onDate") return null;
  const end = dateInputValue(profile.offerEndDateTimeInUtc);
  if (!end) return "Choose the date the final group gets the update.";
  if (end <= start) return "The final group date must be after the first group date.";
  const interval = profile.offerIntervalInDays ?? 0;
  if (!Number.isInteger(interval) || interval < 1) return "Days between groups must be 1 or more.";
  if (interval > daysBetween(start, end)) return "Days between groups cannot be longer than the whole rollout.";
  return null;
}

/** Licence check for gradual rollout and optional updates, read once per mount. */
export function useFeatureUpdateEligibility() {
  const [eligibility, setEligibility] = useState<FeatureUpdateEligibility | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchFeatureUpdateEligibility()
      .then((response) => {
        if (cancelled) return;
        setEligibility(response.eligibility);
        setError(response.error);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setEligibility(null);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { eligibility, error };
}

/**
 * Deployment settings, offer, and rollout fields, shared by the editor and the
 * create dialog. `saved` is the deployment as Graph has it (null when creating):
 * an option it already uses stays available even when the tenant is unlicensed.
 */
export function FeatureUpdateProfileFields({
  profile,
  saved,
  catalog,
  disabled,
  onChange,
}: {
  profile: FeatureUpdateProfile;
  saved: FeatureUpdateProfile | null;
  catalog: FeatureUpdateCatalog;
  disabled: boolean;
  onChange: (next: Partial<FeatureUpdateProfile>) => void;
}) {
  const radioName = useId();
  const { eligibility, error: eligibilityError } = useFeatureUpdateEligibility();
  const mode = rolloutMode(profile);
  // Known not licensed: the options stay visible but cannot be turned on. A
  // deployment that already uses one can keep it or move off it.
  const unlicensed = eligibility != null && !eligibility.eligible;
  const gradualLocked = unlicensed && (saved == null || rolloutMode(saved) !== "gradually");
  const optionalLocked = unlicensed && !saved?.installFeatureUpdatesOptional;
  const lockedHint = "Needs a Windows Enterprise, Education, VDA, or Business Premium licence. See the note above.";
  const start = dateInputValue(profile.offerStartDateTimeInUtc);

  function setMode(next: RolloutMode) {
    const firstDate = start || todayInput();
    if (next === "asSoonAsPossible") {
      onChange({ offerStartDateTimeInUtc: null, offerEndDateTimeInUtc: null, offerIntervalInDays: null });
    } else if (next === "onDate") {
      onChange({ offerStartDateTimeInUtc: toGraphDate(firstDate), offerEndDateTimeInUtc: null, offerIntervalInDays: null });
    } else {
      onChange({
        offerStartDateTimeInUtc: toGraphDate(firstDate),
        offerEndDateTimeInUtc:
          profile.offerEndDateTimeInUtc && !isUnsetDate(profile.offerEndDateTimeInUtc)
            ? profile.offerEndDateTimeInUtc
            : toGraphDate(addDays(firstDate, 7)),
        offerIntervalInDays: profile.offerIntervalInDays ?? 1,
      });
    }
  }

  return (
    <>
      <div className="axis-panel axis-panel-padded">
        <p className="axis-kicker">Deployment settings</p>
        <label className="device-field" style={{ marginTop: "0.5rem" }}>
          Name
          <input
            className="axis-input"
            value={profile.displayName}
            disabled={disabled}
            onChange={(event) => onChange({ displayName: event.target.value })}
          />
        </label>
        <label className="device-field">
          Description
          <textarea
            className="axis-input"
            rows={2}
            value={profile.description ?? ""}
            disabled={disabled}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </label>
        <label className="device-field">
          Feature update to deploy
          <select
            className="axis-input"
            value={profile.featureUpdateVersion ?? ""}
            disabled={disabled || catalog.loading}
            onChange={(event) => onChange({ featureUpdateVersion: event.target.value || null })}
          >
            <option value="">{catalog.loading ? "Loading versions…" : "Choose a version"}</option>
            {catalog.items.map((item) => (
              <option key={item.version} value={item.version}>
                {item.displayName}
                {isUnsetDate(item.endOfSupportDate) ? "" : ` · supported until ${dateInputValue(item.endOfSupportDate)}`}
              </option>
            ))}
            {/* Keep a saved version Intune has since retired visible, so the field is not blank. */}
            {profile.featureUpdateVersion &&
            !catalog.loading &&
            !catalog.items.some((item) => item.version === profile.featureUpdateVersion) ? (
              <option value={profile.featureUpdateVersion}>{profile.featureUpdateVersion} (not in the catalog)</option>
            ) : null}
          </select>
        </label>
        {catalog.error ? (
          <p className="setting-field-error" style={{ margin: 0 }}>
            Could not load the Windows versions Intune offers. {catalog.error}
          </p>
        ) : null}
        {saved ? (
          <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-2xs)" }}>
            End of support {fmtDate(saved.endOfSupportDate)} · {saved.isAssigned ? "Assigned" : "Not assigned"}
          </p>
        ) : null}
      </div>

      <div className="axis-panel axis-panel-padded">
        <p className="axis-kicker">Offer to users</p>
        {/* Optional updates and gradual rollout need a Windows subscription. */}
        {unlicensed ? (
          <div className="axis-alert axis-alert-warning" style={{ marginTop: "0.5rem" }}>
            <p style={{ margin: "0 0 0.35rem" }}>
              <strong>This tenant is not licensed for optional updates or gradual rollout.</strong>
            </p>
            <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-2xs)" }}>
              No active subscription includes the Windows Update for Business deployment service.
              Required updates on a set date or as soon as possible still work. One of these is
              needed:
            </p>
            <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", fontSize: "var(--axis-text-2xs)" }}>
              <li>Windows 10/11 Enterprise E3 or E5 (included in Microsoft 365 F3, E3, or E5)</li>
              <li>Windows 10/11 Education A3 or A5 (included in Microsoft 365 A3 or A5)</li>
              <li>Windows Virtual Desktop Access E3 or E5</li>
              <li>Microsoft 365 Business Premium</li>
            </ul>
          </div>
        ) : eligibility?.eligible ? (
          <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "var(--axis-text-2xs)" }}>
            Optional updates and gradual rollout are licensed through {eligibility.skus.join(", ")}.
          </p>
        ) : eligibilityError ? (
          <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "var(--axis-text-2xs)" }}>
            Axis could not read whether this tenant is licensed for optional updates and gradual
            rollout, so Intune will decide when you save. ({eligibilityError})
          </p>
        ) : null}

        <div className="wufb-toggle-row" style={{ marginTop: "0.5rem" }}>
          <BooleanToggle
            checked={Boolean(profile.installFeatureUpdatesOptional)}
            ariaLabel="Make available as an optional update"
            disabled={disabled || (optionalLocked && !profile.installFeatureUpdatesOptional)}
            onChange={(optional) => onChange({ installFeatureUpdatesOptional: optional })}
          />
          <span title={optionalLocked ? lockedHint : undefined}>
            Make available as an optional update
            {optionalLocked ? <span className="muted"> · needs licence</span> : null}
          </span>
        </div>

        <div className="wufb-toggle-row" style={{ marginTop: "0.5rem" }}>
          <BooleanToggle
            checked={Boolean(profile.installLatestWindows10OnWindows11IneligibleDevice)}
            ariaLabel="Offer the latest Windows 10 update to Windows 11 ineligible devices"
            disabled={disabled}
            onChange={(installLatestWindows10OnWindows11IneligibleDevice) =>
              onChange({ installLatestWindows10OnWindows11IneligibleDevice })
            }
          />
          <span>Offer the latest Windows 10 update to Windows 11 ineligible devices</span>
        </div>
      </div>

      <div className="axis-panel axis-panel-padded">
        <p className="axis-kicker">Rollout options</p>
        <div className="stack" style={{ gap: "0.4rem", marginTop: "0.5rem" }}>
          {(
            [
              ["asSoonAsPossible", "Make update available as soon as possible"],
              ["onDate", "Make update available on a specific date"],
              ["gradually", "Make update available gradually"],
            ] as const
          ).map(([value, label]) => {
            const locked = value === "gradually" && gradualLocked;
            return (
              <label key={value} className="wufb-week" title={locked ? lockedHint : undefined}>
                <input
                  type="radio"
                  name={radioName}
                  checked={mode === value}
                  disabled={disabled || (locked && mode !== value)}
                  onChange={() => setMode(value)}
                />
                <span className={locked ? "muted" : undefined}>
                  {label}
                  {locked ? " · needs licence" : ""}
                </span>
              </label>
            );
          })}
        </div>

        {mode !== "asSoonAsPossible" ? (
          <div className="wufb-children">
            <p className="wufb-children-label">Schedule</p>
            <div className="wufb-grid">
              <label className="device-field">
                {mode === "gradually" ? "First group availability" : "Available from"}
                <input
                  className="axis-input"
                  type="date"
                  value={start}
                  disabled={disabled}
                  onChange={(event) => onChange({ offerStartDateTimeInUtc: toGraphDate(event.target.value) })}
                />
              </label>
              {mode === "gradually" ? (
                <>
                  <label className="device-field">
                    Final group availability
                    <input
                      className="axis-input"
                      type="date"
                      min={start || undefined}
                      value={dateInputValue(profile.offerEndDateTimeInUtc)}
                      disabled={disabled}
                      onChange={(event) => onChange({ offerEndDateTimeInUtc: toGraphDate(event.target.value) })}
                    />
                  </label>
                  <label className="device-field">
                    Days between groups
                    <input
                      className={`axis-input${
                        profile.offerIntervalInDays != null && profile.offerIntervalInDays < 1 ? " is-invalid" : ""
                      }`}
                      type="number"
                      min={1}
                      value={profile.offerIntervalInDays ?? ""}
                      disabled={disabled}
                      onChange={(event) =>
                        onChange({
                          offerIntervalInDays: event.target.value === "" ? null : Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
