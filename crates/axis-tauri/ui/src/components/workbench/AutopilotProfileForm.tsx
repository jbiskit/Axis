import type { ReactNode } from "react";
import type { AutopilotProfileDraft } from "../../lib/autopilotProfile";
import {
  AUTOPILOT_DEVICE_TYPE_OPTIONS,
  AUTOPILOT_JOIN_OPTIONS,
  AUTOPILOT_USAGE_OPTIONS,
  AUTOPILOT_USER_TYPE_OPTIONS,
} from "../../lib/autopilotProfile";
import { AutopilotLocaleField } from "./AutopilotLocaleField";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="device-field">
      {label}
      {hint ? (
        <span className="muted" style={{ display: "block", fontSize: "0.7rem", marginBottom: "0.25rem" }}>
          {hint}
        </span>
      ) : null}
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className="device-field"
      style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function AutopilotProfileForm({
  draft,
  onChange,
  lockedJoinAndMode,
  disabled,
}: {
  draft: AutopilotProfileDraft;
  onChange: (patch: Partial<AutopilotProfileDraft>) => void;
  /**
   * Existing profiles: Join type, Deployment mode, and Device type cannot change.
   */
  lockedJoinAndMode?: boolean;
  disabled?: boolean;
}) {
  const hybrid = draft.joinKind === "hybrid";
  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <section className="stack" style={{ gap: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.9rem" }}>Basics</h3>
        <Field label="Name">
          <input
            className="axis-input"
            value={draft.displayName}
            disabled={disabled}
            onChange={(event) => onChange({ displayName: event.target.value })}
            placeholder="e.g. Corporate laptops — Entra"
          />
        </Field>
        <Field label="Description">
          <input
            className="axis-input"
            value={draft.description}
            disabled={disabled}
            onChange={(event) => onChange({ description: event.target.value })}
            placeholder="Optional"
          />
        </Field>
      </section>

      <section className="stack" style={{ gap: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.9rem" }}>Join & device</h3>
        <Field
          label="Convert all targeted devices to"
          hint={lockedJoinAndMode ? "Fixed after the profile is created." : undefined}
        >
          <select
            className="axis-input"
            value={draft.joinKind}
            disabled={disabled || lockedJoinAndMode}
            onChange={(event) =>
              onChange({ joinKind: event.target.value as AutopilotProfileDraft["joinKind"] })
            }
          >
            {AUTOPILOT_JOIN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        {hybrid ? (
          <Toggle
            label="Skip domain connectivity check"
            checked={draft.hybridAzureAdJoinSkipConnectivityCheck}
            disabled={disabled}
            onChange={(hybridAzureAdJoinSkipConnectivityCheck) =>
              onChange({ hybridAzureAdJoinSkipConnectivityCheck })
            }
          />
        ) : null}
        <Field
          label="Device type"
          hint={lockedJoinAndMode ? "Fixed after the profile is created." : undefined}
        >
          <select
            className="axis-input"
            value={draft.deviceType}
            disabled={disabled || lockedJoinAndMode}
            onChange={(event) => onChange({ deviceType: event.target.value })}
          >
            {AUTOPILOT_DEVICE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Device name template"
          hint="Optional. Generated names are limited to 15 characters (e.g. AX-%SERIAL%)."
        >
          <input
            className="axis-input"
            value={draft.deviceNameTemplate}
            disabled={disabled}
            onChange={(event) => onChange({ deviceNameTemplate: event.target.value })}
            placeholder="Not configured"
          />
        </Field>
      </section>

      <section className="stack" style={{ gap: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.9rem" }}>Out-of-box experience</h3>
        <Field
          label="Deployment mode"
          hint={lockedJoinAndMode ? "Fixed after the profile is created." : undefined}
        >
          <select
            className="axis-input"
            value={draft.deviceUsageType}
            disabled={disabled || lockedJoinAndMode}
            onChange={(event) => onChange({ deviceUsageType: event.target.value })}
          >
            {AUTOPILOT_USAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="User account type">
          <select
            className="axis-input"
            value={draft.userType}
            disabled={disabled}
            onChange={(event) => onChange({ userType: event.target.value })}
          >
            {AUTOPILOT_USER_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Toggle
          label="Hide privacy settings"
          checked={draft.privacySettingsHidden}
          disabled={disabled}
          onChange={(privacySettingsHidden) => onChange({ privacySettingsHidden })}
        />
        <Toggle
          label="Hide EULA"
          checked={draft.eulaHidden}
          disabled={disabled}
          onChange={(eulaHidden) => onChange({ eulaHidden })}
        />
        <Toggle
          label="Skip keyboard selection page"
          checked={draft.keyboardSelectionPageSkipped}
          disabled={disabled}
          onChange={(keyboardSelectionPageSkipped) => onChange({ keyboardSelectionPageSkipped })}
        />
        <Toggle
          label="Hide change account options"
          checked={draft.escapeLinkHidden}
          disabled={disabled}
          onChange={(escapeLinkHidden) => onChange({ escapeLinkHidden })}
        />
      </section>

      <section className="stack" style={{ gap: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.9rem" }}>Pre-provisioning & language</h3>
        <Toggle
          label="Allow pre-provisioned deployment"
          checked={draft.preprovisioningAllowed}
          disabled={disabled}
          onChange={(preprovisioningAllowed) => onChange({ preprovisioningAllowed })}
        />
        <Field label="Language (Region)" hint="Search by name or locale tag (e.g. en-US).">
          <AutopilotLocaleField
            value={draft.locale}
            disabled={disabled}
            onChange={(locale) => onChange({ locale })}
          />
        </Field>
        <Toggle
          label="Convert all targeted devices to Autopilot"
          checked={draft.hardwareHashExtractionEnabled}
          disabled={disabled}
          onChange={(hardwareHashExtractionEnabled) => onChange({ hardwareHashExtractionEnabled })}
        />
      </section>

      <section className="stack" style={{ gap: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.9rem" }}>Enrollment status screen (on profile)</h3>
        <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
          Optional ESP settings embedded on this profile. Standalone ESP configs live under Enrollment
          Status Page.
        </p>
        <Toggle
          label="Configure ESP on this profile"
          checked={draft.configureEsp}
          disabled={disabled}
          onChange={(configureEsp) => onChange({ configureEsp })}
        />
        {draft.configureEsp ? (
          <>
            <Toggle
              label="Show installation progress"
              checked={draft.showInstallationProgress}
              disabled={disabled}
              onChange={(showInstallationProgress) => onChange({ showInstallationProgress })}
            />
            <Toggle
              label="Block device use until required apps install"
              checked={draft.blockDeviceUseUntilRequiredAppsInstall}
              disabled={disabled}
              onChange={(blockDeviceUseUntilRequiredAppsInstall) =>
                onChange({ blockDeviceUseUntilRequiredAppsInstall })
              }
            />
            <Toggle
              label="Allow device use on install failure"
              checked={draft.allowDeviceUseOnInstallFailure}
              disabled={disabled}
              onChange={(allowDeviceUseOnInstallFailure) =>
                onChange({ allowDeviceUseOnInstallFailure })
              }
            />
            <Toggle
              label="Block device setup retry by user"
              checked={draft.blockDeviceSetupRetryByUser}
              disabled={disabled}
              onChange={(blockDeviceSetupRetryByUser) => onChange({ blockDeviceSetupRetryByUser })}
            />
            <Toggle
              label="Allow log collection on install failure"
              checked={draft.allowLogCollectionOnInstallFailure}
              disabled={disabled}
              onChange={(allowLogCollectionOnInstallFailure) =>
                onChange({ allowLogCollectionOnInstallFailure })
              }
            />
            <Field label="Install progress timeout (minutes)">
              <input
                className="axis-input"
                type="number"
                min={1}
                max={720}
                value={draft.installProgressTimeoutInMinutes}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    installProgressTimeoutInMinutes: Number(event.target.value) || 60,
                  })
                }
              />
            </Field>
            <Field label="Custom error message">
              <input
                className="axis-input"
                value={draft.customErrorMessage}
                disabled={disabled}
                onChange={(event) => onChange({ customErrorMessage: event.target.value })}
                placeholder="Optional"
              />
            </Field>
          </>
        ) : null}
      </section>
    </div>
  );
}
