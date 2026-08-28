import { useEffect, useMemo, useState } from "react";
import { fetchRemediationDeviceStatus } from "../../lib/tauri";
import { readCachedRunStatus, writeCachedRunStatus } from "../../lib/inspectorCache";
import type {
  RemediationDeviceRunState,
  RemediationDeviceStatusReport,
  RemediationRunSummary,
  ScriptUserRunState,
} from "../../types/inventory";
import { formatRelative } from "./shared";

function graphEnumLabel(value?: string | null): string {
  if (!value) return "—";
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

function statePillClass(value?: string | null): string {
  const normalized = (value ?? "").toLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "pending") return "axis-pill";
  if (normalized.includes("error") || normalized.includes("fail")) return "axis-pill axis-pill-danger";
  if (
    normalized.includes("success") ||
    normalized === "skipped" ||
    normalized.includes("noissue") ||
    normalized.includes("remediated")
  ) {
    return "axis-pill axis-pill-success";
  }
  return "axis-pill axis-pill-warning";
}

function isRemediationKind(kind: string): boolean {
  return kind === "script:remediation" || kind.endsWith("remediation");
}

function hasDetails(row: RemediationDeviceRunState): boolean {
  return Boolean(
    row.preRemediationDetectionScriptError?.trim() ||
      row.preRemediationDetectionScriptOutput?.trim() ||
      row.remediationScriptError?.trim() ||
      row.postRemediationDetectionScriptError?.trim() ||
      row.postRemediationDetectionScriptOutput?.trim() ||
      row.errorDescription?.trim() ||
      row.resultMessage?.trim(),
  );
}

function SummaryPills({ summary }: { summary: RemediationRunSummary }) {
  const items = [
    ["No issue", summary.noIssueDetectedDeviceCount, "axis-pill axis-pill-success"],
    ["Issue detected", summary.issueDetectedDeviceCount, "axis-pill axis-pill-warning"],
    ["Remediated", summary.issueRemediatedDeviceCount, "axis-pill axis-pill-success"],
    ["Detection error", summary.detectionScriptErrorDeviceCount, "axis-pill axis-pill-danger"],
    ["Remediation error", summary.remediationScriptErrorDeviceCount, "axis-pill axis-pill-danger"],
    ["Pending", summary.detectionScriptPendingDeviceCount, "axis-pill"],
    ["Unknown", summary.unknownDeviceCount, "axis-pill"],
  ] as const;
  const visible = items.filter(([, count]) => count != null && count > 0);
  if (visible.length === 0 && summary.lastScriptRunDateTime) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Last run {formatRelative(summary.lastScriptRunDateTime)}
      </p>
    );
  }
  if (visible.length === 0) return null;
  return (
    <div className="script-status-summary">
      {visible.map(([label, count, className]) => (
        <span key={label} className={className}>
          {label} {count}
        </span>
      ))}
      {summary.lastScriptRunDateTime ? (
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          Last run {formatRelative(summary.lastScriptRunDateTime)}
        </span>
      ) : null}
    </div>
  );
}

function DeviceCountPills({ states }: { states: RemediationDeviceRunState[] }) {
  const counts = new Map<string, number>();
  for (const row of states) {
    const key = (row.runState ?? "unknown").toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return (
    <div className="script-status-summary">
      {[...counts.entries()].map(([state, count]) => (
        <span key={state} className={statePillClass(state)}>
          {graphEnumLabel(state)} {count}
        </span>
      ))}
    </div>
  );
}

function OutputBlock({ label, value }: { label: string; value?: string | null }) {
  const text = value?.trim();
  if (!text) return null;
  return (
    <div className="script-status-output">
      <p>{label}</p>
      <pre>{text}</pre>
    </div>
  );
}

export function ScriptRunStatus({ kind, scriptId }: { kind: string; scriptId: string }) {
  const remediation = isRemediationKind(kind);
  const cached = readCachedRunStatus(kind, scriptId);
  const [report, setReport] = useState<RemediationDeviceStatusReport | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [pane, setPane] = useState<"devices" | "users">("devices");

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await fetchRemediationDeviceStatus(scriptId, kind);
      if (response.report) {
        writeCachedRunStatus(kind, scriptId, response.report);
        setReport(response.report);
        setError(response.error);
      } else if (!readCachedRunStatus(kind, scriptId)) {
        setReport(null);
        setError(response.error);
      }
    } catch (err) {
      if (!readCachedRunStatus(kind, scriptId)) {
        setReport(null);
        setError(err instanceof Error ? err.message : "Failed to load run status.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const hit = readCachedRunStatus(kind, scriptId);
    if (hit) {
      setReport(hit);
      setLoading(false);
      void load(true);
      return;
    }
    setPane("devices");
    void load(false);
  }, [scriptId, kind]);

  const userStates = report?.userStates ?? [];
  const showUsers = !remediation;

  const filteredDevices = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = report?.states ?? [];
    if (!needle) return rows;
    return rows.filter((row) => {
      const device = row.managedDevice;
      const hay = [
        device?.deviceName,
        device?.userPrincipalName,
        device?.osVersion,
        row.runState,
        row.detectionState,
        row.remediationState,
        row.errorDescription,
        row.resultMessage,
        row.preRemediationDetectionScriptError,
        row.remediationScriptError,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [query, report?.states]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return userStates;
    return userStates.filter((row) =>
      (row.userPrincipalName ?? "").toLowerCase().includes(needle),
    );
  }, [query, userStates]);

  return (
    <section className="axis-panel" style={{ padding: "0.85rem" }}>
      <div className="device-toolbar">
        <div>
          <p className="muted" style={{ margin: 0 }}>
            {remediation
              ? "Per-device detection and remediation results from Graph. This is the Intune device status report, not a live rerun."
              : "Device and user execution status from Graph (the Intune device execution status blade). This does not rerun the script."}
          </p>
          {report?.truncated && pane === "devices" ? (
            <p className="muted" style={{ margin: "0.35rem 0 0", color: "var(--axis-warning)" }}>
              Showing the first {report.states.length} devices.
            </p>
          ) : null}
          {report?.usersTruncated && pane === "users" ? (
            <p className="muted" style={{ margin: "0.35rem 0 0", color: "var(--axis-warning)" }}>
              Showing the first {userStates.length} users.
            </p>
          ) : null}
        </div>
        <button type="button" className="axis-btn" disabled={loading} onClick={() => void load(false)}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {showUsers ? (
        <div className="tab-row" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className={`tab-btn${pane === "devices" ? " active" : ""}`}
            onClick={() => setPane("devices")}
          >
            Devices ({report?.states.length ?? 0})
          </button>
          <button
            type="button"
            className={`tab-btn${pane === "users" ? " active" : ""}`}
            onClick={() => setPane("users")}
          >
            Users ({userStates.length})
          </button>
        </div>
      ) : null}
      {remediation && report?.summary ? <SummaryPills summary={report.summary} /> : null}
      {!remediation && pane === "devices" && report?.states.length ? (
        <DeviceCountPills states={report.states} />
      ) : null}
      <label className="device-field" style={{ marginTop: "0.75rem" }}>
        {pane === "users" ? "Filter users" : "Filter devices"}
        <input
          className="axis-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            pane === "users" ? "User principal name…" : "Device, user, state, error text…"
          }
        />
      </label>
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {loading && !report ? <p className="muted">Loading run states…</p> : null}
      {pane === "users" ? (
        <UserStateTable loading={loading} error={error} rows={filteredUsers} />
      ) : (
        <DeviceStateTable
          remediation={remediation}
          loading={loading}
          error={error}
          rows={filteredDevices}
          openKey={openKey}
          onToggle={(key) => setOpenKey((current) => (current === key ? null : key))}
        />
      )}
    </section>
  );
}

function DeviceStateTable({
  remediation,
  loading,
  error,
  rows,
  openKey,
  onToggle,
}: {
  remediation: boolean;
  loading: boolean;
  error: string | null;
  rows: RemediationDeviceRunState[];
  openKey: string | null;
  onToggle: (key: string) => void;
}) {
  if (!loading && !error && rows.length === 0) {
    return (
      <p className="muted">
        {remediation
          ? "No device run states yet. Assign the remediation and wait for a client check-in."
          : "No device execution status yet. Assign the script and wait for a client check-in."}
      </p>
    );
  }
  if (rows.length === 0) return null;
  return (
    <div className="axis-table-wrap" style={{ marginTop: "0.75rem" }}>
      <table className="axis-table">
        <thead>
          <tr>
            <th>Device</th>
            <th>User</th>
            {remediation ? (
              <>
                <th>Detection</th>
                <th>Remediation</th>
              </>
            ) : (
              <th>Run state</th>
            )}
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const key = `${row.id ?? row.managedDevice?.id ?? "device"}:${row.lastStateUpdateDateTime ?? index}`;
            return (
              <DeviceStateRow
                key={key}
                row={row}
                remediation={remediation}
                open={openKey === key}
                onToggle={() => onToggle(key)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DeviceStateRow({
  row,
  remediation,
  open,
  onToggle,
}: {
  row: RemediationDeviceRunState;
  rowKey?: string;
  remediation: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const device = row.managedDevice;
  const details = hasDetails(row);
  const colSpan = remediation ? 5 : 4;
  return (
    <>
      <tr
        className={details ? "script-status-row" : undefined}
        onClick={details ? onToggle : undefined}
        aria-expanded={details ? open : undefined}
      >
        <td>
          <div>{device?.deviceName || "Unknown device"}</div>
          {device?.osVersion ? (
            <div className="muted" style={{ fontSize: "0.75rem" }}>
              {device.osVersion}
            </div>
          ) : null}
        </td>
        <td>{device?.userPrincipalName?.trim() ? device.userPrincipalName : "—"}</td>
        {remediation ? (
          <>
            <td>
              <span className={statePillClass(row.detectionState)}>
                {graphEnumLabel(row.detectionState)}
              </span>
            </td>
            <td>
              <span className={statePillClass(row.remediationState)}>
                {graphEnumLabel(row.remediationState)}
              </span>
            </td>
          </>
        ) : (
          <td>
            <span className={statePillClass(row.runState)}>{graphEnumLabel(row.runState)}</span>
          </td>
        )}
        <td title={row.lastStateUpdateDateTime ?? undefined}>
          {formatRelative(row.lastStateUpdateDateTime)}
          {details ? (
            <div className="muted" style={{ fontSize: "0.6875rem" }}>
              {open ? "Hide output" : "Show output"}
            </div>
          ) : null}
        </td>
      </tr>
      {open && details ? (
        <tr>
          <td colSpan={colSpan}>
            <div className="script-status-details">
              {row.errorCode != null && row.errorCode !== 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
                  Error code {row.errorCode}
                </p>
              ) : null}
              <OutputBlock label="Error" value={row.errorDescription} />
              <OutputBlock label="Result" value={row.resultMessage} />
              <OutputBlock
                label="Detection error (before remediation)"
                value={row.preRemediationDetectionScriptError}
              />
              <OutputBlock
                label="Detection output (before remediation)"
                value={row.preRemediationDetectionScriptOutput}
              />
              <OutputBlock label="Remediation error" value={row.remediationScriptError} />
              <OutputBlock
                label="Detection error (after remediation)"
                value={row.postRemediationDetectionScriptError}
              />
              <OutputBlock
                label="Detection output (after remediation)"
                value={row.postRemediationDetectionScriptOutput}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function UserStateTable({
  loading,
  error,
  rows,
}: {
  loading: boolean;
  error: string | null;
  rows: ScriptUserRunState[];
}) {
  if (!loading && !error && rows.length === 0) {
    return <p className="muted">No user execution status yet.</p>;
  }
  if (rows.length === 0) return null;
  return (
    <div className="axis-table-wrap" style={{ marginTop: "0.75rem" }}>
      <table className="axis-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Success</th>
            <th>Error</th>
            <th>Pending</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? `${row.userPrincipalName ?? "user"}:${index}`}>
              <td>{row.userPrincipalName?.trim() ? row.userPrincipalName : "—"}</td>
              <td>{row.successDeviceCount ?? 0}</td>
              <td>{row.errorDeviceCount ?? 0}</td>
              <td>{row.pendingDeviceCount ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** @deprecated Use ScriptRunStatus */
export function RemediationDeviceStatus({
  kind = "script:remediation",
  scriptId,
}: {
  kind?: string;
  scriptId: string;
}) {
  return <ScriptRunStatus kind={kind} scriptId={scriptId} />;
}
