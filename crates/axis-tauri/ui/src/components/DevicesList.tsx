import { useMemo, useState } from "react";
import { STALE_DEVICE_DAYS, type ManagedDeviceSummary } from "../types/glance";
import {
  compareBool,
  compareIso,
  compareText,
  sortRows,
} from "../lib/listSelection";
import { PageHeader } from "./ui/PageChrome";
import { SortableTh, useColumnSort } from "./workbench/shared";

const STALE_SYNC_MS = STALE_DEVICE_DAYS * 24 * 60 * 60 * 1000;

type AttentionFilter = "" | "noncompliant" | "stale" | "unencrypted" | "attention";

function complianceClass(state: string | null | undefined): string {
  const value = (state ?? "").toLowerCase();
  if (value === "compliant") return "axis-pill axis-pill-success";
  if (value === "noncompliant") return "axis-pill axis-pill-danger";
  if (value === "ingraceperiod") return "axis-pill axis-pill-warning";
  return "axis-pill";
}

function formatRelative(iso?: string | null): string {
  if (!iso) return "Never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const delta = Date.now() - then;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function isNoncompliant(device: ManagedDeviceSummary): boolean {
  return (device.complianceState ?? "").toLowerCase() === "noncompliant";
}

function isStaleSync(device: ManagedDeviceSummary, now = Date.now()): boolean {
  if (!device.lastSyncDateTime) return true;
  const then = Date.parse(device.lastSyncDateTime);
  if (Number.isNaN(then)) return true;
  return now - then > STALE_SYNC_MS;
}

function isUnencrypted(device: ManagedDeviceSummary): boolean {
  return device.isEncrypted === false;
}

function needsAttention(device: ManagedDeviceSummary, now = Date.now()): boolean {
  return isNoncompliant(device) || isStaleSync(device, now) || isUnencrypted(device);
}

export function DevicesList({
  devices,
  loading,
  error,
  truncated,
  fetchedAt,
  onRefresh,
  onSelect,
  selectedId,
  compact = false,
}: {
  devices: ManagedDeviceSummary[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
  fetchedAt: string | null;
  onRefresh: () => void;
  onSelect?: (deviceId: string) => void;
  selectedId?: string | null;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [osFilter, setOsFilter] = useState("all");
  const [complianceFilter, setComplianceFilter] = useState("all");
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>("");
  const { sort, toggle: toggleSort } = useColumnSort<
    "name" | "user" | "os" | "compliance" | "lastCheckIn" | "model" | "encrypted"
  >("name");
  const now = useMemo(() => Date.now(), [devices]);

  const osOptions = useMemo(() => {
    const values = new Set(
      devices.map((device) => device.operatingSystem?.trim() || "Unknown"),
    );
    return ["all", ...[...values].sort()];
  }, [devices]);

  const complianceOptions = useMemo(() => {
    const values = new Set(
      devices.map((device) => device.complianceState?.trim() || "Unknown"),
    );
    return ["all", ...[...values].sort()];
  }, [devices]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = devices.filter((device) => {
      if (
        osFilter !== "all" &&
        (device.operatingSystem?.trim() || "Unknown") !== osFilter
      ) {
        return false;
      }
      if (
        complianceFilter !== "all" &&
        (device.complianceState?.trim() || "Unknown") !== complianceFilter
      ) {
        return false;
      }
      if (attentionFilter === "noncompliant" && !isNoncompliant(device)) return false;
      if (attentionFilter === "stale" && !isStaleSync(device, now)) return false;
      if (attentionFilter === "unencrypted" && !isUnencrypted(device)) return false;
      if (attentionFilter === "attention" && !needsAttention(device, now)) return false;
      if (!needle) return true;
      const haystack = [
        device.deviceName,
        device.userPrincipalName,
        device.operatingSystem,
        device.osVersion,
        device.model,
        device.manufacturer,
        device.complianceState,
        device.managementAgent,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
    return sortRows(rows, sort.dir, (a, b) => {
      switch (sort.key) {
        case "user":
          return compareText(a.userPrincipalName, b.userPrincipalName) || compareText(a.deviceName, b.deviceName);
        case "os":
          return (
            compareText(a.operatingSystem, b.operatingSystem) ||
            compareText(a.osVersion, b.osVersion) ||
            compareText(a.deviceName, b.deviceName)
          );
        case "compliance":
          return compareText(a.complianceState, b.complianceState) || compareText(a.deviceName, b.deviceName);
        case "lastCheckIn":
          return compareIso(a.lastSyncDateTime, b.lastSyncDateTime) || compareText(a.deviceName, b.deviceName);
        case "model":
          return (
            compareText([a.manufacturer, a.model].filter(Boolean).join(" "), [b.manufacturer, b.model].filter(Boolean).join(" ")) ||
            compareText(a.deviceName, b.deviceName)
          );
        case "encrypted":
          return compareBool(a.isEncrypted, b.isEncrypted) || compareText(a.deviceName, b.deviceName);
        default:
          return compareText(a.deviceName, b.deviceName) || compareText(a.id, b.id);
      }
    });
  }, [attentionFilter, complianceFilter, devices, now, osFilter, query, sort]);

  const countLabel = loading
    ? "Loading…"
    : `${filtered.length} of ${devices.length} device${devices.length === 1 ? "" : "s"}`;

  const filters = (
    <div className="device-toolbar" style={compact ? { flexDirection: "column", alignItems: "stretch" } : undefined}>
      <label className="device-field">
        Search
        <input
          className="axis-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, user, model…"
        />
      </label>
      <label className="device-field">
        OS
        <select
          className="axis-input"
          value={osFilter}
          onChange={(event) => setOsFilter(event.target.value)}
        >
          {osOptions.map((option) => (
            <option key={option} value={option}>
              {option === "all" ? "All OS" : option}
            </option>
          ))}
        </select>
      </label>
      <label className="device-field">
        Compliance
        <select
          className="axis-input"
          value={complianceFilter}
          onChange={(event) => setComplianceFilter(event.target.value)}
        >
          {complianceOptions.map((option) => (
            <option key={option} value={option}>
              {option === "all" ? "All states" : option}
            </option>
          ))}
        </select>
      </label>
      <label className="device-field">
        Attention
        <select
          className="axis-input"
          value={attentionFilter}
          onChange={(event) => setAttentionFilter(event.target.value as AttentionFilter)}
        >
          <option value="">All devices</option>
          <option value="attention">Needs attention</option>
          <option value="noncompliant">Noncompliant</option>
          <option value="stale">Stale sync</option>
          <option value="unencrypted">Not encrypted</option>
        </select>
      </label>
      <p className="muted" style={{ margin: 0, fontSize: "0.6875rem", alignSelf: compact ? "start" : "end" }}>
        {countLabel}
      </p>
    </div>
  );

  if (compact) {
    return (
      <div className="device-list-compact">
        <div className="device-inspector-head">
          <div>
            <h1 style={{ fontSize: "0.95rem" }}>Devices</h1>
            <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.6875rem" }}>
              Select a device to inspect it here.
            </p>
          </div>
          <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {truncated ? (
          <div className="axis-alert axis-alert-warning">
            Showing the first {devices.length} devices.
          </div>
        ) : null}
        {filters}
        {loading && devices.length === 0 ? (
          <p className="muted">Loading managed devices…</p>
        ) : !loading && filtered.length === 0 ? (
          <p className="muted">No devices match these filters.</p>
        ) : (
          <ul className="device-card-list">
            {filtered.map((device) => {
              const selected = device.id === selectedId;
              const noncompliant = isNoncompliant(device);
              const stale = isStaleSync(device, now);
              const unencrypted = isUnencrypted(device);
              return (
                <li key={device.id}>
                  <button
                    type="button"
                    className={`device-card${selected ? " selected" : ""}${
                      !selected && noncompliant ? " noncompliant" : ""
                    }${!selected && (stale || unencrypted) && !noncompliant ? " attention" : ""}`}
                    onClick={() => onSelect?.(device.id)}
                  >
                    <p className="device-card-name">{device.deviceName}</p>
                    <p className="device-card-meta">
                      {device.userPrincipalName ?? "No user"}
                      {device.operatingSystem ? ` · ${device.operatingSystem}` : ""}
                    </p>
                    <div className="device-card-flags">
                      <span className={complianceClass(device.complianceState)}>
                        {device.complianceState ?? "unknown"}
                      </span>
                      <span className="muted" style={stale ? { color: "var(--axis-warning)" } : undefined}>
                        {formatRelative(device.lastSyncDateTime)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="All devices"
        description={
          <>
            Managed Intune devices from Graph · Live Graph
            {fetchedAt ? ` · Updated ${new Date(fetchedAt).toLocaleString()}` : ""}
            . Select a row to inspect it in this workspace.
          </>
        }
        actions={
          <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}

      {truncated ? (
        <div className="axis-alert axis-alert-warning">
          Showing the first {devices.length} devices. Full pagination comes later.
        </div>
      ) : null}

      <div className="searchable-table">
      {filters}

      <section className="axis-panel">
        {loading && devices.length === 0 ? (
          <p className="muted" style={{ margin: 0, padding: "1.25rem" }}>
            Loading managed devices…
          </p>
        ) : !loading && devices.length === 0 && !error ? (
          <p className="muted" style={{ margin: 0, padding: "1.25rem" }}>
            No managed devices returned for this tenant.
          </p>
        ) : !loading && filtered.length === 0 ? (
          <p className="muted" style={{ margin: 0, padding: "1.25rem" }}>
            No devices match these filters.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="axis-table">
              <thead>
                <tr>
                  <SortableTh column="name" label="Name" sort={sort} onSort={toggleSort} />
                  <SortableTh column="user" label="User" sort={sort} onSort={toggleSort} />
                  <SortableTh column="os" label="OS" sort={sort} onSort={toggleSort} />
                  <SortableTh column="compliance" label="Compliance" sort={sort} onSort={toggleSort} />
                  <SortableTh column="lastCheckIn" label="Last check-in" sort={sort} onSort={toggleSort} />
                  <SortableTh column="model" label="Model" sort={sort} onSort={toggleSort} />
                  <SortableTh column="encrypted" label="Encrypted" sort={sort} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((device) => {
                  const stale = isStaleSync(device, now);
                  return (
                    <tr
                      key={device.id}
                      className={
                        onSelect
                          ? `row-link${selectedId === device.id ? " selected" : ""}`
                          : undefined
                      }
                      onClick={() => onSelect?.(device.id)}
                    >
                      <td style={{ fontWeight: 500 }}>{device.deviceName}</td>
                      <td className="muted">{device.userPrincipalName ?? "No user"}</td>
                      <td className="muted">
                        {device.operatingSystem ?? "Unknown"}
                        {device.osVersion ? (
                          <span style={{ display: "block", fontSize: "0.6875rem" }}>
                            {device.osVersion}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span className={complianceClass(device.complianceState)}>
                          {device.complianceState ?? "unknown"}
                        </span>
                      </td>
                      <td className={stale ? undefined : "muted"} style={stale ? { color: "var(--axis-warning)" } : undefined}>
                        {formatRelative(device.lastSyncDateTime)}
                      </td>
                      <td className="muted">
                        {[device.manufacturer, device.model].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="muted">
                        {device.isEncrypted == null
                          ? "—"
                          : device.isEncrypted
                            ? "Yes"
                            : "No"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
