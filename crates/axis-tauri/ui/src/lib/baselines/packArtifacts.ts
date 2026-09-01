export const PACK_CATALOG_KIND = "catalogPolicy";
export const PACK_BASELINE_KIND = "baseline";

export const PACK_PLATFORMS = ["windows", "macos", "android"] as const;

export const PACK_CONTENT_ORDER = [
  PACK_CATALOG_KIND,
  "script-platform",
  "script-remediation",
  "script-compliance",
  "compliance",
  "endpoint-security",
  "group-policy",
  "windows-update",
  "enrollment-autopilot",
] as const;

export type PackArtifactKind = string;

export function packContentKind(kind: string | undefined): string {
  const value = kind?.trim() || PACK_CATALOG_KIND;
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

export function packPlatformKind(kind: string | undefined): string | undefined {
  const value = kind?.trim() || "";
  const slash = value.indexOf("/");
  if (slash <= 0) return undefined;
  return value.slice(0, slash);
}

function platformLabel(platform: string | undefined): string | undefined {
  switch (platform) {
    case "windows":
      return "Windows";
    case "macos":
      return "macOS";
    case "android":
      return "Android";
    default:
      return platform;
  }
}

function contentLabel(content: string): string {
  switch (content) {
    case "script-platform":
      return "Scripts · Platform";
    case "script-remediation":
      return "Scripts · Remediation";
    case "script-compliance":
      return "Scripts · Compliance";
    case "compliance":
      return "Compliance settings";
    case "endpoint-security":
      return "Endpoint Security";
    case "group-policy":
      return "Group Policy";
    case "windows-update":
      return "Windows Update";
    case "enrollment-autopilot":
      return "Enrolment · Autopilot";
    case PACK_BASELINE_KIND:
    case "baseline-checks":
      return "Baselines";
    case PACK_CATALOG_KIND:
      return "Policies";
    default:
      return content;
  }
}

export function packArtifactKindLabel(kind: string | undefined): string {
  const content = packContentKind(kind);
  const platform = platformLabel(packPlatformKind(kind));
  const label = contentLabel(content);
  return platform ? `${platform} · ${label}` : label;
}

export function isCatalogPackArtifact(kind: string | undefined): boolean {
  return packContentKind(kind) === PACK_CATALOG_KIND;
}

export function isBaselinePackArtifact(kind: string | undefined): boolean {
  const content = packContentKind(kind);
  return content === PACK_BASELINE_KIND || content === "baseline-checks";
}

export function groupPackArtifacts<T extends { artifactKind?: string }>(items: T[]): Array<{
  kind: string;
  label: string;
  items: T[];
}> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const kind = item.artifactKind?.trim() || PACK_CATALOG_KIND;
    const bucket = buckets.get(kind);
    if (bucket) bucket.push(item);
    else buckets.set(kind, [item]);
  }
  const ordered: Array<{ kind: string; label: string; items: T[] }> = [];
  for (const platform of PACK_PLATFORMS) {
    for (const content of PACK_CONTENT_ORDER) {
      const kind = `${platform}/${content}`;
      const itemsForKind = buckets.get(kind);
      if (!itemsForKind?.length) continue;
      ordered.push({ kind, label: packArtifactKindLabel(kind), items: itemsForKind });
      buckets.delete(kind);
    }
  }
  for (const kind of [PACK_CATALOG_KIND, PACK_BASELINE_KIND, "baseline-checks"]) {
    const itemsForKind = buckets.get(kind);
    if (!itemsForKind?.length) continue;
    ordered.push({ kind, label: packArtifactKindLabel(kind), items: itemsForKind });
    buckets.delete(kind);
  }
  for (const [kind, itemsForKind] of buckets) {
    if (!itemsForKind.length) continue;
    ordered.push({ kind, label: packArtifactKindLabel(kind), items: itemsForKind });
  }
  return ordered;
}

export function packRelativeDownloadUrl(
  baseDownloadUrl: string,
  relativePath: string,
  localPackRoot?: string,
): string {
  const rel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const root = localPackRoot?.trim();
  if (root) {
    return `${root.replace(/[\\/]+$/, "")}/${rel}`.replace(/\//g, root.includes("\\") ? "\\" : "/");
  }
  const raw = baseDownloadUrl.match(
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i,
  );
  if (raw) {
    return `https://raw.githubusercontent.com/${raw[1]}/${raw[2]}/${raw[3]}/${rel}`;
  }
  const trimmed = baseDownloadUrl.replace(/\\/g, "/");
  const marker = "/baselines/";
  const index = trimmed.toLowerCase().lastIndexOf(marker);
  if (index >= 0) {
    return `${trimmed.slice(0, index)}/${rel}`;
  }
  const slash = Math.max(trimmed.lastIndexOf("/"), baseDownloadUrl.lastIndexOf("\\"));
  if (slash >= 0) {
    return `${baseDownloadUrl.slice(0, slash + 1)}${rel}`;
  }
  return rel;
}
