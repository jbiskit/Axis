import type {
  CatalogPolicySummary,
  ConfigurationPolicyTemplateSummary,
} from "../types/inventory";
import { humanizeSettingToken } from "./catalogSettingDisplay";

function normalizeTemplateId(id: string): string {
  return id.trim().toLowerCase();
}

/** Graph versions templates as `{base}_{n}`; policies often keep that versioned id. */
function versionedBase(id: string): string | null {
  const trimmed = id.trim();
  const split = trimmed.lastIndexOf("_");
  if (split <= 0) return null;
  const suffix = trimmed.slice(split + 1);
  if (!suffix || !/^\d+$/.test(suffix)) return null;
  return trimmed.slice(0, split);
}

function templateLineageKeys(id: string, baseId?: string | null): string[] {
  const keys = new Set<string>();
  const normalized = normalizeTemplateId(id);
  if (normalized) keys.add(normalized);
  const declared = baseId?.trim().toLowerCase();
  if (declared) keys.add(declared);
  const stripped = versionedBase(id)?.toLowerCase();
  if (stripped) keys.add(stripped);
  return [...keys];
}

/** Match a policy `templateId` to a Create-dialog template (id / baseId / versioned id). */
export function matchConfigurationPolicyTemplate(
  policyTemplateId: string | null | undefined,
  templates: readonly ConfigurationPolicyTemplateSummary[],
): ConfigurationPolicyTemplateSummary | null {
  const raw = policyTemplateId?.trim();
  if (!raw || templates.length === 0) return null;
  const policyKeys = new Set(templateLineageKeys(raw));
  const exact = templates.find((row) => normalizeTemplateId(row.id) === normalizeTemplateId(raw));
  if (exact) return exact;
  return (
    templates.find((row) =>
      templateLineageKeys(row.id, row.baseId).some((key) => policyKeys.has(key)),
    ) ?? null
  );
}

/**
 * Graph profile name for an Endpoint Security policy: template list `displayName`,
 * then inventory `templateDisplayName`, then a last-resort humanized family/id.
 */
export function catalogPolicyProfileName(
  policy: Pick<CatalogPolicySummary, "templateId" | "templateDisplayName" | "templateFamily">,
  templates?: readonly ConfigurationPolicyTemplateSummary[] | null,
): string {
  const matched = matchConfigurationPolicyTemplate(policy.templateId, templates ?? []);
  const graphName = matched?.displayName?.trim() || policy.templateDisplayName?.trim();
  if (graphName) return graphName;
  const family = policy.templateFamily?.trim();
  if (family && family.toLowerCase() !== "none") {
    const withoutPrefix = family.replace(/^endpointSecurity/i, "");
    return humanizeSettingToken(withoutPrefix || family);
  }
  const id = policy.templateId?.trim();
  if (id) return humanizeSettingToken(versionedBase(id) ?? id);
  return "—";
}
