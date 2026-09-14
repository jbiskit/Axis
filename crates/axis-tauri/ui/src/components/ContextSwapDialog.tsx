import type { DeviceCodePrompt, SessionMode } from "../types/glance";

export function ContextSwapDialog({
  targetMode,
  deviceCode,
  onCancel,
}: {
  targetMode: SessionMode;
  deviceCode: DeviceCodePrompt;
  onCancel: () => void;
}) {
  const elevating = targetMode === "admin";
  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="axis-modal context-swap-dialog" role="dialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Swap context</p>
            <h2>{elevating ? "Read & Write sign-in" : "Read-only sign-in"}</h2>
          </div>
          <button type="button" className="axis-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {elevating
            ? "Complete Microsoft device sign-in to request write-capable Graph permissions. Axis will unlock create, edit, and device actions after the token is issued."
            : "Complete Microsoft device sign-in to switch back to read-only permissions. Write actions in Axis will lock down again."}
        </p>
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
        <p className="muted context-swap-status" role="status">
          Waiting for Microsoft to finish sign-in…
        </p>
      </div>
    </div>
  );
}
