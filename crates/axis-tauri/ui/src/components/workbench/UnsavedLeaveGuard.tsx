import { useEffect, useState } from "react";
import {
  cancelPendingLeave,
  confirmPendingLeave,
  hasUnsavedInspectorChanges,
  subscribeUnsavedLeave,
} from "../../lib/inspectorDrafts";
import { ConfirmActionDialog } from "../devices/ConfirmActionDialog";

export function UnsavedLeaveGuard() {
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeUnsavedLeave(() => setOpen(true)), []);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsavedInspectorChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return (
    <ConfirmActionDialog
      open={open}
      title="Unsaved changes"
      message="You have unsaved changes on this object. Leave and discard them?"
      confirmLabel="Discard and leave"
      danger
      onCancel={() => {
        cancelPendingLeave();
        setOpen(false);
      }}
      onConfirm={() => {
        confirmPendingLeave();
        setOpen(false);
      }}
    />
  );
}
