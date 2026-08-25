import type { BaselineReferenceSourceInput } from "../../types/inventory";

export const SOURCE_STORAGE_KEY = "axis-baseline-reference-sources-v1";
export const BUILTIN_E8_SOURCE_ID = "e8-github";

export const DEFAULT_E8_SOURCE: BaselineReferenceSourceInput = {
  id: BUILTIN_E8_SOURCE_ID,
  name: "ASD E8",
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

export function packTitle(source: { id?: string; name?: string; owner?: string; repo?: string }): string {
  if (isBuiltinSource(source)) return "ASD E8";
  const name = source.name?.trim();
  if (name) return name;
  if (source.owner?.trim() && source.repo?.trim()) return `${source.owner}/${source.repo}`;
  return "Custom pack";
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
  return {
    ...next,
    owner: parsed.owner,
    repo: parsed.repo,
    gitRef: parsed.gitRef?.trim() || (sameRepo ? source.gitRef || "main" : "main"),
    path: parsed.path !== undefined ? parsed.path : sameRepo ? source.path : "",
    name: source.name?.trim() && sameRepo ? source.name : `${parsed.owner}/${parsed.repo}`,
  };
}

export function isSourceReady(source: BaselineReferenceSourceInput): boolean {
  if (parseGitHubRepoInput(source.url ?? "")) return true;
  return Boolean(source.owner.trim() && source.repo.trim());
}

export function sanitizeSource(entry: BaselineReferenceSourceInput): BaselineReferenceSourceInput {
  const parsed = parseGitHubRepoInput(entry.url ?? "");
  const owner = (parsed?.owner ?? entry.owner ?? "").trim();
  const repo = (parsed?.repo ?? entry.repo ?? "").trim().replace(/\.git$/i, "");
  const gitRef = (parsed?.gitRef ?? entry.gitRef ?? "").trim() || "main";
  const path = (parsed?.path ?? entry.path ?? "").trim().replace(/^\/+|\/+$/g, "");
  const privateRepo = entry.private === true || Boolean(entry.token?.trim());
  const token = privateRepo ? entry.token?.trim() || undefined : undefined;
  const url = (entry.url ?? "").trim() || (owner && repo ? githubDirectoryUrl({ owner, repo, gitRef, path }) : "");
  const id =
    entry.id?.trim() ||
    (owner && repo ? `repo:${owner}/${repo}:${gitRef}:${path}` : undefined);
  const name = isBuiltinSource({ id }) ? "ASD E8" : entry.name?.trim() || undefined;
  return {
    id,
    name,
    url,
    owner,
    repo,
    gitRef,
    path,
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
    url: "",
    owner: "",
    repo: "",
    gitRef: "main",
    path: "",
    private: false,
  };
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
  const source = sources.find((entry) => entry.id === sourceId);
  if (!source?.private) return undefined;
  return source.token?.trim() || undefined;
}
