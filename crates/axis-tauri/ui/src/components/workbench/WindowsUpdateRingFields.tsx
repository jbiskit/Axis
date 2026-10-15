import type { WindowsUpdateRing } from "../../lib/tauri";
import { BooleanToggle } from "./BooleanToggle";

export type RingField = keyof WindowsUpdateRing;

/** Graph enum options, labelled the way Intune's portal labels them. */
export const RING_ENUMS: Record<string, { value: string; label: string }[]> = {
  deliveryOptimizationMode: [
    { value: "userDefined", label: "Not configured" },
    { value: "httpOnly", label: "HTTP only" },
    { value: "httpWithPeeringNat", label: "HTTP with peering (NAT)" },
    { value: "httpWithPeeringPrivateGroup", label: "HTTP with peering (private group)" },
    { value: "httpWithInternetPeering", label: "HTTP with internet peering" },
    { value: "simpleDownload", label: "Simple download" },
    { value: "bypassMode", label: "Bypass" },
  ],
  automaticUpdateMode: [
    { value: "userDefined", label: "Not configured" },
    { value: "notifyDownload", label: "Notify for download and notify for install" },
    { value: "autoInstallAtMaintenanceTime", label: "Auto install at maintenance time" },
    {
      value: "autoInstallAndRebootAtMaintenanceTime",
      label: "Auto install and reboot at maintenance time",
    },
    {
      value: "autoInstallAndRebootAtScheduledTime",
      label: "Auto install and reboot at scheduled time",
    },
    {
      value: "autoInstallAndRebootWithoutEndUserControl",
      label: "Auto install and reboot without end-user control",
    },
    { value: "windowsDefault", label: "Windows default" },
  ],
  businessReadyUpdatesOnly: [
    { value: "userDefined", label: "Not configured" },
    { value: "windowsInsiderBuildRelease", label: "Windows Insider — Release Preview" },
    { value: "windowsInsiderBuildSlow", label: "Beta Channel" },
    { value: "windowsInsiderBuildFast", label: "Dev Channel" },
  ],
  autoRestartNotificationDismissal: [
    { value: "notConfigured", label: "Not configured" },
    { value: "automatic", label: "Auto-dismiss" },
    { value: "user", label: "User dismisses" },
  ],
  userPauseAccess: [
    { value: "notConfigured", label: "Not configured" },
    { value: "enabled", label: "Enabled" },
    { value: "disabled", label: "Disabled" },
  ],
  userWindowsUpdateScanAccess: [
    { value: "notConfigured", label: "Not configured" },
    { value: "enabled", label: "Enabled" },
    { value: "disabled", label: "Disabled" },
  ],
  updateNotificationLevel: [
    { value: "notConfigured", label: "Not configured" },
    { value: "defaultNotifications", label: "Default notifications" },
    { value: "restartWarningsOnly", label: "Restart warnings only" },
    { value: "disableAllNotifications", label: "Disable all notifications" },
  ],
  scheduledInstallDay: [
    { value: "everyday", label: "Every day" },
    { value: "sunday", label: "Sunday" },
    { value: "monday", label: "Monday" },
    { value: "tuesday", label: "Tuesday" },
    { value: "wednesday", label: "Wednesday" },
    { value: "thursday", label: "Thursday" },
    { value: "friday", label: "Friday" },
    { value: "saturday", label: "Saturday" },
  ],
  // `updateWeeks` is a comma-separated list of member names on the wire, e.g.
  // "everyWeek,firstWeek". The portal renders it as a multi-select.
  updateWeeks: [
    { value: "everyWeek", label: "Every week" },
    { value: "firstWeek", label: "First week of the month" },
    { value: "secondWeek", label: "Second week of the month" },
    { value: "thirdWeek", label: "Third week of the month" },
    { value: "fourthWeek", label: "Fourth week of the month" },
  ],
};

/**
 * `scheduledInstallTime` and the active-hours window are whole-hour slots, not
 * free times. The portal offers 12 AM through 11 PM; Graph stores them as
 * `HH:00:00.0000000`.
 */
export const SCHEDULED_INSTALL_HOURS = Array.from({ length: 24 }, (_, hour) => {
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return {
    value: `${String(hour).padStart(2, "0")}:00:00.0000000`,
    label: `${display} ${suffix}`,
  };
});

/** Normalise a stored time to the matching hour slot, so the select matches. */
export function scheduledInstallHourValue(value?: string | null): string {
  const hour = Number.parseInt((value ?? "").split(":")[0] ?? "", 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "";
  return `${String(hour).padStart(2, "0")}:00:00.0000000`;
}

/** `0001-01-01` is Graph's "never"; show it as unset rather than a date. */
export function isUnsetRingDate(value?: string | null): boolean {
  return !value || value.startsWith("0001-01-01");
}

export function formatRingDate(value?: string | null): string {
  if (isUnsetRingDate(value)) return "—";
  const date = new Date(value!);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

/**
 * The ring field controls, shared by the create dialog and the inspector editor
 * so the two cannot drift apart.
 */
export function WindowsUpdateRingFields({
  ring,
  disabled,
  onChange,
}: {
  ring: WindowsUpdateRing;
  disabled: boolean;
  onChange: (patch: Partial<WindowsUpdateRing>) => void;
}) {
  const mode = ring.automaticUpdateMode ?? "";
  // Pre-release is one setting in the portal: `userDefined` means off, any
  // Insider channel means on.
  const prereleaseEnabled = Boolean(
    ring.businessReadyUpdatesOnly && ring.businessReadyUpdatesOnly !== "userDefined",
  );
  // `updateWeeks` arrives as a comma-separated list of member names.
  const selectedWeeks = (ring.updateWeeks ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  function toggleWeek(value: string) {
    const next = selectedWeeks.includes(value)
      ? selectedWeeks.filter((week) => week !== value)
      : [...selectedWeeks, value];
    onChange({ updateWeeks: next.length ? next.join(",") : null });
  }

  /**
   * Deadlines are one setting in the portal: a single Allow / Not configured
   * toggle that governs all four values together. Graph models "not configured"
   * as `null` on every deadline property, so the toggle sets or clears them as
   * a group.
   */
  const deadlinesEnabled = ring.deadlineForQualityUpdatesInDays != null;

  function setDeadlines(enabled: boolean) {
    onChange(
      enabled
        ? {
            deadlineForQualityUpdatesInDays: 7,
            deadlineForFeatureUpdatesInDays: 7,
            deadlineGracePeriodInDays: 1,
            postponeRebootUntilAfterDeadline: false,
          }
        : {
            deadlineForQualityUpdatesInDays: null,
            deadlineForFeatureUpdatesInDays: null,
            deadlineGracePeriodInDays: null,
            postponeRebootUntilAfterDeadline: null,
          },
    );
  }

  const number = (label: string, field: RingField, max = 30, min = 0, hint?: string) => {
    const value = ring[field] as number | null | undefined;
    const problem =
      value != null && (value < min || value > max)
        ? `${label.replace(/\s*\(.*\)$/, "")} must be from ${min} to ${max}.`
        : null;
    return (
      <label className="device-field">
        {label}
        <input
          className={`axis-input${problem ? " is-invalid" : ""}`}
          type="number"
          min={min}
          max={max}
          value={value ?? ""}
          disabled={disabled}
          aria-invalid={problem ? true : undefined}
          onChange={(event) =>
            onChange({
              [field]: event.target.value === "" ? null : Number(event.target.value),
            } as Partial<WindowsUpdateRing>)
          }
        />
        {problem ? (
          <span className="setting-field-error" role="alert">
            {problem}
          </span>
        ) : hint ? (
          <span className="muted" style={{ fontSize: "var(--axis-text-2xs)" }}>
            {hint}
          </span>
        ) : null}
      </label>
    );
  };

  /**
   * A portal Allow/Block or Yes/No pair, rendered as a pill slider whose label
   * reflects the current value. `invert` covers the properties whose Graph name
   * is the negative of the portal's label — "Windows drivers: Allow" is
   * `driversExcluded: false`, and "Auto reboot before deadline: Yes" is
   * `postponeRebootUntilAfterDeadline: false`.
   */
  const allowBlock = (
    label: string,
    field: RingField,
    onLabel: string,
    offLabel: string,
    invert = false,
  ) => {
    const raw = Boolean(ring[field]);
    const on = invert ? !raw : raw;
    return (
      <div className="device-field">
        <span>{label}</span>
        <div className="wufb-toggle-row">
          <BooleanToggle
            checked={on}
            ariaLabel={label}
            disabled={disabled}
            onChange={(next) =>
              onChange({ [field]: invert ? !next : next } as Partial<WindowsUpdateRing>)
            }
          />
          <span>{on ? onLabel : offLabel}</span>
        </div>
      </div>
    );
  };

  /**
   * An Enable/Disable pair backed by an `enablement` enum, where `notConfigured`
   * is the unset state. The portal only offers Enable and Disable.
   */
  const enablement = (label: string, field: RingField) => {
    const value = (ring[field] as string | null) ?? "notConfigured";
    const on = value === "enabled";
    return (
      <div className="device-field">
        <span>{label}</span>
        <div className="wufb-toggle-row">
          <BooleanToggle
            checked={on}
            ariaLabel={label}
            disabled={disabled}
            onChange={(next) =>
              onChange({ [field]: next ? "enabled" : "disabled" } as Partial<WindowsUpdateRing>)
            }
          />
          <span>{on ? "Enable" : "Disable"}</span>
        </div>
      </div>
    );
  };

  const select = (label: string, field: RingField) => (
    <label className="device-field">
      {label}
      <select
        className="axis-input"
        value={(ring[field] as string | null) ?? ""}
        disabled={disabled}
        onChange={(event) =>
          onChange({ [field]: event.target.value || null } as Partial<WindowsUpdateRing>)
        }
      >
        {(RING_ENUMS[field] ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <div className="axis-panel axis-panel-padded">
        <p className="axis-kicker">Update settings</p>
        <div className="wufb-grid">
          {allowBlock("Microsoft product updates", "microsoftUpdateServiceAllowed", "Allow", "Block")}
          {allowBlock("Windows drivers", "driversExcluded", "Allow", "Block", true)}
          {allowBlock("Upgrade Windows 10 to Windows 11", "allowWindows11Upgrade", "Yes", "No")}
          {number(
            "Set feature update uninstall period (2–60 days)",
            "featureUpdatesRollbackWindowInDays",
            60,
            2,
          )}
        </div>

        {/* Deferrals are a sequence: quality first, then feature. */}
        <div className="wufb-children">
          <p className="wufb-children-label">Deferrals</p>
          <div className="wufb-grid">
            {number(
              "Quality update deferral period (days)",
              "qualityUpdatesDeferralPeriodInDays",
              30,
              0,
            )}
            {number(
              "Feature update deferral period (days)",
              "featureUpdatesDeferralPeriodInDays",
              30,
              0,
            )}
          </div>
        </div>

        {/* The portal models pre-release as one setting: a toggle plus a channel.
            `userDefined` is the "off" value. */}
        <div className="wufb-children">
          <p className="wufb-children-label">Pre-release builds</p>
          <div className="wufb-grid">
            <label
              className="device-field"
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}
            >
              <BooleanToggle
                checked={prereleaseEnabled}
                ariaLabel="Enable pre-release builds"
                disabled={disabled}
                onChange={(enabled) =>
                  onChange({
                    businessReadyUpdatesOnly: enabled ? "windowsInsiderBuildRelease" : "userDefined",
                  })
                }
              />
              <span>Enable pre-release builds</span>
            </label>
            {prereleaseEnabled ? (
              <label className="device-field">
                Select pre-release channel
                <select
                  className="axis-input"
                  value={ring.businessReadyUpdatesOnly ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({ businessReadyUpdatesOnly: event.target.value || null })
                  }
                >
                  {(RING_ENUMS.businessReadyUpdatesOnly ?? [])
                    .filter((option) => option.value !== "userDefined")
                    .map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
          </div>
        </div>
      </div>

      <div className="axis-panel axis-panel-padded">
        <p className="axis-kicker">User experience settings</p>
        <div className="wufb-grid">
          {select("Automatic update behavior", "automaticUpdateMode")}
        </div>

        {/* The schedule fields depend on the mode: a scheduled install takes a
            day/time, a maintenance install takes an active-hours window, and
            every other mode takes neither. They are indented under the
            behaviour select to read as its children. */}
        {mode === "autoInstallAndRebootAtScheduledTime" ? (
          <div className="wufb-children">
            <p className="wufb-children-label">Scheduled install</p>
            <div className="wufb-grid">
              <div className="device-field">
                Frequency
                <div className="wufb-weeks">
                  {(RING_ENUMS.updateWeeks ?? []).map((option) => {
                    const selected = selectedWeeks.includes(option.value);
                    return (
                      <label key={option.value} className="wufb-week">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={disabled}
                          onChange={() => toggleWeek(option.value)}
                        />
                        <span>{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              {select("Day", "scheduledInstallDay")}
              <label className="device-field">
                Time
                <select
                  className="axis-input"
                  value={scheduledInstallHourValue(ring.scheduledInstallTime)}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({ scheduledInstallTime: event.target.value || null })
                  }
                >
                  <option value="">Not configured</option>
                  {SCHEDULED_INSTALL_HOURS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : null}

        {mode === "autoInstallAtMaintenanceTime" ||
        mode === "autoInstallAndRebootAtMaintenanceTime" ? (
          <div className="wufb-children">
            <p className="wufb-children-label">Active hours</p>
            <div className="wufb-grid">
              <label className="device-field">
                Active hours start
                <select
                  className="axis-input"
                  value={scheduledInstallHourValue(ring.activeHoursStart)}
                  disabled={disabled}
                  onChange={(event) => onChange({ activeHoursStart: event.target.value || null })}
                >
                  <option value="">Not configured</option>
                  {SCHEDULED_INSTALL_HOURS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="device-field">
                Active hours end
                <select
                  className="axis-input"
                  value={scheduledInstallHourValue(ring.activeHoursEnd)}
                  disabled={disabled}
                  onChange={(event) => onChange({ activeHoursEnd: event.target.value || null })}
                >
                  <option value="">Not configured</option>
                  {SCHEDULED_INSTALL_HOURS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : null}

        <div className="wufb-grid">
          {enablement("Option to pause Windows updates", "userPauseAccess")}
          {enablement("Option to check for Windows updates", "userWindowsUpdateScanAccess")}
          {select("Change notification update level", "updateNotificationLevel")}
        </div>
      </div>

      <div className="axis-panel axis-panel-padded">
        <p className="axis-kicker">Deadlines and restart</p>
        <label
          className="device-field"
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}
        >
          <BooleanToggle
            checked={deadlinesEnabled}
            ariaLabel="Use deadline settings"
            disabled={disabled}
            onChange={setDeadlines}
          />
          <span>Use deadline settings</span>
        </label>

        {deadlinesEnabled ? (
          <div className="wufb-children">
            <p className="wufb-children-label">Deadlines</p>
            <div className="wufb-grid">
              {number("Feature update deadline (days)", "deadlineForFeatureUpdatesInDays", 30)}
              {number("Quality update deadline (days)", "deadlineForQualityUpdatesInDays", 30)}
              {number("Deadline grace period (days)", "deadlineGracePeriodInDays", 7)}
            </div>
            <div className="stack" style={{ gap: "0.5rem", marginTop: "0.6rem" }}>
              {allowBlock(
                "Auto reboot before deadline",
                "postponeRebootUntilAfterDeadline",
                "Yes",
                "No",
                true,
              )}
            </div>
          </div>
        ) : (
          <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "var(--axis-text-2xs)" }}>
            No deadlines. Devices install updates without a forced restart window.
          </p>
        )}
      </div>
    </>
  );
}
