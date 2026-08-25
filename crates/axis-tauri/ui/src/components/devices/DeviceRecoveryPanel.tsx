import { useCallback, useEffect, useState } from "react";
import {
  getLapsInfo,
  listBitlockerKeys,
  revealBitlockerKey,
  revealLaps,
  rotateLapsPassword,
} from "../../lib/tauri";
import type { BitLockerRecoveryKeySummary, LapsCredentialInfo } from "../../types/inventory";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function DeviceRecoveryPanel({
  managedDeviceId,
  entraDeviceId,
  deviceName,
}: {
  managedDeviceId: string;
  entraDeviceId: string | null | undefined;
  deviceName: string;
}) {
  const [laps, setLaps] = useState<LapsCredentialInfo | null>(null);
  const [bitlockerKeys, setBitlockerKeys] = useState<BitLockerRecoveryKeySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revealLapsConfirm, setRevealLapsConfirm] = useState(false);
  const [revealBitlockerId, setRevealBitlockerId] = useState<string | null>(null);
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      if (!entraDeviceId?.trim()) {
        setLaps(null);
        setBitlockerKeys([]);
        throw new Error(
          "This device has no Entra device id — BitLocker / LAPS are backed up against the Entra object.",
        );
      }
      const [lapsResult, keysResult] = await Promise.allSettled([
        getLapsInfo(entraDeviceId),
        listBitlockerKeys(entraDeviceId),
      ]);
      if (lapsResult.status === "fulfilled") {
        setLaps(lapsResult.value.laps);
        if (lapsResult.value.error) {
          setError((current) => [current, `LAPS: ${lapsResult.value.error}`].filter(Boolean).join(" · "));
        }
      } else {
        setLaps(null);
        setError((current) =>
          [current, `LAPS: ${lapsResult.reason instanceof Error ? lapsResult.reason.message : String(lapsResult.reason)}`]
            .filter(Boolean)
            .join(" · "),
        );
      }
      if (keysResult.status === "fulfilled") {
        setBitlockerKeys(keysResult.value.keys);
        if (keysResult.value.error) {
          setError((current) => [current, `BitLocker: ${keysResult.value.error}`].filter(Boolean).join(" · "));
        }
      } else {
        setBitlockerKeys([]);
        setError((current) =>
          [
            current,
            `BitLocker: ${keysResult.reason instanceof Error ? keysResult.reason.message : String(keysResult.reason)}`,
          ]
            .filter(Boolean)
            .join(" · "),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [entraDeviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRevealLaps() {
    if (!entraDeviceId?.trim()) return;
    setBusy("reveal-laps");
    setError(null);
    setMessage(null);
    try {
      const result = await revealLaps(entraDeviceId);
      if (result.error || !result.laps) {
        setError(result.error ?? "LAPS password was not returned.");
        return;
      }
      setLaps(result.laps);
      setMessage("LAPS password revealed. This access is audited in Entra.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setRevealLapsConfirm(false);
    }
  }

  async function onRevealBitlocker(keyId: string) {
    setBusy(`reveal-bitlocker-${keyId}`);
    setError(null);
    setMessage(null);
    try {
      const result = await revealBitlockerKey(keyId);
      if (result.error || !result.key) {
        setError(result.error ?? "BitLocker key was not returned.");
        return;
      }
      setBitlockerKeys((prev) => prev.map((row) => (row.id === keyId ? result.key! : row)));
      setMessage("BitLocker recovery key revealed. This access is audited in Entra.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setRevealBitlockerId(null);
    }
  }

  async function onRotateLaps() {
    setBusy("rotate-laps");
    setError(null);
    setMessage(null);
    try {
      const result = await rotateLapsPassword(managedDeviceId);
      if (!result.ok) {
        setError(result.error ?? "LAPS rotation failed.");
        return;
      }
      setLaps((prev) => (prev ? { ...prev, credentials: [] } : prev));
      setMessage(
        "LAPS password rotation queued. Previous password hidden — reveal again after the device checks in.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setRotateConfirm(false);
    }
  }

  return (
    <div className="stack">
      <div className="device-toolbar">
        <div>
          <h2 style={{ margin: 0, fontSize: "0.875rem" }}>Recovery secrets</h2>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            Windows LAPS and BitLocker keys for {deviceName}. Secrets stay hidden until you explicitly
            reveal them (Entra-audited).
          </p>
        </div>
        <button type="button" className="axis-btn" disabled={loading || Boolean(busy)} onClick={() => void load()}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {message ? <div className="axis-alert axis-alert-info">{message}</div> : null}

      {!entraDeviceId?.trim() ? (
        <p className="muted">
          No Microsoft Entra device id on this Intune object — recovery APIs cannot be queried.
        </p>
      ) : (
        <div className="recovery-grid">
          <section className="axis-panel" style={{ padding: "0.85rem" }}>
            <div className="device-toolbar">
              <div>
                <h3 style={{ margin: 0 }}>Local admin password (LAPS)</h3>
                <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.6875rem" }}>
                  Last backup {formatDate(laps?.lastBackupDateTime)} · Next refresh{" "}
                  {formatDate(laps?.refreshDateTime)}
                </p>
              </div>
              <div className="device-actions">
                <button
                  type="button"
                  className="axis-btn axis-btn-primary"
                  disabled={loading || Boolean(busy)}
                  onClick={() => setRevealLapsConfirm(true)}
                >
                  {busy === "reveal-laps" ? "Revealing…" : "Reveal password"}
                </button>
                <button
                  type="button"
                  className="axis-btn"
                  disabled={loading || Boolean(busy)}
                  onClick={() => setRotateConfirm(true)}
                >
                  Rotate
                </button>
              </div>
            </div>
            {laps?.credentials.length ? (
              <ul className="recovery-list">
                {laps.credentials.map((cred) => (
                  <li key={`${cred.accountName}-${cred.backupDateTime}`}>
                    <p style={{ margin: 0, fontWeight: 500 }}>{cred.accountName}</p>
                    <p className="muted" style={{ margin: "0.2rem 0 0", fontFamily: "ui-monospace, monospace" }}>
                      Backed up {formatDate(cred.backupDateTime)}
                    </p>
                    {cred.password ? (
                      <div className="copy-row">
                        <code>{cred.password}</code>
                        <button
                          type="button"
                          className="axis-btn"
                          onClick={() => void navigator.clipboard.writeText(cred.password!)}
                        >
                          Copy
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                {loading
                  ? "Loading LAPS metadata…"
                  : laps
                    ? "Metadata loaded. Reveal to show the current local admin password."
                    : "No LAPS credential found for this Entra device."}
              </p>
            )}
          </section>

          <section className="axis-panel" style={{ padding: "0.85rem" }}>
            <h3 style={{ margin: 0 }}>BitLocker recovery keys</h3>
            <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.6875rem" }}>
              Keys backed up to Entra for this device ({bitlockerKeys.length}).
            </p>
            {bitlockerKeys.length === 0 ? (
              <p className="muted">
                {loading ? "Loading BitLocker keys…" : "No BitLocker recovery keys found for this Entra device."}
              </p>
            ) : (
              <ul className="recovery-list">
                {bitlockerKeys.map((row) => (
                  <li key={row.id}>
                    <div className="device-toolbar">
                      <div>
                        <p style={{ margin: 0, fontWeight: 500 }}>{row.volumeType ?? "Volume"}</p>
                        <p className="muted" style={{ margin: "0.2rem 0 0", fontFamily: "ui-monospace, monospace", fontSize: "0.625rem" }}>
                          {row.id}
                        </p>
                        <p className="muted" style={{ margin: "0.2rem 0 0" }}>
                          Created {formatDate(row.createdDateTime)}
                        </p>
                      </div>
                      {!row.key ? (
                        <button
                          type="button"
                          className="axis-btn"
                          disabled={Boolean(busy)}
                          onClick={() => setRevealBitlockerId(row.id)}
                        >
                          {busy === `reveal-bitlocker-${row.id}` ? "Revealing…" : "Reveal key"}
                        </button>
                      ) : null}
                    </div>
                    {row.key ? (
                      <div className="copy-row">
                        <code>{row.key}</code>
                        <button
                          type="button"
                          className="axis-btn"
                          onClick={() => void navigator.clipboard.writeText(row.key!)}
                        >
                          Copy
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <ConfirmActionDialog
        open={revealLapsConfirm}
        title="Reveal LAPS password?"
        message={`Show the Windows LAPS local admin password for “${deviceName}”? This is audited in Entra (Key / credential access).`}
        confirmLabel="Reveal"
        busy={busy === "reveal-laps"}
        onCancel={() => setRevealLapsConfirm(false)}
        onConfirm={() => void onRevealLaps()}
      />
      <ConfirmActionDialog
        open={Boolean(revealBitlockerId)}
        title="Reveal BitLocker recovery key?"
        message={`Show the BitLocker recovery key for “${deviceName}”? Retrieving the key is audited in Entra under KeyManagement.`}
        confirmLabel="Reveal"
        busy={Boolean(revealBitlockerId && busy === `reveal-bitlocker-${revealBitlockerId}`)}
        onCancel={() => setRevealBitlockerId(null)}
        onConfirm={() => {
          if (revealBitlockerId) void onRevealBitlocker(revealBitlockerId);
        }}
      />
      <ConfirmActionDialog
        open={rotateConfirm}
        title="Rotate LAPS password?"
        message={`Queue a Windows LAPS password rotation for “${deviceName}”? The device must check in to apply the new password.`}
        confirmLabel="Rotate"
        busy={busy === "rotate-laps"}
        onCancel={() => setRotateConfirm(false)}
        onConfirm={() => void onRotateLaps()}
      />
    </div>
  );
}
