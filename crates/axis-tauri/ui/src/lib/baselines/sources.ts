import type { BaselineReferenceSourceInput, TemplateStoreKind } from "../../types/inventory";

export type { TemplateStoreKind };

export const SOURCE_STORAGE_KEY = "axis-baseline-reference-sources-v1";
export const BUILTIN_E8_SOURCE_ID = "e8-github";

/** GitHub form to create a fine-grained PAT (least privilege for Axis packs). */
export const GITHUB_FINE_GRAINED_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new";
export const GITHUB_FINE_GRAINED_TOKEN_DOCS_URL =
  "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token";

export const DEFAULT_E8_SOURCE: BaselineReferenceSourceInput = {
  id: BUILTIN_E8_SOURCE_ID,
  name: "ASD E8",
  kind: "github",
  url: "https://github.com/ASD-Blueprint/ASD-Blueprint-for-Secure-Cloud/tree/main/static/content/files/intune-config-policies",
  owner: "ASD-Blueprint",
  repo: "ASD-Blueprint-for-Secure-Cloud",
  gitRef: "main",
  path: "static/content/files/intune-config-policies",
  private: false,
};

export function isBuiltinSource(source: { id?: string }): boolean {
  return source.id === BUILTIN_E8_SOURCE_ID;
}

export function isLocalSource(source: {
  kind?: string;
  localPath?: string;
}): boolean {
  return (source.kind ?? "").toLowerCase() === "local" || Boolean(source.localPath?.trim());
}

export function isTemplateStoreKind(value: string | undefined): value is TemplateStoreKind {
  return value === "axisTemplated" || value === "flatJson";
}

/** User template stores only. Built-in ASD is not a template. Missing values follow the old path rule. */
export function resolveStoreKind(source: {
  id?: string;
  storeKind?: string;
  path?: string;
}): TemplateStoreKind | undefined {
  if (isBuiltinSource(source)) return undefined;
  if (isTemplateStoreKind(source.storeKind)) return source.storeKind;
  return source.path?.trim() ? "flatJson" : "axisTemplated";
}

export function storeKindLabel(kind: TemplateStoreKind | undefined): string {
  if (kind === "flatJson") return "Flat JSON";
  if (kind === "axisTemplated") return "Axis Templated";
  return "";
}

export function templateKicker(source: {
  id?: string;
  kind?: string;
  localPath?: string;
  storeKind?: string;
  path?: string;
}): string {
  if (isBuiltinSource(source)) return "Built-in";
  const transport = isLocalSource(source) ? "Local folder" : "GitHub";
  const kind = storeKindLabel(resolveStoreKind(source));
  return kind ? `${transport} · ${kind}` : transport;
}

export function packTitle(source: {
  id?: string;
  name?: string;
  owner?: string;
  repo?: string;
  kind?: string;
  localPath?: string;
}): string {
  if (isBuiltinSource(source)) return "ASD E8";
  const name = source.name?.trim();
  if (name) return name;
  if (isLocalSource(source)) {
    const folder = source.localPath?.trim().replace(/[\\/]+$/, "");
    const parts = folder?.split(/[\\/]/).filter(Boolean) ?? [];
    return parts[parts.length - 1] || "Local template";
  }
  if (source.owner?.trim() && source.repo?.trim()) return `${source.owner}/${source.repo}`;
  return "Template";
}

export function ensureBuiltinSources(sources: BaselineReferenceSourceInput[]): BaselineReferenceSourceInput[] {
  const rest = sources.filter((source) => !isBuiltinSource(source));
  const existing = sources.find(isBuiltinSource);
  return [
    {
      ...DEFAULT_E8_SOURCE,
      ...existing,
      id: BUILTIN_E8_SOURCE_ID,
      name: "ASD E8",
      url: DEFAULT_E8_SOURCE.url,
      owner: DEFAULT_E8_SOURCE.owner,
      repo: DEFAULT_E8_SOURCE.repo,
      gitRef: DEFAULT_E8_SOURCE.gitRef,
      path: DEFAULT_E8_SOURCE.path,
      private: false,
      token: undefined,
      kind: "github",
      localPath: undefined,
      storeKind: undefined,
    },
    ...rest,
  ];
}

export type ParsedGitHubRepo = {
  owner: string;
  repo: string;
  gitRef?: string;
  path?: string;
};

export function parseGitHubRepoInput(input: string): ParsedGitHubRepo | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const short = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if (short && !trimmed.includes("://") && !trimmed.toLowerCase().includes("github.com")) {
    return { owner: short[1]!, repo: short[2]! };
  }

  let url: URL;
  try {
    const normalized = trimmed
      .replace(/^git@github\.com:/i, "https://github.com/")
      .replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/");
    url = new URL(normalized.includes("://") ? normalized : `https://${normalized}`);
  } catch {
    return null;
  }

  if (!/(^|\.)github\.com$/i.test(url.hostname)) return null;

  const parts = url.pathname
    .replace(/^\//, "")
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/i, "");
  let gitRef: string | undefined;
  let path: string | undefined;
  if (parts[2] === "tree" || parts[2] === "blob" || parts[2] === "raw") {
    gitRef = parts[3];
    const rest = parts.slice(4);
    if (rest.length > 0) path = rest.join("/");
  }
  return { owner, repo, gitRef, path };
}

export function githubDirectoryUrl(
  source: Pick<BaselineReferenceSourceInput, "owner" | "repo" | "gitRef" | "path" | "url">,
): string {
  const parsed = parseGitHubRepoInput(source.url ?? "");
  if (parsed) {
    const ref = parsed.gitRef?.trim() || source.gitRef.trim() || "main";
    const path = (parsed.path ?? source.path).trim().replace(/^\/+|\/+$/g, "");
    if (!path) return `https://github.com/${parsed.owner}/${parsed.repo}/tree/${ref}`;
    return `https://github.com/${parsed.owner}/${parsed.repo}/tree/${ref}/${path}`;
  }
  const ref = source.gitRef.trim() || "main";
  const path = source.path.trim().replace(/^\/+|\/+$/g, "");
  if (!source.owner.trim() || !source.repo.trim()) return source.url?.trim() || "";
  if (!path) return `https://github.com/${source.owner}/${source.repo}/tree/${ref}`;
  return `https://github.com/${source.owner}/${source.repo}/tree/${ref}/${path}`;
}

export function applyGitHubRepoInput(
  source: BaselineReferenceSourceInput,
  input: string,
): BaselineReferenceSourceInput {
  const parsed = parseGitHubRepoInput(input);
  const next: BaselineReferenceSourceInput = { ...source, url: input };
  if (!parsed) return next;
  const sameRepo = source.owner === parsed.owner && source.repo === parsed.repo;
  const path = parsed.path !== undefined ? parsed.path : sameRepo ? source.path : "";
  const explicitPath = Boolean(path.trim());
  return {
    ...next,
    owner: parsed.owner,
    repo: parsed.repo,
    gitRef: parsed.gitRef?.trim() || (sameRepo ? source.gitRef || "main" : "main"),
    path,
    storeKind: explicitPath
      ? "flatJson"
      : sameRepo && isTemplateStoreKind(source.storeKind)
        ? source.storeKind
        : "axisTemplated",
    name: source.name?.trim() && sameRepo ? source.name : `${parsed.owner}/${parsed.repo}`,
  };
}

export function isSourceReady(source: BaselineReferenceSourceInput): boolean {
  if (isLocalSource(source)) return Boolean(source.localPath?.trim());
  if (parseGitHubRepoInput(source.url ?? "")) return true;
  return Boolean(source.owner.trim() && source.repo.trim());
}

export function sanitizeSource(entry: BaselineReferenceSourceInput): BaselineReferenceSourceInput {
  if (isLocalSource(entry) && !isBuiltinSource(entry)) {
    const localPath = (entry.localPath ?? "").trim();
    const storeKind = resolveStoreKind(entry) ?? "axisTemplated";
    const path =
      storeKind === "axisTemplated"
        ? ""
        : (entry.path ?? "").trim().replace(/^[/\\]+|[/\\]+$/g, "").replace(/\\/g, "/");
    const id =
      entry.id?.trim() ||
      (localPath ? `local:${localPath}:${path}` : undefined);
    return {
      id,
      name: entry.name?.trim() || undefined,
      kind: "local",
      localPath,
      url: "",
      owner: "",
      repo: "",
      gitRef: "",
      path,
      storeKind,
      private: false,
      token: undefined,
    };
  }
  const parsed = parseGitHubRepoInput(entry.url ?? "");
  const owner = (parsed?.owner ?? entry.owner ?? "").trim();
  const repo = (parsed?.repo ?? entry.repo ?? "").trim().replace(/\.git$/i, "");
  const gitRef = (parsed?.gitRef ?? entry.gitRef ?? "").trim() || "main";
  const parsedPath = (parsed?.path ?? entry.path ?? "").trim().replace(/^\/+|\/+$/g, "");
  const builtin = isBuiltinSource(entry) || isBuiltinSource({ id: entry.id?.trim() });
  const storeKind = builtin ? undefined : resolveStoreKind({ ...entry, path: parsedPath }) ?? "axisTemplated";
  const path = storeKind === "axisTemplated" ? "" : parsedPath;
  const privateRepo = entry.private === true || Boolean(entry.token?.trim());
  const token = privateRepo ? entry.token?.trim() || undefined : undefined;
  const url =
    storeKind === "axisTemplated" && owner && repo
      ? githubDirectoryUrl({ owner, repo, gitRef, path: "" })
      : (entry.url ?? "").trim() || (owner && repo ? githubDirectoryUrl({ owner, repo, gitRef, path }) : "");
  const id =
    entry.id?.trim() ||
    (owner && repo ? `repo:${owner}/${repo}:${gitRef}:${path}` : undefined);
  const name = isBuiltinSource({ id }) ? "ASD E8" : entry.name?.trim() || undefined;
  return {
    id,
    name,
    kind: "github",
    url,
    owner,
    repo,
    gitRef,
    path,
    storeKind,
    private: privateRepo,
    token,
  };
}

export function newCustomSource(): BaselineReferenceSourceInput {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `custom-${crypto.randomUUID()}`
      : `custom-${Date.now()}`;
  return {
    id,
    kind: "github",
    url: "",
    owner: "",
    repo: "",
    gitRef: "main",
    path: "",
    storeKind: "axisTemplated",
    private: false,
  };
}

export function newLocalSource(): BaselineReferenceSourceInput {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `local-${crypto.randomUUID()}`
      : `local-${Date.now()}`;
  return {
    id,
    kind: "local",
    localPath: "",
    url: "",
    owner: "",
    repo: "",
    gitRef: "",
    path: "",
    storeKind: "axisTemplated",
    private: false,
  };
}

export function sourceOpenUrl(source: BaselineReferenceSourceInput, directoryUrl?: string): string {
  if (isLocalSource(source)) {
    return directoryUrl?.trim() || source.localPath?.trim() || "";
  }
  return directoryUrl?.trim() || githubDirectoryUrl(source);
}

export function loadStoredSources(): BaselineReferenceSourceInput[] {
  try {
    const stored = window.localStorage.getItem(SOURCE_STORAGE_KEY);
    if (!stored) return [DEFAULT_E8_SOURCE];
    const parsed = JSON.parse(stored) as BaselineReferenceSourceInput[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [DEFAULT_E8_SOURCE];
    const cleaned = parsed.map(sanitizeSource);
    return ensureBuiltinSources(cleaned.length > 0 ? cleaned : [DEFAULT_E8_SOURCE]);
  } catch {
    return [DEFAULT_E8_SOURCE];
  }
}

export function saveStoredSources(sources: BaselineReferenceSourceInput[]) {
  window.localStorage.setItem(
    SOURCE_STORAGE_KEY,
    JSON.stringify(ensureBuiltinSources(sources).map(sanitizeSource)),
  );
}

export function tokenForSource(
  sources: BaselineReferenceSourceInput[],
  sourceId: string,
): string | undefined {
  const source = sources
    .map(sanitizeSource)
    .find((entry) => entry.id === sourceId);
  return source?.private ? source.token?.trim() || undefined : undefined;
}
