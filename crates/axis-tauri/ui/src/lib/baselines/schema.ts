export type BaselineCheckType =
  | "policyExists"
  | "policyCountAtLeast"
  | "deviceComplianceRateAtLeast"
  | "settingEquals"
  | "settingPresent";

export type BaselineCheck = {
  id: string;
  title: string;
  description?: string;
  category: string;
  type: BaselineCheckType;
  target?: string;
  expected?: string | number | boolean;
  expectedRaw?: string;
};

export type Baseline = {
  id: string;
  name: string;
  description: string;
  version: string;
  source: "builtin" | "custom" | "asd";
  checks: BaselineCheck[];
};

export type CheckResultStatus = "pass" | "warn" | "conflict" | "fail" | "unknown";

export type CheckEvidence = {
  policyName: string;
  valueSummary: string;
  rawValue?: string;
};

export type CheckResult = {
  check: BaselineCheck;
  status: CheckResultStatus;
  actual?: string | number | boolean | null;
  message: string;
  expectedDisplay?: string;
  evidence?: CheckEvidence[];
};

export type DeviceBaselineEvaluation = {
  baseline: Baseline;
  deviceId: string;
  deviceName: string;
  results: CheckResult[];
  summary: {
    pass: number;
    warn: number;
    conflict: number;
    fail: number;
    unknown: number;
  };
  notes: string[];
};
