import type { ScriptCodeLanguage } from "../components/ui/ScriptCodeEditor";
import type { AssignedFilter } from "./listSelection";
import { assignedSearchToken, matchesAssignedFilter, matchesListQuery } from "./listSelection";
import type { TenantScriptSummary } from "../types/inventory";

export type ScriptKindFilter = "all" | "platform-powershell" | "platform-shell";

export type ScriptWorkbenchScope = "platform" | "remediation" | "compliance";

export function tenantScriptKindLabel(kind: string): string {
  switch (kind) {
    case "platform-powershell":
      return "Windows PowerShell";
    case "platform-shell":
      return "macOS shell";
    case "remediation":
      return "Remediation";
    case "compliance":
      return "Compliance script";
    default:
      return kind;
  }
}

export function scriptKindFilterOptions(): { value: ScriptKindFilter; label: string }[] {
  return [
    { value: "all", label: "All kinds" },
    { value: "platform-powershell", label: "Windows PowerShell" },
    { value: "platform-shell", label: "macOS shell" },
  ];
}

export function scriptIsAssigned(item: { assignmentCount?: number | null }): boolean {
  return (item.assignmentCount ?? 0) > 0;
}

export function matchesScriptQuery(item: TenantScriptSummary, query: string): boolean {
  return matchesListQuery(
    `${item.displayName} ${item.description ?? ""} ${item.kind} ${item.runAsAccount ?? ""} ${item.fileName ?? ""} ${item.publisher ?? ""} ${tenantScriptKindLabel(item.kind)} ${assignedSearchToken(scriptIsAssigned(item))}`,
    query,
  );
}

export function matchesScriptKindFilter(kind: string, filter: ScriptKindFilter): boolean {
  if (filter === "all") return true;
  return kind === filter;
}

export function matchesScriptFilters(
  item: TenantScriptSummary,
  query: string,
  assigned: AssignedFilter,
  kindFilter: ScriptKindFilter,
): boolean {
  return (
    matchesAssignedFilter(scriptIsAssigned(item), assigned) &&
    matchesScriptKindFilter(item.kind, kindFilter) &&
    matchesScriptQuery(item, query)
  );
}

export function scriptLanguageForKind(scriptKind: string): ScriptCodeLanguage {
  return scriptKind === "platform-shell" ? "bash" : "powershell";
}

export function parseScriptInspectorKind(kind: string) {
  if (!kind.startsWith("script:")) return null;
  const scriptKind = kind.slice("script:".length);
  return {
    scriptKind,
    isPlatform: scriptKind.startsWith("platform"),
    isRemediation: scriptKind === "remediation",
    isCompliance: scriptKind === "compliance",
    language: scriptLanguageForKind(scriptKind),
  };
}

export function inspectorKindForTenantScript(kind: string): string {
  return `script:${kind}`;
}

export function homogeneousBulkAssignKind(scripts: { kind: string }[]): string | null {
  if (scripts.length === 0) return null;
  const kinds = new Set(scripts.map((script) => script.kind));
  if (kinds.size !== 1) return null;
  return inspectorKindForTenantScript([...kinds][0]);
}

export function matchesScriptWorkbenchScope(scriptKind: string, scope: ScriptWorkbenchScope): boolean {
  if (scope === "remediation") return scriptKind === "remediation";
  if (scope === "compliance") return scriptKind === "compliance";
  return scriptKind.startsWith("platform");
}

export function scriptWorkbenchScopeFromPath(pathname: string): ScriptWorkbenchScope {
  if (pathname.endsWith("remediations")) return "remediation";
  if (pathname.endsWith("compliance")) return "compliance";
  return "platform";
}
