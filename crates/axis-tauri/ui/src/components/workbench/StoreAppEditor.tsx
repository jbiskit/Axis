import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { updateWinGetApp } from "../../lib/tauri";
import { requestObjectRefresh } from "../../lib/inspectorCache";
import { useInspectorDirty } from "../../lib/inspectorDrafts";
import { useReadOnly } from "../../lib/readOnly";
import {
  draftFromStoreObject,
  draftsEqualStore,
  installBehaviorLabel,
  toUpdateStoreInput,
  type StoreAppDraft,
} from "../../lib/storeApp";
import { BooleanToggle } from "./BooleanToggle";
import { TenantAppIcon } from "./TenantAppIcon";
import { useInspectorSaveAction } from "./inspectorSave";

export function InstallBehaviorToggle({
  runAsAccount,
  disabled,
  onChange,
}: {
  runAsAccount: string;
  disabled?: boolean;
  onChange: (runAsAccount: "system" | "user") => void;
}) {
  const user = runAsAccount === "user";
  return (
    <div className="install-behavior-toggle">
      <span className={user ? "muted" : "is-active"}>System</span>
      <BooleanToggle
        checked={user}
        disabled={disabled}
        ariaLabel={user ? "Install behavior, user" : "Install behavior, system"}
        onChange={(next) => onChange(next ? "user" : "system")}
      />
      <span className={user ? "is-active" : "muted"}>User</span>
    </div>
  );
}

function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="device-field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      {label}
      {hint ? (
        <span className="muted" style={{ display: "block", fontSize: "0.7rem", marginBottom: "0.25rem" }}>
          {hint}
        </span>
      ) : null}
      {children}
    </label>
  );
}

function Pane({
  title,
  hint,
  defaultOpen,
  children,
}: {
  title: string;
  hint: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const seeded = useRef(false);
  return (
    <details
      className="axis-panel win32-pane"
      ref={(node) => {
        if (node && defaultOpen && !seeded.current) {
          node.open = true;
          seeded.current = true;
        }
      }}
    >
      <summary>
        <span className="win32-pane-title">{title}</span>
        <span className="win32-pane-hint">{hint}</span>
      </summary>
      <div className="win32-pane-body">{children}</div>
    </details>
  );
}

export function StoreAppEditor({
  appId,
  object,
  children,
}: {
  appId: string;
  object: Record<string, unknown> | null;
  children?: ReactNode;
}) {
  const readOnly = useReadOnly();
  const baseline = useMemo(() => draftFromStoreObject(object), [object]);
  const [draft, setDraft] = useState<StoreAppDraft>(baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(baseline);
    setError(null);
    setMessage(null);
  }, [baseline]);

  const dirty = !draftsEqualStore(draft, baseline);
  useInspectorDirty(`store-app:${appId}`, dirty);

  function patch(next: Partial<StoreAppDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  async function save() {
    if (!dirty) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await updateWinGetApp(
        toUpdateStoreInput(appId, draft, draft.iconValue !== baseline.iconValue),
      );
      if (!response.ok) {
        setError(response.error ?? "Could not update the Store app.");
        return;
      }
      setMessage("Saved Store app to Graph.");
      requestObjectRefresh(appId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the Store app.");
    } finally {
      setBusy(false);
    }
  }

  useInspectorSaveAction({
    onSave: () => void save(),
    disabled: busy || !dirty || readOnly,
    busy,
    label: dirty ? "Save app" : undefined,
  });

  const disabled = readOnly || busy;

  return (
    <div className="win32-panes">
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {message ? <div className="axis-alert axis-alert-info">{message}</div> : null}

      <Pane title="Install behavior" hint={installBehaviorLabel(draft.runAsAccount)} defaultOpen>
        <div className="win32-grid">
          <Field label="Install behavior">
            <InstallBehaviorToggle
              runAsAccount={draft.runAsAccount}
              disabled
              onChange={() => undefined}
            />
          </Field>
          <Field label="Package identifier">
            <input className="axis-input" value={draft.packageIdentifier} readOnly disabled />
          </Field>
        </div>
      </Pane>

      <Pane title="App information" hint={draft.displayName || "Untitled"}>
        <div className="win32-grid">
          <div className="device-field" style={{ gridColumn: "1 / -1" }}>
            <span>Icon</span>
            <TenantAppIcon
              mimeType={draft.iconType}
              value={draft.iconValue}
              disabled={disabled}
              onChange={(icon) => patch(icon)}
              onError={setError}
            />
          </div>
          <Field label="Display name">
            <input
              className="axis-input"
              value={draft.displayName}
              disabled={disabled}
              onChange={(event) => patch({ displayName: event.target.value })}
            />
          </Field>
          <Field label="Publisher">
            <input
              className="axis-input"
              value={draft.publisher}
              disabled={disabled}
              onChange={(event) => patch({ publisher: event.target.value })}
            />
          </Field>
          <Field label="Developer">
            <input
              className="axis-input"
              value={draft.developer}
              disabled={disabled}
              onChange={(event) => patch({ developer: event.target.value })}
            />
          </Field>
          <Field label="Owner">
            <input
              className="axis-input"
              value={draft.owner}
              disabled={disabled}
              onChange={(event) => patch({ owner: event.target.value })}
            />
          </Field>
          <Field label="Information URL" wide>
            <input
              className="axis-input"
              value={draft.informationUrl}
              disabled={disabled}
              onChange={(event) => patch({ informationUrl: event.target.value })}
            />
          </Field>
          <Field label="Privacy URL" wide>
            <input
              className="axis-input"
              value={draft.privacyInformationUrl}
              disabled={disabled}
              onChange={(event) => patch({ privacyInformationUrl: event.target.value })}
            />
          </Field>
          <Field label="Description" wide>
            <textarea
              className="axis-input"
              rows={3}
              value={draft.description}
              disabled={disabled}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </Field>
          <Field label="Notes" wide>
            <textarea
              className="axis-input"
              rows={2}
              value={draft.notes}
              disabled={disabled}
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Field>
        </div>
      </Pane>
      {children}
    </div>
  );
}
