import { formatRelative } from "./shared";

type StatusPayload = {
  total?: number;
  rows?: Array<Record<string, unknown>>;
};

function asRows(value: unknown): { total: number; rows: Array<Record<string, unknown>> } {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as StatusPayload)
    : {};
  const rows = Array.isArray(record.rows) ? record.rows : [];
  const total = typeof record.total === "number" ? record.total : rows.length;
  return { total, rows };
}

function cell(row: Record<string, unknown>, key: string): string {
  const fallbacks: Record<string, string> = {
    AppInstallState: "InstallState",
    HexErrorCode: "ErrorCode",
    UserPrincipalName: "UserName",
  };
  let value = row[key];
  if ((value == null || value === "") && fallbacks[key]) value = row[fallbacks[key]];
  if (value == null || value === "") return "—";
  if (typeof value === "string" && /DateTime$/i.test(key)) return formatRelative(value);
  return String(value);
}

function StatusTable({
  title,
  columns,
  payload,
}: {
  title: string;
  columns: Array<{ key: string; label: string }>;
  payload: unknown;
}) {
  const { total, rows } = asRows(payload);
  return (
    <section className="axis-panel" style={{ padding: "0.85rem" }}>
      <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
        {title} ({total})
      </h2>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No rows.
        </p>
      ) : (
        <table className="axis-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={String(row.DeviceId ?? row.UserId ?? index)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.key === columns[0].key ? undefined : "muted"}>
                    {cell(row, column.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {total > rows.length ? (
        <p className="muted" style={{ margin: "0.5rem 0 0" }}>
          This list stops at {rows.length} rows.
        </p>
      ) : null}
    </section>
  );
}

export function StoreInstallStatus({
  devices,
  users,
}: {
  devices: unknown;
  users: unknown;
}) {
  return (
    <>
      <StatusTable
        title="Device install status"
        payload={devices}
        columns={[
          { key: "DeviceName", label: "Device" },
          { key: "UserPrincipalName", label: "User" },
          { key: "Platform", label: "Platform" },
          { key: "AppInstallState", label: "Install state" },
          { key: "HexErrorCode", label: "Error" },
          { key: "AppVersion", label: "Version" },
          { key: "LastModifiedDateTime", label: "Last modified" },
        ]}
      />
      <StatusTable
        title="User install status"
        payload={users}
        columns={[
          { key: "UserPrincipalName", label: "User" },
          { key: "InstalledCount", label: "Installed" },
          { key: "FailedCount", label: "Failed" },
          { key: "PendingInstallCount", label: "Pending" },
          { key: "NotInstalledCount", label: "Not installed" },
          { key: "NotApplicableCount", label: "Not applicable" },
        ]}
      />
    </>
  );
}
