"use strict";

// src/lib/graph/settingsCatalog.ts
function titleCaseWords(input) {
  return input.split(/\s+/).filter(Boolean).map((word) => {
    const lower = word.toLowerCase();
    const known = {
      mdm: "MDM",
      id: "ID",
      url: "URL",
      uri: "URI",
      os: "OS",
      wifi: "Wi-Fi",
      vpn: "VPN",
      bitlocker: "BitLocker",
      defender: "Defender"
    };
    if (known[lower]) return known[lower];
    if (/^\d+$/.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(" ");
}
function humanizeSettingToken(value, definitionId) {
  let token2 = value.trim();
  if (!token2) return "(empty)";
  if (definitionId) {
    if (token2.startsWith(`${definitionId}_`)) {
      token2 = token2.slice(definitionId.length + 1);
    } else if (token2.startsWith(definitionId)) {
      token2 = token2.slice(definitionId.length).replace(/^_+/, "");
    }
  }
  if (token2.includes("_") && token2.length > 40 && !definitionId) {
    const match = token2.match(/_([a-z0-9]+)$/i);
    if (match) token2 = match[1];
  } else if (token2.includes("device_vendor_") || token2.includes("device_vendor_msft_")) {
    const match = token2.match(/_([a-z0-9]+)$/i);
    if (match) token2 = match[1];
  }
  const lower = token2.toLowerCase();
  const literals = {
    true: "Enabled",
    false: "Disabled",
    enabled: "Enabled",
    disabled: "Disabled",
    allow: "Allow",
    block: "Block",
    notconfigured: "Not configured",
    not_configured: "Not configured",
    userdefined: "User defined",
    devicedefault: "Device default"
  };
  if (literals[lower]) return literals[lower];
  const parts = token2.split("_").filter(Boolean);
  const tail = parts.length > 4 ? parts.slice(-3).join(" ") : parts.join(" ") || token2;
  return titleCaseWords(tail.replace(/([a-z])([A-Z])/g, "$1 $2"));
}
function normalizeSettingLabel(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
function isWrapperValueSummary(summary) {
  return /\bnested settings?\b/i.test(summary) || /^Group ·/i.test(summary) || /^\d+ groups?$/i.test(summary);
}
function resolveLeafConfiguredValue(flattened, match) {
  const stem = `${match.path}/${match.settingDefinitionId}[`;
  const descendants = flattened.filter(
    (setting) => setting.path.startsWith(stem)
  );
  if (descendants.length === 0) return match;
  const leaves = descendants.filter(
    (setting) => !isWrapperValueSummary(setting.valueSummary)
  );
  const candidates = leaves.length > 0 ? leaves : descendants.slice().sort((a, b) => b.path.length - a.path.length);
  if (candidates.length === 0) return match;
  const deepest = candidates.slice().sort((a, b) => b.path.length - a.path.length);
  const uniqueValues = Array.from(
    new Set(deepest.map((item) => item.valueSummary.trim()).filter(Boolean))
  );
  if (uniqueValues.length === 1) {
    return {
      ...match,
      valueSummary: uniqueValues[0],
      rawValue: deepest[0].rawValue ?? uniqueValues[0]
    };
  }
  return {
    ...match,
    valueSummary: deepest.map((item) => `${item.displayName}: ${item.valueSummary}`).join("; "),
    rawValue: deepest.map((item) => item.rawValue ?? item.valueSummary).join(" | ")
  };
}
function pickSettingForConflictName(flattened, settingName) {
  const needle = normalizeSettingLabel(settingName);
  if (!needle || flattened.length === 0) return null;
  const scored = flattened.map((setting) => {
    const name = normalizeSettingLabel(setting.displayName);
    const idLabel = normalizeSettingLabel(
      humanizeSettingToken(setting.settingDefinitionId)
    );
    let score = 0;
    if (name === needle || idLabel === needle) score = 100;
    else if (name.includes(needle) || needle.includes(name) || idLabel.includes(needle) || needle.includes(idLabel)) {
      score = 60;
    } else return null;
    if (!isWrapperValueSummary(setting.valueSummary)) score += 25;
    if (setting.path !== "root") score += 10;
    score += Math.min(setting.path.split("/").length, 6);
    return { setting, score };
  }).filter(
    (item) => Boolean(item)
  ).sort((a, b) => b.score - a.score);
  const best = scored[0]?.setting;
  if (!best) return null;
  return resolveLeafConfiguredValue(flattened, best);
}
function resolveConflictNameToDefinitionIds(settings2, settingName, policyKeys2) {
  if (!settings2 || !settingName.trim()) return [];
  const keySet = policyKeys2 && policyKeys2.length > 0 ? new Set(policyKeys2.map((key) => key.trim().toLowerCase()).filter(Boolean)) : null;
  const candidates = settings2.settings.filter((row) => {
    if (!keySet) return true;
    return keySet.has(row.policyId.toLowerCase()) || keySet.has(row.policyName.trim().toLowerCase());
  });
  const match = pickSettingForConflictName(candidates, settingName);
  if (!match) return [];
  const ids = /* @__PURE__ */ new Set([match.settingDefinitionId]);
  for (const row of candidates) {
    if (normalizeSettingLabel(row.displayName) === normalizeSettingLabel(match.displayName) || row.settingDefinitionId === match.settingDefinitionId) {
      ids.add(row.settingDefinitionId);
    }
  }
  return [...ids];
}

// src/lib/cache/policyStatusCache.ts
var POLICY_STATUS_TTL_MS = 15 * 60 * 1e3;
var POLICY_STATUS_STALE_MS = 24 * 60 * 60 * 1e3;

// src/lib/graph/devices.ts
function emptyHardwareDetails() {
  return {
    managedDeviceName: null,
    azureADRegistered: null,
    serialNumber: null,
    enrollmentProfileName: null,
    userDisplayName: null,
    operatingSystemLanguage: null,
    operatingSystemEdition: null,
    skuFamily: null,
    skuNumber: null,
    subscriberCarrier: null,
    cellularTechnology: null,
    wifiMacAddress: null,
    ethernetMacAddress: null,
    iccid: null,
    ipAddressV4: null,
    subnetAddress: null,
    wiredIPv4Addresses: [],
    totalStorageSpaceInBytes: null,
    freeStorageSpaceInBytes: null,
    physicalMemoryInBytes: null,
    imei: null,
    meid: null,
    processorArchitecture: null,
    tpmSpecificationVersion: null,
    tpmManufacturer: null,
    tpmVersion: null,
    systemManagementBIOSVersion: null,
    activationLockBypassCode: null,
    easActivated: null,
    easDeviceId: null,
    easActivationDateTime: null,
    isSupervised: null,
    managedDeviceOwnerType: null,
    subscriptionState: null
  };
}
var DEVICE_SELECT = [
  "id",
  "deviceName",
  "userPrincipalName",
  "operatingSystem",
  "osVersion",
  "complianceState",
  "lastSyncDateTime",
  "managementAgent",
  "model",
  "manufacturer",
  "isEncrypted",
  "azureADDeviceId"
].join(",");
var DETAIL_SELECT = [
  DEVICE_SELECT,
  "emailAddress",
  "enrolledDateTime",
  "jailBroken",
  "userId",
  "managedDeviceName",
  "serialNumber",
  "azureADRegistered",
  "enrollmentProfileName",
  "userDisplayName",
  "subscriberCarrier",
  "meid",
  "imei",
  "totalStorageSpaceInBytes",
  "freeStorageSpaceInBytes",
  "physicalMemoryInBytes",
  "ethernetMacAddress",
  "wiFiMacAddress",
  "iccid",
  "easActivated",
  "easDeviceId",
  "easActivationDateTime",
  "isSupervised",
  "managedDeviceOwnerType",
  "skuFamily",
  "skuNumber",
  "activationLockBypassCode"
].join(",");
function isConflictPolicyState(state) {
  return state.trim().toLowerCase().replace(/[_\s]/g, "") === "conflict";
}
function isSuccessfulPolicyState(state) {
  const normalized = state.trim().toLowerCase().replace(/[_\s]/g, "");
  return [
    "compliant",
    "succeeded",
    "success",
    "secured",
    "remediated",
    "assigned"
  ].includes(normalized);
}
function findDevicePolicyMatches(states, policyName) {
  const needle = policyName.trim().toLowerCase();
  if (!needle) return [];
  return states.filter((state) => {
    const name = state.displayName.toLowerCase();
    return name === needle || name.includes(needle) || needle.includes(name);
  });
}

// src/lib/baselines/compare.ts
function optionSuffix(value) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  const parts = trimmed.split("_").filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}
function normalizeExpected(expected) {
  if (typeof expected === "boolean") {
    return expected ? ["enabled", "true", "allow", "allowed"] : ["disabled", "false", "block", "blocked", "not configured"];
  }
  if (typeof expected === "number") {
    return [String(expected), humanizeSettingToken(String(expected)).toLowerCase()];
  }
  const raw = expected.trim();
  const lower = raw.toLowerCase();
  const humanized = humanizeSettingToken(raw).toLowerCase();
  const aliases = /* @__PURE__ */ new Set([lower, humanized]);
  if (["true", "enabled", "allow", "allowed"].includes(lower)) {
    ["enabled", "true", "allow", "allowed"].forEach((a) => aliases.add(a));
  }
  if (["false", "disabled", "block", "blocked"].includes(lower)) {
    ["disabled", "false", "block", "blocked", "not configured"].forEach(
      (a) => aliases.add(a)
    );
  }
  return [...aliases];
}
function rawValuesMatch(expectedRaw, actualRaw) {
  if (!expectedRaw?.trim() || !actualRaw?.trim()) return false;
  const left = expectedRaw.trim().toLowerCase();
  const right = actualRaw.trim().toLowerCase();
  if (left === right) return true;
  const leftSuffix = optionSuffix(left);
  const rightSuffix = optionSuffix(right);
  if (leftSuffix && leftSuffix === rightSuffix && left.endsWith(`_${leftSuffix}`)) {
    if (left.includes("_") && right.includes("_")) {
      const leftStem = left.slice(0, left.length - leftSuffix.length);
      const rightStem = right.slice(0, right.length - rightSuffix.length);
      const leftSeg = optionSuffix(leftStem.replace(/_+$/, ""));
      const rightSeg = optionSuffix(rightStem.replace(/_+$/, ""));
      return Boolean(leftSeg && leftSeg === rightSeg);
    }
  }
  return false;
}
function valueMatchesExpected(valueSummary, rawValue, expected, expectedRaw) {
  if (rawValuesMatch(expectedRaw, rawValue)) return true;
  const expectedForms = normalizeExpected(expected);
  if (expectedRaw?.trim()) {
    expectedForms.push(
      expectedRaw.trim().toLowerCase(),
      humanizeSettingToken(expectedRaw).toLowerCase(),
      optionSuffix(expectedRaw)
    );
  }
  const actualForms = [valueSummary, rawValue ?? ""].filter(Boolean).map((v) => v.trim().toLowerCase());
  return actualForms.some(
    (actual) => expectedForms.some(
      (exp) => Boolean(exp) && (actual === exp || actual.includes(exp) || exp.includes(actual))
    )
  );
}
function findSettingOccurrences(settings2, settingDefinitionId) {
  const needle = settingDefinitionId.trim().toLowerCase();
  return settings2.settings.filter((setting) => {
    const id = setting.settingDefinitionId.toLowerCase();
    return id === needle || id.endsWith(`_${needle}`) || id.endsWith(needle) || id.includes(needle);
  });
}

// src/lib/baselines/deviceCompare.ts
function summarize(results) {
  return {
    pass: results.filter((r) => r.status === "pass").length,
    warn: results.filter((r) => r.status === "warn").length,
    conflict: results.filter((r) => r.status === "conflict").length,
    fail: results.filter((r) => r.status === "fail").length,
    unknown: results.filter((r) => r.status === "unknown").length
  };
}
function isReportedOnDevice(state) {
  const normalized = state.trim().toLowerCase().replace(/[_\s]/g, "");
  if (!normalized || normalized === "notapplicable" || normalized === "notassigned") {
    return false;
  }
  return true;
}
function uniquePolicies(items) {
  const byName = /* @__PURE__ */ new Map();
  for (const item of items) {
    const key = item.policyName.trim().toLowerCase();
    if (!key || byName.has(key)) continue;
    byName.set(key, item);
  }
  return [...byName.values()];
}
function occurrencesFor(settings2, target, caches) {
  const key = target.trim().toLowerCase();
  if (!key) return [];
  if (caches) {
    const hit = caches.occurrences.get(key);
    if (hit) return hit;
    const next = findSettingOccurrences(settings2, target);
    caches.occurrences.set(key, next);
    return next;
  }
  return findSettingOccurrences(settings2, target);
}
function resolveConflictIdsCached(settings2, settingName, policyKeys2, caches) {
  if (!settings2 || !settingName.trim()) return [];
  const cacheKey = `${settingName.trim().toLowerCase()}\0${(policyKeys2 ?? []).map((key) => key.trim().toLowerCase()).filter(Boolean).sort().join("|")}`;
  if (caches) {
    const hit = caches.conflictDefinitionIds.get(cacheKey);
    if (hit) return hit;
    const next = resolveConflictNameToDefinitionIds(
      settings2,
      settingName,
      policyKeys2
    );
    caches.conflictDefinitionIds.set(cacheKey, next);
    return next;
  }
  return resolveConflictNameToDefinitionIds(settings2, settingName, policyKeys2);
}
function policiesThatConfigureSetting(settings2, check, caches) {
  const target = check.target?.trim();
  if (!settings2 || !target) return [];
  return uniquePolicies(
    occurrencesFor(settings2, target, caches).map((item) => ({
      policyId: item.policyId,
      policyName: item.policyName,
      valueSummary: item.valueSummary
    }))
  );
}
function policiesThatDeliverSetting(settings2, check, caches) {
  const target = check.target?.trim();
  if (!settings2 || !target) return [];
  const occurrences = occurrencesFor(settings2, target, caches);
  const matched = check.type === "settingEquals" ? occurrences.filter(
    (item) => valueMatchesExpected(
      item.valueSummary,
      item.rawValue,
      check.expected ?? true,
      check.expectedRaw
    )
  ) : occurrences;
  return uniquePolicies(
    matched.map((item) => ({
      policyId: item.policyId,
      policyName: item.policyName,
      valueSummary: item.valueSummary
    }))
  );
}
function collectIssues(policies) {
  return policies.flatMap((policy) => policy.issues ?? []);
}
function normalizeKey(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
function token(value) {
  return value.trim().toLowerCase().replace(/[~./\\]+/g, "_").replace(/[_\s-]+/g, "");
}
function significantSegments(value) {
  return value.toLowerCase().split(/[~_/\s.-]+/).map((part) => part.replace(/[^a-z0-9]/g, "")).filter((part) => part.length >= 6);
}
function labelsMatch(a, b) {
  const left = normalizeKey(a);
  const right = normalizeKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length >= 5 && longer.includes(shorter)) return true;
  const leftTok = token(a);
  const rightTok = token(b);
  if (!leftTok || !rightTok) return false;
  if (leftTok === rightTok) return true;
  const shortTok = leftTok.length <= rightTok.length ? leftTok : rightTok;
  const longTok = leftTok.length <= rightTok.length ? rightTok : leftTok;
  return shortTok.length >= 8 && longTok.includes(shortTok);
}
function definitionIdRelated(candidate, target) {
  const left = candidate.trim().toLowerCase();
  const right = target.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const leftTok = token(left);
  const rightTok = token(right);
  if (leftTok === rightTok) return true;
  if (leftTok.length >= 8 && rightTok.length >= 8 && (leftTok.includes(rightTok) || rightTok.includes(leftTok))) {
    return true;
  }
  const targetLeaf = significantSegments(right).at(-1);
  if (!targetLeaf || targetLeaf.length < 8) return false;
  return leftTok.includes(targetLeaf) || significantSegments(left).includes(targetLeaf);
}
function catalogLabelsForCheck(settings2, check, caches) {
  const target = check.target?.trim();
  const labels = /* @__PURE__ */ new Set();
  if (check.title?.trim()) labels.add(check.title.trim());
  if (target) {
    const humanized = humanizeSettingToken(target);
    if (humanized && humanized !== "(empty)") labels.add(humanized);
    const leaf = target.split(/[~_]/).filter(Boolean).pop();
    if (leaf && leaf.length >= 4) {
      labels.add(humanizeSettingToken(leaf));
      labels.add(leaf);
    }
  }
  if (settings2 && target) {
    for (const row of occurrencesFor(settings2, target, caches)) {
      if (row.displayName?.trim()) labels.add(row.displayName.trim());
    }
  }
  return [...labels].filter(Boolean);
}
function policyKeysForCheck(settings2, check, caches) {
  const target = check.target?.trim();
  if (!settings2 || !target) return [];
  return [
    ...new Set(
      occurrencesFor(settings2, target, caches).flatMap((row) => [
        row.policyId,
        row.policyName
      ])
    )
  ];
}
function isPolicyStatusPlaceholder(issue) {
  return issue.setting === "PolicyStatus" || normalizeKey(issue.settingName) === "policy status";
}
function isGenericOverlapPlaceholder(issue) {
  const name = normalizeKey(issue.settingName || issue.setting || "");
  return name === "overlapping setting" || name === "overlapping settings";
}
function isNamedSettingConflict(issue) {
  return isConflictPolicyState(issue.state) && !isPolicyStatusPlaceholder(issue) && !isGenericOverlapPlaceholder(issue);
}
function conflictLabelBelongsToCheck(label, check, catalogLabels, settings2, caches) {
  const trimmed = label.trim();
  if (!trimmed) return false;
  if (trimmed === "Policy status" || trimmed === "PolicyStatus" || normalizeKey(trimmed) === "overlapping setting") {
    return false;
  }
  const target = check.target?.trim();
  const needles = [target, check.title, ...catalogLabels].filter(
    (value) => Boolean(value?.trim())
  );
  if (needles.some((needle) => labelsMatch(trimmed, needle))) {
    return true;
  }
  if (target && definitionIdRelated(trimmed, target)) {
    return true;
  }
  if (!settings2 || !target) return false;
  const policyKeys2 = policyKeysForCheck(settings2, check, caches);
  const resolved = resolveConflictIdsCached(
    settings2,
    trimmed,
    policyKeys2.length > 0 ? policyKeys2 : void 0,
    caches
  );
  return resolved.some(
    (id) => definitionIdRelated(id, target) || labelsMatch(id, target)
  );
}
function issueMatchesBaselineSetting(issue, check, catalogLabels = [], settings2, caches) {
  if (!isNamedSettingConflict(issue)) return false;
  const haystacks = [
    issue.settingName,
    issue.setting,
    issue.settingInstanceId
  ].filter((value) => Boolean(value?.trim()));
  return haystacks.some(
    (hay) => conflictLabelBelongsToCheck(
      hay,
      check,
      catalogLabels,
      settings2 ?? null,
      caches
    )
  );
}
function conflictLabelMatchesCheck(label, check, catalogLabels, settings2, caches) {
  return conflictLabelBelongsToCheck(
    label,
    check,
    catalogLabels,
    settings2,
    caches
  );
}
function policyKeys(policies) {
  return new Set(
    policies.flatMap((policy) => [
      normalizeKey(policy.id),
      normalizeKey(policy.displayName)
    ])
  );
}
function policyInKeySet(policy, keys) {
  return keys.has(normalizeKey(policy.id)) || keys.has(normalizeKey(policy.displayName));
}
function findAppliedPolicies(appliedStates, catalogPolicies) {
  const matches = catalogPolicies.flatMap((policy) => {
    const byName = findDevicePolicyMatches(appliedStates, policy.policyName);
    const needleId = policy.policyId.trim().toLowerCase();
    const byId2 = needleId ? appliedStates.filter(
      (state) => state.id.trim().toLowerCase() === needleId
    ) : [];
    return [...byName, ...byId2];
  });
  const seen = /* @__PURE__ */ new Set();
  return matches.filter((row) => {
    if (!isReportedOnDevice(row.state)) return false;
    const key = `${row.id}:${row.displayName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function classifyAppliedSetting(check, device2, appliedDelivering, appliedConfiguring, delivering, settings2, caches, namedConflictIssues) {
  const catalogLabels = catalogLabelsForCheck(settings2, check, caches);
  const scope = appliedConfiguring.length > 0 ? appliedConfiguring : appliedDelivering;
  const scopeKeys = policyKeys(scope);
  const devicePolicies = [
    ...device2.configurationStates,
    ...device2.compliancePolicyStates
  ];
  const issuePool = namedConflictIssues ?? collectIssues(devicePolicies).filter(isNamedSettingConflict);
  const namedConflicts = issuePool.filter(
    (issue) => issueMatchesBaselineSetting(issue, check, catalogLabels, settings2, caches)
  );
  if (namedConflicts.length > 0) {
    const unique = /* @__PURE__ */ new Map();
    for (const issue of namedConflicts) {
      const key = `${issue.policyId}:${issue.settingName}:${issue.state}`;
      if (!unique.has(key)) unique.set(key, issue);
    }
    const conflicts = [...unique.values()];
    return {
      check,
      status: "conflict",
      actual: "conflict",
      message: `This setting is in conflict on the device (${conflicts.slice(0, 2).map((issue) => issue.settingName || issue.policyDisplayName).join(", ")})`,
      evidence: conflicts.slice(0, 6).map((issue) => ({
        policyName: issue.policyDisplayName || issue.policyId,
        valueSummary: `${issue.settingName}: ${issue.state}`
      }))
    };
  }
  const deviceKeys = policyKeys([
    ...device2.configurationStates,
    ...device2.compliancePolicyStates
  ]);
  for (const summary of device2.policyConflicts ?? []) {
    if (summary.contributingSettings.length === 0) continue;
    let overlapping = summary.conflictingPolicies.filter(
      (policy) => policyInKeySet(policy, scopeKeys)
    );
    if (overlapping.length === 0) {
      overlapping = summary.conflictingPolicies.filter(
        (policy) => policyInKeySet(policy, deviceKeys)
      );
    }
    if (overlapping.length === 0) continue;
    for (const contributing of summary.contributingSettings) {
      if (!conflictLabelMatchesCheck(
        contributing,
        check,
        catalogLabels,
        settings2,
        caches
      )) {
        continue;
      }
      return {
        check,
        status: "conflict",
        actual: "conflict",
        message: `This setting (\u201C${contributing}\u201D) is listed in a device conflict involving ${overlapping.slice(0, 2).map((policy) => policy.displayName).join(", ")}`,
        evidence: overlapping.slice(0, 6).map((policy) => ({
          policyName: policy.displayName,
          valueSummary: `conflict \xB7 ${contributing}`
        }))
      };
    }
  }
  const successful = appliedDelivering.filter(
    (policy) => isSuccessfulPolicyState(policy.state)
  );
  const parentConflict = appliedDelivering.filter(
    (policy) => isConflictPolicyState(policy.state)
  );
  if (successful.length > 0 || parentConflict.length > 0) {
    const winner = successful[0] ?? parentConflict[0];
    const deliveringHit = delivering.find(
      (policy) => policy.policyName.toLowerCase() === winner.displayName.toLowerCase() || policy.policyId === winner.id
    ) ?? delivering[0];
    return {
      check,
      status: "pass",
      actual: winner.state,
      message: `Policy \u201C${winner.displayName}\u201D is applied and configures this setting`,
      evidence: [
        {
          policyName: winner.displayName,
          valueSummary: `applied \xB7 policy sets ${deliveringHit.valueSummary}`
        }
      ]
    };
  }
  return {
    check,
    status: "fail",
    actual: appliedDelivering[0]?.state ?? null,
    message: `A delivering policy is on the device but not successful (${appliedDelivering.map((policy) => `${policy.displayName}:${policy.state}`).join(", ")})`,
    evidence: appliedDelivering.map((policy) => ({
      policyName: policy.displayName,
      valueSummary: policy.state
    }))
  };
}
function evaluateDeviceCheck(check, device2, settings2, caches, namedConflictIssues) {
  const appliedStates = [
    ...device2.configurationStates,
    ...device2.compliancePolicyStates
  ];
  switch (check.type) {
    case "deviceComplianceRateAtLeast": {
      const state = (device2.complianceState ?? "unknown").toLowerCase();
      const pass = state === "compliant";
      return {
        check,
        status: pass ? "pass" : "fail",
        actual: device2.complianceState ?? "unknown",
        message: pass ? `Device compliance state is \u201C${device2.complianceState}\u201D` : `Device compliance state is \u201C${device2.complianceState ?? "unknown"}\u201D (expects compliant)`
      };
    }
    case "policyExists": {
      const name = check.target ?? "";
      const matches = findDevicePolicyMatches(appliedStates, name).filter(
        (row) => isReportedOnDevice(row.state)
      );
      if (matches.length === 0) {
        return {
          check,
          status: "fail",
          actual: null,
          message: `No applied policy on this device matching \u201C${name}\u201D`,
          evidence: []
        };
      }
      const ok = matches.filter(
        (m) => isSuccessfulPolicyState(m.state) || isConflictPolicyState(m.state)
      );
      if (ok.length > 0) {
        return {
          check,
          status: "pass",
          actual: matches.map((m) => `${m.displayName}:${m.state}`).join(", "),
          message: `Policy applied on device (${ok.length} match${ok.length === 1 ? "" : "es"})`,
          evidence: matches.map((m) => ({
            policyName: m.displayName,
            valueSummary: m.state
          }))
        };
      }
      return {
        check,
        status: "fail",
        actual: matches[0]?.state ?? null,
        message: `Policy found on device but not in a successful state`,
        evidence: matches.map((m) => ({
          policyName: m.displayName,
          valueSummary: m.state
        }))
      };
    }
    case "policyCountAtLeast": {
      const count = device2.configurationStates.length;
      const expected = Number(check.expected ?? 0);
      const pass = count >= expected;
      return {
        check,
        status: pass ? "pass" : "fail",
        actual: count,
        message: pass ? `Device has ${count} applied configuration state${count === 1 ? "" : "s"} (required \u2265 ${expected})` : `Device has ${count} applied configuration state${count === 1 ? "" : "s"}, expected \u2265 ${expected}`
      };
    }
    case "settingPresent":
    case "settingEquals": {
      const target = check.target?.trim();
      if (!target) {
        return {
          check,
          status: "unknown",
          message: "Baseline check is missing a settingDefinitionId target"
        };
      }
      if (!settings2) {
        return {
          check,
          status: "unknown",
          message: "Settings Catalog index not loaded \u2014 cannot see which tenant policies configure this setting"
        };
      }
      const configuring = policiesThatConfigureSetting(settings2, check, caches);
      const delivering = policiesThatDeliverSetting(settings2, check, caches);
      if (delivering.length === 0) {
        return {
          check,
          status: "fail",
          actual: null,
          message: check.type === "settingEquals" ? "No tenant policy configures this setting to the baseline requirement \u2014 nothing to evaluate on the device" : "No tenant policy configures this setting \u2014 nothing to evaluate on the device",
          evidence: []
        };
      }
      if (appliedStates.length === 0) {
        return {
          check,
          status: "unknown",
          actual: null,
          message: `Tenant has ${delivering.length} polic${delivering.length === 1 ? "y" : "ies"} that configure this setting, but this device reports no policy application states`,
          evidence: delivering.slice(0, 6).map((policy) => ({
            policyName: policy.policyName,
            valueSummary: `configures as ${policy.valueSummary}`
          }))
        };
      }
      const appliedDelivering = findAppliedPolicies(appliedStates, delivering);
      const appliedConfiguring = findAppliedPolicies(
        appliedStates,
        configuring.length > 0 ? configuring : delivering
      );
      if (appliedDelivering.length === 0) {
        const peerConflicts = classifyAppliedSetting(
          check,
          device2,
          [],
          appliedConfiguring,
          delivering,
          settings2,
          caches,
          namedConflictIssues
        );
        if (peerConflicts.status === "conflict") {
          return peerConflicts;
        }
        return {
          check,
          status: "fail",
          actual: null,
          message: "A tenant policy configures this setting, but none of those policies are applied on this device",
          evidence: delivering.slice(0, 6).map((policy) => ({
            policyName: policy.policyName,
            valueSummary: `would set ${policy.valueSummary} \xB7 not applied`
          }))
        };
      }
      return classifyAppliedSetting(
        check,
        device2,
        appliedDelivering,
        appliedConfiguring,
        delivering,
        settings2,
        caches,
        namedConflictIssues
      );
    }
    default:
      return {
        check,
        status: "unknown",
        message: `Unsupported check type for device evaluation: ${check.type}`
      };
  }
}
function evaluateDeviceBaseline(baseline2, device2, options = {}) {
  const notes = [
    "OK: a policy that configures the required setting is applied on this device.",
    "Setting conflict: this specific setting is reported in conflict on the device.",
    "Fail: no delivering policy is applied on this device."
  ];
  const caches = {
    occurrences: /* @__PURE__ */ new Map(),
    conflictDefinitionIds: /* @__PURE__ */ new Map()
  };
  const namedConflictIssues = collectIssues([
    ...device2.configurationStates,
    ...device2.compliancePolicyStates
  ]).filter(isNamedSettingConflict);
  const results = baseline2.checks.map(
    (check) => evaluateDeviceCheck(
      check,
      device2,
      options.settings,
      caches,
      namedConflictIssues
    )
  );
  if (device2.configurationStates.length === 0 && device2.compliancePolicyStates.length === 0) {
    notes.push(
      "No configuration or compliance policy states were returned for this device."
    );
  }
  const hasSettingConflictRows = namedConflictIssues.length > 0;
  const hasPolicyConflicts = (device2.policyConflicts?.length ?? 0) > 0;
  if (!hasSettingConflictRows && !hasPolicyConflicts) {
    notes.push(
      "No setting-level conflict data was available for this device \u2014 results may only reflect whether delivering policies are applied."
    );
  }
  return {
    baseline: baseline2,
    deviceId: device2.id,
    deviceName: device2.deviceName,
    results,
    summary: summarize(results),
    notes
  };
}

// scripts/verify-baseline-eval-entry.ts
var DOWNLOAD = "device_vendor_msft_policy_config_microsoft_edge~policy~downloadrestrictions_downloadrestrictions";
var LSA = "device_vendor_msft_policy_config_localsecurityauthority_configurelsaprotectedprocess";
var MISSING = "device_vendor_msft_policy_config_does_not_exist_anywhere_zzz";
var settings = {
  policies: [
    { id: "demo-cfg-1", name: "ASD Edge Hardening Guidelines" },
    { id: "demo-cfg-2", name: "Microsoft Edge CIS L1 Consolidated" },
    { id: "demo-1", name: "Windows Security Baseline" }
  ],
  settings: [
    {
      key: "1",
      policyId: "demo-cfg-1",
      policyName: "ASD Edge Hardening Guidelines",
      settingDefinitionId: DOWNLOAD,
      displayName: "Download restrictions",
      valueSummary: "Block malicious downloads",
      rawValue: `${DOWNLOAD}_2`,
      instanceType: "choiceSettingInstance",
      path: "root"
    },
    {
      key: "1b",
      policyId: "demo-cfg-1",
      policyName: "ASD Edge Hardening Guidelines",
      settingDefinitionId: "device_vendor_msft_policy_config_microsoft_edge~policy~microsoft_edge~downloadrestrictions_allowdownloadrestrictions",
      displayName: "Allow download restrictions",
      valueSummary: "Enabled \xB7 Nested settings",
      rawValue: "1",
      instanceType: "choiceSettingInstance",
      path: "root"
    },
    {
      key: "2",
      policyId: "demo-cfg-2",
      policyName: "Microsoft Edge CIS L1 Consolidated",
      settingDefinitionId: DOWNLOAD,
      displayName: "Download restrictions",
      valueSummary: "Block potentially dangerous downloads",
      rawValue: `${DOWNLOAD}_1`,
      instanceType: "choiceSettingInstance",
      path: "root"
    },
    {
      key: "3",
      policyId: "demo-1",
      policyName: "Windows Security Baseline",
      settingDefinitionId: LSA,
      displayName: "Configure LSA protected process",
      valueSummary: "Enabled",
      rawValue: `${LSA}_1`,
      instanceType: "choiceSettingInstance",
      path: "root"
    }
  ],
  loadedAt: (/* @__PURE__ */ new Date()).toISOString(),
  errors: []
};
var device = {
  id: "demo-device",
  deviceName: "DEMO-PC",
  operatingSystem: "Windows",
  osVersion: "10.0",
  complianceState: "compliant",
  userPrincipalName: "demo@contoso.com",
  userId: null,
  azureADDeviceId: null,
  emailAddress: null,
  enrolledDateTime: null,
  jailBroken: null,
  hardware: emptyHardwareDetails(),
  configurationStates: [
    {
      id: "demo-cfg-1",
      displayName: "ASD Edge Hardening Guidelines",
      state: "conflict",
      source: "configurationPolicy",
      assigned: true,
      issues: [
        {
          policyId: "demo-cfg-1",
          policyDisplayName: "ASD Edge Hardening Guidelines",
          settingName: "Download restrictions",
          setting: "downloadrestrictions",
          state: "conflict",
          sources: [
            {
              id: "demo-cfg-1",
              displayName: "ASD Edge Hardening Guidelines"
            },
            {
              id: "demo-cfg-2",
              displayName: "Microsoft Edge CIS L1 Consolidated"
            }
          ]
        }
      ]
    },
    {
      id: "demo-cfg-2",
      displayName: "Microsoft Edge CIS L1 Consolidated",
      state: "conflict",
      source: "configurationPolicy",
      assigned: true,
      issues: [
        {
          policyId: "demo-cfg-2",
          policyDisplayName: "Microsoft Edge CIS L1 Consolidated",
          settingName: "Allow download restrictions",
          setting: "Allow download restrictions",
          state: "conflict",
          sources: []
        }
      ]
    },
    {
      id: "demo-1",
      displayName: "Windows Security Baseline",
      state: "conflict",
      source: "configurationPolicy",
      assigned: true,
      issues: [
        {
          policyId: "demo-1",
          policyDisplayName: "Windows Security Baseline",
          settingName: "Policy status",
          setting: "PolicyStatus",
          state: "conflict",
          sources: []
        }
      ]
    }
  ],
  compliancePolicyStates: [],
  policyConflicts: [
    {
      id: "c1",
      contributingSettings: ["Download restrictions"],
      conflictingPolicies: [
        {
          id: "demo-cfg-1",
          displayName: "ASD Edge Hardening Guidelines"
        },
        {
          id: "demo-cfg-2",
          displayName: "Microsoft Edge CIS L1 Consolidated"
        }
      ],
      relevantToDevice: true
    }
  ],
  policyDiagnostics: {
    rawConfigurationStateCount: 3,
    rawConfigurationPolicyStateCount: 3,
    rawComplianceStateCount: 0,
    rawStates: [],
    conflictSummaryCount: 1,
    notes: []
  },
  managedApps: [],
  detectedApps: [],
  deviceGroups: [],
  userGroups: [],
  enrichmentWarnings: []
};
var baseline = {
  id: "verify",
  name: "Verify Baseline",
  description: "test",
  version: "1",
  source: "custom",
  checks: [
    {
      id: "c-conflict",
      title: "Download restrictions",
      category: "Edge",
      type: "settingEquals",
      target: DOWNLOAD,
      expected: "Block malicious downloads",
      expectedRaw: `${DOWNLOAD}_2`
    },
    {
      id: "c-pass",
      title: "Configure LSA protected process",
      category: "Security",
      type: "settingEquals",
      target: LSA,
      expected: "Enabled",
      expectedRaw: `${LSA}_1`
    },
    {
      id: "c-fail",
      title: "Missing setting",
      category: "Other",
      type: "settingEquals",
      target: MISSING,
      expected: "Enabled"
    }
  ]
};
var evaluation = evaluateDeviceBaseline(baseline, device, { settings });
var byId = Object.fromEntries(
  evaluation.results.map((result) => [result.check.id, result.status])
);
var expectations = {
  "c-conflict": "conflict",
  "c-pass": "pass",
  "c-fail": "fail"
};
var failed = 0;
for (const [id, expected] of Object.entries(expectations)) {
  const actual = byId[id];
  const ok = actual === expected;
  if (!ok) failed += 1;
  const message = evaluation.results.find((r) => r.check.id === id)?.message;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${id}: ${actual} (want ${expected}) \u2014 ${message}`
  );
}
console.log(
  `
Summary: conflict=${evaluation.summary.conflict} pass=${evaluation.summary.pass} fail=${evaluation.summary.fail}`
);
if (failed > 0 || evaluation.summary.conflict !== 1) {
  console.error(
    `
Failed: expected exactly 1 conflict among 3 checks (got ${evaluation.summary.conflict}, ${failed} status mismatches)`
  );
  process.exit(1);
}
console.log("\nBaseline evaluation verify OK.");
