import type { TenantGlance } from "../types/glance";
import { STALE_DEVICE_DAYS } from "../types/glance";
import { navigate } from "../lib/route";
import { useDebugTools } from "../lib/debugTools";
import { healthTitle, healthValue, TenantHealthColumn, useTenantHealth } from "./TenantHealthPanel";
import {
  AttentionTable,
  count,
  KpiTiles,
  OverviewHeader,
  pct,
  ShareCard,
  since,
  type Issue,
  type Kpi,
  type ShareRow,
} from "./overview/OverviewParts";

// Targets are fixed until Settings has them.
const COMPLIANCE_TARGET = 95;
const ENCRYPTION_TARGET = 95;
const STALE_LIMIT = 3;

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
  const health = useTenantHealth(glance?.fetchedAt ?? "");
  const debugTools = useDebugTools();

  if (!glance && loading) {
    return <p className="muted">Loading tenant overview…</p>;
  }

  if (!glance) {
    return <p className="muted">No tenant data available yet.</p>;
  }

  const { devices, compliance, failures, conflicts, drift } = glance;
  const total = devices.total;
  const appFailed = failures.appFailedDeviceCount;
  const configFailed = failures.configNoncompliantDevices + failures.configErrorDevices;
  const failureTotal = (appFailed ?? 0) + configFailed;
  const failuresKnown = appFailed != null || configFailed > 0;
  const stalePct = pct(devices.stale, total);
  const encryptionReported = devices.encryptionReported ?? 0;
  const encryptedPct = encryptionReported > 0 ? pct(devices.encrypted ?? 0, encryptionReported) : null;
  const rate = compliance.ratePercent;

  const kpis: Kpi[] = [
    {
      label: "Compliant",
      base: `Target ${COMPLIANCE_TARGET}%`,
      value: rate == null ? "—" : `${rate}%`,
      unit: `of ${count(total)}`,
      fill: rate ?? 0,
      tick: COMPLIANCE_TARGET,
      tone: rate == null || rate >= COMPLIANCE_TARGET ? "quiet" : "warn",
      foot: `${count(compliance.noncompliant)} noncompliant`,
      state: rate == null ? "" : rate >= COMPLIANCE_TARGET ? "Healthy" : "Below target",
      tip: `${count(compliance.compliant)} compliant · ${count(compliance.noncompliant)} noncompliant · ${count(compliance.inGracePeriod)} in grace period · ${count(compliance.unknown)} unknown`,
      href: "/intune/devices/compliance",
    },
    {
      label: "Stale",
      base: `No sync ${STALE_DEVICE_DAYS} d`,
      value: count(devices.stale),
      unit: "devices",
      fill: stalePct,
      tick: STALE_LIMIT,
      tone: stalePct > STALE_LIMIT ? "warn" : "quiet",
      foot: `${stalePct.toFixed(1)}% of fleet`,
      state: stalePct > STALE_LIMIT ? `Over ${STALE_LIMIT}%` : "Healthy",
      tip: `Managed devices with no check-in for ${STALE_DEVICE_DAYS} days`,
      href: "/intune/devices/all",
    },
    {
      label: "Failures",
      base: "Apps · Config",
      value: failuresKnown ? count(failureTotal) : "—",
      unit: "devices",
      fill: failureTotal > 0 ? 100 : 0,
      tone: failureTotal > 0 ? "bad" : "quiet",
      foot: `${appFailed == null ? "—" : count(appFailed)} apps · ${count(configFailed)} config`,
      state: failureTotal > 0 ? "Act" : failuresKnown ? "Clear" : "",
      tip: failures.warning || "Devices with a failed app install, or a configuration error or noncompliant state",
      href: "/intune/apps",
    },
    {
      label: "Conflicts",
      base: "Settings",
      value: count(conflicts.summaryCount),
      unit: "settings",
      fill: conflicts.summaryCount > 0 ? 100 : 0,
      tone: conflicts.summaryCount > 0 ? "bad" : "quiet",
      foot: `${count(conflicts.devicesImpacted)} devices`,
      state: conflicts.summaryCount > 0 ? "Act" : "Clear",
      tip: conflicts.warning || "Settings set to different values by two or more policies",
      href: "/intune/policies/device-configuration",
    },
    {
      label: "Encrypted",
      base: `Target ${ENCRYPTION_TARGET}%`,
      value: encryptedPct == null ? "—" : `${Math.round(encryptedPct)}%`,
      unit: `of ${count(encryptionReported)}`,
      fill: encryptedPct ?? 0,
      tick: ENCRYPTION_TARGET,
      tone: encryptedPct == null || encryptedPct >= ENCRYPTION_TARGET ? "quiet" : "warn",
      foot: `${count(devices.encrypted ?? 0)} encrypted`,
      state: encryptedPct == null ? "" : encryptedPct >= ENCRYPTION_TARGET ? "Healthy" : "Below target",
      tip: "Devices reporting BitLocker or FileVault encryption",
      href: "/intune/devices/all",
    },
  ];

  const issues: Issue[] = [
    ...health.inUse
      .filter((item) => item.status === "error" || item.status === "warning")
      .map<Issue>((item, index) => ({
        key: `health-${item.key}-${index}`,
        tone: item.status === "error" ? "bad" : "warn",
        item: healthTitle(item),
        area: "Tenant",
        count: null,
        since: healthValue(item),
        tip: item.detail,
        action: "Open connectors",
        href: "/intune/tenant-admin/connectors",
      })),
    ...conflicts.items.map<Issue>((item) => ({
      key: `conflict-${item.id}`,
      tone: "bad",
      item: item.label,
      detail: `${item.settingCount} setting${item.settingCount === 1 ? "" : "s"} conflict`,
      area: "Conflict",
      count: item.deviceCheckinsImpacted,
      tip: `${item.policyCount} policies`,
      action: "Open policies",
      href: "/intune/policies/device-configuration",
    })),
    ...(appFailed ? [{
      key: "app-failures",
      tone: "bad" as const,
      item: "App installs",
      detail: "failed",
      area: "App",
      count: appFailed,
      tip: failures.appFailureSampleSize ? `Sampled from ${failures.appFailureSampleSize} apps` : undefined,
      action: "Open apps",
      href: "/intune/apps",
    }] : []),
    ...(failures.configErrorDevices > 0 ? [{
      key: "config-errors",
      tone: "bad" as const,
      item: "Configuration profiles",
      detail: "error state",
      area: "Config",
      count: failures.configErrorDevices,
      action: "Open profiles",
      href: "/intune/policies/device-configuration",
    }] : []),
    ...(compliance.noncompliant > 0 ? [{
      key: "noncompliant",
      tone: "warn" as const,
      item: "Noncompliant devices",
      detail: compliance.inGracePeriod > 0 ? `${count(compliance.inGracePeriod)} in grace` : undefined,
      area: "Compliance",
      count: compliance.noncompliant,
      action: "Open list",
      href: "/intune/devices/compliance",
    }] : []),
    ...(stalePct > STALE_LIMIT ? [{
      key: "stale",
      tone: "warn" as const,
      item: "Stale devices",
      detail: `no check-in ${STALE_DEVICE_DAYS} d`,
      area: "Devices",
      count: devices.stale,
      action: "Review",
      href: "/intune/devices/all",
    }] : []),
    ...(encryptedPct != null && encryptedPct < ENCRYPTION_TARGET ? [{
      key: "encryption",
      tone: "warn" as const,
      item: "Unencrypted devices",
      area: "Devices",
      count: encryptionReported - (devices.encrypted ?? 0),
      action: "Review",
      href: "/intune/devices/all",
    }] : []),
    ...(drift && drift.fail > 0 ? [{
      key: "drift",
      tone: "warn" as const,
      item: drift.baselineName,
      detail: `${drift.fail} setting${drift.fail === 1 ? "" : "s"} drifted`,
      area: "Drift",
      count: null,
      tip: drift.failingChecks.map((check) => check.title).join(" · ") || undefined,
      action: "Open packs",
      href: "/intune/packs",
    }] : []),
  ];

  const releases = devices.windowsReleases ?? [];
  const releaseRows: ShareRow[] = [
    ...releases.slice(0, 3),
    ...(releases.length > 3 ? [{ label: "Other", count: releases.slice(3).reduce((sum, row) => sum + row.count, 0) }] : []),
  ];
  const windowsTotal = releases.reduce((sum, row) => sum + row.count, 0);
  const complianceRows: ShareRow[] = [
    { label: "Compliant", count: compliance.compliant },
    { label: "Noncompliant", count: compliance.noncompliant, flag: true },
    { label: "Grace period", count: compliance.inGracePeriod },
    { label: "Unknown", count: compliance.unknown },
  ].filter((row) => row.count > 0);
  const ownershipRows: ShareRow[] = Object.entries(devices.byOwnership ?? {})
    .map(([key, value]) => ({ label: OWNERSHIP_LABELS[key] ?? key, count: value }))
    .sort((a, b) => b.count - a.count);

  const enrolled = devices.enrolledLast30Days ?? [];
  const enrolledTotal = enrolled.reduce((sum, value) => sum + value, 0);
  const enrolledWeek = enrolled.slice(-7).reduce((sum, value) => sum + value, 0);
  const enrolledPeak = Math.max(1, ...enrolled);
  const dayLabel = (offset: number) =>
    new Date(Date.now() - offset * 86_400_000).toLocaleDateString([], { day: "numeric", month: "short" });

  return (
    <div className="stack ov-page">
      <OverviewHeader
        description={[glance.organizationName, accountName].filter(Boolean).join(" · ") || "Intune"}
        fetchedAt={glance.fetchedAt}
        gaps={[...glance.permissionWarnings, ...glance.otherWarnings]}
        gapNoun={glance.permissionWarnings.length > 0 ? "permission gap" : "query issue"}
        loading={loading}
        onRefresh={onRefresh}
      />

      {error ? <div className="axis-alert axis-alert-warning">Graph request failed. {error}</div> : null}

      <KpiTiles kpis={kpis} />

      <div className="ov-split">
        <AttentionTable issues={issues} />
        <TenantHealthColumn {...health} />
      </div>

      <div className="ov-shares">
        <ShareCard title="Windows releases" base={`${count(windowsTotal)} devices`} rows={releaseRows} />
        <ShareCard title="Compliance" base={`${count(total)} devices`} rows={complianceRows} />
        <ShareCard title="Ownership" base={`${count(total)} devices`} rows={ownershipRows} />
      </div>

      <div className="ov-split ov-split-even">
        <section className="ov-card" aria-label="Enrollments">
          <div className="ov-card-head">
            <h2>Enrollments</h2>
            <span>30 days</span>
            <span className="ov-card-head-end">
              <span className="ov-strong">{count(enrolledTotal)}</span> · {count(enrolledWeek)} this week
            </span>
          </div>
          <div className="ov-enroll" role="img" aria-label={`Enrollments per day for the last 30 days, ${enrolledTotal} in total`}>
            {enrolled.map((value, index) => {
              const offset = enrolled.length - 1 - index;
              return (
                <span
                  key={index}
                  className={offset === 0 ? "is-today" : undefined}
                  style={{ height: `${Math.max(2, (value / enrolledPeak) * 100)}%` }}
                  title={`${dayLabel(offset)}: ${value} enrolled`}
                />
              );
            })}
          </div>
          <div className="ov-row-line ov-axis">
            <span>{dayLabel(enrolled.length - 1)}</span>
            <span>{dayLabel(Math.floor(enrolled.length / 2))}</span>
            <span>Today</span>
          </div>
        </section>

        <section className="ov-card" aria-label="Recent activity">
          <div className="ov-card-head">
            <h2>Recent activity</h2>
            <button type="button" className="ov-link" onClick={() => navigate("/intune/activity")}>
              All activity
            </button>
          </div>
          {glance.recentActivity.length === 0 ? (
            <p className="ov-empty">{glance.recentActivityWarning || "No Intune audit events yet"}</p>
          ) : (
            <ul className="ov-activity">
              {glance.recentActivity.map((event) => {
                const target = event.targetResources.filter(Boolean)[0];
                const actor = actorLabel(event);
                const failed = event.result && event.result !== "Success";
                return (
                  <li key={event.id} title={[event.category, event.result].filter(Boolean).join(" · ")}>
                    <span className="ov-muted">{since(event.activityDateTime)}</span>
                    <span className="ov-activity-what">
                      {event.activityDisplayName}
                      {target ? <span className="ov-muted"> {target}</span> : null}
                    </span>
                    <span className={failed ? "is-bad" : actor.startsWith("Axis") ? "is-axis" : "ov-muted"}>
                      {failed ? event.result : actor}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {debugTools ? (
      <details className="axis-panel ov-diagnostics">
        <summary>Graph inventory and token scopes</summary>
        {glance.tokenScopes.length > 0 ? (
          <p className="mono-code muted" style={{ margin: "0.5rem 0.75rem", wordBreak: "break-all" }}>
            {glance.tokenScopes.join(" · ")}
          </p>
        ) : null}
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
                    <span style={{ display: "block", marginTop: "0.125rem", fontSize: "0.6875rem", fontWeight: 400, color: "var(--axis-warning)" }}>
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
      ) : null}
    </div>
  );
}
