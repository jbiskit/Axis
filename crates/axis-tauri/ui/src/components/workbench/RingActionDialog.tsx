import { useEffect, useState } from "react";
import {
  applyWindowsUpdateRingAction,
  type RingAction,
  type RingActionResult,
  type RingChannel,
} from "../../lib/tauri";
import type { RingChannelState, RingUpdateState } from "../../types/inventory";
import { CloseButton } from "../ui/CloseButton";
import { BooleanToggle } from "./BooleanToggle";

/** A pause lasts this long from when it is set or extended. */
const PAUSE_DAYS = 35;

export type RingActionTarget = { id: string; name: string; ringState?: RingUpdateState };

const TITLES: Record<RingAction, string> = {
  pause: "Pause updates",
  resume: "Resume updates",
  extend: "Extend pause",
  uninstall: "Uninstall updates",
};

const CHANNEL_LABEL: Record<RingChannel, string> = { quality: "Quality updates", feature: "Feature updates" };

function isUnset(value?: string | null): boolean {
  return !value || value.startsWith("0001-01-01");
}

function shortDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

/** "Running", "Paused until 12/11/2026", or "Uninstalling". Shared with the ring list. */
export function ringChannelLabel(state?: RingChannelState): string {
  if (!state) return "—";
  if (state.rollingBack) return "Uninstalling";
  if (state.paused) return isUnset(state.pauseExpiry) ? "Paused" : `Paused until ${shortDate(state.pauseExpiry!)}`;
  return "Running";
}

/** Mirrors `ring_action_skip_reason` in Rust, so the preview matches what will happen. */
function skipReason(state: RingChannelState | undefined, action: RingAction): string | null {
  if (!state) return null;
  if (action === "pause" && state.paused) return "Already paused";
  if (action === "resume" && !state.paused) return "Not paused";
  if (action === "extend" && !state.paused) return "Not paused";
  if (action === "uninstall" && state.rollingBack) return "Already uninstalling";
  return null;
}

function afterLabel(action: RingAction, pauseEnds: Date): string {
  switch (action) {
    case "pause":
    case "extend":
      return `Paused until ${shortDate(pauseEnds)}`;
    case "resume":
      return "Running";
    case "uninstall":
      return "Uninstalling";
  }
}

function explanation(action: RingAction, channel: RingChannel, pauseEnds: Date): string {
  const what = CHANNEL_LABEL[channel].toLowerCase();
  switch (action) {
    case "pause":
      return `Devices in these rings stop receiving ${what} for ${PAUSE_DAYS} days, until ${shortDate(pauseEnds)}. Resume any time to end the pause early.`;
    case "resume":
      return `Devices in these rings start receiving ${what} again on their next check-in.`;
    case "extend":
      return `Restarts each pause's ${PAUSE_DAYS} days from today, so it now ends ${shortDate(pauseEnds)}.`;
    case "uninstall":
      return channel === "feature"
        ? "On their next check-in, devices roll back to the previous Windows version. This only works within each ring's feature update uninstall period."
        : "On their next check-in, devices uninstall the most recent quality update.";
  }
}

/**
 * Pause, resume, extend, or uninstall quality or feature updates on one or
 * more rings. Doubles as the review step: it shows what changes on each ring
 * before anything is sent, then the outcome for each.
 */
export function RingActionDialog({
  action,
  rings,
  onClose,
  onApplied,
}: {
  action: RingAction | null;
  rings: RingActionTarget[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [channel, setChannel] = useState<RingChannel>("quality");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<RingActionResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!action) return;
    setChannel("quality");
    setAcknowledged(false);
    setBusy(false);
    setResults(null);
    setError(null);
  }, [action]);

  if (!action) return null;

  const pauseEnds = new Date(Date.now() + PAUSE_DAYS * 86_400_000);
  const rows = rings.map((ring) => {
    const state = ring.ringState?.[channel];
    return { ring, state, skip: skipReason(state, action) };
  });
  const changing = rows.filter((row) => !row.skip).length;
  const destructive = action === "uninstall";
  const resultFor = (id: string) => results?.find((result) => result.id === id);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await applyWindowsUpdateRingAction(
        rings.map((ring) => ring.id),
        channel,
        action!,
      );
      setResults(outcome);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const failed = results?.filter((result) => !result.ok).length ?? 0;
  const skipped = results?.filter((result) => result.ok && result.skipped).length ?? 0;
  const applied = (results?.length ?? 0) - failed - skipped;

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="axis-modal axis-modal-wide object-action-pane" role="alertdialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Windows Update rings</p>
            <h2>
              {TITLES[action]} on {rings.length} {rings.length === 1 ? "ring" : "rings"}
            </h2>
          </div>
          <CloseButton onClick={onClose} disabled={busy} />
        </div>

        <div className="stack" style={{ gap: "0.4rem" }}>
          <p className="axis-kicker" style={{ margin: 0 }}>Updates</p>
          <div style={{ display: "flex", gap: "1rem" }}>
            {(["quality", "feature"] as const).map((value) => (
              <label key={value} className="wufb-week">
                <input
                  type="radio"
                  name="ring-action-channel"
                  checked={channel === value}
                  disabled={busy || results != null}
                  onChange={() => setChannel(value)}
                />
                <span>{CHANNEL_LABEL[value]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className={destructive ? "axis-alert axis-alert-danger" : "axis-alert axis-alert-info"}>
          {explanation(action, channel, pauseEnds)}
          {destructive ? " It cannot be undone from Write activity." : null}
        </div>

        <table className="axis-table">
          <thead>
            <tr>
              <th>Ring</th>
              <th>Now</th>
              <th>{results ? "Result" : "After"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ ring, state, skip }) => {
              const result = resultFor(ring.id);
              return (
                <tr key={ring.id}>
                  <td>{ring.name}</td>
                  <td className="muted">{ringChannelLabel(state)}</td>
                  <td>
                    {result ? (
                      result.error ? (
                        <span className="setting-field-error">{result.error}</span>
                      ) : result.skipped ? (
                        <span className="muted">Skipped · {result.skipped}</span>
                      ) : (
                        "Done"
                      )
                    ) : skip ? (
                      <span className="muted">No change · {skip}</span>
                    ) : (
                      afterLabel(action, pauseEnds)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {destructive && !results ? (
          <label style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <BooleanToggle
              checked={acknowledged}
              disabled={busy}
              ariaLabel="I understand devices will roll back"
              onChange={setAcknowledged}
            />
            <span>I understand devices in {changing === 1 ? "this ring" : "these rings"} will roll back.</span>
          </label>
        ) : null}

        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {results ? (
          <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-xs)" }}>
            {applied} changed · {skipped} skipped · {failed} failed. Each change is in Write activity
            {destructive || action === "extend" ? "." : ", where it can be undone."}
          </p>
        ) : null}

        <div className="object-action-footer">
          <span />
          <div className="device-actions">
            {results ? (
              <button type="button" className="axis-btn axis-btn-primary" onClick={onClose}>
                Close
              </button>
            ) : (
              <>
                <button type="button" className="axis-btn" disabled={busy} onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={destructive ? "axis-btn axis-btn-danger" : "axis-btn axis-btn-primary"}
                  disabled={busy || changing === 0 || (destructive && !acknowledged)}
                  title={changing === 0 ? "No selected ring would change." : undefined}
                  onClick={() => void apply()}
                >
                  {busy
                    ? "Working…"
                    : `${TITLES[action].split(" ")[0]} ${CHANNEL_LABEL[channel].toLowerCase()} · ${changing}`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
