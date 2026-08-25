import type { DirectoryGroupMembership } from "../../types/inventory";

export function isConflictPolicyState(state: string): boolean {
  return state.trim().toLowerCase().replace(/[_\s]/g, "") === "conflict";
}

export function isProblemPolicyState(state: string): boolean {
  const normalized = state.trim().toLowerCase().replace(/[_\s]/g, "");
  return ["conflict", "error", "failed", "noncompliant"].includes(normalized);
}

export function humanizeAppToken(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function describeGroup(group: DirectoryGroupMembership): string {
  if (group.groupTypes.some((type) => type.toLowerCase() === "unified")) {
    return "Microsoft 365";
  }
  if (group.securityEnabled) return "Security";
  if (group.mailEnabled) return "Mail";
  return "Group";
}

export function stateClass(state?: string | null): string {
  const value = (state ?? "").toLowerCase();
  if (value.includes("compliant") && !value.includes("non")) return "axis-pill axis-pill-success";
  if (value.includes("conflict") || value.includes("error") || value.includes("noncompliant")) {
    return "axis-pill axis-pill-danger";
  }
  if (value.includes("grace") || value.includes("pending") || value.includes("warning")) {
    return "axis-pill axis-pill-warning";
  }
  return "axis-pill";
}
