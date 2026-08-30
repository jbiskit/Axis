import type {
  AssignmentDraft,
  CompliancePolicyStatusReport,
  GraphObjectDetail,
  RemediationDeviceStatusReport,
} from "../types/inventory";

function key(kind: string, id: string): string {
  return `${kind}\0${id}`;
}

const details = new Map<string, GraphObjectDetail>();
const assignmentDrafts = new Map<string, AssignmentDraft[]>();
const runStatus = new Map<string, RemediationDeviceStatusReport>();
const complianceStatus = new Map<string, CompliancePolicyStatusReport>();

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

export function readCachedComplianceStatus(
  policyId: string,
): CompliancePolicyStatusReport | null {
  return complianceStatus.get(policyId) ?? null;
}

export function writeCachedComplianceStatus(
  policyId: string,
  report: CompliancePolicyStatusReport,
): void {
  complianceStatus.set(policyId, report);
}

export function clearCachedObject(kind: string, id: string): void {
  const cacheKey = key(kind, id);
  details.delete(cacheKey);
  assignmentDrafts.delete(cacheKey);
  runStatus.delete(cacheKey);
  complianceStatus.delete(id);
}

export function requestObjectRefresh(id: string): void {
  window.dispatchEvent(new CustomEvent("axis:graph-object-refresh", { detail: { id } }));
}
