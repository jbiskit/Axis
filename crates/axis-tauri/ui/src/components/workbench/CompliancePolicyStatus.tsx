import { useEffect, useMemo, useState } from "react";
import { fetchCompliancePolicyStatus } from "../../lib/tauri";
import {
  readCachedComplianceStatus,
  writeCachedComplianceStatus,
} from "../../lib/inspectorCache";
import type {
  ComplianceDeviceStatus,
  ComplianceDeviceStatusOverview,
  CompliancePolicyStatusReport,
  ComplianceSettingStatusSummary,
  ComplianceUserStatus,
} from "../../types/inventory";
import { formatRelative } from "./shared";

/** Intune portal wording for Graph complianceStatus. */
const STATUS_LABELS: Record<string, string> = {
  compliant: "Compliant",
  noncompliant: "Noncompliant",
  error: "Error",
  conflict: "Conflict",
  notapplicable: "Not applicable",
  unknown: "Not evaluated",
  pending: "Not evaluated",
  remediated: "Remediated",
  notassigned: "Not assigned",
  ingraceperiod: "In grace period",
};

function statusKey(value?: string | null): string {
  return (value ?? "unknown").replace(/[^a-zA-Z]/g, "").toLowerCase();
}

function statusLabel(value?: string | null): string {
  return STATUS_LABELS[statusKey(value)] ?? "Not evaluated";
}

function statusPillClass(value?: string | null): string {
  const key = statusKey(value);
  if (key === "compliant" || key === "remediated" || key === "success") {
    return "axis-pill axis-pill-success";
  }
  if (key === "noncompliant" || key === "failed" || key === "error") {
    return "axis-pill axis-pill-danger";
  }
  if (key === "conflict" || key === "ingraceperiod") {
    return "axis-pill axis-pill-warning";
  }
  return "axis-pill";
}

function OverviewPills({
  overview,
  active,
  onSelect,
}: {
  overview: ComplianceDeviceStatusOverview;
  active: string | null;
  onSelect: (key: string | null) => void;
}) {
  const items = [
    ["compliant", "Compliant", overview.successCount],
    ["noncompliant", "Noncompliant", overview.failedCount],
    ["error", "Error", overview.errorCount],
    ["conflict", "Conflict", overview.conflictCount],
    ["notapplicable", "Not applicable", overview.notApplicableCount],
    ["unknown", "Not evaluated", overview.pendingCount],
    ["ingraceperiod", "In grace period", overview.inGracePeriodCount],
  ] as const;
  const visible = items.filter(([, , count]) => count != null && count > 0);
  if (visible.length === 0 && !overview.lastUpdateDateTime) return null;
  return (
    <div className="script-status-summary">
      {visible.map(([key, label, count]) => (
        <button
          key={key}
          type="button"
          className={`${statusPillClass(key)}${active === key ? " is-active" : ""}`}
          onClick={() => onSelect(active === key ? null : key)}
        >
          {label} {count}
        </button>
      ))}
      {overview.lastUpdateDateTime ? (
        <span className="muted" style={{ fontSize: "0.75rem" }}>
          Updated {formatRelative(overview.lastUpdateDateTime)}
        </span>
      ) : null}
    </div>
  );
}

export function CompliancePolicyStatus({ policyId }: { policyId: string }) {
  const cached = readCachedComplianceStatus(policyId);
  const [report, setReport] = useState<CompliancePolicyStatusReport | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [pane, setPane] = useState<"devices" | "users" | "settings">("devices");
  const [generating, setGenerating] = useState(false);

  async function load(silent = false, generateSettings = false) {
    if (!silent) setLoading(true);
    if (generateSettings) setGenerating(true);
    setError(null);
    try {
      const response = await fetchCompliancePolicyStatus(policyId, generateSettings);
      if (response.report) {
        writeCachedComplianceStatus(policyId, response.report);
        setReport(response.report);
        setError(response.error);
      } else if (!readCachedComplianceStatus(policyId)) {
        setReport(null);
        setError(response.error);
      }
    } catch (err) {
      if (!readCachedComplianceStatus(policyId)) {
        setReport(null);
        setError(err instanceof Error ? err.message : "Failed to load compliance status.");
      }
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  }

  useEffect(() => {
    const hit = readCachedComplianceStatus(policyId);
    if (hit) {
      setReport(hit);
      setLoading(false);
      void load(true);
      return;
    }
    setPane("devices");
    setStatusFilter(null);
    void load(false);
  }, [policyId]);

  const users = report?.users ?? [];
  const settings = report?.settings ?? [];
  const settingsStatus = (report?.settingsReport?.status ?? "missing").toLowerCase();
  const settingsReady = settingsStatus === "completed";
  const settingsBusy = generating || settingsStatus === "inprogress" || settingsStatus === "notstarted";
  const showUsers = users.length > 0;

  useEffect(() => {
    if (!settingsBusy || generating) return;
    const timer = window.setTimeout(() => {
      void load(true, false);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [generating, policyId, settingsStatus]);

  const filteredDevices = useMemo(() => {
    const rows = report?.devices ?? [];
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter && statusKey(row.status) !== statusFilter) return false;
      if (!needle) return true;
      return [
        row.deviceDisplayName,
        row.userPrincipalName,
        row.userName,
        row.deviceModel,
        statusLabel(row.status),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [query, report?.devices, statusFilter]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((row) =>
      [row.userDisplayName, row.userPrincipalName, statusLabel(row.status)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query, users]);

  const filteredSettings = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return settings;
    return settings.filter((row) =>
      [row.settingName, row.platformType].filter(Boolean).join(" ").toLowerCase().includes(needle),
    );
  }, [query, settings]);

  return (
    <section className="axis-panel" style={{ padding: "0.85rem" }}>
      <div className="device-toolbar">
        <div>
          <p className="muted" style={{ margin: 0 }}>
            Device compliance against this policy, from Graph. Assign the policy and wait for a
            client check-in.
          </p>
          {report?.truncated && pane === "devices" ? (
            <p className="muted" style={{ margin: "0.35rem 0 0", color: "var(--axis-warning)" }}>
              Showing the first {report.devices.length} devices.
            </p>
          ) : null}
          {report?.usersTruncated && pane === "users" ? (
            <p className="muted" style={{ margin: "0.35rem 0 0", color: "var(--axis-warning)" }}>
              Showing the first {users.length} users.
            </p>
          ) : null}
        </div>
        <button type="button" className="axis-btn" disabled={loading || generating} onClick={() => void load(false)}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <div className="tab-row" style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          className={`tab-btn${pane === "devices" ? " active" : ""}`}
          onClick={() => setPane("devices")}
        >
          Devices ({report?.devices.length ?? 0})
        </button>
        {showUsers ? (
          <button
            type="button"
            className={`tab-btn${pane === "users" ? " active" : ""}`}
            onClick={() => setPane("users")}
          >
            Users ({users.length})
          </button>
        ) : null}
        <button
          type="button"
          className={`tab-btn${pane === "settings" ? " active" : ""}`}
          onClick={() => setPane("settings")}
        >
          Settings{settingsReady ? ` (${settings.length})` : ""}
        </button>
      </div>
      {pane === "devices" && report?.overview ? (
        <OverviewPills
          overview={report.overview}
          active={statusFilter}
          onSelect={setStatusFilter}
        />
      ) : null}
      <label className="device-field" style={{ marginTop: "0.75rem" }}>
        {pane === "users" ? "Filter users" : pane === "settings" ? "Filter settings" : "Filter devices"}
        <input
          className="axis-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            pane === "users"
              ? "User, status…"
              : pane === "settings"
                ? "Setting name…"
                : "Device, user, status…"
          }
        />
      </label>
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {loading && !report ? <p className="muted">Loading compliance status…</p> : null}
      {pane === "users" ? (
        <UserTable loading={loading} error={error} rows={filteredUsers} />
      ) : pane === "settings" ? (
        <SettingsPane
          loading={loading}
          generating={settingsBusy}
          error={error}
          status={settingsStatus}
          lastRefresh={report?.settingsReport?.lastRefreshDateTime}
          rows={filteredSettings}
          onGenerate={() => void load(false, true)}
        />
      ) : (
        <DeviceTable loading={loading} error={error} rows={filteredDevices} />
      )}
    </section>
  );
}

function DeviceTable({
  loading,
  error,
  rows,
}: {
  loading: boolean;
  error: string | null;
  rows: ComplianceDeviceStatus[];
}) {
  if (!loading && !error && rows.length === 0) {
    return (
      <p className="muted">
        No device status yet. Assign the policy and wait for a client check-in.
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
            <th>Status</th>
            <th>Reported</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? `${row.deviceId ?? row.deviceDisplayName ?? "device"}:${index}`}>
              <td>
                <div>{row.deviceDisplayName?.trim() || "Unknown device"}</div>
                {row.deviceModel ? (
                  <div className="muted" style={{ fontSize: "0.75rem" }}>
                    {row.deviceModel}
                  </div>
                ) : null}
              </td>
              <td>{row.userPrincipalName?.trim() || row.userName?.trim() || "—"}</td>
              <td>
                <span className={statusPillClass(row.status)}>{statusLabel(row.status)}</span>
              </td>
              <td title={row.lastReportedDateTime ?? undefined}>
                {formatRelative(row.lastReportedDateTime)}
                {row.complianceGracePeriodExpirationDateTime ? (
                  <div className="muted" style={{ fontSize: "0.75rem" }}>
                    Grace ends {formatRelative(row.complianceGracePeriodExpirationDateTime)}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserTable({
  loading,
  error,
  rows,
}: {
  loading: boolean;
  error: string | null;
  rows: ComplianceUserStatus[];
}) {
  if (!loading && !error && rows.length === 0) {
    return <p className="muted">No user status yet.</p>;
  }
  if (rows.length === 0) return null;
  return (
    <div className="axis-table-wrap" style={{ marginTop: "0.75rem" }}>
      <table className="axis-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Devices</th>
            <th>Status</th>
            <th>Reported</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? `${row.userPrincipalName ?? "user"}:${index}`}>
              <td>
                <div>{row.userDisplayName?.trim() || row.userPrincipalName?.trim() || "—"}</div>
                {row.userDisplayName && row.userPrincipalName ? (
                  <div className="muted" style={{ fontSize: "0.75rem" }}>
                    {row.userPrincipalName}
                  </div>
                ) : null}
              </td>
              <td>{row.devicesCount ?? "—"}</td>
              <td>
                <span className={statusPillClass(row.status)}>{statusLabel(row.status)}</span>
              </td>
              <td title={row.lastReportedDateTime ?? undefined}>
                {formatRelative(row.lastReportedDateTime)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsPane({
  loading,
  generating,
  error,
  status,
  lastRefresh,
  rows,
  onGenerate,
}: {
  loading: boolean;
  generating: boolean;
  error: string | null;
  status: string;
  lastRefresh?: string | null;
  rows: ComplianceSettingStatusSummary[];
  onGenerate: () => void;
}) {
  return (
    <div>
      <div className="device-toolbar" style={{ marginTop: "0.75rem" }}>
        <p className="muted" style={{ margin: 0 }}>
          Per-setting compliance from Intune’s cached report. This is the same Generate report
          action as the portal.
        </p>
        <button
          type="button"
          className="axis-btn axis-btn-primary"
          disabled={generating}
          onClick={onGenerate}
        >
          {generating ? "Generating…" : rows.length ? "Regenerate report" : "Generate report"}
        </button>
      </div>
      {lastRefresh ? (
        <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.75rem" }}>
          Last refresh {formatRelative(lastRefresh)}
        </p>
      ) : null}
      {generating ? (
        <p className="muted">Intune is generating the setting report…</p>
      ) : status === "failed" ? (
        <p className="muted">The last report failed. Generate it again to retry.</p>
      ) : !loading && !error && rows.length === 0 ? (
        <p className="muted">No setting report yet. Generate a report to see the breakdown.</p>
      ) : rows.length ? (
        <div className="axis-table-wrap" style={{ marginTop: "0.75rem" }}>
          <table className="axis-table">
            <thead>
              <tr>
                <th>Setting</th>
                <th>Compliant</th>
                <th>Noncompliant</th>
                <th>Not evaluated</th>
                <th>Error</th>
                <th>Not applicable</th>
                <th>Other</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.settingId ?? `${row.settingName ?? "setting"}:${index}`}>
                  <td>{row.settingName?.trim() || "Setting"}</td>
                  <td>{row.numberOfCompliantDevices ?? 0}</td>
                  <td>{row.numberOfNonCompliantDevices ?? 0}</td>
                  <td>{row.numberOfUnknownDevices ?? 0}</td>
                  <td>{row.numberOfErrorDevices ?? 0}</td>
                  <td>{row.numberOfNotApplicableDevices ?? 0}</td>
                  <td>{row.numberOfOtherDevices ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
