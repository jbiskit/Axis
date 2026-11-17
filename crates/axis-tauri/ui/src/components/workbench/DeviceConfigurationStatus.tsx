import { useCallback, useEffect, useState } from "react";
import { fetchDeviceConfigurationDevices } from "../../lib/tauri";
import { plural, ShareCard, shareRows, since } from "../overview/OverviewParts";

type Row = Record<string, unknown>;

const text = (value: unknown) => (value == null ? "" : String(value));
const status = (row: Row) => text(row.ReportStatus_loc) || text(row.PolicyStatus) || "Unknown";
const problem = (label: string) => /error|conflict|fail/i.test(label);

/** Device status for a classic device configuration (update rings), from the portal's per-device report. */
export function DeviceConfigurationStatus({ policyId }: { policyId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchDeviceConfigurationDevices(policyId)
      .then(setRows)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [policyId]);

  useEffect(load, [load]);

  const list = rows ?? [];
  const sorted = [...list].sort((a, b) => Number(problem(status(b))) - Number(problem(status(a))) || text(a.DeviceName).localeCompare(text(b.DeviceName)));

  return (
    <div className="stack">
      <div className="ov-row-line">
        <span className="ov-muted">{rows ? plural(list.length, "device") : loading ? "Loading…" : ""}</span>
        <button type="button" className="axis-btn" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {rows && list.length === 0 ? (
        <p className="ov-empty">No devices have reported against this policy yet.</p>
      ) : null}
      {list.length > 0 ? (
        <>
          <ShareCard title="Status" base={plural(list.length, "device")} rows={shareRows(list.map(status), 5, problem)} />
          <section className="ov-card">
            <div className="ov-table-scroll">
              <table className="ov-table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>User</th>
                    <th>Status</th>
                    <th className="num">Last report</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row, index) => {
                    const label = status(row);
                    return (
                      <tr key={text(row.IntuneDeviceId) || index}>
                        <td title={[text(row.Manufacturer), text(row.Model), text(row.SerialNumber)].filter(Boolean).join(" · ")}>
                          {text(row.DeviceName) || "—"}
                        </td>
                        <td className="ov-muted">{text(row.UPN) || text(row.UserName) || "—"}</td>
                        <td>
                          <span className={`ov-dot is-${problem(label) ? "bad" : "quiet"}`} aria-hidden="true" /> {label}
                        </td>
                        <td className="num ov-muted">{since(text(row.PspdpuLastModifiedTimeUtc))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
