import type {
  CatalogPolicySummary,
  ConfigurationPolicyTemplateSummary,
} from "../types/inventory";
import { humanizeSettingToken } from "./catalogSettingDisplay";

/**
 * Human label for a template's comma-separated `platforms` value
 * (`windows10,windows11` → `Windows`, `macOS` → `macOS`).
 *
 * The same display name can exist for more than one platform, so callers that
 * list templates need this to tell otherwise-identical entries apart.
 */
export function templatePlatformLabel(platforms?: string | null): string | null {
  const parts = (platforms ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    const label = lower.startsWith("windows")
      ? "Windows"
      : lower === "macos" || lower === "mac"
        ? "macOS"
        : lower === "ios"
          ? "iOS"
          : lower === "android"
            ? "Android"
            : part;
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels.join(", ");
}

/** `Display name (Platform)` — platform omitted when Graph returns none. */
export function templateDisplayLabel(
  template: Pick<ConfigurationPolicyTemplateSummary, "displayName" | "platforms">,
): string {
  const platform = templatePlatformLabel(template.platforms);
  return platform ? `${template.displayName} (${platform})` : template.displayName;
}

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
  // The same profile name exists per platform, so include it when Graph gives us
  // one — otherwise two policies look identical in the list.
  if (matched) {
    const platform = templatePlatformLabel(matched.platforms);
    const name = matched.displayName?.trim();
    if (name) return platform ? `${name} (${platform})` : name;
  }
  const graphName = policy.templateDisplayName?.trim();
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
