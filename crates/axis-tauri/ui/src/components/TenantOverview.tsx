import type { TenantGlance } from "../types/glance";
import { STALE_DEVICE_DAYS } from "../types/glance";
import {
  DistributionBar,
  PageHeader,
  Panel,
  PanelHead,
  SignalCard,
} from "./ui/PageChrome";

function actorLabel(event: TenantGlance["recentActivity"][number]): string {
  return (
    event.actor.displayName ||
    event.actor.userPrincipalName ||
    event.actor.appDisplayName ||
    "Unknown actor"
  );
}

export function TenantOverview({
  glance,
  loading,
  error,
  accountName,
  onRefresh,
}: {
  glance: TenantGlance | null;
  loading: boolean;
  error: string | null;
  accountName: string | null;
  onRefresh: () => void;
}) {
  if (!glance && loading) {
    return <p className="muted">Loading tenant overview…</p>;
  }

  if (!glance) {
    return <p className="muted">No tenant data available yet.</p>;
  }

  const inventory = [...glance.inventory].sort((a, b) => b.count - a.count);
  const organizationLabel = glance.organizationName;
  const failureTotal =
    (glance.failures.appFailedDeviceCount ?? 0) +
    glance.failures.configNoncompliantDevices +
    glance.failures.configErrorDevices;
  const appFailureDisplay =
    glance.failures.appFailedDeviceCount == null
      ? "—"
      : glance.failures.appFailedDeviceCount;

  const complianceBars = [
    { label: "Compliant", count: glance.compliance.compliant },
    { label: "Noncompliant", count: glance.compliance.noncompliant },
    { label: "Grace period", count: glance.compliance.inGracePeriod },
    { label: "Unknown", count: glance.compliance.unknown },
  ].filter((row) => row.count > 0);

  const checkInBars = [
    { label: "Active", count: glance.devices.active },
    { label: `Stale (>${STALE_DEVICE_DAYS}d)`, count: glance.devices.stale },
  ];

  return (
    <div className="stack">
      <PageHeader
        title={organizationLabel || "Intune overview"}
        description={
          <>
            {accountName ? `${accountName} · ` : null}
            Live Graph · Updated {new Date(glance.fetchedAt).toLocaleString()}
          </>
        }
        actions={
          <button
            type="button"
            className="axis-btn"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {error ? (
        <div className="axis-alert axis-alert-warning">
          Graph request failed. {error}
        </div>
      ) : null}

      {glance.permissionWarnings.length > 0 ? (
        <div className="axis-alert axis-alert-danger">
          <p style={{ margin: 0, fontWeight: 500 }}>Permission / consent failures</p>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1rem" }}>
            {glance.permissionWarnings.map((warning) => (
              <li key={warning} style={{ wordBreak: "break-all" }}>
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {glance.otherWarnings.length > 0 ? (
        <div className="axis-alert axis-alert-warning">
          <p style={{ margin: 0, fontWeight: 500 }}>Other Graph query issues</p>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1rem" }}>
            {glance.otherWarnings.slice(0, 8).map((warning) => (
              <li key={warning} style={{ wordBreak: "break-all" }}>
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overview-grid-6">
        <SignalCard
          label="Conflicts"
          value={glance.conflicts.summaryCount}
          hint={
            glance.conflicts.devicesImpacted > 0
              ? `${glance.conflicts.devicesImpacted} check-ins impacted`
              : "Config conflict sets"
          }
          tone={glance.conflicts.summaryCount > 0 ? "bad" : "good"}
        />
        <SignalCard
          label="Active"
          value={glance.devices.active}
          hint={`Synced within ${STALE_DEVICE_DAYS}d`}
          tone="good"
        />
        <SignalCard
          label="Stale"
          value={glance.devices.stale}
          hint={`No sync in ${STALE_DEVICE_DAYS}+ days`}
          tone={glance.devices.stale > 0 ? "warn" : "good"}
        />
        <SignalCard
          label="Noncompliant"
          value={glance.compliance.noncompliant}
          hint={
            glance.compliance.ratePercent != null
              ? `${glance.compliance.ratePercent}% compliant`
              : "Device compliance"
          }
          tone={glance.compliance.noncompliant > 0 ? "bad" : "good"}
        />
        <SignalCard
          label="Failures"
          value={
            glance.failures.appFailedDeviceCount == null && failureTotal === 0
              ? "—"
              : glance.failures.appFailedDeviceCount == null
                ? glance.failures.configNoncompliantDevices +
                  glance.failures.configErrorDevices
                : failureTotal
          }
          hint={`Apps ${appFailureDisplay} · Config ${
            glance.failures.configNoncompliantDevices +
            glance.failures.configErrorDevices
          }`}
          tone={
            glance.failures.appFailedDeviceCount == null &&
            glance.failures.configNoncompliantDevices +
              glance.failures.configErrorDevices ===
              0
              ? "default"
              : failureTotal > 0
                ? "bad"
                : "good"
          }
        />
        {glance.drift ? (
          <SignalCard
            label="Drift fails"
            value={glance.drift.fail}
            hint={
              glance.drift.incomplete
                ? "Partial check"
                : `${glance.drift.pass} pass · ${glance.drift.unknown} unknown`
            }
            tone={
              glance.drift.fail > 0
                ? "bad"
                : glance.drift.incomplete
                  ? "warn"
                  : "good"
            }
          />
        ) : null}
      </div>

      <div className="overview-grid-2">
        <DistributionBar title="Compliance mix" data={complianceBars} />
        <DistributionBar
          title="Check-in freshness"
          data={checkInBars}
          emptyLabel="No managed devices"
        />
      </div>

      <div className="overview-grid-2">
        <Panel padded>
          <PanelHead title="Conflicts" />
          {glance.conflicts.items.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-xs)" }}>
              {glance.conflicts.warning || "No configuration conflict summaries."}
            </p>
          ) : (
            <ul className="overview-list">
              {glance.conflicts.items.map((item) => (
                <li key={item.id}>
                  <p>{item.label}</p>
                  <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "var(--axis-text-2xs)" }}>
                    {item.policyCount} policies
                    {item.settingCount > 0 ? ` · ${item.settingCount} settings` : ""}
                    {item.deviceCheckinsImpacted != null
                      ? ` · ${item.deviceCheckinsImpacted} check-ins`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel padded>
          <PanelHead title="Failures" />
          <dl className="stat-rows">
            <div>
              <dt className="muted">App install failures</dt>
              <dd className="tabular" style={{ margin: 0 }}>
                {appFailureDisplay}
              </dd>
            </div>
            <div>
              <dt className="muted">Noncompliant devices (config/compliance)</dt>
              <dd className="tabular" style={{ margin: 0 }}>
                {glance.failures.configNoncompliantDevices}
              </dd>
            </div>
            <div>
              <dt className="muted">Error / failed state</dt>
              <dd className="tabular" style={{ margin: 0 }}>
                {glance.failures.configErrorDevices}
              </dd>
            </div>
          </dl>
          {glance.failures.warning ? (
            <p className="muted" style={{ margin: "0.55rem 0 0", fontSize: "var(--axis-text-2xs)" }}>
              {glance.failures.warning}
            </p>
          ) : null}
        </Panel>
      </div>

      <Panel padded>
        <PanelHead
          title="Recent activity"
          hint={`Entra directory audits (latest ${glance.recentActivity.length || 20})`}
        />
        {glance.recentActivity.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-xs)" }}>
            {glance.recentActivityWarning || "No recent directory audit events."}
          </p>
        ) : (
          <div className="axis-table-wrap">
            <table className="axis-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Activity</th>
                  <th>Actor</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {glance.recentActivity.map((event) => (
                  <tr key={event.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {new Date(event.activityDateTime).toLocaleString()}
                    </td>
                    <td>
                      {event.activityDisplayName}
                      {event.targetResources[0] ? (
                        <span
                          className="muted"
                          style={{ display: "block", fontSize: "0.6875rem" }}
                        >
                          {event.targetResources.join(", ")}
                        </span>
                      ) : null}
                    </td>
                    <td className="muted">{actorLabel(event)}</td>
                    <td className="muted">{event.result || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {glance.drift ? (
        <Panel padded>
          <PanelHead
            title="Potential policy drift"
            hint={`vs ${glance.drift.baselineName}${glance.drift.incomplete ? " · incomplete settings scan" : ""}`}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.5rem", fontSize: "0.75rem" }}>
            <p style={{ margin: 0 }}>
              <span className="muted">Pass </span>
              <span style={{ color: "var(--axis-success)" }}>{glance.drift.pass}</span>
            </p>
            <p style={{ margin: 0 }}>
              <span className="muted">Fail </span>
              <span style={{ color: "var(--axis-danger)" }}>{glance.drift.fail}</span>
            </p>
            <p style={{ margin: 0 }}>
              <span className="muted">Unknown </span>
              <span className="muted">{glance.drift.unknown}</span>
            </p>
          </div>
          {glance.drift.failingChecks.length > 0 ? (
            <ul className="overview-list">
              {glance.drift.failingChecks.map((check) => (
                <li key={check.id}>
                  <p>{check.title}</p>
                  <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "var(--axis-text-2xs)" }}>
                    {check.message}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "var(--axis-text-xs)" }}>
              {glance.drift.warning ||
                (glance.drift.fail === 0
                  ? "No failing baseline checks in this pass."
                  : null)}
            </p>
          )}
        </Panel>
      ) : null}

      {glance.tokenScopes.length > 0 ? (
        <details className="axis-panel" style={{ padding: "0.5rem 0.75rem", fontSize: "0.75rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 500 }}>
            Token scopes ({glance.tokenScopes.length})
          </summary>
          <p className="mono-code muted" style={{ margin: "0.375rem 0 0", wordBreak: "break-all" }}>
            {glance.tokenScopes.join(" · ")}
          </p>
        </details>
      ) : null}

      <details className="axis-panel" style={{ overflow: "hidden" }}>
        <summary
          style={{
            cursor: "pointer",
            padding: "0.5rem 0.75rem",
            borderBottom: "1px solid var(--axis-border)",
            fontSize: "0.75rem",
            fontWeight: 600,
          }}
        >
          Full Graph inventory
        </summary>
        <div style={{ padding: "0.5rem 0.75rem" }}>
          <p className="muted" style={{ margin: 0, fontSize: "0.6875rem" }}>
            Endpoint map aligned with IntuneManagement (one API family per row, Graph beta).
          </p>
        </div>
        <table className="axis-table">
          <thead style={{ background: "var(--axis-surface-2)" }}>
            <tr>
              <th>Object type</th>
              <th>Category</th>
              <th>Count</th>
              <th>Graph API</th>
            </tr>
          </thead>
          <tbody>
            {inventory.map((item) => (
              <tr key={item.id}>
                <td style={{ fontWeight: 500 }}>
                  {item.title}
                  {item.error ? (
                    <span
                      style={{
                        display: "block",
                        marginTop: "0.125rem",
                        fontSize: "0.6875rem",
                        fontWeight: 400,
                        color: "var(--axis-warning)",
                      }}
                    >
                      {item.permissionRelated ? "Permission denied" : "Query failed"}
                      {item.status ? ` · HTTP ${item.status}` : ""}
                      {item.code ? ` · ${item.code}` : ""}
                      {item.error ? ` — ${item.error}` : ""}
                    </span>
                  ) : null}
                </td>
                <td className="muted">{item.category}</td>
                <td>{item.count}</td>
                <td className="mono-code muted">{item.api}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
