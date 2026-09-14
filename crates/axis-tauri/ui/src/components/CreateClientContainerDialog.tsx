import { useState } from "react";

export function CreateClientContainerDialog({
  folderPath,
  busy,
  error,
  defaultName,
  onCancel,
  onCreate,
}: {
  folderPath: string;
  busy: boolean;
  error: string | null;
  defaultName?: string | null;
  onCancel: () => void;
  onCreate: (name: string, primaryDomain?: string) => void;
}) {
  const [name, setName] = useState(defaultName?.trim() || "");
  const [domain, setDomain] = useState("");

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="axis-modal" role="dialog" aria-modal="true" aria-labelledby="create-client-title">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Client container</p>
            <h2 id="create-client-title">Create container</h2>
          </div>
          <button type="button" className="axis-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Axis will write <code className="mono-code">axis-client.json</code> into this folder and
          bind it 1:1 to the signed-in Entra tenant.
        </p>
        <label className="device-field" style={{ marginTop: "0.85rem" }}>
          Folder
          <input className="axis-input" value={folderPath} readOnly />
        </label>
        <label className="device-field" style={{ marginTop: "0.65rem" }}>
          Client name
          <input
            className="axis-input"
            value={name}
            autoFocus
            disabled={busy}
            placeholder="Contoso Ltd"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim()) {
                onCreate(name.trim(), domain.trim() || undefined);
              }
            }}
          />
        </label>
        <label className="device-field" style={{ marginTop: "0.65rem" }}>
          Primary domain (optional)
          <input
            className="axis-input"
            value={domain}
            disabled={busy}
            placeholder="contoso.com"
            onChange={(event) => setDomain(event.target.value)}
          />
        </label>
        {error ? (
          <p className="axis-alert axis-alert-danger" style={{ marginTop: "0.85rem" }}>
            {error}
          </p>
        ) : null}
        <div className="page-header-actions" style={{ marginTop: "1rem", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={busy || !name.trim()}
            onClick={() => onCreate(name.trim(), domain.trim() || undefined)}
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
