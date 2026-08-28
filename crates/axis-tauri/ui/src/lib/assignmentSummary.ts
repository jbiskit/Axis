import { summarizeRemediationSchedule } from "./remediationSchedule";
import type { AssignmentDraft, AssignmentIntent } from "../types/inventory";

const NULL_ASSIGNMENT_FILTER_ID = "00000000-0000-0000-0000-000000000000";

export function isRealAssignmentFilterId(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return trimmed.toLowerCase() !== NULL_ASSIGNMENT_FILTER_ID;
}

export function hasAssignmentFilter(draft: AssignmentDraft): boolean {
  return (
    draft.targetKind !== "exclusionGroup" &&
    isRealAssignmentFilterId(draft.filterId)
  );
}

export function assignmentTargetLabel(draft: AssignmentDraft): string {
  switch (draft.targetKind) {
    case "allUsers":
      return "All users";
    case "allDevices":
      return "All devices";
    case "exclusionGroup":
      return `Exclude · ${draft.groupName || draft.groupId || "group"}`;
    case "group":
      return `Include · ${draft.groupName || draft.groupId || "group"}`;
    default:
      return draft.groupName || draft.groupId || "Group";
  }
}

export function assignmentFilterLabel(draft: AssignmentDraft): string | null {
  if (!hasAssignmentFilter(draft)) return null;
  const mode = draft.filterMode === "exclude" ? "exclude filter" : "include filter";
  return `${mode} ${draft.filterName ?? draft.filterId}`;
}

export function summarizeAssignmentDraft(
  draft: AssignmentDraft,
  options?: {
    supportsIntent?: boolean;
    supportsSchedule?: boolean;
  },
): string {
  const filter = assignmentFilterLabel(draft);
  const intent =
    options?.supportsIntent && draft.intent
      ? `${draft.intent[0]?.toUpperCase()}${draft.intent.slice(1)}: `
      : "";
  const label = `${intent}${assignmentTargetLabel(draft)}`;
  const schedule =
    options?.supportsSchedule && draft.targetKind !== "exclusionGroup"
      ? summarizeRemediationSchedule(draft.runSchedule, draft.runRemediationScript)
      : null;
  const base = filter ? `${label} (${filter})` : label;
  return schedule ? `${base} · ${schedule}` : base;
}

export function intentLabel(intent: AssignmentIntent): string {
  return `${intent[0]?.toUpperCase()}${intent.slice(1)}`;
}
