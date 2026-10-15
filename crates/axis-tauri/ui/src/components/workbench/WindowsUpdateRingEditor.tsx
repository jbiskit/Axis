import { useEffect, useMemo, useState } from "react";
import {
  fetchWindowsUpdateRing,
  updateWindowsUpdateRing,
  type RingAction,
  type WindowsUpdateRing,
} from "../../lib/tauri";
import type { RingUpdateState } from "../../types/inventory";
import { requestObjectRefresh } from "../../lib/inspectorCache";
import { useWriteGate, WriteActionButton } from "../../lib/readOnly";
import { WindowsUpdateRingFields, formatRingDate } from "./WindowsUpdateRingFields";
import { RingActionDialog, ringChannelLabel } from "./RingActionDialog";

/** The ring's pause and uninstall state, in the shape the action dialog takes. */
function ringState(ring: WindowsUpdateRing): RingUpdateState {
  return {
    quality: {
      paused: Boolean(ring.qualityUpdatesPaused),
      pauseExpiry: ring.qualityUpdatesPauseExpiryDateTime,
      rollingBack: Boolean(ring.qualityUpdatesWillBeRolledBack),
    },
    feature: {
      paused: Boolean(ring.featureUpdatesPaused),
      pauseExpiry: ring.featureUpdatesPauseExpiryDateTime,
      rollingBack: Boolean(ring.featureUpdatesWillBeRolledBack),
    },
  };
}

export function WindowsUpdateRingEditor({
  ringId,
  onSaved,
}: {
  ringId: string;
  onSaved?: () => void;
}) {
  const { writeDisabled, writeHint } = useWriteGate();
  const [ring, setRing] = useState<WindowsUpdateRing | null>(null);
  const [draft, setDraft] = useState<WindowsUpdateRing | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ringAction, setRingAction] = useState<RingAction | null>(null);
  // Bumped after a pause or uninstall, so the ring is read again. Deferred
  // until the dialog closes: reloading unmounts it, hiding the results.
  const [reloadKey, setReloadKey] = useState(0);
  const [actionApplied, setActionApplied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);
    void fetchWindowsUpdateRing(ringId)
      .then((response) => {
        if (cancelled) return;
        if (response.error || !response.ring) {
          setError(response.error ?? "Could not read this ring.");
          setRing(null);
          setDraft(null);
          return;
        }
        setRing(response.ring);
        setDraft(response.ring);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ringId, reloadKey]);

  const dirty = useMemo(() => {
    if (!ring || !draft) return false;
    return JSON.stringify(ring) !== JSON.stringify(draft);
  }, [draft, ring]);

  function patch(next: Partial<WindowsUpdateRing>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
    setMessage(null);
  }

  async function save() {
    if (!draft || !dirty) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await updateWindowsUpdateRing(draft);
      if (!response.ok) throw new Error(response.error ?? "Could not save the ring.");
      setMessage("Saved to Graph.");
      requestObjectRefresh(draft.id);
      const refreshed = await fetchWindowsUpdateRing(draft.id);
      if (refreshed.ring) {
        setRing(refreshed.ring);
        setDraft(refreshed.ring);
      }
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the ring.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading ring…</p>;
  if (error && !draft) {
    return (
      <p className="axis-alert axis-alert-danger" style={{ margin: 0 }}>
        {error}
      </p>
    );
  }
  if (!draft) return null;

  const disabled = writeDisabled || busy;

  return (
    <div className="stack" style={{ gap: "0.85rem" }}>
      <div className="axis-panel axis-panel-padded">
        <p className="axis-kicker">Ring</p>
        <label className="device-field" style={{ marginTop: "0.5rem" }}>
          Name
          <input
            className="axis-input"
            value={draft.displayName}
            disabled={disabled}
            onChange={(event) => patch({ displayName: event.target.value })}
          />
        </label>
        <label className="device-field">
          Description
          <textarea
            className="axis-input"
            rows={2}
            value={draft.description ?? ""}
            disabled={disabled}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </label>
        <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-2xs)" }}>
          Modified {formatRingDate(draft.lastModifiedDateTime)} ·{" "}
          {draft.isAssigned ? "Assigned" : "Not assigned"}
        </p>
      </div>

      <WindowsUpdateRingFields ring={draft} disabled={disabled} onChange={patch} />

      <div className="axis-panel axis-panel-padded">
        <p className="axis-kicker">Pause and uninstall</p>
        <div className="stack" style={{ gap: "0.4rem", marginTop: "0.4rem" }}>
          {(() => {
            const state = ringState(ring ?? draft);
            return (
              <>
                <p style={{ margin: 0, fontSize: "var(--axis-text-xs)" }}>
                  Quality updates: <strong>{ringChannelLabel(state.quality)}</strong>
                </p>
                <p style={{ margin: 0, fontSize: "var(--axis-text-xs)" }}>
                  Feature updates: <strong>{ringChannelLabel(state.feature)}</strong>
                </p>
              </>
            );
          })()}
          <div className="device-actions" style={{ marginTop: "0.3rem" }}>
            {(
              [
                ["pause", "Pause"],
                ["resume", "Resume"],
                ["extend", "Extend pause"],
                ["uninstall", "Uninstall"],
              ] as const
            ).map(([action, label]) => (
              <WriteActionButton
                key={action}
                type="button"
                className={action === "uninstall" ? "axis-btn axis-btn-danger" : "axis-btn"}
                disabled={busy || dirty}
                title={dirty ? "Save or discard your changes first." : undefined}
                onClick={() => setRingAction(action)}
              >
                {label}
              </WriteActionButton>
            ))}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-2xs)" }}>
            A pause lasts 35 days. Uninstall rolls devices back on their next check-in. Feature
            update uninstall works within {draft.featureUpdatesRollbackWindowInDays ?? 10} days of
            the update.
          </p>
        </div>
      </div>

      <RingActionDialog
        action={ringAction}
        rings={[{ id: draft.id, name: draft.displayName, ringState: ringState(ring ?? draft) }]}
        onClose={() => {
          setRingAction(null);
          if (!actionApplied) return;
          setActionApplied(false);
          requestObjectRefresh(draft.id);
          setReloadKey((key) => key + 1);
          onSaved?.();
        }}
        onApplied={() => setActionApplied(true)}
      />

      {error ? (
        <p className="axis-alert axis-alert-danger" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-2xs)" }}>
          {message}
        </p>
      ) : null}

      <div className="assignment-actions">
        <WriteActionButton
          type="button"
          className="axis-btn axis-btn-primary"
          disabled={busy || !dirty || !draft.displayName.trim()}
          title={writeDisabled ? writeHint : undefined}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save ring"}
        </WriteActionButton>
        <button
          type="button"
          className="axis-btn"
          disabled={busy || !dirty}
          onClick={() => {
            setDraft(ring);
            setError(null);
            setMessage(null);
          }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
