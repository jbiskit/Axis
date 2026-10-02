import { BooleanToggle } from "./workbench/BooleanToggle";

export function AppUpdateControls({
  appVersion,
  autoCheck,
  checking,
  status,
  compact = false,
  onAutoCheckChange,
  onCheck,
}: {
  appVersion: string | null;
  autoCheck: boolean;
  checking: boolean;
  status: string | null;
  compact?: boolean;
  onAutoCheckChange: (value: boolean) => void;
  onCheck: () => void;
}) {
  return (
    <div className={`app-update-controls${compact ? " compact" : ""}`}>
      <p className="app-update-version">Version {appVersion ?? "…"}</p>
      <label className="app-update-auto">
        <BooleanToggle
          checked={autoCheck}
          ariaLabel="Automatically check for updates"
          onChange={onAutoCheckChange}
        />
        Automatically check for updates
      </label>
      <button
        type="button"
        className="axis-btn axis-btn-ghost"
        disabled={checking}
        onClick={onCheck}
      >
        {checking ? "Checking…" : "Check for updates"}
      </button>
      {status ? (
        <p className="app-update-status muted" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
