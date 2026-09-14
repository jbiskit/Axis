import type {
  PackDiffChangeKind,
  PackDiffReport,
  RestoreApplyResult,
} from "../types/clientContainer";

export type ClientCompareCache = {
  containerRoot: string;
  left: string;
  right: string;
  report: PackDiffReport;
  resolutions: Record<string, "unresolved" | "keep" | "take-left" | "take-right">;
  selectedKey: string | null;
  filter: "all" | "unresolved" | PackDiffChangeKind;
  query: string;
  comparedAt: string;
  applyResult: RestoreApplyResult | null;
};

let cache: ClientCompareCache | null = null;

export function readClientCompareCache(containerRoot: string | null | undefined): ClientCompareCache | null {
  const root = containerRoot?.trim();
  if (!root || !cache) return null;
  if (cache.containerRoot !== root) return null;
  return cache;
}

export function writeClientCompareCache(next: ClientCompareCache): void {
  cache = next;
}

export function patchClientCompareCache(
  containerRoot: string | null | undefined,
  patch: Partial<Omit<ClientCompareCache, "containerRoot" | "report" | "left" | "right" | "comparedAt">> & {
    report?: PackDiffReport;
    left?: string;
    right?: string;
    comparedAt?: string;
  },
): void {
  const root = containerRoot?.trim();
  if (!root || !cache || cache.containerRoot !== root) return;
  cache = { ...cache, ...patch };
}

export function clearClientCompareCache(containerRoot?: string | null): void {
  if (!cache) return;
  if (containerRoot && cache.containerRoot !== containerRoot.trim()) return;
  cache = null;
}

export function formatComparedAt(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString();
}
