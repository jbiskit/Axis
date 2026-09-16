import { useEffect, useState } from "react";
import { updateAutopilotDeviceGroupTag } from "../../lib/tauri";

export type AutopilotGroupTagTarget = {
  id: string;
  title: string;
};

export function AutopilotGroupTagDialog({
  open,
  targets,
  initialTag = "",
  onClose,
  onSaved,
}: {
  open: boolean;
  targets: AutopilotGroupTagTarget[];
  initialTag?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [groupTag, setGroupTag] = useState(initialTag);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const targetKey = targets.map((t) => t.id).join("\0");

  useEffect(() => {
    if (!open) return;
    setGroupTag(initialTag);
    setBusy(false);
    setProgress(0);
    setError(null);
  }, [open, initialTag, targetKey]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open || targets.length === 0) return null;

  async function save() {
    setBusy(true);
    setProgress(0);
    setError(null);
    const failures: string[] = [];
    let ok = 0;
    for (const target of targets) {
      try {
        const response = await updateAutopilotDeviceGroupTag(target.id, groupTag.trim());
        if (response.ok) ok += 1;
        else failures.push(`${target.title}: ${response.error ?? "Update failed."}`);
      } catch (err) {
        failures.push(`${target.title}: ${err instanceof Error ? err.message : "Update failed."}`);
      }
      setProgress((value) => value + 1);
    }
    setBusy(false);
    if (ok > 0) onSaved();
    if (failures.length > 0) {
      setError(
        `${ok} updated; ${failures.length} failed. ${failures.slice(0, 3).join(" ")}`,
      );
      return;
    }
    onClose();
  }

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="axis-modal object-action-pane" role="dialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Bulk edit</p>
            <h2>
              {targets.length === 1
                ? "Update group tag"
                : `Update group tag on ${targets.length} devices`}
            </h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              Writes the same group tag to every selected Autopilot device identity. Leave blank to
              clear the tag.
            </p>
          </div>
          <button type="button" className="axis-btn" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
        <label className="axis-field" style={{ display: "grid", gap: "0.35rem", marginTop: "1rem" }}>
          <span>Group tag</span>
          <input
            className="axis-input"
            value={groupTag}
            onChange={(event) => setGroupTag(event.target.value)}
            disabled={busy}
            autoFocus
            placeholder="e.g. Marketing-Laptops"
          />
        </label>
        {busy ? (
          <p className="muted" style={{ marginTop: "0.75rem", fontSize: "0.75rem" }}>
            Updating {progress} of {targets.length}…
          </p>
        ) : null}
        {error ? (
          <div className="axis-alert axis-alert-danger" style={{ marginTop: "0.75rem" }}>
            {error}
          </div>
        ) : null}
        <div className="device-actions" style={{ marginTop: "1rem", justifyContent: "flex-end" }}>
          <button type="button" className="axis-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="axis-btn axis-btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? "Updating…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
