import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  dismissFinishedUploads,
  getUploadTasks,
  overallUploadPercent,
  subscribeUploadTasks,
} from "../lib/uploadTasks";

export function TaskTracker() {
  const tasks = useSyncExternalStore(subscribeUploadTasks, getUploadTasks, getUploadTasks);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const percent = overallUploadPercent(tasks);
  const running = percent != null;
  const failed = tasks.some((task) => task.status === "failed");
  const finished = tasks.some((task) => task.status !== "running");

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="task-tracker" ref={rootRef}>
      <button
        type="button"
        className={`task-tracker-toggle${running ? " is-running" : ""}${failed && !running ? " is-failed" : ""}`}
        aria-expanded={open}
        aria-label={running ? `Upload tasks ${percent}%` : "Upload tasks"}
        onClick={() => setOpen((current) => !current)}
      >
        <span>Tasks</span>
        {running ? <span className="tabular">{percent}%</span> : null}
      </button>
      {open ? (
        <div className="task-tracker-panel" role="region" aria-label="Upload tasks">
          {tasks.length === 0 ? (
            <p className="muted">No upload tasks this session.</p>
          ) : (
            <ul>
              {tasks.map((task) => (
                <li key={task.id} className={`is-${task.status}`}>
                  <div className="task-tracker-row">
                    <span className="task-tracker-label">{task.label}</span>
                    <span className="tabular task-tracker-pct">
                      {task.status === "failed" ? "Failed" : `${task.percent}%`}
                    </span>
                  </div>
                  <div className="task-tracker-track" aria-hidden="true">
                    <span style={{ width: `${Math.min(task.percent, 100)}%` }} />
                  </div>
                  <p className="muted">{task.message}</p>
                </li>
              ))}
            </ul>
          )}
          {finished ? (
            <button type="button" className="axis-btn axis-btn-ghost" onClick={dismissFinishedUploads}>
              Clear finished
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
