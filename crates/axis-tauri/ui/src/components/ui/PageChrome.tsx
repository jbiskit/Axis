import type { MouseEvent, ReactNode } from "react";
import { useHeaderRefreshMenu } from "./ContextMenu";

export type SignalCardTone = "default" | "good" | "warn" | "bad";

export function SignalCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: SignalCardTone;
}) {
  return (
    <div className={`axis-panel signal-card${tone !== "default" ? ` tone-${tone}` : ""}`}>
      <p className="axis-kicker">{label}</p>
      <p className="signal-card-value tabular">{value}</p>
      {hint ? <p className="signal-card-hint">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  onContextMenu,
  onRefresh,
  refreshing,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const refreshMenu = useHeaderRefreshMenu(onRefresh, refreshing);
  return (
    <div
      className="page-header"
      title={onRefresh ? "Right-click to refresh all" : undefined}
      onContextMenu={onContextMenu ?? refreshMenu.onContextMenu}
    >
      <div className="page-header-copy">
        {eyebrow ? <div className="axis-kicker">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <div className="page-header-desc">{description}</div> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
      {refreshMenu.menuNode}
    </div>
  );
}

export function Panel({
  children,
  padded = false,
  className,
}: {
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section className={`axis-panel${padded ? " axis-panel-padded" : ""}${className ? ` ${className}` : ""}`}>
      {children}
    </section>
  );
}

export function PanelHead({ title, hint }: { title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="axis-panel-head">
      <h3>{title}</h3>
      {hint ? <p className="muted">{hint}</p> : null}
    </div>
  );
}

export function DistributionBar({
  title,
  data,
  emptyLabel = "No data",
}: {
  title: string;
  data: Array<{ label: string; count: number }>;
  emptyLabel?: string;
}) {
  const total = data.reduce((sum, row) => sum + row.count, 0) || 1;

  return (
    <div className="axis-panel dist-bar">
      <PanelHead title={title} />
      {data.length === 0 || data.every((row) => row.count === 0) ? (
        <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-xs)" }}>
          {emptyLabel}
        </p>
      ) : (
        <ul>
          {data.map((row) => {
            const pct = Math.round((row.count / total) * 100);
            return (
              <li key={row.label}>
                <div className="dist-bar-meta">
                  <span>{row.label}</span>
                  <span className="muted tabular">
                    {row.count} · {pct}%
                  </span>
                </div>
                <div className="dist-bar-track">
                  <div className="dist-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
