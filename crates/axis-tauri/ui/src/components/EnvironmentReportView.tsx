import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { EnvironmentReport, PackExportProgress } from "../types/inventory";
import {
  generateEnvironmentReport,
  openExternalUrl,
  saveTextFile,
} from "../lib/tauri";
import { PageHeader } from "./ui/PageChrome";

function pathToFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(normalized)) {
    return `file:///${normalized}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${normalized}`;
  }
  return `file:///${normalized}`;
}

export function EnvironmentReportView({
  signedIn,
  defaultPreparedFor,
  defaultPreparedBy,
}: {
  signedIn: boolean;
  defaultPreparedFor: string | null;
  defaultPreparedBy: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PackExportProgress | null>(null);
  const [report, setReport] = useState<EnvironmentReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [preparedFor, setPreparedFor] = useState("");
  const [preparedBy, setPreparedBy] = useState("");

  useEffect(() => {
    if (defaultPreparedFor) {
      setPreparedFor((current) => current || defaultPreparedFor);
    }
  }, [defaultPreparedFor]);

  useEffect(() => {
    if (defaultPreparedBy) {
      setPreparedBy((current) => current || defaultPreparedBy);
    }
  }, [defaultPreparedBy]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    void listen<PackExportProgress>("axis-environment-report-progress", (event) => {
      if (!cancelled) setProgress(event.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const generate = useCallback(async () => {
    if (!signedIn || busy) return;
    setBusy(true);
    setError(null);
    setSavedPath(null);
    setProgress({ phase: "inventory", current: 0, total: 0, message: "Starting…" });
    try {
      const next = await generateEnvironmentReport({
        preparedFor,
        preparedBy,
      });
      setReport(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [busy, preparedBy, preparedFor, signedIn]);

  const save = useCallback(async () => {
    if (!report) return;
    const path = await saveTextFile({
      contents: report.html,
      suggestedName: report.suggestedName,
      title: "Save as-built report",
    });
    if (path) setSavedPath(path);
  }, [report]);

  const openSaved = useCallback(async () => {
    if (!savedPath) return;
    await openExternalUrl(pathToFileUrl(savedPath));
  }, [savedPath]);

  const progressLabel = progress
    ? progress.total > 0
      ? `${progress.message} (${progress.current}/${progress.total})`
      : progress.message
    : null;

  return (
    <div className="stack environment-report">
      <PageHeader
        title="Environment report"
        description="A portable HTML as-built of how Intune is configured today. Set who the report is for, generate a snapshot, preview it here, then save a single file to share, archive, or print."
        actions={
          <>
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              onClick={() => void generate()}
              disabled={!signedIn || busy}
            >
              {busy ? "Generating…" : report ? "Regenerate" : "Generate"}
            </button>
            <button type="button" className="axis-btn" onClick={() => void save()} disabled={!report || busy}>
              Save HTML
            </button>
            {savedPath ? (
              <button type="button" className="axis-btn" onClick={() => void openSaved()}>
                Open file
              </button>
            ) : null}
          </>
        }
      />
      {signedIn ? (
        <div className="environment-report-options axis-panel axis-panel-padded">
          <label className="environment-report-field">
            <span>Prepared for</span>
            <input
              className="axis-input"
              type="text"
              value={preparedFor}
              onChange={(event) => setPreparedFor(event.target.value)}
              placeholder={defaultPreparedFor ?? "Organization or customer name"}
              disabled={busy}
            />
          </label>
          <label className="environment-report-field">
            <span>Prepared by</span>
            <input
              className="axis-input"
              type="text"
              value={preparedBy}
              onChange={(event) => setPreparedBy(event.target.value)}
              placeholder={defaultPreparedBy ?? "Your name or team"}
              disabled={busy}
            />
          </label>
        </div>
      ) : (
        <p className="muted">Sign in to generate an as-built from the live tenant.</p>
      )}
      {progressLabel ? <p className="muted">{progressLabel}</p> : null}
      {error ? <p className="axis-alert axis-alert-warning">{error}</p> : null}
      {savedPath ? <p className="muted">Saved to {savedPath}</p> : null}
      {report ? (
        <>
          {report.warnings.length > 0 ? (
            <p className="muted">
              {report.objectCount} objects · {report.warnings.length} note
              {report.warnings.length === 1 ? "" : "s"} in the document
            </p>
          ) : (
            <p className="muted">{report.objectCount} objects in this snapshot</p>
          )}
          <iframe
            className="environment-report-preview"
            title="As-built preview"
            sandbox=""
            srcDoc={report.html}
          />
        </>
      ) : (
        <div className="axis-panel axis-panel-padded">
          <p style={{ margin: 0, fontWeight: 500 }}>No snapshot yet</p>
          <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", lineHeight: 1.45 }}>
            This is a point-in-time as-built, not a live Graph view. Catalog policies are expanded one
            by one, so a large tenant can take a few minutes. Saved HTML includes script source — treat
            it as sensitive.
          </p>
        </div>
      )}
    </div>
  );
}
