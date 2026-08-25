import type { UpdateCheck, UpdateDownloadProgress } from "../types/updater";
import type { UpdaterPhase } from "../hooks/useUpdater";

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function progressLabel(progress: UpdateDownloadProgress | null) {
  if (!progress) return "Starting download…";
  if (progress.total && progress.total > 0) {
    const pct = Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
    return `${pct}% · ${formatBytes(progress.downloaded)} of ${formatBytes(progress.total)}`;
  }
  return `Downloaded ${formatBytes(progress.downloaded)}`;
}

function progressPercent(progress: UpdateDownloadProgress | null) {
  if (!progress?.total || progress.total <= 0) return null;
  return Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
}

export function UpdateDialog({
  phase,
  update,
  progress,
  error,
  busy,
  onLater,
  onDownload,
  onRelaunch,
}: {
  phase: UpdaterPhase;
  update: UpdateCheck | null;
  progress: UpdateDownloadProgress | null;
  error: string | null;
  busy: boolean;
  onLater: () => void;
  onDownload: () => void;
  onRelaunch: () => void;
}) {
  if (phase === "idle" || !update?.version) return null;

  const version = update.version;
  const current = update.currentVersion;
  const notes = update.notes?.trim() ?? "";
  const percent = progressPercent(progress);
  const downloading = phase === "downloading";
  const ready = phase === "ready";

  const title = downloading
    ? "Downloading update"
    : ready
      ? "Restart to update"
      : "Update available";

  const message = downloading
    ? `Downloading Axis ${version}…`
    : ready
      ? `Axis ${version} is ready. Axis will quit and reopen on the new version. Your sign-in stays in Windows Credential Manager.`
      : `Axis ${version} is available. You're running ${current}.`;

  return (
    <div className="axis-modal-backdrop">
      <div className="axis-modal" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <h2 id="update-title">{title}</h2>
        <p className="muted">{message}</p>
        {notes && !downloading ? <pre className="update-notes">{notes}</pre> : null}
        {downloading ? (
          <div className="update-progress" aria-live="polite">
            <div className="dist-bar-track">
              <div
                className="dist-bar-fill"
                style={{ width: `${percent ?? 15}%` }}
              />
            </div>
            <p className="muted update-progress-label">{progressLabel(progress)}</p>
          </div>
        ) : null}
        {error ? <p className="update-error">{error}</p> : null}
        <div className="axis-modal-actions">
          <button type="button" className="axis-btn" disabled={downloading || busy} onClick={onLater}>
            Later
          </button>
          {ready ? (
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={busy}
              onClick={onRelaunch}
            >
              {busy ? "Relaunching…" : "Quit and relaunch"}
            </button>
          ) : (
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={downloading || busy}
              onClick={onDownload}
            >
              {busy || downloading ? "Downloading…" : error ? "Try again" : "Download"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
