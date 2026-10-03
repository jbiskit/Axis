import { useState } from "react";
import type { BrowserSignIn, SessionMode, StoredSignIn } from "../types/glance";
import {
  isAppRegistrationClientId,
  loadLastExtraScopes,
  loadLastSessionMode,
  loadLastSignInApp,
  type SignInApp,
} from "../lib/loginPrefs";
import { requiredResourceAccessJson } from "../lib/appRegistrationManifest";
import { AppUpdateControls } from "./AppUpdateControls";

function storedSignInLabel(client: StoredSignIn): string {
  return client.mode === "admin" ? "Read & Write" : "Read-only";
}

function accountDomain(accountName: string | null | undefined): string | null {
  const domain = accountName?.split("@").at(-1)?.trim();
  if (!accountName?.includes("@") || !domain) return null;
  return domain;
}

function tenantPresentation(clients: StoredSignIn[]): { title: string; detail: string | null } {
  const name = clients.map((client) => client.tenantName?.trim()).find((value) => value);
  const domain =
    clients.map((client) => client.tenantDomain?.trim()).find((value) => value) ||
    clients.map((client) => accountDomain(client.accountName)).find((value) => value);
  if (name && domain && name.localeCompare(domain, undefined, { sensitivity: "accent" }) !== 0) {
    return { title: name, detail: domain };
  }
  if (name) return { title: name, detail: null };
  if (domain) return { title: domain, detail: null };
  return { title: "Saved tenant", detail: null };
}

function groupStoredSignIns(clients: StoredSignIn[]): Array<{
  key: string;
  title: string;
  detail: string | null;
  clients: StoredSignIn[];
}> {
  const groups = new Map<string, StoredSignIn[]>();
  for (const client of clients) {
    const key = client.tenantId?.trim() || client.tenantDomain?.trim() || client.clientId;
    const group = groups.get(key) ?? [];
    group.push(client);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, grouped]) => {
      const presentation = tenantPresentation(grouped);
      return {
        key,
        title: presentation.title,
        detail: presentation.detail,
        clients: [...grouped].sort((left, right) => {
          const mode = Number(left.mode === "admin") - Number(right.mode === "admin");
          if (mode !== 0) return mode;
          return Number(left.graphCommandLine) - Number(right.graphCommandLine);
        }),
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function LoginScreen({
  browserSignIn,
  storedSignIns,
  onLogin,
  onUseStored,
  onForgetStored,
  onCancel,
  appVersion,
  autoCheck,
  checkingForUpdate,
  updateStatus,
  onAutoCheckChange,
  onCheckForUpdate,
}: {
  browserSignIn: BrowserSignIn | null;
  storedSignIns: StoredSignIn[];
  onLogin: (mode: SessionMode, extraScopes: string, clientId: string | null) => Promise<void>;
  onUseStored: (client: StoredSignIn) => Promise<void>;
  onForgetStored: (clientId: string) => Promise<void>;
  onCancel?: () => Promise<void> | void;
  appVersion: string | null;
  autoCheck: boolean;
  checkingForUpdate: boolean;
  updateStatus: string | null;
  onAutoCheckChange: (value: boolean) => void;
  onCheckForUpdate: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<SessionMode>(loadLastSessionMode);
  const [signInApp, setSignInApp] = useState<SignInApp>(loadLastSignInApp);
  const [clientId, setClientId] = useState("");
  const [extraScopes, setExtraScopes] = useState(loadLastExtraScopes);
  const [manifestCopied, setManifestCopied] = useState(false);
  const waitingOnMicrosoft = busy || Boolean(browserSignIn);

  async function handleLogin() {
    setError(null);
    const registrationId = signInApp === "registration" ? clientId.trim() : null;
    if (signInApp === "registration" && !isAppRegistrationClientId(registrationId ?? "")) {
      setError("Enter the application (client) id from the Entra app registration.");
      return;
    }
    setBusy(true);
    try {
      await onLogin(mode, extraScopes, registrationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleStored(client: StoredSignIn) {
    setError(null);
    setBusy(true);
    try {
      await onUseStored(client);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleForget(clientId: string) {
    setError(null);
    try {
      await onForgetStored(clientId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that saved sign-in");
    }
  }

  async function handleCancel() {
    setError(null);
    setBusy(false);
    await onCancel?.();
  }

  const statusLabel = browserSignIn
    ? "Waiting for you to finish sign-in in the browser"
    : busy
      ? "Opening the Microsoft sign-in page…"
      : null;

  const savedGroups = groupStoredSignIns(storedSignIns);

  return (
    <div className="login-screen">
      <header className="login-topbar">
        <div className="login-card-brand">
          <span className="shell-mark">AX</span>
          <div>
            <p className="shell-brand-name">Axis</p>
            <p className="shell-brand-meta">Desktop console</p>
          </div>
        </div>
        <p className="login-topbar-title">Sign in to Intune</p>
      </header>

      <div className="login-body">
        <section className="login-stage" aria-label="Saved tenants">
          <div className="login-stage-head">
            <h1>Saved tenants</h1>
            <p>Choose a saved app to sign in. Read-only and Read &amp; Write stay side by side.</p>
          </div>
          {savedGroups.length > 0 ? (
            <div className="login-saved-grid">
              {savedGroups.map((group) => (
                <article key={group.key} className="login-saved-tenant">
                  <header>
                    <h2 className="login-saved-tenant-name">{group.title}</h2>
                    {group.detail ? (
                      <p className="login-saved-tenant-domain">{group.detail}</p>
                    ) : null}
                  </header>
                  <ul className="login-saved-list">
                    {group.clients.map((client) => (
                      <li key={client.clientId}>
                        <div className="login-saved-copy">
                          <p className="login-saved-name">{storedSignInLabel(client)}</p>
                          <p className="login-saved-meta">
                            {client.graphCommandLine ? "Microsoft Graph" : "App registration"}
                            {client.accountName ? ` · ${client.accountName}` : ""}
                          </p>
                        </div>
                        <div className="login-saved-actions">
                          <button
                            type="button"
                            className="axis-btn axis-btn-primary"
                            disabled={waitingOnMicrosoft}
                            onClick={() => void handleStored(client)}
                          >
                            Sign in
                          </button>
                          <button
                            type="button"
                            className="axis-btn"
                            disabled={waitingOnMicrosoft}
                            onClick={() => void handleForget(client.clientId)}
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          ) : (
            <p className="login-stage-empty">
              No saved tenants yet. Sign in from the pane on the right and Axis will keep that
              app here.
            </p>
          )}
        </section>

        <aside className="login-new" aria-label="New sign-in">
          <h2>New sign-in</h2>
          <p className="login-preset-hint login-new-lead">
            Opens the system browser. Microsoft returns here when you finish.
          </p>

          <fieldset className="login-preset">
            <legend>Application</legend>
            <label className={signInApp === "graph" ? "is-active" : ""}>
              <input
                type="radio"
                name="signInApp"
                value="graph"
                checked={signInApp === "graph"}
                disabled={waitingOnMicrosoft}
                onChange={() => setSignInApp("graph")}
              />
              Microsoft Graph
            </label>
            <label className={signInApp === "registration" ? "is-active" : ""}>
              <input
                type="radio"
                name="signInApp"
                value="registration"
                checked={signInApp === "registration"}
                disabled={waitingOnMicrosoft}
                onChange={() => setSignInApp("registration")}
              />
              App registration
            </label>
          </fieldset>
          {signInApp === "graph" ? (
            <p className="login-preset-hint">Microsoft Graph Command Line Tools.</p>
          ) : null}

          <fieldset className="login-preset">
            <legend>Access</legend>
            <label className={mode === "read" ? "is-active" : ""}>
              <input
                type="radio"
                name="sessionMode"
                value="read"
                checked={mode === "read"}
                disabled={waitingOnMicrosoft}
                onChange={() => setMode("read")}
              />
              Read-only
            </label>
            <label className={mode === "admin" ? "is-active" : ""}>
              <input
                type="radio"
                name="sessionMode"
                value="admin"
                checked={mode === "admin"}
                disabled={waitingOnMicrosoft}
                onChange={() => setMode("admin")}
              />
              Read &amp; Write
            </label>
          </fieldset>

          {signInApp === "registration" ? (
            <section className="login-guide" aria-label="Create an app registration">
              <h3>Create an app registration</h3>
              <ol className="login-steps">
                <li>
                  In the{" "}
                  <a
                    href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                    className="axis-link"
                  >
                    Entra admin center
                  </a>
                  , open App registrations and choose New registration.
                </li>
                <li>
                  Name it Axis. Choose “Accounts in this organizational directory only”, then
                  Register.
                </li>
                <li>
                  Open Authentication, add a platform, and choose Mobile and desktop applications.
                  Add the redirect URI <code className="mono-code">http://localhost</code>. Set
                  Allow public client flows to Yes, and save. Do not add a client secret.
                </li>
                <li>
                  Open Manifest, replace the{" "}
                  <code className="mono-code">requiredResourceAccess</code> block with the copied
                  JSON, and save.
                </li>
                <li>On API permissions, grant admin consent.</li>
                <li>On Overview, copy the Application (client) ID into the field below.</li>
              </ol>
              <div className="login-actions">
                <button
                  type="button"
                  className="axis-btn"
                  disabled={waitingOnMicrosoft}
                  onClick={() => {
                    void navigator.clipboard.writeText(requiredResourceAccessJson(mode)).then(() => {
                      setManifestCopied(true);
                      window.setTimeout(() => setManifestCopied(false), 2000);
                    });
                  }}
                >
                  {manifestCopied ? "Copied" : "Copy required resource access"}
                </button>
              </div>
              <p className="login-preset-hint">
                {mode === "read"
                  ? "The copy is the requiredResourceAccess block for read-only Graph permissions."
                  : "The copy is the requiredResourceAccess block for read and write Graph permissions."}
              </p>
              <label className="login-field">
                Application (client) id
                <input
                  className="axis-input"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={waitingOnMicrosoft}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                />
              </label>
            </section>
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
              Comma, space, or newline separated. Entra still unions consented permissions into
              the token.
            </p>
          </details>

          <div className="login-actions">
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={waitingOnMicrosoft}
              onClick={() => void handleLogin()}
            >
              {waitingOnMicrosoft ? "Waiting for Microsoft…" : "Sign in"}
            </button>
            {waitingOnMicrosoft && onCancel ? (
              <button type="button" className="axis-btn" onClick={() => void handleCancel()}>
                Cancel
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="login-error" role="alert">
              {error}
            </p>
          ) : null}
        </aside>
      </div>

      <footer className="login-footer">
        <p className="login-status" role="status">
          {statusLabel
            ? `${statusLabel}${browserSignIn ? " You can leave this window open." : ""}`
            : "Saved apps stay in Credential Manager after you sign out."}
        </p>
        <AppUpdateControls
          compact
          appVersion={appVersion}
          autoCheck={autoCheck}
          checking={checkingForUpdate}
          status={updateStatus}
          onAutoCheckChange={onAutoCheckChange}
          onCheck={onCheckForUpdate}
        />
      </footer>
    </div>
  );
}
