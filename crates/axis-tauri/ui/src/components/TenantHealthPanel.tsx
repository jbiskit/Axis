import { useCallback, useEffect, useState } from "react";
import { fetchTenantHealth, type HealthItem, type HealthStatus, type TenantHealth } from "../lib/tauri";
import { Panel, PanelHead } from "./ui/PageChrome";

const STATUS_LABEL: Record<HealthStatus, string> = {
  error: "Action needed",
  warning: "Attention",
  unknown: "Could not read",
  ok: "Healthy",
  notConfigured: "Not in use",
};

const STATUS_ORDER: HealthStatus[] = ["error", "warning", "unknown", "ok"];

function itemTitle(item: HealthItem): string {
  return item.name ? `${item.area} · ${item.name}` : item.area;
}

/**
 * Certificates, tokens, and connectors, worst first. Loaded on its own so the
 * rest of the overview does not wait on eight extra Graph reads.
 */
export function TenantHealthPanel({ refreshKey }: { refreshKey: string }) {
  const [health, setHealth] = useState<TenantHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchTenantHealth()
      .then(setHealth)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  // The overview's Refresh changes `refreshKey`, which reloads this too.
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const items = health?.items ?? [];
  const inUse = items
    .filter((item) => item.status !== "notConfigured")
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const notInUse = items.filter((item) => item.status === "notConfigured");
  const problems = inUse.filter((item) => item.status === "error" || item.status === "warning").length;

  return (
    <Panel padded>
      <PanelHead
        title="Tenant health"
        hint={
          loading && !health
            ? "Checking certificates, tokens, and connectors…"
            : problems > 0
              ? `${problems} need${problems === 1 ? "s" : ""} attention. Expiry under 30 days or no sync for 7 days is flagged.`
              : "Certificates, tokens, and connectors Intune depends on."
        }
      />
      {error ? <div className="axis-alert axis-alert-warning">{error}</div> : null}
      {inUse.length > 0 ? (
        <ul className="health-list">
          {inUse.map((item, index) => (
            <li key={`${item.key}-${item.name ?? index}`} className={`health-item is-${item.status}`}>
              <span className="health-dot" aria-hidden="true" />
              <div className="health-copy">
                <span className="health-title">{itemTitle(item)}</span>
                <span className="health-detail">{item.detail}</span>
              </div>
              <span className="health-status">{STATUS_LABEL[item.status]}</span>
            </li>
          ))}
        </ul>
      ) : !loading && !error ? (
        <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-xs)" }}>
          No connectors or tokens are set up in this tenant.
        </p>
      ) : null}
      {notInUse.length > 0 ? (
        <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "var(--axis-text-2xs)" }}>
          Not in use: {notInUse.map((item) => item.area).join(" · ")}
        </p>
      ) : null}
    </Panel>
  );
}
