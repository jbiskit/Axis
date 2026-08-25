import { humanizeSettingToken } from "../catalogSettingDisplay";

function optionSuffix(value: string): string {
  const parts = value.trim().toLowerCase().split("_").filter(Boolean);
  return parts[parts.length - 1] ?? value.trim().toLowerCase();
}

function normalizeExpected(expected: string | number | boolean): string[] {
  if (typeof expected === "boolean") {
    return expected
      ? ["enabled", "true", "allow", "allowed"]
      : ["disabled", "false", "block", "blocked", "not configured"];
  }
  if (typeof expected === "number") {
    return [String(expected), humanizeSettingToken(String(expected)).toLowerCase()];
  }
  const lower = expected.trim().toLowerCase();
  const aliases = new Set<string>([lower, humanizeSettingToken(expected).toLowerCase()]);
  if (["true", "enabled", "allow", "allowed"].includes(lower)) {
    ["enabled", "true", "allow", "allowed"].forEach((alias) => aliases.add(alias));
  }
  if (["false", "disabled", "block", "blocked"].includes(lower)) {
    ["disabled", "false", "block", "blocked", "not configured"].forEach((alias) => aliases.add(alias));
  }
  return [...aliases];
}

function rawValuesMatch(expectedRaw: string | undefined, actualRaw: string | undefined): boolean {
  if (!expectedRaw?.trim() || !actualRaw?.trim()) return false;
  const left = expectedRaw.trim().toLowerCase();
  const right = actualRaw.trim().toLowerCase();
  if (left === right) return true;
  const leftSuffix = optionSuffix(left);
  const rightSuffix = optionSuffix(right);
  if (leftSuffix && leftSuffix === rightSuffix && left.includes("_") && right.includes("_")) {
    return true;
  }
  return false;
}

export function valueMatchesExpected(
  valueSummary: string,
  rawValue: string | undefined,
  expected: string | number | boolean,
  expectedRaw?: string,
): boolean {
  if (rawValuesMatch(expectedRaw, rawValue)) return true;
  const expectedForms = normalizeExpected(expected);
  if (expectedRaw?.trim()) {
    expectedForms.push(
      expectedRaw.trim().toLowerCase(),
      humanizeSettingToken(expectedRaw).toLowerCase(),
      optionSuffix(expectedRaw),
    );
  }
  const actualForms = [valueSummary, rawValue ?? ""]
    .filter(Boolean)
    .map((value) => value.trim().toLowerCase());
  return actualForms.some((actual) =>
    expectedForms.some(
      (expectedForm) =>
        Boolean(expectedForm) &&
        (actual === expectedForm || actual.includes(expectedForm) || expectedForm.includes(actual)),
    ),
  );
}

export function definitionIdsMatch(candidate: string, target: string): boolean {
  const left = candidate.trim().toLowerCase();
  const right = target.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}
