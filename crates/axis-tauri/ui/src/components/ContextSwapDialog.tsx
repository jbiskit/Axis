import type { SessionMode } from "../types/glance";
import { CloseButton } from "./ui/CloseButton";

export function ContextSwapDialog({
  targetMode,
  onCancel,
}: {
  targetMode: SessionMode;
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
            ? "Finish sign-in in the browser. Axis will unlock create, edit, and device actions after the token is issued."
            : "Finish sign-in in the browser. Write actions in Axis will lock down again."}
        </p>
        <p className="muted context-swap-status" role="status">
          Waiting for the browser sign-in to finish…
        </p>
      </div>
    </div>
  );
}

export function MissingContextDialog({
  targetMode,
  onSignInWithGraph,
  onSignOutToCreate,
  onClose,
}: {
  targetMode: SessionMode;
  onSignInWithGraph: () => void;
  onSignOutToCreate: () => void;
  onClose: () => void;
}) {
  const elevating = targetMode === "admin";
  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="axis-modal context-swap-dialog" role="dialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Swap context</p>
            <h2>No additional context</h2>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {elevating
            ? "This tenant has no saved Read & Write app registration to switch to."
            : "This tenant has no saved read-only app registration to switch to."}
        </p>
        <p className="muted" style={{ margin: "0.75rem 0 0" }}>
          {elevating
            ? "Request write scopes with Microsoft Graph, or create a Read & Write app registration and sign in with it. After that registration is saved, swap context will switch to it."
            : "Request read-only scopes with Microsoft Graph, or create a read-only app registration and sign in with it. After that registration is saved, swap context will switch to it."}
        </p>
        <div className="axis-modal-actions">
          <button type="button" className="axis-btn axis-btn-primary" onClick={onSignInWithGraph}>
            Sign in with Microsoft Graph
          </button>
          <button type="button" className="axis-btn" onClick={onSignOutToCreate}>
            Sign out and create new App Registration
          </button>
        </div>
      </div>
    </div>
  );
}
