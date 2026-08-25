import { useEffect, useState } from "react";
import {
  collectDeviceDiagnostics,
  deleteManagedDevice,
  fetchRemediationScripts,
  initiateOnDemandRemediation,
  rebootManagedDevice,
  remoteLockManagedDevice,
  retireManagedDevice,
  syncManagedDevice,
  wipeManagedDevice,
} from "../../lib/tauri";
import type { TenantScriptSummary } from "../../types/inventory";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
type ConfirmKind = "reboot" | "lock" | "retire" | "wipe" | "delete" | null;

export function DeviceActionsBar({
  deviceId,
  deviceName,
  disabled,
  onActionMessage,
  onDeleted,
}: {
  deviceId: string;
  deviceName: string;
  disabled?: boolean;
  onActionMessage?: (message: string | null, error?: string | null) => void;
  onDeleted?: () => void;
}) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const [remediationOpen, setRemediationOpen] = useState(false);
  const [remediations, setRemediations] = useState<TenantScriptSummary[]>([]);
  const [remediationLoading, setRemediationLoading] = useState(false);
  const [remediationId, setRemediationId] = useState("");
  const [remediationError, setRemediationError] = useState<string | null>(null);

  async function runAction(
    key: string,
    label: string,
    fn: () => Promise<{ ok: boolean; error: string | null }>,
  ) {
    setBusyAction(key);
    onActionMessage?.(null, null);
    try {
      const result = await fn();
      if (!result.ok) {
        onActionMessage?.(null, result.error ?? `${label} failed.`);
        return;
      }
      onActionMessage?.(`${label} queued for ${deviceName}.`);
    } catch (err) {
      onActionMessage?.(null, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
      setRemoteOpen(false);
      setRemoveOpen(false);
    }
  }

  useEffect(() => {
    if (!remediationOpen) return;
    let cancelled = false;
    setRemediationLoading(true);
    setRemediationError(null);
    void fetchRemediationScripts()
      .then((response) => {
        if (cancelled) return;
        if (response.error) setRemediationError(response.error);
        setRemediations(response.list.items);
        setRemediationId(response.list.items[0]?.id ?? "");
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setRemediations([]);
          setRemediationError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setRemediationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [remediationOpen]);

  async function confirmPending() {
    if (!confirmKind) return;
    const kind = confirmKind;
    setConfirmKind(null);
    if (kind === "reboot") {
      await runAction("reboot", "Reboot", () => rebootManagedDevice(deviceId));
      return;
    }
    if (kind === "lock") {
      await runAction("lock", "Remote lock", () => remoteLockManagedDevice(deviceId));
      return;
    }
    if (kind === "retire") {
      await runAction("retire", "Retire", () => retireManagedDevice(deviceId));
      return;
    }
    if (kind === "wipe") {
      await runAction("wipe", "Wipe", () => wipeManagedDevice(deviceId));
      return;
    }
    setBusyAction("delete");
    onActionMessage?.(null, null);
    try {
      const result = await deleteManagedDevice(deviceId);
      if (!result.ok) {
        onActionMessage?.(null, result.error ?? "Delete failed.");
        return;
      }
      onActionMessage?.(`Deleted ${deviceName} from Intune.`);
      onDeleted?.();
    } catch (err) {
      onActionMessage?.(null, err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
      setRemoveOpen(false);
    }
  }

  async function runSelectedRemediation() {
    if (!remediationId) {
      setRemediationError("Select a remediation.");
      return;
    }
    const selected = remediations.find((row) => row.id === remediationId);
    setBusyAction("remediation");
    setRemediationError(null);
    onActionMessage?.(null, null);
    try {
      const result = await initiateOnDemandRemediation(deviceId, remediationId);
      if (!result.ok) {
        setRemediationError(result.error ?? "Remediation failed.");
        return;
      }
      onActionMessage?.(
        `On-demand remediation “${selected?.displayName ?? remediationId}” queued.`,
      );
      setRemediationOpen(false);
    } catch (err) {
      setRemediationError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  const busy = Boolean(busyAction) || disabled;
  const confirmCopy: Record<
    Exclude<ConfirmKind, null>,
    { title: string; message: string; label: string; danger?: boolean }
  > = {
    reboot: {
      title: "Reboot device?",
      message: `Queue a reboot for “${deviceName}”? The device will restart when it next checks in.`,
      label: "Reboot",
    },
    lock: {
      title: "Remote lock?",
      message: `Lock “${deviceName}” remotely? Supported platforms only.`,
      label: "Lock",
    },
    retire: {
      title: "Retire device?",
      message: `Retire “${deviceName}”? Company data is removed; the device object may remain until it checks in.`,
      label: "Retire",
      danger: true,
    },
    wipe: {
      title: "Wipe device?",
      message: `Factory wipe “${deviceName}”? This is destructive and cannot be undone from Axis.`,
      label: "Wipe",
      danger: true,
    },
    delete: {
      title: "Delete from Intune?",
      message: `Delete the Intune managed-device record for “${deviceName}”? This does not wipe the device.`,
      label: "Delete",
      danger: true,
    },
  };

  return (
    <>
      <div className="device-actions">
        <button
          type="button"
          className="axis-btn"
          disabled={busy}
          onClick={() => void runAction("sync", "Sync", () => syncManagedDevice(deviceId))}
        >
          {busyAction === "sync" ? "Syncing…" : "Sync"}
        </button>
        <button type="button" className="axis-btn" disabled={busy} onClick={() => setRemediationOpen(true)}>
          Run remediation
        </button>
        <button
          type="button"
          className="axis-btn"
          disabled={busy}
          onClick={() =>
            void runAction("diagnostics", "Diagnostics collection", () =>
              collectDeviceDiagnostics(deviceId),
            )
          }
        >
          {busyAction === "diagnostics" ? "Collecting…" : "Collect diagnostics"}
        </button>
        <div className="device-menu">
          <button
            type="button"
            className="axis-btn"
            disabled={busy}
            onClick={() => {
              setRemoteOpen((open) => !open);
              setRemoveOpen(false);
            }}
          >
            Remote actions ▾
          </button>
          {remoteOpen ? (
            <div className="device-menu-panel">
              <button type="button" onClick={() => setConfirmKind("reboot")}>
                Reboot
              </button>
              <button type="button" onClick={() => setConfirmKind("lock")}>
                Remote lock
              </button>
            </div>
          ) : null}
        </div>
        <div className="device-menu">
          <button
            type="button"
            className="axis-btn"
            disabled={busy}
            onClick={() => {
              setRemoveOpen((open) => !open);
              setRemoteOpen(false);
            }}
          >
            Remove data ▾
          </button>
          {removeOpen ? (
            <div className="device-menu-panel">
              <button type="button" onClick={() => setConfirmKind("retire")}>
                Retire
              </button>
              <button type="button" className="danger" onClick={() => setConfirmKind("wipe")}>
                Wipe
              </button>
            </div>
          ) : null}
        </div>
        <button type="button" className="axis-btn axis-btn-danger" disabled={busy} onClick={() => setConfirmKind("delete")}>
          Delete
        </button>
      </div>

      <ConfirmActionDialog
        open={Boolean(confirmKind)}
        title={confirmKind ? confirmCopy[confirmKind].title : ""}
        message={confirmKind ? confirmCopy[confirmKind].message : ""}
        confirmLabel={confirmKind ? confirmCopy[confirmKind].label : "Confirm"}
        danger={confirmKind ? confirmCopy[confirmKind].danger : false}
        busy={Boolean(busyAction)}
        onCancel={() => setConfirmKind(null)}
        onConfirm={() => void confirmPending()}
      />

      {remediationOpen ? (
        <div className="axis-modal-backdrop">
          <div className="axis-modal" role="dialog" aria-modal="true" aria-labelledby="run-remediation-title">
            <h2 id="run-remediation-title">Run remediation</h2>
            <p className="muted">
              Queue an on-demand proactive remediation against {deviceName}.
            </p>
            <label className="muted" style={{ display: "block", marginTop: "0.75rem" }}>
              Remediation
              <select
                value={remediationId}
                disabled={remediationLoading || remediations.length === 0}
                onChange={(event) => setRemediationId(event.target.value)}
              >
                {remediations.length === 0 ? (
                  <option value="">{remediationLoading ? "Loading…" : "No remediations found"}</option>
                ) : (
                  remediations.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.displayName}
                    </option>
                  ))
                )}
              </select>
            </label>
            {remediationError ? <div className="axis-alert axis-alert-danger">{remediationError}</div> : null}
            <div className="axis-modal-actions">
              <button
                type="button"
                className="axis-btn"
                disabled={busyAction === "remediation"}
                onClick={() => setRemediationOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="axis-btn axis-btn-primary"
                disabled={busyAction === "remediation" || remediationLoading || !remediationId}
                onClick={() => void runSelectedRemediation()}
              >
                {busyAction === "remediation" ? "Queuing…" : "Run now"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
