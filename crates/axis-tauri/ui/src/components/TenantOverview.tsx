import type { TenantGlance } from "../types/glance";
import { STALE_DEVICE_DAYS } from "../types/glance";
import { navigate } from "../lib/route";
import { TenantHealthPanel } from "./TenantHealthPanel";
import { ConfiguredObjectsPanel } from "./ConfiguredObjectsPanel";
import {
  DistributionBar,
  PageHeader,
  Panel,
  PanelHead,
  SignalCard,
} from "./ui/PageChrome";

/** `managedDeviceOwnerType` values, worded as the Intune portal shows them. */
const OWNERSHIP_LABELS: Record<string, string> = {
  company: "Corporate",
  personal: "Personal",
  unknown: "Unknown",
};

function actorLabel(event: TenantGlance["recentActivity"][number]): string {
  return (
    event.actor.displayName ||
    event.actor.userPrincipalName ||
    event.actor.appDisplayName ||
    "Unknown actor"
  );
}

function activityWhen(value: string): string {
  const parsed = Date.parse(value);
  if (!value || Number.isNaN(parsed)) return "Unknown time";
  const delta = Date.now() - parsed;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(parsed).toLocaleString();
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

  // Fleet shape: Windows releases (top six, rest grouped), ownership, encryption, enrollments.
  const releases = glance.devices.windowsReleases ?? [];
  const releaseBars = [
    ...releases.slice(0, 6),
    ...(releases.length > 6
      ? [{ label: "Other builds", count: releases.slice(6).reduce((sum, row) => sum + row.count, 0) }]
      : []),
  ];
  const ownershipBars = Object.entries(glance.devices.byOwnership ?? {})
    .map(([key, count]) => ({ label: OWNERSHIP_LABELS[key] ?? key, count }))
    .sort((a, b) => b.count - a.count);
  const encryptionReported = glance.devices.encryptionReported ?? 0;
  const encryptedPct =
    encryptionReported > 0 ? Math.round(((glance.devices.encrypted ?? 0) / encryptionReported) * 100) : null;
  const enrolled = glance.devices.enrolledLast30Days ?? [];
  const enrolledTotal = enrolled.reduce((sum, count) => sum + count, 0);
  const enrolledWeek = enrolled.slice(-7).reduce((sum, count) => sum + count, 0);
  const enrolledPeak = Math.max(1, ...enrolled);

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

      <TenantHealthPanel refreshKey={glance.fetchedAt} />

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
        <DistributionBar title="Windows releases" data={releaseBars} emptyLabel="No Windows devices" />
        <DistributionBar title="Ownership" data={ownershipBars} emptyLabel="No managed devices" />
      </div>

      <div className="overview-grid-2">
        <Panel padded>
          <PanelHead
            title="Enrollments, last 30 days"
            hint={`${enrolledTotal} enrolled · ${enrolledWeek} in the last 7 days`}
          />
          <div
            className="enroll-spark"
            role="img"
            aria-label={`Enrollments per day for the last 30 days, ${enrolledTotal} in total`}
          >
            {enrolled.map((count, index) => {
              const day = new Date(Date.now() - (enrolled.length - 1 - index) * 86_400_000);
              return (
                <span
                  key={index}
                  className={count === 0 ? "is-zero" : undefined}
                  style={{ height: `${Math.max(4, (count / enrolledPeak) * 100)}%` }}
                  title={`${day.toLocaleDateString()}: ${count} enrolled`}
                />
              );
            })}
          </div>
        </Panel>
        <SignalCard
          label="Encrypted"
          value={encryptedPct == null ? "—" : `${encryptedPct}%`}
          hint={
            encryptedPct == null
              ? "No devices report encryption"
              : `${glance.devices.encrypted ?? 0} of ${encryptionReported} reporting devices`
          }
          tone={encryptedPct == null ? "default" : encryptedPct >= 95 ? "good" : encryptedPct >= 80 ? "warn" : "bad"}
        />
      </div>

      <ConfiguredObjectsPanel inventory={glance.inventory} />

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
                    {item.deviceCheckinsImpacted != null
                      ? `${item.deviceCheckinsImpacted} device${item.deviceCheckinsImpacted === 1 ? "" : "s"} in conflict`
                      : `${item.policyCount} policies${item.settingCount > 0 ? ` · ${item.settingCount} settings` : ""}`}
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
          hint={
            glance.recentActivity.length > 0
              ? `Intune audit log · ${glance.recentActivity.length} latest`
              : "Intune audit log"
          }
        />
        {glance.recentActivity.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-xs)" }}>
            {glance.recentActivityWarning || "No Intune audit events in this tenant yet."}
          </p>
        ) : (
          <ul className="overview-list">
            {glance.recentActivity.map((event) => {
              const target = event.targetResources.filter(Boolean)[0];
              const result = event.result && event.result !== "Success" ? event.result : null;
              return (
                <li key={event.id}>
                  <p>{event.activityDisplayName}</p>
                  <p className="muted" style={{ margin: "0.15rem 0 0", fontSize: "var(--axis-text-2xs)" }}>
                    {activityWhen(event.activityDateTime)}
                    {target ? ` · ${target}` : ""}
                    {` · ${actorLabel(event)}`}
                    {event.category ? ` · ${event.category}` : ""}
                    {result ? ` · ${result}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          className="axis-btn"
          style={{ marginTop: "0.75rem" }}
          onClick={() => navigate("/intune/activity")}
        >
          Open write activity
        </button>
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
            {[...glance.inventory].sort((a, b) => b.count - a.count).map((item) => (
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
