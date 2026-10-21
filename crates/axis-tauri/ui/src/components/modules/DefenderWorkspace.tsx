import type { ReviewKind } from "../../lib/tauri";
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
  String(row.Name ?? row.Value ?? row.Domain ?? row.Identity ?? row.id ?? "Untitled");
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
  { key: "modified", label: "Modified", value: modified },
];

type DefenderPage = {
  path: string;
  kind: ReviewKind;
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
      { key: "layer", label: "Protection", value: (row) => String(row.ProtectionLayer ?? "") },
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
    columns: [{ key: "modified", label: "Modified", value: modified }],
    sections: plainSections,
  },
  {
    path: "/defender/email/quarantine-policies",
    kind: "mdo:quarantine",
    title: "Quarantine policies",
    description: "What users can do with quarantined messages, and notification settings.",
    columns: [{ key: "modified", label: "Modified", value: modified }],
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
      { key: "expires", label: "Expires", value: (row) => isoDate(row.ExpirationDate) || "Never" },
      { key: "modified", label: "Modified", value: modified },
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
];

export function DefenderWorkspace({ route, signedIn }: { route: { pathname: string; search: URLSearchParams }; signedIn: boolean }) {
  const { pathname, search } = route;
  const page = PAGES.find((candidate) => candidate.path === pathname) ?? PAGES[0];
  return (
    <ReviewWorkbench
      key={page.kind}
      kind={page.kind}
      eyebrow="Defender · Email & collaboration"
      title={page.title}
      description={page.description}
      note={page.note ?? EXCHANGE_NOTE}
      columns={page.columns}
      summary={(row) => <ReviewSections sections={page.sections(row)} />}
      titleOf={title}
      pathname={page.path}
      search={search}
      signedIn={signedIn}
    />
  );
}
