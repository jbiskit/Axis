import type {
  AssignmentDraft,
  GraphObjectDetail,
  RemediationDeviceStatusReport,
} from "../types/inventory";

function key(kind: string, id: string): string {
  return `${kind}\0${id}`;
}

const details = new Map<string, GraphObjectDetail>();
const assignmentDrafts = new Map<string, AssignmentDraft[]>();
const runStatus = new Map<string, RemediationDeviceStatusReport>();

export function readCachedObjectDetail(
  kind: string,
  id: string,
): GraphObjectDetail | null {
  return details.get(key(kind, id)) ?? null;
}

export function writeCachedObjectDetail(detail: GraphObjectDetail): void {
  details.set(key(detail.kind, detail.id), detail);
}

export function readCachedAssignmentDrafts(
  kind: string,
  id: string,
): AssignmentDraft[] | null {
  return assignmentDrafts.get(key(kind, id)) ?? null;
}

export function writeCachedAssignmentDrafts(
  kind: string,
  id: string,
  drafts: AssignmentDraft[],
): void {
  assignmentDrafts.set(key(kind, id), drafts);
}

export function readCachedRunStatus(
  kind: string,
  scriptId: string,
): RemediationDeviceStatusReport | null {
  return runStatus.get(key(kind, scriptId)) ?? null;
}

export function writeCachedRunStatus(
  kind: string,
  scriptId: string,
  report: RemediationDeviceStatusReport,
): void {
  runStatus.set(key(kind, scriptId), report);
}
