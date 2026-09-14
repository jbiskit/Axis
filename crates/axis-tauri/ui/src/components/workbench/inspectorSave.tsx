import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { READ_ONLY_WRITE_HINT, useReadOnly } from "../../lib/readOnly";

export type InspectorSaveAction = {
  onSave: () => void;
  disabled: boolean;
  busy: boolean;
  label?: string;
};

const SetActionContext = createContext<(action: InspectorSaveAction | null) => void>(() => {});
const ActionContext = createContext<InspectorSaveAction | null>(null);

export function InspectorSaveProvider({
  action,
  children,
}: {
  action?: InspectorSaveAction | null;
  children: ReactNode;
}) {
  const [childAction, setChildAction] = useState<InspectorSaveAction | null>(null);
  return (
    <SetActionContext.Provider value={setChildAction}>
      <ActionContext.Provider value={childAction ?? action ?? null}>{children}</ActionContext.Provider>
    </SetActionContext.Provider>
  );
}

export function useInspectorSaveAction(action: InspectorSaveAction | null) {
  const setAction = useContext(SetActionContext);
  const readOnly = useReadOnly();
  const onSaveRef = useRef(action?.onSave);
  onSaveRef.current = action?.onSave;
  const present = Boolean(action?.onSave);
  const disabled = action?.disabled;
  const busy = action?.busy;
  const label = action?.label;
  useEffect(() => {
    if (!present) {
      setAction(null);
      return;
    }
    setAction({
      onSave: () => onSaveRef.current?.(),
      disabled: Boolean(disabled) || readOnly,
      busy: Boolean(busy),
      label,
    });
    return () => setAction(null);
  }, [busy, disabled, label, present, readOnly, setAction]);
}

export function InspectorSaveButton() {
  const action = useContext(ActionContext);
  const readOnly = useReadOnly();
  if (!action) return null;
  const disabled = action.disabled || action.busy || readOnly;
  return (
    <button
      type="button"
      className="axis-btn axis-btn-primary"
      disabled={disabled}
      title={
        readOnly
          ? READ_ONLY_WRITE_HINT
          : action.disabled && !action.busy
            ? "No unsaved changes"
            : "Save changes to Graph"
      }
      onClick={() => action.onSave()}
    >
      {action.busy ? "Saving…" : action.label ?? "Save to Graph"}
    </button>
  );
}
