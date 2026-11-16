import { useEffect, useMemo, useState } from "react";
import { useInventory } from "../../hooks/useInventory";
import { hrefWithParam, navigate } from "../../lib/route";
import {
  fetchConditionalAccessCoverage,
  resolveReviewNames,
  type ConditionalAccessCoverage,
  type CoverageGap,
} from "../../lib/tauri";
import { PageHeader, Panel, PanelHead, SignalCard } from "../ui/PageChrome";
import {
  asList,
  asRecord,
  humanize,
  isoDate,
  loaderFor,
  ReviewSections,
  ReviewWorkbench,
  rowTitle,
  type ReviewColumn,
  type ReviewNames,
  type ReviewRow,
  type ReviewSection,
} from "./ReviewWorkbench";
import { AppCredentialsView, AuthStrengthsView, CaTemplatesView, CustomRolesView, PimRoleSettingsView, RoleAssignmentsView, TenantSettingsView } from "./EntraDirectoryPages";

const OVERVIEW_PATH = "/entra/conditional-access/overview";
const POLICIES_PATH = "/entra/conditional-access/policies";
const NAMED_LOCATIONS_PATH = "/entra/conditional-access/named-locations";
const AUTH_REGISTRATION_PATH = "/entra/authentication-methods/registration";
const AUTH_POLICY_PATH = "/entra/authentication-methods/policy";

// Authentication methods. Method tokens have no Graph display names, so labels are humanized.

const yes = (value: unknown) => (value ? "Yes" : "No");
const methods = (row: ReviewRow) => asList(row.methodsRegistered).map(humanize);

function registrationHeadline(rows: ReviewRow[]) {
  const count = (test: (row: ReviewRow) => boolean) => rows.filter(test).length;
  const users = rows.length;
  const mfa = count((row) => Boolean(row.isMfaRegistered));
  const adminsWithout = count((row) => Boolean(row.isAdmin) && !row.isMfaRegistered);
  const passwordless = count((row) => Boolean(row.isPasswordlessCapable));
  return (
    <div className="axis-panel axis-panel-padded">
      <p className="axis-kicker">Registration</p>
      <h2 style={{ margin: 0 }}>
        {mfa} of {users} users MFA registered ({users ? Math.round((mfa / users) * 100) : 0}%)
      </h2>
      <p className="muted" style={{ margin: "0.35rem 0 0" }}>
        {adminsWithout} admin{adminsWithout === 1 ? "" : "s"} without MFA · {passwordless} passwordless capable
      </p>
    </div>
  );
}

const REGISTRATION_COLUMNS: ReviewColumn[] = [
  { key: "mfa", label: "MFA registered", value: (row) => yes(row.isMfaRegistered) },
  { key: "methods", label: "Methods", value: (row) => methods(row).join(", ") },
  { key: "default", secondary: true, label: "Default MFA method", value: (row) => (row.defaultMfaMethod === "none" ? "" : humanize(row.defaultMfaMethod)) },
  { key: "admin", label: "Admin", value: (row) => yes(row.isAdmin) },
  { key: "type", secondary: true, label: "User type", value: (row) => humanize(row.userType) },
];

const registrationSections = (row: ReviewRow): ReviewSection[] => [
  {
    title: "User",
    fields: [
      { label: "User principal name", value: String(row.userPrincipalName ?? "") },
      { label: "User type", value: humanize(row.userType) },
      { label: "Admin", value: yes(row.isAdmin) },
      { label: "Last updated", value: isoDate(row.lastUpdatedDateTime) },
    ],
  },
  {
    title: "Registration",
    fields: [
      { label: "Methods registered", value: methods(row) },
      { label: "MFA registered", value: yes(row.isMfaRegistered) },
      { label: "MFA capable", value: yes(row.isMfaCapable) },
      { label: "Passwordless capable", value: yes(row.isPasswordlessCapable) },
      { label: "Default MFA method", value: humanize(row.defaultMfaMethod) },
      { label: "Preferred secondary method", value: humanize(row.userPreferredMethodForSecondaryAuthentication) },
      { label: "System-preferred MFA", value: yes(row.isSystemPreferredAuthenticationMethodEnabled) },
    ],
  },
  {
    title: "Self-service password reset",
    fields: [
      { label: "Enabled", value: yes(row.isSsprEnabled) },
      { label: "Registered", value: yes(row.isSsprRegistered) },
      { label: "Capable", value: yes(row.isSsprCapable) },
    ],
  },
];

const targets = (value: unknown) =>
  (Array.isArray(value) ? value.map(asRecord) : []).map((target) =>
    target.id === "all_users" ? "All users" : `${humanize(target.targetType)} ${String(target.id ?? "")}`.trim(),
  );

const METHOD_COLUMNS: ReviewColumn[] = [
  { key: "state", label: "State", value: (row) => humanize(row.state) },
  { key: "include", label: "Included", value: (row) => targets(row.includeTargets).join(", ") },
  { key: "exclude", secondary: true, label: "Excluded", value: (row) => targets(row.excludeTargets).join(", ") },
];

const SKIP_METHOD_KEYS = new Set(["id", "state", "includeTargets", "excludeTargets", "@odata.type"]);

const methodSections = (row: ReviewRow): ReviewSection[] => [
  {
    title: "Method",
    fields: [
      { label: "State", value: humanize(row.state) },
      { label: "Included", value: targets(row.includeTargets) },
      { label: "Excluded", value: targets(row.excludeTargets) },
    ],
  },
  {
    title: "Settings",
    fields: Object.entries(row)
      .filter(([key]) => !SKIP_METHOD_KEYS.has(key))
      .map(([key, value]) => ({
        label: humanize(key),
        value: value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value),
      })),
  },
];

/** Structural values Graph puts in CA include/exclude lists instead of object ids. */
const USER_SPECIAL: Record<string, string> = { All: "All users", None: "None", GuestsOrExternalUsers: "Guests or external users" };
const APP_SPECIAL: Record<string, string> = { All: "All resources", None: "None", Office365: "Office 365", MicrosoftAdminPortals: "Microsoft admin portals" };
const LOCATION_SPECIAL: Record<string, string> = {
  All: "Any location",
  AllTrusted: "All trusted locations",
  "00000000-0000-0000-0000-000000000000": "MFA trusted IPs",
};

type Lines = Array<[string, string]>;

const named = (ids: unknown, names: ReviewNames, special: Record<string, string> = {}) =>
  asList(ids).map((id) => special[id] ?? names[id] ?? id);

/** "A, B, C +2 more" for table cells; the inspector shows the full list. */
function shortList(items: string[], max = 3): string {
  return items.length > max ? `${items.slice(0, max).join(", ")} +${items.length - max} more` : items.join(", ");
}

function withExcluded(include: string[], exclude: string[]): string {
  const text = shortList(include) || "None";
  return exclude.length ? `${text} · excl. ${shortList(exclude)}` : text;
}

function guests(value: unknown): string[] {
  const types = String(asRecord(value).guestOrExternalUserTypes ?? "");
  return types ? [`Guests: ${types.split(",").map(humanize).join(", ")}`] : [];
}

function userTargets(row: ReviewRow, names: ReviewNames) {
  const users = asRecord(asRecord(row.conditions).users);
  return {
    include: [
      ...named(users.includeUsers, names, USER_SPECIAL),
      ...named(users.includeGroups, names),
      ...named(users.includeRoles, names),
      ...guests(users.includeGuestsOrExternalUsers),
    ],
    exclude: [
      ...named(users.excludeUsers, names, USER_SPECIAL),
      ...named(users.excludeGroups, names),
      ...named(users.excludeRoles, names),
      ...guests(users.excludeGuestsOrExternalUsers),
    ],
  };
}

function resourceTargets(row: ReviewRow, names: ReviewNames) {
  const apps = asRecord(asRecord(row.conditions).applications);
  return {
    include: [
      ...named(apps.includeApplications, names, APP_SPECIAL),
      ...asList(apps.includeUserActions).map((action) => `User action: ${humanize(action.replace(/^urn:user:/, ""))}`),
      ...asList(apps.includeAuthenticationContextClassReferences).map((ref) => `Auth context: ${ref}`),
    ],
    exclude: named(apps.excludeApplications, names, APP_SPECIAL),
  };
}

function includeExclude(include: string[], exclude: string[]): string {
  return [include.length ? include.join(", ") : "", exclude.length ? `excluding ${exclude.join(", ")}` : ""]
    .filter(Boolean)
    .join("; ");
}

function conditionLines(row: ReviewRow, names: ReviewNames): Lines {
  const conditions = asRecord(row.conditions);
  const platforms = asRecord(conditions.platforms);
  const locations = asRecord(conditions.locations);
  const clientApps = asList(conditions.clientAppTypes).filter((type) => type !== "all");
  const filter = asRecord(asRecord(conditions.devices).deviceFilter);
  const lines: Lines = [
    ["Platforms", includeExclude(asList(platforms.includePlatforms), asList(platforms.excludePlatforms))],
    [
      "Locations",
      includeExclude(named(locations.includeLocations, names, LOCATION_SPECIAL), named(locations.excludeLocations, names, LOCATION_SPECIAL)),
    ],
    ["Client apps", clientApps.map(humanize).join(", ")],
    ["Sign-in risk", asList(conditions.signInRiskLevels).map(humanize).join(", ")],
    ["User risk", asList(conditions.userRiskLevels).map(humanize).join(", ")],
    ["Workload risk", asList(conditions.servicePrincipalRiskLevels).map(humanize).join(", ")],
    ["Insider risk", asList(conditions.insiderRiskLevels).map(humanize).join(", ")],
    ["Device filter", filter.rule ? `${humanize(filter.mode)}: ${filter.rule}` : ""],
    ["Auth flows", humanize(asRecord(conditions.authenticationFlows).transferMethods)],
  ];
  return lines.filter(([, value]) => value);
}

function grantControls(row: ReviewRow) {
  const grant = asRecord(row.grantControls);
  const controls = asList(grant.builtInControls);
  if (controls.includes("block")) return { block: true, all: false, items: ["Block access"] };
  const items = controls.map(humanize);
  const strength = asRecord(grant.authenticationStrength).displayName;
  if (strength) items.push(`Authentication strength: ${strength}`);
  if (asList(grant.termsOfUse).length) items.push("Terms of use");
  if (asList(grant.customAuthenticationFactors).length) items.push("Custom controls");
  return { block: false, all: grant.operator === "AND", items };
}

function grantText(row: ReviewRow): string {
  const grant = grantControls(row);
  if (grant.block) return "Block access";
  return grant.items.length ? `Require ${grant.items.join(grant.all ? " and " : " or ")}` : "";
}

function sessionItems(row: ReviewRow): string[] {
  return Object.entries(asRecord(row.sessionControls))
    .filter(([key, value]) => !key.startsWith("@") && value != null && value !== false && asRecord(value).isEnabled !== false)
    .map(([key, value]) => {
      const setting = asRecord(value);
      const detail =
        setting.value != null && setting.type
          ? `${setting.value} ${setting.type}`
          : setting.frequencyInterval === "everyTime"
            ? "Every time"
            : humanize(setting.mode ?? setting.cloudAppSecurityType ?? "");
      return detail ? `${humanize(key)}: ${detail}` : humanize(key);
    });
}

async function resolvePolicyNames(rows: ReviewRow[]): Promise<ReviewNames> {
  const refs = { users: new Set<string>(), groups: new Set<string>(), roles: new Set<string>(), apps: new Set<string>(), locations: new Set<string>() };
  const add = (set: Set<string>, ...lists: unknown[]) => lists.forEach((list) => asList(list).forEach((id) => set.add(id)));
  for (const row of rows) {
    const conditions = asRecord(row.conditions);
    const users = asRecord(conditions.users);
    const apps = asRecord(conditions.applications);
    const locations = asRecord(conditions.locations);
    add(refs.users, users.includeUsers, users.excludeUsers);
    add(refs.groups, users.includeGroups, users.excludeGroups);
    add(refs.roles, users.includeRoles, users.excludeRoles);
    add(refs.apps, apps.includeApplications, apps.excludeApplications);
    add(refs.locations, locations.includeLocations, locations.excludeLocations);
  }
  return resolveReviewNames({
    users: [...refs.users],
    groups: [...refs.groups],
    roles: [...refs.roles],
    apps: [...refs.apps],
    locations: [...refs.locations],
  });
}

const includeExcludeFields = (include: string[], exclude: string[]) => [
  { label: "Include", value: include },
  { label: "Exclude", value: exclude },
];

/** Portal order: assignments, then conditions, then access controls. */
function policySections(row: ReviewRow, names: ReviewNames): ReviewSection[] {
  const users = userTargets(row, names);
  const resources = resourceTargets(row, names);
  const conditions = asRecord(row.conditions);
  const platforms = asRecord(conditions.platforms);
  const locations = asRecord(conditions.locations);
  const filter = asRecord(asRecord(conditions.devices).deviceFilter);
  const levels = (value: unknown) => asList(value).filter((level) => level !== "all").map(humanize);
  const grant = grantControls(row);
  return [
    {
      title: "Policy",
      fields: [
        { label: "State", value: humanize(row.state) },
        { label: "Created", value: isoDate(row.createdDateTime) },
        { label: "Modified", value: isoDate(row.modifiedDateTime) || "Never" },
      ],
    },
    {
      title: "Assignments",
      groups: [
        { label: "Users", fields: includeExcludeFields(users.include, users.exclude) },
        { label: "Target resources", fields: includeExcludeFields(resources.include, resources.exclude) },
      ],
    },
    {
      title: "Conditions",
      fields: [
        { label: "User risk", value: levels(conditions.userRiskLevels) },
        { label: "Sign-in risk", value: levels(conditions.signInRiskLevels) },
        { label: "Insider risk", value: levels(conditions.insiderRiskLevels) },
        { label: "Workload risk", value: levels(conditions.servicePrincipalRiskLevels) },
        { label: "Client apps", value: levels(conditions.clientAppTypes) },
        {
          label: "Filter for devices",
          value: filter.rule ? [`${humanize(filter.mode)} devices matching`, String(filter.rule)] : [],
        },
        { label: "Authentication flows", value: humanize(asRecord(conditions.authenticationFlows).transferMethods) },
      ],
      groups: [
        {
          label: "Device platforms",
          fields: includeExcludeFields(asList(platforms.includePlatforms), asList(platforms.excludePlatforms)),
        },
        {
          label: "Locations",
          fields: includeExcludeFields(
            named(locations.includeLocations, names, LOCATION_SPECIAL),
            named(locations.excludeLocations, names, LOCATION_SPECIAL),
          ),
        },
      ],
    },
    {
      title: "Access controls",
      fields: [
        { label: "Grant", value: grant.items },
        ...(grant.items.length > 1
          ? [{ label: "For multiple controls", value: grant.all ? "Require all selected controls" : "Require one of the selected controls" }]
          : []),
        { label: "Session", value: sessionItems(row) },
      ],
    },
  ];
}

const cidrs = (row: ReviewRow): string[] =>
  Array.isArray(row.ipRanges) ? row.ipRanges.map((range) => String(asRecord(range).cidrAddress ?? "")) : [];

const locationType = (row: ReviewRow) => String(row["@odata.type"] ?? "").replace(/^#microsoft\.graph\./, "");

function locationSections(row: ReviewRow): ReviewSection[] {
  const type = locationType(row);
  const sections: ReviewSection[] = [
    {
      title: "Location",
      fields: [
        { label: "Type", value: humanize(type) },
        ...(type === "ipNamedLocation"
          ? [{ label: "Trusted", value: row.isTrusted ? "Yes" : "No" }]
          : type === "countryNamedLocation"
            ? [
                { label: "Lookup method", value: humanize(row.countryLookupMethod) },
                { label: "Unknown countries", value: row.includeUnknownCountriesAndRegions ? "Included" : "Not included" },
              ]
            : []),
        { label: "Modified", value: isoDate(row.modifiedDateTime ?? row.createdDateTime) },
      ],
    },
  ];
  if (type === "ipNamedLocation") sections.push({ title: "IP ranges", fields: [{ label: "Ranges", value: cidrs(row) }] });
  if (type === "countryNamedLocation") {
    sections.push({ title: "Countries and regions", fields: [{ label: "Countries", value: asList(row.countriesAndRegions) }] });
  }
  return sections;
}

const POLICY_COLUMNS: ReviewColumn[] = [
  { key: "state", label: "State", value: (row) => humanize(row.state) },
  {
    key: "users",
    label: "Users",
    value: (row, names) => {
      const targets = userTargets(row, names);
      return withExcluded(targets.include, targets.exclude);
    },
  },
  {
    key: "apps",
    label: "Target resources",
    value: (row, names) => {
      const targets = resourceTargets(row, names);
      return withExcluded(targets.include, targets.exclude);
    },
  },
  {
    key: "conditions",
    label: "Conditions",
    value: (row, names) => conditionLines(row, names).map(([label, value]) => `${label}: ${value}`).join("; "),
  },
  { key: "grant", label: "Grant", value: grantText },
  { key: "session", secondary: true, label: "Session", value: (row) => sessionItems(row).join(", ") },
  { key: "modified", secondary: true, label: "Modified", value: (row) => isoDate(row.modifiedDateTime ?? row.createdDateTime) },
];

const LOCATION_COLUMNS: ReviewColumn[] = [
  { key: "type", label: "Type", value: (row) => humanize(locationType(row)) },
  { key: "trusted", secondary: true, label: "Trusted", value: (row) => (typeof row.isTrusted === "boolean" ? (row.isTrusted ? "Yes" : "No") : "") },
  {
    key: "entries",
    label: "Entries",
    value: (row) => shortList([...cidrs(row), ...asList(row.countriesAndRegions)]),
  },
  { key: "modified", secondary: true, label: "Modified", value: (row) => isoDate(row.modifiedDateTime ?? row.createdDateTime) },
];

type FindingStatus = "error" | "warning" | "ok" | "info";
type Finding = {
  key: string;
  title: string;
  detail: string;
  status: FindingStatus;
  items: Array<{ id: string; label: string; href: string }>;
  noun?: string;
};
const FINDING_ORDER: FindingStatus[] = ["error", "warning", "ok", "info"];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const policyLink = (row: ReviewRow) => ({
  id: String(row.id),
  label: `${rowTitle(row)}${row.state === "enabled" ? "" : ` (${humanize(row.state)})`}`,
  href: hrefWithParam(POLICIES_PATH, new URLSearchParams(), "object", String(row.id)),
});

/** Every id a policy references, by the condition it sits in. */
function referencedIds(row: ReviewRow): string[] {
  const conditions = asRecord(row.conditions);
  const users = asRecord(conditions.users);
  const apps = asRecord(conditions.applications);
  const locations = asRecord(conditions.locations);
  return [
    users.includeUsers, users.excludeUsers, users.includeGroups, users.excludeGroups, users.includeRoles, users.excludeRoles,
    apps.includeApplications, apps.excludeApplications, locations.includeLocations, locations.excludeLocations,
  ].flatMap(asList);
}

/** Review checks over the loaded policies. Mirrors what the Entra overview counts, plus lockout and hygiene checks. */
function policyFindings(rows: ReviewRow[], locations: ReviewRow[], names: ReviewNames | null): Finding[] {
  const active = rows.filter((row) => row.state !== "disabled");
  const users = (row: ReviewRow) => asRecord(asRecord(row.conditions).users);
  const grant = (row: ReviewRow) => asList(asRecord(row.grantControls).builtInControls);
  const pick = (list: ReviewRow[], test: (row: ReviewRow) => boolean) => list.filter(test).map(policyLink);

  const noExclusions = pick(active, (row) => {
    const scope = users(row);
    return (
      asList(scope.includeUsers).includes("All") &&
      [scope.excludeUsers, scope.excludeGroups, scope.excludeRoles].every((list) => asList(list).length === 0)
    );
  });
  const legacyBlock = pick(rows, (row) => {
    const clients = asList(asRecord(row.conditions).clientAppTypes);
    return row.state === "enabled" && grant(row).includes("block") && (clients.includes("exchangeActiveSync") || clients.includes("other"));
  });
  const approvedApp = pick(rows, (row) => grant(row).includes("approvedApplication"));
  const usedLocations = new Set(rows.flatMap((row) => {
    const conditions = asRecord(asRecord(row.conditions).locations);
    return [...asList(conditions.includeLocations), ...asList(conditions.excludeLocations)];
  }));
  const unusedLocations = locations
    .filter((location) => typeof location.id === "string" && !usedLocations.has(location.id))
    .map((location) => ({
      id: String(location.id),
      label: rowTitle(location),
      href: hrefWithParam(NAMED_LOCATIONS_PATH, new URLSearchParams(), "object", String(location.id)),
    }));
  const unresolved = names
    ? pick(rows, (row) => referencedIds(row).some((id) => GUID.test(id) && !LOCATION_SPECIAL[id] && !names[id]))
    : [];

  const findings: Finding[] = [
    {
      key: "no-exclusions",
      title: "All-users policies with no exclusions",
      detail: noExclusions.length
        ? "Every account is in scope, break-glass accounts included. One bad grant control locks everyone out."
        : "Every all-users policy excludes at least one account, group or role.",
      status: noExclusions.length ? "error" : "ok",
      items: noExclusions,
    },
    {
      key: "legacy-auth",
      title: "Legacy authentication blocked",
      detail: legacyBlock.length
        ? "Enabled policies block Exchange ActiveSync and other legacy clients."
        : "No enabled policy blocks Exchange ActiveSync or other legacy authentication clients.",
      status: legacyBlock.length ? "ok" : "warning",
      items: legacyBlock,
    },
    ...(names
      ? [
          {
            key: "unresolved",
            title: "References Graph couldn't resolve",
            detail: unresolved.length
              ? "These policies point at users, groups, roles, apps or locations Graph didn't return: usually deleted objects, sometimes a missing permission."
              : "Every user, group, role, app and location these policies reference still exists.",
            status: (unresolved.length ? "warning" : "ok") as FindingStatus,
            items: unresolved,
          },
        ]
      : []),
    {
      key: "approved-app",
      title: "Require approved client app",
      detail: approvedApp.length
        ? "Microsoft is retiring this grant control. Move these policies to Require app protection policy."
        : "No policy uses the approved client app grant control.",
      status: approvedApp.length ? "warning" : "ok",
      items: approvedApp,
    },
    {
      key: "unused-locations",
      title: "Named locations no policy uses",
      detail: unusedLocations.length
        ? "Not referenced by any Conditional Access policy. Candidates for clean-up."
        : "Every named location is used by at least one policy.",
      status: unusedLocations.length ? "warning" : "ok",
      items: unusedLocations,
      noun: "location",
    },
    {
      key: "report-only",
      title: "Report-only policies",
      detail: "Evaluated and logged, not enforced.",
      status: "info",
      items: pick(rows, (row) => row.state === "enabledForReportingButNotEnforced"),
    },
    {
      key: "mfa",
      title: "Require MFA or an authentication strength",
      detail: "Policies, not disabled, that ask for MFA or a named authentication strength.",
      status: "info",
      items: pick(active, (row) => grant(row).includes("mfa") || Boolean(asRecord(asRecord(row.grantControls).authenticationStrength).id)),
    },
    {
      key: "block",
      title: "Block access",
      detail: "Policies, not disabled, whose grant control blocks access.",
      status: "info",
      items: pick(active, (row) => grant(row).includes("block")),
    },
    {
      key: "locations",
      title: "Use named locations",
      detail: "Policies with a location condition.",
      status: "info",
      items: pick(rows, (row) => asRecord(asRecord(row.conditions).locations).includeLocations != null),
    },
    {
      key: "device-filters",
      title: "Use filters for devices",
      detail: "Policies with a device filter condition.",
      status: "info",
      items: pick(rows, (row) => Boolean(asRecord(asRecord(asRecord(row.conditions).devices).deviceFilter).rule)),
    },
  ];
  return findings.sort((a, b) => FINDING_ORDER.indexOf(a.status) - FINDING_ORDER.indexOf(b.status));
}

function GapItem({ title, gap, bad, detail }: { title: string; gap: CoverageGap; bad: "error" | "warning"; detail: string }) {
  const more = gap.count - gap.sample.length;
  return (
    <li className={`health-item is-${gap.count ? bad : "ok"}`}>
      <span className="health-dot" aria-hidden="true" />
      <div className="health-copy">
        <span className="health-title">{title}</span>
        <span className="health-detail">{detail}</span>
        {gap.sample.length ? (
          <span className="review-finding-links">
            {gap.sample.map((name, index) => (
              <span key={`${index}-${name}`}>{name}</span>
            ))}
            {more > 0 ? <span className="muted">+{more} more</span> : null}
          </span>
        ) : null}
      </div>
      <span className="health-status">
        {gap.count} {gap.count === 1 ? "user" : "users"}
      </span>
    </li>
  );
}

/** Effective users per policy. On demand: it expands every referenced group and role. */
function CoveragePanel({ rows }: { rows: ReviewRow[] }) {
  const [coverage, setCoverage] = useState<ConditionalAccessCoverage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const calculate = () => {
    setBusy(true);
    setError(null);
    fetchConditionalAccessCoverage()
      .then(setCoverage)
      .catch((reason) => setError(String(reason)))
      .finally(() => setBusy(false));
  };
  const byId = new Map(coverage?.policies.map((policy) => [policy.id, policy]) ?? []);
  const share = (count: number) => (coverage?.userCount ? `${Math.round((count / coverage.userCount) * 100)}%` : "—");
  const ranked = rows
    .filter((row) => byId.has(String(row.id)))
    .sort((a, b) => (byId.get(String(b.id))?.covered ?? 0) - (byId.get(String(a.id))?.covered ?? 0));

  return (
    <Panel padded>
      <PanelHead
        title="User coverage"
        hint={
          coverage
            ? `${coverage.userCount.toLocaleString()} enabled accounts, ${coverage.guestCount.toLocaleString()} of them guests. Calculated ${isoDate(coverage.fetchedAt)}.`
            : "Enabled accounts each policy's user assignment reaches, after nested groups, role holders and exclusions. Apps and conditions aren't factored in."
        }
      />
      <button type="button" className="axis-btn" onClick={calculate} disabled={busy || rows.length === 0}>
        {busy ? "Calculating…" : coverage ? "Recalculate" : "Calculate coverage"}
      </button>
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {coverage?.truncated ? (
        <div className="axis-alert axis-alert-warning">A user or group list passed 200,000 entries, so these counts are a minimum.</div>
      ) : null}
      {coverage?.warnings.length ? (
        <div className="axis-alert axis-alert-warning">{coverage.warnings.join(" · ")}</div>
      ) : null}
      {coverage ? (
        <>
          <ul className="health-list">
            <GapItem
              title="Not covered by any enabled policy"
              gap={coverage.uncovered}
              bad="error"
              detail="No enabled Conditional Access policy applies to these accounts. Report-only and disabled policies don't count."
            />
            <GapItem
              title="No enabled MFA policy"
              gap={coverage.withoutMfa}
              bad="warning"
              detail="No enabled policy that requires MFA or an authentication strength applies to these accounts."
            />
          </ul>
          <section className="axis-panel" style={{ overflow: "hidden", marginTop: "0.85rem" }}>
            <table className="axis-table">
              <thead>
                <tr>
                  <th>Policy</th>
                  <th>State</th>
                  <th>Users in scope</th>
                  <th>Share</th>
                  <th>Excluded</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((row) => {
                  const result = byId.get(String(row.id))!;
                  return (
                    <tr key={String(row.id)} className="row-link" onClick={() => navigate(policyLink(row).href)}>
                      <td>{rowTitle(row)}</td>
                      <td className="muted">{humanize(row.state)}</td>
                      <td className="tabular">{result.covered.toLocaleString()}</td>
                      <td className="tabular muted">{share(result.covered)}</td>
                      <td className="tabular muted">{result.excluded.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </Panel>
  );
}

function ConditionalAccessOverview({ signedIn }: { signedIn: boolean }) {
  const policies = useInventory(loaderFor("conditionalAccessPolicy"), signedIn, signedIn);
  const locations = useInventory(loaderFor("namedLocation"), signedIn, signedIn);
  const rows = useMemo(() => policies.items.filter((row) => typeof row.id === "string"), [policies.items]);
  const [names, setNames] = useState<ReviewNames | null>(null);
  useEffect(() => {
    if (rows.length === 0) return;
    let cancelled = false;
    resolvePolicyNames(rows)
      .then((resolved) => {
        if (!cancelled) setNames(resolved);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rows]);
  const findings = useMemo(() => policyFindings(rows, locations.items, names), [locations.items, names, rows]);
  const count = (state: string) => rows.filter((row) => row.state === state).length;
  const problems = findings.filter((finding) => finding.status === "error" || finding.status === "warning").length;
  const loading = policies.loading || locations.loading;
  const refresh = () => {
    void policies.reload();
    void locations.reload();
  };

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Entra · Conditional Access"
        title="Overview"
        description="Policy states at a glance, and checks worth reviewing across every Conditional Access policy."
        onRefresh={refresh}
        refreshing={loading}
        actions={
          <button type="button" className="axis-btn" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      {policies.error ? <div className="axis-alert axis-alert-danger">{policies.error}</div> : null}
      {locations.error ? <div className="axis-alert axis-alert-danger">{locations.error}</div> : null}
      <div className="overview-grid-6">
        <SignalCard label="Policies" value={rows.length} hint="Conditional Access" />
        <SignalCard label="On" value={count("enabled")} hint="Enforced" tone="good" />
        <SignalCard label="Report-only" value={count("enabledForReportingButNotEnforced")} hint="Logged, not enforced" />
        <SignalCard label="Off" value={count("disabled")} hint="Disabled" />
        <SignalCard label="Named locations" value={locations.items.length} hint="IP ranges and countries" />
        <SignalCard
          label="Trusted"
          value={locations.items.filter((location) => location.isTrusted === true).length}
          hint="Trusted IP locations"
        />
      </div>
      <Panel padded>
        <PanelHead
          title="Review"
          hint={
            loading && rows.length === 0
              ? "Loading policies…"
              : problems > 0
                ? `${problems} check${problems === 1 ? "" : "s"} need${problems === 1 ? "s" : ""} attention.`
                : "Checks run against every policy listed under Policies."
          }
        />
        <ul className="health-list">
          {findings.map((finding) => (
            <li key={finding.key} className={`health-item is-${finding.status}`}>
              <span className="health-dot" aria-hidden="true" />
              <div className="health-copy">
                <span className="health-title">{finding.title}</span>
                <span className="health-detail">{finding.detail}</span>
                {finding.items.length ? (
                  <span className="review-finding-links">
                    {finding.items.map((item) => (
                      <button key={item.id} type="button" className="axis-link" onClick={() => navigate(item.href)}>
                        {item.label}
                      </button>
                    ))}
                  </span>
                ) : null}
              </div>
              <span className="health-status">
                {finding.items.length}{" "}
                {finding.items.length === 1 ? (finding.noun ?? "policy") : finding.noun ? `${finding.noun}s` : "policies"}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <CoveragePanel rows={rows} />
    </div>
  );
}

export function EntraWorkspace({ route, signedIn }: { route: { pathname: string; search: URLSearchParams }; signedIn: boolean }) {
  const { pathname, search } = route;
  if (pathname === "/entra" || pathname === OVERVIEW_PATH) {
    return <ConditionalAccessOverview signedIn={signedIn} />;
  }
  if (pathname === "/entra/applications/credentials") return <AppCredentialsView route={route} signedIn={signedIn} />;
  if (pathname === "/entra/roles/assignments") return <RoleAssignmentsView route={route} signedIn={signedIn} />;
  if (pathname === "/entra/tenant/settings") return <TenantSettingsView route={route} signedIn={signedIn} />;
  if (pathname === "/entra/roles/pim-settings") return <PimRoleSettingsView route={route} signedIn={signedIn} />;
  if (pathname === "/entra/roles/custom") return <CustomRolesView route={route} signedIn={signedIn} />;
  if (pathname === "/entra/conditional-access/authentication-strengths") return <AuthStrengthsView route={route} signedIn={signedIn} />;
  if (pathname === "/entra/conditional-access/templates") return <CaTemplatesView route={route} signedIn={signedIn} />;

  if (pathname === AUTH_REGISTRATION_PATH) {
    return (
      <ReviewWorkbench
        key="authRegistration"
        kind="authRegistration"
        eyebrow="Entra · Authentication methods"
        title="User registration"
        description="Every user with the authentication methods they have registered, MFA and passwordless readiness, and SSPR."
        columns={REGISTRATION_COLUMNS}
        headline={registrationHeadline}
        titleOf={(row) => String(row.userDisplayName ?? row.userPrincipalName ?? row.id ?? "Untitled")}
        summary={(row) => <ReviewSections sections={registrationSections(row)} />}
        pathname={pathname}
        search={search}
        signedIn={signedIn}
      />
    );
  }
  if (pathname === AUTH_POLICY_PATH) {
    return (
      <ReviewWorkbench
        key="authMethodConfig"
        kind="authMethodConfig"
        eyebrow="Entra · Authentication methods"
        title="Methods policy"
        description="Which authentication methods are enabled for the tenant, and who each one is targeted at."
        columns={METHOD_COLUMNS}
        titleOf={(row) => humanize(row.id)}
        summary={(row) => <ReviewSections sections={methodSections(row)} />}
        pathname={pathname}
        search={search}
        signedIn={signedIn}
        defaultSort="state"
      />
    );
  }
  if (pathname === NAMED_LOCATIONS_PATH) {
    return (
      <ReviewWorkbench
        key="namedLocation"
        kind="namedLocation"
        eyebrow="Entra · Conditional Access"
        title="Named locations"
        description="IP ranges and countries that Conditional Access policies can include or exclude."
        columns={LOCATION_COLUMNS}
        summary={(row) => <ReviewSections sections={locationSections(row)} />}
        pathname={pathname}
        search={search}
        signedIn={signedIn}
      />
    );
  }
  return (
    <ReviewWorkbench
      key="conditionalAccessPolicy"
      kind="conditionalAccessPolicy"
      eyebrow="Entra · Conditional Access"
      title="Conditional Access policies"
      description="Every Conditional Access policy with who it targets, what it requires, and its state."
      columns={POLICY_COLUMNS}
      resolveNames={resolvePolicyNames}
      summary={(row, names) => <ReviewSections sections={policySections(row, names)} />}
      pathname={pathname}
      search={search}
      signedIn={signedIn}
    />
  );
}
