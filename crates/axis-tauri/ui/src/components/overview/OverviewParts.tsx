import type { ReactNode } from "react";
import { navigate } from "../../lib/route";
import { PageHeader } from "../ui/PageChrome";

// Shared pieces of the module overviews (approved board R396Bed9): quiet when healthy,
// problems flagged on the data with their action beside them, explanations in tooltips.

export type Tone = "bad" | "warn" | "quiet";

export type Kpi = {
  label: string;
  base: string;
  value: string;
  unit: string;
  fill: number;
  tick?: number;
  tone: Tone;
  foot: string;
  state: string;
  tip: string;
  href: string;
};

export type Issue = {
  key: string;
  tone: "bad" | "warn";
  item: string;
  detail?: string;
  area: string;
  count: number | null;
  since?: string;
  tip?: string;
  action: string;
  href: string;
};

export type ShareRow = { label: string; count: number; flag?: boolean };

export const count = (value: number) => value.toLocaleString();
export const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
export const plural = (n: number, word: string, many = `${word}s`) => `${count(n)} ${n === 1 ? word : many}`;

/** "now", "5m", a time today, "Yesterday", then a short date. */
export function since(value: string | null | undefined): string {
  const parsed = value ? Date.parse(value) : NaN;
  if (Number.isNaN(parsed)) return "—";
  const minutes = Math.floor((Date.now() - parsed) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (hours < 48) return "Yesterday";
  return new Date(parsed).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Rows grouped by a label, largest first; the tail past `top` folds into Other. */
export function shareRows(labels: string[], top = 4, flag?: (label: string) => boolean): ShareRow[] {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label || "Unknown", (counts.get(label || "Unknown") ?? 0) + 1);
  const sorted = [...counts].map(([label, value]) => ({ label, count: value, flag: flag?.(label) })).sort((a, b) => b.count - a.count);
  if (sorted.length <= top + 1) return sorted;
  return [...sorted.slice(0, top), { label: "Other", count: sorted.slice(top).reduce((sum, row) => sum + row.count, 0) }];
}

export function OverviewHeader({
  eyebrow,
  title = "Overview",
  description,
  fetchedAt,
  gaps,
  gapNoun = "query issue",
  loading,
  onRefresh,
}: {
  eyebrow?: string;
  title?: string;
  description?: ReactNode;
  fetchedAt: string | null;
  gaps: string[];
  gapNoun?: string;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      description={description}
      onRefresh={onRefresh}
      refreshing={loading}
      actions={
        <div className="ov-header-actions">
          {gaps.length > 0 ? (
            <details className="ov-gaps">
              <summary className="ov-pill is-warn">
                <span className="ov-dot" aria-hidden="true" />
                {plural(gaps.length, gapNoun)}
              </summary>
              <ul className="ov-gaps-list">
                {gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {fetchedAt ? (
            <span className="ov-muted ov-updated" title={new Date(fetchedAt).toLocaleString()}>
              Updated {since(fetchedAt)}
            </span>
          ) : null}
          <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      }
    />
  );
}

export function KpiTiles({ kpis }: { kpis: Kpi[] }) {
  return (
    <section className="ov-kpis" aria-label="Key numbers">
      {kpis.map((kpi) => (
        <button key={kpi.label} type="button" className={`ov-card ov-kpi is-${kpi.tone}`} title={kpi.tip} onClick={() => navigate(kpi.href)}>
          <span className="ov-row-line ov-muted">
            <span>{kpi.label}</span>
            <span>{kpi.base}</span>
          </span>
          <span className="ov-kpi-value">
            <span>{kpi.value}</span>
            <span className="ov-muted">{kpi.unit}</span>
          </span>
          <span className="ov-bullet">
            <span className="ov-bullet-fill" style={{ width: `${Math.max(0, Math.min(100, kpi.fill))}%` }} />
            {kpi.tick != null ? <span className="ov-bullet-tick" style={{ left: `${kpi.tick}%` }} /> : null}
          </span>
          <span className="ov-row-line">
            <span className="ov-muted">{kpi.foot}</span>
            <span className="ov-kpi-state">{kpi.state}</span>
          </span>
        </button>
      ))}
    </section>
  );
}

const SEVERITY = { bad: 0, warn: 1 };

export function AttentionTable({
  issues,
  countLabel = "Devices",
  loading,
}: {
  issues: Issue[];
  countLabel?: string;
  loading?: boolean;
}) {
  const sorted = [...issues].sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone]);
  return (
    <section className="ov-card ov-attention" aria-label="Needs attention">
      <div className="ov-card-head">
        <h2>Needs attention</h2>
        <span>{sorted.length === 0 ? (loading ? "Checking…" : "Nothing") : plural(sorted.length, "item")}</span>
      </div>
      {sorted.length === 0 ? (
        <p className="ov-empty">{loading ? "Loading…" : "All clear"}</p>
      ) : (
        <div className="ov-table-scroll">
          <table className="ov-table">
            <thead>
              <tr>
                <th aria-label="Severity" />
                <th>Item</th>
                <th>Area</th>
                <th className="num">{countLabel}</th>
                <th className="num">Since</th>
                <th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((issue) => (
                <tr key={issue.key}>
                  <td>
                    <span className={`ov-dot is-${issue.tone}`} aria-label={issue.tone === "bad" ? "Action needed" : "Attention"} />
                  </td>
                  <td title={issue.tip}>
                    {issue.item}
                    {issue.detail ? <span className="ov-muted"> · {issue.detail}</span> : null}
                  </td>
                  <td className="ov-muted">{issue.area}</td>
                  <td className="num">{issue.count == null ? "—" : count(issue.count)}</td>
                  <td className="num ov-muted">{issue.since ?? "—"}</td>
                  <td className="num">
                    <button type="button" className="axis-btn ov-action" onClick={() => navigate(issue.href)}>
                      {issue.action}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ShareCard({
  title,
  base,
  rows,
  className,
  empty = "—",
  of,
}: {
  title: string;
  base: string;
  rows: ShareRow[];
  className?: string;
  empty?: string;
  /** Denominator when rows overlap (one policy in several rows); defaults to the rows' sum. */
  of?: number;
}) {
  const total = of ?? rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <section className={`ov-card${className ? ` ${className}` : ""}`}>
      <div className="ov-card-head">
        <h2>{title}</h2>
        <span>{base}</span>
      </div>
      {rows.length === 0 ? <p className="ov-empty">{empty}</p> : null}
      {rows.map((row) => {
        const share = pct(row.count, total);
        const shareLabel = share > 0 && share < 1 ? "<1%" : `${Math.round(share)}%`;
        return (
          <div key={row.label} className={`ov-share${row.flag ? " is-warn" : ""}`}>
            <div className="ov-row-line">
              <span className="ov-share-label">{row.label}</span>
              <span>
                <span className="ov-muted ov-share-pct">{shareLabel}</span>
                {count(row.count)}
              </span>
            </div>
            <div className="ov-track">
              <span style={{ width: `${share}%` }} />
            </div>
          </div>
        );
      })}
    </section>
  );
}
