import { useEffect, useState, type ReactNode } from "react";
import { getPreferences, setPreferences, type Preferences } from "../lib/tauri";
import { navigate } from "../lib/route";
import type { Density, Theme } from "../lib/theme";
import { PageHeader, Panel, PanelHead } from "./ui/PageChrome";
import { BooleanToggle } from "./workbench/BooleanToggle";

const LINK_BUTTON = { background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" } as const;

function SettingRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
      <BooleanToggle checked={checked} disabled={disabled} ariaLabel={label} onChange={onChange} />
      <span>
        <strong>{label}</strong>
        {hint ? (
          <span className="muted" style={{ display: "block", fontSize: "0.8125rem", marginTop: "0.2rem" }}>
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function AppSettingsView({
  theme,
  onToggleTheme,
  density,
  onDensityChange,
  appVersion,
  autoCheck,
  checkingForUpdate,
  updateStatus,
  onAutoCheckChange,
  onCheckForUpdate,
}: {
  theme: Theme;
  onToggleTheme: () => void;
  density: Density;
  onDensityChange: (density: Density) => void;
  appVersion: string | null;
  autoCheck: boolean;
  checkingForUpdate: boolean;
  updateStatus: string | null;
  onAutoCheckChange: (value: boolean) => void;
  onCheckForUpdate: () => void;
}) {
  const [preferences, setLocal] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getPreferences()
      .then(setLocal)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function update(patch: Partial<Preferences>) {
    if (!preferences) return;
    const previous = preferences;
    const next = { ...preferences, ...patch };
    setLocal(next);
    setSaving(true);
    setError(null);
    try {
      setLocal(await setPreferences(next));
    } catch (err) {
      setLocal(previous);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <PageHeader title="Settings" description="How Axis behaves on this device. Settings apply to every tenant." />
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}

      <Panel padded>
        <PanelHead title="Appearance" />
        <div className="stack" style={{ marginTop: "0.75rem" }}>
          <SettingRow
            label="Dark mode"
            checked={theme === "dark"}
            onChange={(dark) => {
              if (dark !== (theme === "dark")) onToggleTheme();
            }}
          />
          <SettingRow
            label="Compact view"
            hint="Tighter spacing, shorter rows, and smaller controls so more fits on screen."
            checked={density === "compact"}
            onChange={(compact) => onDensityChange(compact ? "compact" : "comfortable")}
          />
        </div>
      </Panel>

      <Panel padded>
        <PanelHead title="Updates" hint={`Version ${appVersion ?? "…"}`} />
        <div className="stack" style={{ marginTop: "0.75rem" }}>
          <SettingRow
            label="Automatically check for updates"
            hint="Checks once when Axis starts."
            checked={autoCheck}
            onChange={onAutoCheckChange}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <button type="button" className="axis-btn" disabled={checkingForUpdate} onClick={onCheckForUpdate}>
              {checkingForUpdate ? "Checking…" : "Check for updates"}
            </button>
            {updateStatus ? (
              <span className="muted" role="status" style={{ fontSize: "0.8125rem" }}>
                {updateStatus}
              </span>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel padded>
        <PanelHead
          title="Write safety"
          hint={
            <>
              Every create, update, and delete Axis sends to Graph is recorded in{" "}
              <button type="button" className="axis-link" style={LINK_BUTTON} onClick={() => navigate("/intune/activity")}>
                Write activity
              </button>
              . That record is always kept.
            </>
          }
        />
        <div className="stack" style={{ marginTop: "0.75rem" }}>
          <SettingRow
            label="Keep state for undo"
            checked={preferences?.undoStateTracking ?? true}
            disabled={!preferences || saving}
            onChange={(value) => void update({ undoStateTracking: value })}
            hint="Reads each object just before and just after Axis changes it. Undo uses those reads to put the object back, and to stop when someone changed it since. This adds two Graph reads per write, so large bulk changes are slower and more likely to be throttled. When off, writes are still recorded but cannot be undone, including writes made while it was off."
          />
        </div>
      </Panel>
    </div>
  );
}
