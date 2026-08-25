import { useState } from "react";
import type { DeviceCodePrompt } from "../types/glance";
import { loadLastExtraScopes } from "../lib/loginPrefs";

export function LoginScreen({
  deviceCode,
  onLogin,
  onCancel,
}: {
  deviceCode: DeviceCodePrompt | null;
  onLogin: (extraScopes: string) => Promise<void>;
  onCancel?: () => Promise<void> | void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [extraScopes, setExtraScopes] = useState(loadLastExtraScopes);
  const waitingOnMicrosoft = busy || Boolean(deviceCode);

  async function handleLogin() {
    setBusy(true);
    setError(null);
    try {
      await onLogin(extraScopes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    setError(null);
    setBusy(false);
    await onCancel?.();
  }

  const statusLabel = deviceCode
    ? "Waiting for you to enter the code at Microsoft"
    : busy
      ? "Requesting a device code…"
      : null;

  return (
    <div className="login-screen">
      <div className="axis-panel login-card">
        <div className="login-card-brand">
          <span className="shell-mark">AX</span>
          <div>
            <p className="shell-brand-name" style={{ margin: 0 }}>
              Axis
            </p>
            <p className="shell-brand-meta" style={{ margin: 0 }}>
              Desktop console
            </p>
          </div>
        </div>

        <h1>Sign in to Intune</h1>
        <p className="login-card-lead">
          Axis uses Microsoft’s device-code flow (same idea as{" "}
          <code className="mono-code">Connect-MgGraph -Scopes</code>). There is no
          customer-tenant app registration. You complete sign-in in the browser; this
          window polls until Microsoft finishes. Axis then retains the refresh token
          (session key) locally in{" "}
          <strong>Windows Credential Manager</strong> — this device’s credential
          manager. On the next launch, Axis restores that session if the credential is
          still stored.
        </p>

        <ol className="login-steps">
          <li>Axis asks Microsoft for a short device code and opens the device login page.</li>
          <li>
            Enter the code at Microsoft, pick the tenant (unless{" "}
            <code className="mono-code">AXIS_AZURE_TENANT_ID</code> is set), and
            complete MFA / consent.
          </li>
          <li>This app polls until the token is issued, then you land in the Intune workspace.</li>
        </ol>

        {statusLabel ? (
          <p className="login-status" role="status">
            {statusLabel}
            {busy && !deviceCode ? " Axis is also opening your browser." : null}
            {deviceCode ? " Polling until that completes — you can leave this window open." : null}
          </p>
        ) : null}

        {deviceCode ? (
          <div className="axis-panel login-code">
            <p className="axis-kicker">Enter this code</p>
            <p className="login-code-value">{deviceCode.userCode}</p>
            <p className="muted" style={{ margin: "0.65rem 0 0", fontSize: "var(--axis-text-xs)" }}>
              Microsoft device login:{" "}
              <a href={deviceCode.verificationUri} className="axis-link">
                {deviceCode.verificationUri}
              </a>
            </p>
          </div>
        ) : null}

        <details className="login-extras-details">
          <summary>Optional extra Graph scopes</summary>
          <label className="login-extras">
            Extra scopes
            <textarea
              className="axis-input login-extras-input"
              rows={3}
              spellCheck={false}
              disabled={waitingOnMicrosoft}
              placeholder="Policy.ReadWrite.ConditionalAccess, DeviceManagementCloudCA.Read.All"
              value={extraScopes}
              onChange={(event) => setExtraScopes(event.target.value)}
            />
          </label>
          <p className="login-preset-hint">
            Appended to the Graph Command Line Tools request, like extra{" "}
            <code className="mono-code">-Scopes</code> values. Comma, space, or newline
            separated. Entra still unions org-wide consented permissions into the token;
            extras cannot strip consent.
          </p>
        </details>

        <div className="login-actions">
          <button
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={waitingOnMicrosoft}
            onClick={() => void handleLogin()}
          >
            {waitingOnMicrosoft ? "Waiting for Microsoft…" : "Sign in with Microsoft"}
          </button>
          {waitingOnMicrosoft && onCancel ? (
            <button type="button" className="axis-btn" onClick={() => void handleCancel()}>
              Cancel
            </button>
          ) : null}
        </div>

        {error ? (
          <p
            style={{ margin: "0.85rem 0 0", color: "var(--axis-danger)", fontSize: "var(--axis-text-xs)" }}
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <p className="login-note">
          Tokens use Microsoft Graph Command Line Tools by default. Permissions on the
          session are whatever Entra issued for that public client.
        </p>
      </div>
    </div>
  );
}
