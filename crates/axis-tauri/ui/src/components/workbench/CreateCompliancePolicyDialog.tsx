import { useEffect, useMemo, useState } from "react";
import { createCompliancePolicy } from "../../lib/tauri";
import type { CatalogPolicySummary } from "../../types/inventory";

export type ComplianceCreatePlatform =
  | "windows"
  | "macos"
  | "ios"
  | "androidDeviceOwner"
  | "androidWorkProfile"
  | "androidAosp"
  | "androidDeviceAdmin";

type OsFamily = "windows" | "macos" | "ios" | "android";

const WINDOWS_SETTINGS: Array<{ key: string; label: string }> = [
  { key: "bitLockerEnabled", label: "Require BitLocker" },
  { key: "secureBootEnabled", label: "Require Secure Boot" },
  { key: "codeIntegrityEnabled", label: "Require code integrity" },
  { key: "tpmRequired", label: "Require TPM" },
  { key: "activeFirewallRequired", label: "Require firewall" },
  { key: "defenderEnabled", label: "Require Microsoft Defender" },
  { key: "antivirusRequired", label: "Require antivirus" },
];

const MACOS_SETTINGS: Array<{ key: string; label: string }> = [
  { key: "passwordRequired", label: "Require password" },
  { key: "systemIntegrityProtectionEnabled", label: "Require System Integrity Protection" },
  { key: "firewallEnabled", label: "Require firewall" },
  { key: "storageRequireEncryption", label: "Require FileVault" },
];

const IOS_SETTINGS: Array<{ key: string; label: string }> = [
  { key: "passcodeRequired", label: "Require passcode" },
  { key: "passcodeBlockSimple", label: "Block simple passcodes" },
  { key: "securityBlockJailbrokenDevices", label: "Block jailbroken devices" },
];

const ANDROID_DEVICE_OWNER_SETTINGS: Array<{ key: string; label: string }> = [
  { key: "passwordRequired", label: "Require password" },
  { key: "storageRequireEncryption", label: "Require encryption" },
  { key: "securityRequireSafetyNetAttestationBasicIntegrity", label: "Require Play Integrity (basic)" },
];

const ANDROID_WORK_OR_AOSP_SETTINGS: Array<{ key: string; label: string }> = [
  { key: "passwordRequired", label: "Require password" },
  { key: "storageRequireEncryption", label: "Require encryption" },
];

const ANDROID_DEVICE_ADMIN_SETTINGS: Array<{ key: string; label: string }> = [
  { key: "passwordRequired", label: "Require password" },
  { key: "storageRequireEncryption", label: "Require encryption" },
  { key: "securityBlockJailbrokenDevices", label: "Block rooted devices" },
];

function defaultPlatform(family: OsFamily): ComplianceCreatePlatform {
  if (family === "android") return "androidDeviceOwner";
  return family;
}

function settingsForPlatform(platform: ComplianceCreatePlatform) {
  if (platform === "windows") return WINDOWS_SETTINGS;
  if (platform === "macos") return MACOS_SETTINGS;
  if (platform === "ios") return IOS_SETTINGS;
  if (platform === "androidDeviceOwner") return ANDROID_DEVICE_OWNER_SETTINGS;
  if (platform === "androidDeviceAdmin") return ANDROID_DEVICE_ADMIN_SETTINGS;
  return ANDROID_WORK_OR_AOSP_SETTINGS;
}

export function CreateCompliancePolicyDialog({
  open,
  initialFamily = "windows",
  onClose,
  onCreated,
}: {
  open: boolean;
  initialFamily?: OsFamily;
  onClose: () => void;
  onCreated: (policy: CatalogPolicySummary) => void;
}) {
  const [family, setFamily] = useState<OsFamily>(initialFamily);
  const [platform, setPlatform] = useState<ComplianceCreatePlatform>(() =>
    defaultPlatform(initialFamily),
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [graceHours, setGraceHours] = useState("0");
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFamily(initialFamily);
    setPlatform(defaultPlatform(initialFamily));
    setName("");
    setDescription("");
    setGraceHours("0");
    setSettings({});
    setBusy(false);
    setError(null);
  }, [initialFamily, open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose, open]);

  const settingRows = settingsForPlatform(platform);
  const grace = Number.parseInt(graceHours, 10);
  const canCreate = useMemo(
    () => Boolean(name.trim()) && !busy && Number.isFinite(grace) && grace >= 0,
    [busy, grace, name],
  );

  function changeFamily(next: OsFamily) {
    setFamily(next);
    setPlatform(defaultPlatform(next));
    setSettings({});
  }

  function toggleSetting(key: string) {
    setSettings((current) => ({ ...current, [key]: !current[key] }));
  }

  async function create() {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const selected = Object.fromEntries(
        Object.entries(settings).filter(([, enabled]) => enabled),
      );
      const response = await createCompliancePolicy({
        platform,
        displayName: name.trim(),
        description: description.trim() || undefined,
        gracePeriodHours: grace,
        settings: selected,
      });
      if (!response.policy) {
        setError(response.error ?? "Could not create the compliance policy.");
        return;
      }
      onClose();
      onCreated(response.policy);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the compliance policy.");
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
        className="axis-modal axis-modal-wide create-script-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-compliance-title"
      >
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Graph</p>
            <h2 id="create-compliance-title">New compliance policy</h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              Creates a classic device compliance policy, unassigned. Assign it from the inspector
              after save.
            </p>
          </div>
        </div>

        <div className="create-script-form">
          <div className="create-script-options">
            <label className="device-field">
              Platform
              <select
                className="axis-input"
                value={family}
                disabled={busy}
                onChange={(event) => changeFamily(event.target.value as OsFamily)}
              >
                <option value="windows">Windows</option>
                <option value="macos">macOS</option>
                <option value="ios">iOS / iPadOS</option>
                <option value="android">Android</option>
              </select>
            </label>
            {family === "android" ? (
              <label className="device-field">
                Android type
                <select
                  className="axis-input"
                  value={platform}
                  disabled={busy}
                  onChange={(event) => {
                    setPlatform(event.target.value as ComplianceCreatePlatform);
                    setSettings({});
                  }}
                >
                  <option value="androidDeviceOwner">Enterprise — fully managed</option>
                  <option value="androidWorkProfile">Work profile</option>
                  <option value="androidAosp">AOSP</option>
                  <option value="androidDeviceAdmin">Device administrator (legacy)</option>
                </select>
              </label>
            ) : null}
            <label className="device-field">
              Mark noncompliant after (hours)
              <input
                className="axis-input"
                type="number"
                min={0}
                step={1}
                value={graceHours}
                disabled={busy}
                onChange={(event) => setGraceHours(event.target.value)}
              />
            </label>
          </div>
          <label className="device-field">
            Display name
            <input
              className="axis-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Windows baseline"
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
          <fieldset className="create-compliance-settings" disabled={busy}>
            <legend>Starter settings</legend>
            <p className="muted" style={{ margin: "0 0 0.45rem", fontSize: "0.75rem" }}>
              Optional. Unchecked settings stay not configured. You can refine the policy in Intune
              after create.
            </p>
            <div className="create-compliance-checks">
              {settingRows.map((row) => (
                <label key={row.key} className="app-update-auto">
                  <input
                    type="checkbox"
                    checked={Boolean(settings[row.key])}
                    onChange={() => toggleSetting(row.key)}
                  />
                  {row.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        <div className="axis-modal-actions">
          <button type="button" className="axis-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={!canCreate}
            onClick={() => void create()}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
