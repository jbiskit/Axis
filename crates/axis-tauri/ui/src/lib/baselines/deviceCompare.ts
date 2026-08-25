import type { DevicePolicyState, ManagedDeviceDetail, PolicySettingIssue } from "../../types/inventory";
import { definitionIdsMatch, valueMatchesExpected } from "./match";
import type { Baseline, BaselineCheck, CheckResult, DeviceBaselineEvaluation } from "./schema";
import type { SettingLeaf } from "./settingLeaves";

export type AppliedSettingOccurrence = SettingLeaf & {
  policyId: string;
  policyName: string;
};

function summarize(results: CheckResult[]) {
  return {
    pass: results.filter((result) => result.status === "pass").length,
    warn: results.filter((result) => result.status === "warn").length,
    conflict: results.filter((result) => result.status === "conflict").length,
    fail: results.filter((result) => result.status === "fail").length,
    unknown: results.filter((result) => result.status === "unknown").length,
  };
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isSuccessfulPolicyState(state: string): boolean {
  const normalized = state.trim().toLowerCase().replace(/[_\s]/g, "");
  return ["compliant", "succeeded", "success", "secured", "remediated", "assigned"].includes(
    normalized,
  );
}

export function isConflictPolicyState(state: string): boolean {
  return state.trim().toLowerCase().replace(/[_\s]/g, "") === "conflict";
}

function isReportedOnDevice(state: string): boolean {
  const normalized = state.trim().toLowerCase().replace(/[_\s]/g, "");
  return Boolean(normalized) && normalized !== "notapplicable" && normalized !== "notassigned";
}

function findDevicePolicyMatches(states: DevicePolicyState[], policyName: string): DevicePolicyState[] {
  const needle = policyName.trim().toLowerCase();
  if (!needle) return [];
  return states.filter((state) => {
    const name = state.displayName.toLowerCase();
    return name === needle || name.includes(needle) || needle.includes(name);
  });
}

function policyById(states: DevicePolicyState[], policyId: string): DevicePolicyState | undefined {
  const needle = policyId.trim().toLowerCase();
  return states.find((state) => state.id.trim().toLowerCase() === needle);
}

function isPolicyStatusPlaceholder(issue: PolicySettingIssue): boolean {
  return issue.setting === "PolicyStatus" || normalizeKey(issue.settingName) === "policy status";
}

function labelsMatch(a: string, b: string): boolean {
  const left = normalizeKey(a);
  const right = normalizeKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.length >= 5 && longer.includes(shorter);
}

function issueMatchesCheck(issue: PolicySettingIssue, check: BaselineCheck): boolean {
  const target = check.target?.trim() ?? "";
  const labels = [check.title, target, issue.settingName, issue.setting ?? ""].filter(Boolean);
  if (target && (definitionIdsMatch(issue.setting ?? "", target) || definitionIdsMatch(issue.settingName, target))) {
    return true;
  }
  return labels.some((left, index) =>
    labels.slice(index + 1).some((right) => labelsMatch(left, right)),
  );
}

function occurrencesFor(
  applied: AppliedSettingOccurrence[],
  check: BaselineCheck,
): AppliedSettingOccurrence[] {
  const target = check.target?.trim();
  if (!target) return [];
  return applied.filter((row) => definitionIdsMatch(row.definitionId, target));
}

function evaluateSettingCheck(
  check: BaselineCheck,
  device: ManagedDeviceDetail,
  applied: AppliedSettingOccurrence[],
): CheckResult {
  const target = check.target?.trim();
  if (!target) {
    return { check, status: "unknown", message: "Baseline check is missing a settingDefinitionId target" };
  }

  const states = [...device.configurationStates, ...device.compliancePolicyStates];
  const hits = occurrencesFor(applied, check);
  const matching =
    check.type === "settingEquals"
      ? hits.filter((row) =>
          valueMatchesExpected(row.valueSummary, row.rawValue, check.expected ?? true, check.expectedRaw),
        )
      : hits;

  const namedConflicts = states
    .flatMap((policy) => policy.issues ?? [])
    .filter(
      (issue) =>
        isConflictPolicyState(issue.state) &&
        !isPolicyStatusPlaceholder(issue) &&
        issueMatchesCheck(issue, check),
    );
  if (namedConflicts.length > 0) {
    return {
      check,
      status: "conflict",
      actual: "conflict",
      expectedDisplay: String(check.expected ?? "configured"),
      message: `This setting is in conflict on the device (${namedConflicts
        .slice(0, 2)
        .map((issue) => issue.settingName || issue.policyDisplayName)
        .join(", ")})`,
      evidence: namedConflicts.slice(0, 6).map((issue) => ({
        policyName: issue.policyDisplayName || issue.policyId,
        valueSummary: `${issue.settingName}: ${issue.state}`,
      })),
    };
  }

  if (matching.length === 0 && hits.length > 0) {
    return {
      check,
      status: "fail",
      actual: hits[0]?.valueSummary ?? null,
      expectedDisplay: String(check.expected ?? "configured"),
      message: `Applied policies configure this setting, but not to the baseline value (found ${hits
        .slice(0, 2)
        .map((row) => row.valueSummary)
        .join(", ")})`,
      evidence: hits.slice(0, 6).map((row) => ({
        policyName: row.policyName,
        valueSummary: row.valueSummary,
        rawValue: row.rawValue,
      })),
    };
  }

  if (matching.length === 0) {
    return {
      check,
      status: "fail",
      actual: null,
      expectedDisplay: String(check.expected ?? "configured"),
      message:
        check.type === "settingEquals"
          ? "No applied policy on this device configures this setting to the baseline value"
          : "No applied policy on this device configures this setting",
      evidence: [],
    };
  }

  const deliveringStates = matching
    .map((row) => policyById(states, row.policyId))
    .filter((policy): policy is DevicePolicyState => Boolean(policy && isReportedOnDevice(policy.state)));
  const successful = deliveringStates.filter((policy) => isSuccessfulPolicyState(policy.state));
  const parentConflict = deliveringStates.filter((policy) => isConflictPolicyState(policy.state));
  const winner = successful[0] ?? parentConflict[0] ?? deliveringStates[0];
  const hit = matching[0]!;

  if (successful.length > 0 || parentConflict.length > 0) {
    return {
      check,
      status: "pass",
      actual: hit.valueSummary,
      expectedDisplay: String(check.expected ?? hit.valueSummary),
      message: `Policy “${winner?.displayName ?? hit.policyName}” is applied and configures this setting as ${hit.valueSummary}`,
      evidence: matching.slice(0, 6).map((row) => ({
        policyName: row.policyName,
        valueSummary: row.valueSummary,
        rawValue: row.rawValue,
      })),
    };
  }

  return {
    check,
    status: "fail",
    actual: winner?.state ?? hit.valueSummary,
    expectedDisplay: String(check.expected ?? "configured"),
    message: `A delivering policy is on the device but not successful (${deliveringStates
      .map((policy) => `${policy.displayName}:${policy.state}`)
      .join(", ") || hit.policyName})`,
    evidence: matching.slice(0, 6).map((row) => ({
      policyName: row.policyName,
      valueSummary: `${row.valueSummary} · ${policyById(states, row.policyId)?.state ?? "unknown"}`,
      rawValue: row.rawValue,
    })),
  };
}

function evaluateCheck(
  check: BaselineCheck,
  device: ManagedDeviceDetail,
  applied: AppliedSettingOccurrence[],
): CheckResult {
  const states = [...device.configurationStates, ...device.compliancePolicyStates];
  switch (check.type) {
    case "deviceComplianceRateAtLeast": {
      const pass = (device.complianceState ?? "").toLowerCase() === "compliant";
      return {
        check,
        status: pass ? "pass" : "fail",
        actual: device.complianceState ?? "unknown",
        message: pass
          ? `Device compliance state is “${device.complianceState}”`
          : `Device compliance state is “${device.complianceState ?? "unknown"}” (expects compliant)`,
      };
    }
    case "policyCountAtLeast": {
      const count = device.configurationStates.length;
      const expected = Number(check.expected ?? 0);
      const pass = count >= expected;
      return {
        check,
        status: pass ? "pass" : "fail",
        actual: count,
        message: pass
          ? `Device has ${count} applied configuration policies (required ≥ ${expected})`
          : `Device has ${count} applied configuration policies, expected ≥ ${expected}`,
      };
    }
    case "policyExists": {
      const name = check.target ?? "";
      const matches = findDevicePolicyMatches(states, name).filter((row) => isReportedOnDevice(row.state));
      if (matches.length === 0) {
        return {
          check,
          status: "fail",
          actual: null,
          message: `No applied policy on this device matching “${name}”`,
          evidence: [],
        };
      }
      const ok = matches.filter(
        (row) => isSuccessfulPolicyState(row.state) || isConflictPolicyState(row.state),
      );
      return {
        check,
        status: ok.length > 0 ? "pass" : "fail",
        actual: matches.map((row) => `${row.displayName}:${row.state}`).join(", "),
        message:
          ok.length > 0
            ? `Policy applied on device (${ok.length} match${ok.length === 1 ? "" : "es"})`
            : "Policy found on device but not in a successful state",
        evidence: matches.map((row) => ({ policyName: row.displayName, valueSummary: row.state })),
      };
    }
    case "settingPresent":
    case "settingEquals":
      return evaluateSettingCheck(check, device, applied);
    default:
      return { check, status: "unknown", message: `Unsupported check type “${String((check as BaselineCheck).type)}”` };
  }
}

export function evaluateDeviceBaseline(
  baseline: Baseline,
  device: ManagedDeviceDetail,
  applied: AppliedSettingOccurrence[],
  notes: string[] = [],
): DeviceBaselineEvaluation {
  const results = baseline.checks.map((check) => evaluateCheck(check, device, applied));
  return {
    baseline,
    deviceId: device.id,
    deviceName: device.deviceName,
    results,
    summary: summarize(results),
    notes,
  };
}
