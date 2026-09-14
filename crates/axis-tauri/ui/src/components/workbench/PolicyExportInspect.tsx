import { useEffect, useState, type ReactNode } from "react";
import type { BaselineReferenceSourceInput, E8BaselineReference } from "../../types/inventory";
import {
  catalogDescriptionFromPolicy,
  catalogSettingsFromPolicy,
  normalizeIntunePolicyExport,
} from "../../lib/baselines/policyExport";
import { packArtifactKindLabel } from "../../lib/baselines/packArtifacts";
import { tokenForSource } from "../../lib/baselines/sources";
import { fetchBaselineExport } from "../../lib/tauri";
import { CatalogSettingInstances } from "./CatalogSettingInstances";

export type PolicyExportResolved = {
  name: string;
  description: string;
  settingsCount: number;
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function exportFileLabel(downloadUrl: string, fallbackName: string): string {
  return downloadUrl.split(/[\\/]/).pop() ?? `${fallbackName}.json`;
}

/** Shared Baselines / Templates inspect for Settings Catalog (and Endpoint Security) exports. */
export function PolicyExportInspect({
  reference,
  sources,
  storeLabel,
  formatRelative,
  openExternalUrl,
  banner,
  onResolved,
}: {
  reference: E8BaselineReference & { sourceId: string; sourceName: string };
  sources: BaselineReferenceSourceInput[];
  storeLabel: string;
  formatRelative: (value: string | null | undefined) => string;
  openExternalUrl: (url: string) => void | Promise<void>;
  banner?: ReactNode;
  onResolved?: (info: PolicyExportResolved | null) => void;
}) {
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPolicy(null);
    setSettings(null);
    onResolved?.(null);
    void fetchBaselineExport(reference.downloadUrl, tokenForSource(sources, reference.sourceId))
      .then((response) => {
        if (cancelled) return;
        if (response.error || response.document == null) {
          throw new Error(response.error ?? "The export was empty.");
        }
        const fileName = exportFileLabel(reference.downloadUrl, reference.name);
        const normalized = normalizeIntunePolicyExport(response.document, fileName);
        const nextSettings = catalogSettingsFromPolicy(normalized);
        const name =
          asText(normalized.name) || asText(normalized.displayName) || reference.name;
        setPolicy(normalized);
        setSettings(nextSettings);
        onResolved?.({
          name,
          description: catalogDescriptionFromPolicy(normalized),
          settingsCount: nextSettings.length,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load this export.");
          onResolved?.(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onResolved, reference.downloadUrl, reference.name, reference.sourceId, sources]);

  const description = policy ? catalogDescriptionFromPolicy(policy) : "";
  const platforms = policy ? asText(policy.platforms) : null;
  const technologies = policy ? asText(policy.technologies) : null;
  const settingCount =
    settings?.length ??
    (policy && typeof policy.settingCount === "number" ? policy.settingCount : null);
  const remote = reference.downloadUrl.startsWith("https://");

  return (
    <div className="stack">
      <section className="axis-panel" style={{ padding: "0.85rem" }}>
        {loading ? <p className="muted">Loading policy export…</p> : null}
        {error ? <p className="muted">{error}</p> : null}
        {!loading && !error && description ? (
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>{description}</p>
        ) : null}
        <dl className="meta-grid">
          <div>
            <dt>Platforms</dt>
            <dd>{platforms ?? "—"}</dd>
          </div>
          <div>
            <dt>Technologies</dt>
            <dd>{technologies ?? "—"}</dd>
          </div>
          <div>
            <dt>Settings</dt>
            <dd>{settingCount != null ? String(settingCount) : "—"}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{reference.version ?? asText(policy?.version) ?? "—"}</dd>
          </div>
          <div>
            <dt>Repository modified</dt>
            <dd>
              {reference.repositoryLastModifiedDateTime
                ? formatRelative(reference.repositoryLastModifiedDateTime)
                : reference.policyExportedDateTime
                  ? `Fallback: ${formatRelative(reference.policyExportedDateTime)}`
                  : "—"}
            </dd>
          </div>
          <div>
            <dt>Policy exported</dt>
            <dd>
              {reference.policyExportedDateTime
                ? formatRelative(reference.policyExportedDateTime)
                : asText(policy?.lastModifiedDateTime)
                  ? formatRelative(asText(policy?.lastModifiedDateTime))
                  : "—"}
            </dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{packArtifactKindLabel(reference.artifactKind)}</dd>
          </div>
          <div>
            <dt>{storeLabel}</dt>
            <dd>{reference.sourceName}</dd>
          </div>
        </dl>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <button type="button" className="axis-btn" onClick={() => void openExternalUrl(reference.sourceUrl)}>
            {remote ? "Open source entry" : "Open file"}
          </button>
          <button type="button" className="axis-btn" onClick={() => void openExternalUrl(reference.downloadUrl)}>
            {remote ? "Open raw export" : "Open export file"}
          </button>
        </div>
      </section>
      {banner}
      <section className="axis-panel" style={{ padding: "0.85rem" }}>
        <h2 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
          Setting instances{settings ? ` (${settings.length})` : ""}
        </h2>
        {loading ? <p className="muted">Loading settings…</p> : null}
        {error ? <p className="muted">{error}</p> : null}
        {!loading && !error && settings ? <CatalogSettingInstances settings={settings} /> : null}
      </section>
    </div>
  );
}
