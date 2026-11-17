import { useCallback, useEffect, useState } from "react";
import { fetchTenantHealth, type HealthItem, type HealthStatus, type TenantHealth } from "../lib/tauri";

const STATUS_ORDER: HealthStatus[] = ["error", "warning", "unknown", "ok"];
const DAY_MS = 86_400_000;

export function healthTitle(item: HealthItem): string {
  return item.name ? `${item.area} · ${item.name}` : item.area;
}

function daysUntil(value: string | null): number | null {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? null : Math.floor((parsed - Date.now()) / DAY_MS);
}

/** Short value for the right of the row: days to expiry, or time since the last sync. */
export function healthValue(item: HealthItem): string {
  const left = daysUntil(item.expires);
  if (left != null) return left < 0 ? "Expired" : `${left} d`;
  const since = daysUntil(item.lastSync);
  if (since != null) {
    const ago = -since;
    return ago >= 7 ? `No sync ${ago} d` : ago >= 1 ? `Synced ${ago} d` : "Synced today";
  }
  return item.status === "unknown" ? "Unknown" : "OK";
}

/** Expiry bars fill by days left out of a year; sync-based items are full. */
function healthFill(item: HealthItem): number {
  const left = daysUntil(item.expires);
  if (left == null) return 100;
  return Math.max(2, Math.min(100, (left / 365) * 100));
}

/**
 * Certificates, tokens, and connectors. Loaded on its own so the rest of the
 * overview does not wait on eight extra Graph reads; `refreshKey` reloads it.
 */
export function useTenantHealth(refreshKey: string) {
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

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const inUse = (health?.items ?? [])
    .filter((item) => item.status !== "notConfigured")
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const notInUse = (health?.items ?? []).filter((item) => item.status === "notConfigured");
  return { inUse, notInUse, loading: loading && !health, error };
}

export function TenantHealthColumn({
  inUse,
  notInUse,
  loading,
  error,
}: ReturnType<typeof useTenantHealth>) {
  return (
    <section className="ov-card ov-health" aria-label="Tenant health">
      <div className="ov-card-head">
        <h2>Tenant health</h2>
        <span title="Expiry under 30 days or no sync for 7 days is flagged.">Expiry · last sync</span>
      </div>
      {error ? <p className="ov-empty is-warning">{error}</p> : null}
      {loading ? <p className="ov-empty">Checking…</p> : null}
      {!loading && !error && inUse.length === 0 ? <p className="ov-empty">No connectors or tokens set up</p> : null}
      <ul className="ov-health-list">
        {inUse.map((item, index) => (
          <li key={`${item.key}-${item.name ?? index}`} className={`is-${item.status}`} title={item.detail}>
            <div className="ov-row-line">
              <span>{healthTitle(item)}</span>
              <span className="ov-health-value">{healthValue(item)}</span>
            </div>
            <div className="ov-track">
              <span style={{ width: `${healthFill(item)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {notInUse.length > 0 ? (
        <p className="ov-foot" title={notInUse.map((item) => item.area).join(" · ")}>
          {notInUse.length} not in use
        </p>
      ) : null}
    </section>
  );
}
