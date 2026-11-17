import type { ReactNode } from "react";
import type { ReviewKind } from "../../lib/tauri";
import { DefenderOverview } from "./DefenderOverview";
import {
  asList,
  asRecord,
  counted,
  humanize,
  isoDate,
  ReviewSections,
  ReviewWorkbench,
  type ReviewColumn,
  type ReviewField,
  type ReviewRow,
  type ReviewSection,
} from "./ReviewWorkbench";

const EXCHANGE_NOTE =
  "Read from the Exchange Online admin API (not Graph). Needs Axis signed in with your own app registration that has the Office 365 Exchange Online delegated permission Exchange.Manage, with admin consent.";
const MDO_PLAN_NOTE = `${EXCHANGE_NOTE} Only tenants licensed for Defender for Office 365 Plan 1 or higher have these policies.`;

const title = (row: ReviewRow) =>
  String(row.Name ?? row.Value ?? row.Domain ?? row.DeviceName ?? row.title ?? row.name ?? row.Identity ?? row.id ?? "Untitled").trim();
const rule = (row: ReviewRow) => asRecord(row.rule);
const modified = (row: ReviewRow) => isoDate(row.WhenChangedUTC ?? row.WhenChanged ?? row.LastModifiedDateTime);

/** Rule state wins; a default policy has no rule and applies to everyone; a custom policy without a rule applies to nobody. */
function status(row: ReviewRow): string {
  const state = rule(row).State ?? row.State;
  if (state) return humanize(state);
  if (row.IsDefault) return row.Enabled === false ? "Off" : "On (default)";
  return "No rule";
}

function appliesTo(row: ReviewRow): string {
  if (row.IsDefault) return "Everyone";
  const scope = row.rule ? rule(row) : row;
  return (
    counted([
      [asList(scope.SentTo).length, "user"],
      [asList(scope.SentToMemberOf).length, "group"],
      [asList(scope.RecipientDomainIs).length, "domain"],
    ]) || ""
  );
}

function priority(row: ReviewRow): string {
  const value = rule(row).Priority ?? row.Priority;
  if (value != null) return String(value);
  return row.IsDefault ? "Lowest" : "";
}

function fieldValue(value: unknown): string | string[] {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)));
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const SKIP = new Set(["id", "rule", "Guid", "ExchangeObjectId", "Id", "Identity", "Name"]);

/** Exchange cmdlet properties have no published copy, so labels are humanized parameter names. */
function settingFields(row: ReviewRow): ReviewField[] {
  return Object.entries(row)
    .filter(([key]) => !SKIP.has(key))
    .map(([key, value]) => ({ label: humanize(key), value: fieldValue(value) }));
}

function scopeSection(row: ReviewRow): ReviewSection {
  const scope = rule(row);
  if (row.IsDefault) {
    return { title: "Applies to", fields: [{ label: "Recipients", value: "Everyone (default policy, lowest priority)" }] };
  }
  return {
    title: "Applies to",
    fields: [
      { label: "Rule", value: String(scope.Name ?? "") },
      { label: "State", value: status(row) },
      { label: "Priority", value: priority(row) },
      { label: "Users", value: asList(scope.SentTo) },
      { label: "Groups", value: asList(scope.SentToMemberOf) },
      { label: "Domains", value: asList(scope.RecipientDomainIs) },
      { label: "Except users", value: asList(scope.ExceptIfSentTo) },
      { label: "Except groups", value: asList(scope.ExceptIfSentToMemberOf) },
      { label: "Except domains", value: asList(scope.ExceptIfRecipientDomainIs) },
    ],
  };
}

const policySections = (row: ReviewRow): ReviewSection[] => [
  scopeSection(row),
  { title: "Settings", fields: settingFields(row) },
];
const plainSections = (row: ReviewRow): ReviewSection[] => [{ title: "Settings", fields: settingFields(row) }];

const POLICY_COLUMNS: ReviewColumn[] = [
  { key: "status", label: "Status", value: status },
  { key: "priority", label: "Priority", value: priority },
  { key: "appliesTo", label: "Applies to", value: appliesTo },
  { key: "modified", secondary: true, label: "Modified", value: modified },
];

// Graph-backed pages (Secure Score, hunting, Intune policies).

const num = (value: unknown) => (typeof value === "number" ? value : Number(value) || 0);
const stripHtml = (value: unknown) =>
  String(value ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const current = (row: ReviewRow) => asRecord(row.current);
const points = (row: ReviewRow) => `${num(current(row).score)} / ${num(row.maxScore)}`;

function secureScoreHeadline(rows: ReviewRow[]) {
  const earned = rows.reduce((sum, row) => sum + num(current(row).score), 0);
  const max = rows.reduce((sum, row) => sum + num(row.maxScore), 0);
  const percent = max > 0 ? Math.round((earned / max) * 100) : 0;
  return (
    <div className="axis-panel axis-panel-padded">
      <p className="axis-kicker">Current score</p>
      <h2 style={{ margin: 0 }}>
        {earned.toFixed(2)} / {max} ({percent}%)
      </h2>
    </div>
  );
}

const secureScoreSections = (row: ReviewRow): ReviewSection[] => [
  {
    title: "Control",
    fields: [
      { label: "Points", value: points(row) },
      { label: "Status", value: stripHtml(current(row).implementationStatus) },
      { label: "Category", value: String(row.controlCategory ?? "") },
      { label: "Service", value: String(row.service ?? "") },
      { label: "Tier", value: String(row.tier ?? "") },
      { label: "Rank", value: row.rank != null ? String(row.rank) : "" },
      { label: "User impact", value: String(row.userImpact ?? "") },
      { label: "Implementation cost", value: String(row.implementationCost ?? "") },
      { label: "Threats", value: asList(row.threats).map(humanize) },
    ],
  },
  {
    title: "Remediation",
    fields: [
      { label: "What to do", value: stripHtml(row.remediation) },
      { label: "Impact", value: stripHtml(row.remediationImpact) },
      { label: "Portal", value: String(row.actionUrl ?? "") },
    ],
  },
];

const technologies = (row: ReviewRow) =>
  String(row.technologies ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
/** `microsoftSense` is Defender for Endpoint security settings management (devices not enrolled in Intune). */
const managedBy = (row: ReviewRow) =>
  technologies(row)
    .map((value) => (value === "microsoftSense" ? "Defender for Endpoint" : value === "mdm" ? "Intune (MDM)" : humanize(value)))
    .join(", ");
const policyType = (row: ReviewRow) => String(asRecord(row.templateReference).templateDisplayName ?? "");

const endpointPolicySections = (row: ReviewRow): ReviewSection[] => [
  {
    title: "Policy",
    fields: [
      { label: "Type", value: policyType(row) },
      { label: "Family", value: humanize(asRecord(row.templateReference).templateFamily) },
      { label: "Platform", value: humanize(row.platforms) },
      { label: "Managed by", value: managedBy(row) },
      { label: "Creation source", value: String(row.creationSource ?? "") },
      { label: "Assigned", value: row.isAssigned ? "Yes" : "No" },
      { label: "Scope tags", value: asList(row.roleScopeTagIds) },
      { label: "Modified", value: isoDate(row.lastModifiedDateTime) },
      { label: "Description", value: String(row.description ?? "") },
    ],
  },
];

const deviceSections = (row: ReviewRow): ReviewSection[] => [
  {
    title: "Device",
    fields: [
      { label: "Platform", value: [row.OSPlatform, row.OSVersion, row.OSBuild].filter(Boolean).join(" ") },
      { label: "Device type", value: String(row.DeviceType ?? "") },
      { label: "Device category", value: String(row.DeviceCategory ?? "") },
      { label: "Join type", value: String(row.JoinType ?? "") },
      { label: "Entra device id", value: String(row.AadDeviceId ?? "") },
      { label: "Device group", value: String(row.MachineGroup ?? "") },
      { label: "Public IP", value: String(row.PublicIP ?? "") },
    ],
  },
  {
    title: "Defender for Endpoint",
    fields: [
      { label: "Onboarding", value: String(row.OnboardingStatus ?? "") },
      { label: "Sensor health", value: String(row.SensorHealthState ?? "") },
      { label: "Exposure", value: String(row.ExposureLevel ?? "") },
      { label: "Last seen", value: String(row.LastSeen ?? "").slice(0, 16).replace("T", " ") },
    ],
  },
];

type DefenderPage = {
  path: string;
  kind: ReviewKind;
  eyebrow?: string;
  headline?: (rows: ReviewRow[]) => ReactNode;
  title: string;
  description: string;
  note?: string;
  columns: ReviewColumn[];
  sections: (row: ReviewRow) => ReviewSection[];
};

const PAGES: DefenderPage[] = [
  {
    path: "/defender/email/anti-phishing",
    kind: "mdo:antiPhish",
    title: "Anti-phishing",
    description: "Anti-phishing policies with impersonation, spoof and mailbox intelligence settings.",
    columns: POLICY_COLUMNS,
    sections: policySections,
  },
  {
    path: "/defender/email/anti-spam",
    kind: "mdo:antiSpam",
    title: "Anti-spam (inbound)",
    description: "Inbound spam filter policies and the actions taken on spam, phish and bulk mail.",
    columns: POLICY_COLUMNS,
    sections: policySections,
  },
  {
    path: "/defender/email/outbound-spam",
    kind: "mdo:outboundSpam",
    title: "Anti-spam (outbound)",
    description: "Outbound spam policies: sending limits, auto-forwarding and notifications.",
    columns: POLICY_COLUMNS,
    sections: policySections,
  },
  {
    path: "/defender/email/anti-malware",
    kind: "mdo:antiMalware",
    title: "Anti-malware",
    description: "Malware filter policies, the common attachments filter and notifications.",
    columns: POLICY_COLUMNS,
    sections: policySections,
  },
  {
    path: "/defender/email/safe-links",
    kind: "mdo:safeLinks",
    title: "Safe Links",
    description: "Safe Links policies for email, Teams and Office apps.",
    note: MDO_PLAN_NOTE,
    columns: POLICY_COLUMNS,
    sections: policySections,
  },
  {
    path: "/defender/email/safe-attachments",
    kind: "mdo:safeAttachments",
    title: "Safe Attachments",
    description: "Safe Attachments policies and what happens to detected attachments.",
    note: MDO_PLAN_NOTE,
    columns: POLICY_COLUMNS,
    sections: policySections,
  },
  {
    path: "/defender/email/preset-policies",
    kind: "mdo:presetPolicies",
    title: "Preset security policies",
    description: "Standard and Strict preset protection rules, for Exchange Online Protection and Defender for Office 365.",
    columns: [
      { key: "layer", secondary: true, label: "Protection", value: (row) => String(row.ProtectionLayer ?? "") },
      { key: "status", label: "Status", value: status },
      { key: "priority", label: "Priority", value: priority },
      { key: "appliesTo", label: "Applies to", value: appliesTo },
    ],
    sections: plainSections,
  },
  {
    path: "/defender/email/global-settings",
    kind: "mdo:atpGlobal",
    title: "Global settings",
    description: "Tenant-wide Defender for Office 365 settings, such as Safe Attachments for SharePoint, OneDrive and Teams.",
    note: MDO_PLAN_NOTE,
    columns: [{ key: "modified", secondary: true, label: "Modified", value: modified }],
    sections: plainSections,
  },
  {
    path: "/defender/email/quarantine-policies",
    kind: "mdo:quarantine",
    title: "Quarantine policies",
    description: "What users can do with quarantined messages, and notification settings.",
    columns: [{ key: "modified", secondary: true, label: "Modified", value: modified }],
    sections: plainSections,
  },
  {
    path: "/defender/email/allow-block-list",
    kind: "mdo:allowBlock",
    title: "Tenant Allow/Block List",
    description: "Allowed and blocked senders, URLs and file hashes.",
    columns: [
      { key: "listType", label: "Type", value: (row) => humanize(row.ListType) },
      { key: "action", label: "Action", value: (row) => humanize(row.Action) },
      { key: "expires", secondary: true, label: "Expires", value: (row) => isoDate(row.ExpirationDate) || "Never" },
      { key: "modified", secondary: true, label: "Modified", value: modified },
    ],
    sections: plainSections,
  },
  {
    path: "/defender/email/dkim",
    kind: "mdo:dkim",
    title: "DKIM",
    description: "DKIM signing per domain.",
    columns: [
      { key: "enabled", label: "Enabled", value: (row) => (row.Enabled ? "Yes" : "No") },
      { key: "status", label: "Status", value: (row) => humanize(row.Status) },
    ],
    sections: plainSections,
  },
  {
    path: "/defender/posture/secure-score",
    kind: "secureScoreControl",
    eyebrow: "Defender · Exposure",
    title: "Secure Score",
    description: "Every Secure Score recommendation with the points earned out of the maximum, and how to improve it.",
    note: "From Graph Secure Score (SecurityEvents.Read.All). Scores refresh once a day.",
    headline: secureScoreHeadline,
    columns: [
      { key: "points", label: "Points", value: points },
      { key: "category", secondary: true, label: "Category", value: (row) => String(row.controlCategory ?? "") },
      { key: "service", secondary: true, label: "Service", value: (row) => String(row.service ?? "") },
      { key: "impact", label: "User impact", value: (row) => String(row.userImpact ?? "") },
      { key: "cost", secondary: true, label: "Cost", value: (row) => String(row.implementationCost ?? "") },
    ],
    sections: secureScoreSections,
  },
  {
    path: "/defender/endpoints/devices",
    kind: "defenderDevice",
    eyebrow: "Defender · Endpoints",
    title: "Device inventory",
    description: "Devices Defender for Endpoint has seen in the last 30 days, with onboarding, sensor health and exposure.",
    note: "From advanced hunting (DeviceInfo). Needs ThreatHunting.Read.All and a Defender role that can run hunting queries.",
    columns: [
      { key: "platform", secondary: true, label: "Platform", value: (row) => String(row.OSPlatform ?? "") },
      { key: "onboarding", label: "Onboarding", value: (row) => String(row.OnboardingStatus ?? "") },
      { key: "sensor", label: "Sensor health", value: (row) => String(row.SensorHealthState ?? "") },
      { key: "exposure", label: "Exposure", value: (row) => String(row.ExposureLevel ?? "") },
      { key: "seen", secondary: true, label: "Last seen", value: (row) => isoDate(row.LastSeen) },
    ],
    sections: deviceSections,
  },
  {
    path: "/defender/endpoints/security-policies",
    kind: "endpointSecurityPolicy",
    eyebrow: "Defender · Endpoints",
    title: "Endpoint security policies",
    description: "Endpoint security policies from Intune and the Defender portal. Both are stored in Intune; Managed by and Creation source show where each one applies and came from.",
    note: "Defender for Endpoint in Managed by means the policy also reaches devices through security settings management, without Intune enrollment.",
    columns: [
      { key: "type", label: "Type", value: policyType },
      { key: "platform", secondary: true, label: "Platform", value: (row) => humanize(row.platforms) },
      { key: "managedBy", label: "Managed by", value: managedBy },
      { key: "source", secondary: true, label: "Creation source", value: (row) => String(row.creationSource ?? "") },
      { key: "assigned", label: "Assigned", value: (row) => (row.isAssigned ? "Yes" : "No") },
    ],
    sections: endpointPolicySections,
  },
];

export function DefenderWorkspace({ route, signedIn }: { route: { pathname: string; search: URLSearchParams }; signedIn: boolean }) {
  const { pathname, search } = route;
  if (pathname === "/defender" || pathname === "/defender/overview") return <DefenderOverview signedIn={signedIn} />;
  const page = PAGES.find((candidate) => candidate.path === pathname) ?? PAGES[0];
  return (
    <ReviewWorkbench
      key={page.kind}
      kind={page.kind}
      eyebrow={page.eyebrow ?? "Defender · Email & collaboration"}
      title={page.title}
      description={page.description}
      note={page.note ?? EXCHANGE_NOTE}
      headline={page.headline}
      columns={page.columns}
      summary={(row) => <ReviewSections sections={page.sections(row)} />}
      titleOf={title}
      pathname={page.path}
      search={search}
      signedIn={signedIn}
    />
  );
}
