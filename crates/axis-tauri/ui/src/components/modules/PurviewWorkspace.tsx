import {
  asRecord,
  humanize,
  isoDate,
  ReviewSections,
  ReviewWorkbench,
  type ReviewColumn,
  type ReviewRow,
  type ReviewSection,
} from "./ReviewWorkbench";

const RETENTION_LABELS_PATH = "/purview/data-lifecycle/retention-labels";

// Sensitivity labels come from Security & Compliance Get-Label (every label, with parent label groups).

const labelTitle = (row: ReviewRow) => String(row.DisplayName ?? row.Name ?? row.id ?? "Untitled");
const labelParent = (row: ReviewRow) => (typeof row.ParentId === "string" && row.ParentId ? row.ParentId : null);
const labelActions = (row: ReviewRow) => (Array.isArray(row.LabelActions) ? row.LabelActions.map(asRecord) : []);
const labelKind = (row: ReviewRow) => (row.IsLabelGroup ? "Label group" : row.IsParent ? "Parent label" : "Label");
const labelScope = (row: ReviewRow) =>
  String(row.ContentType ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && value !== "None")
    .join(", ");
/** Action types are cmdlet tokens ("encrypt", "applycontentmarking"); no published copy exists. */
const protectionSummary = (row: ReviewRow) => labelActions(row).map((action) => humanize(action.Type)).join(", ");

function settingValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function labelSections(row: ReviewRow): ReviewSection[] {
  const settings = asRecord(row.Settings);
  return [
    {
      title: "Label",
      fields: [
        { label: "Display name", value: String(row.DisplayName ?? "") },
        { label: "Kind", value: labelKind(row) },
        { label: "Parent", value: String(row.ParentLabelDisplayName ?? "") },
        { label: "Priority", value: row.Priority != null ? String(row.Priority) : "" },
        { label: "Status", value: row.Disabled ? "Off" : "On" },
        { label: "Colour", value: String(settings.color ?? "") },
        { label: "Tooltip", value: String(row.Tooltip ?? "") },
        { label: "Admin description", value: String(row.Comment ?? "") },
      ],
    },
    {
      title: "Scope",
      fields: [
        { label: "Applies to", value: labelScope(row) },
        { label: "Workloads", value: String(row.Workload ?? "") },
        { label: "Mode", value: String(row.Mode ?? "") },
      ],
    },
    {
      title: "Protection",
      fields: labelActions(row).length ? undefined : [{ label: "Actions", value: "" }],
      groups: labelActions(row).map((action) => ({
        label: humanize(action.Type) + (action.SubType ? ` (${humanize(action.SubType)})` : ""),
        fields: Object.entries(asRecord(action.Settings)).map(([key, value]) => ({
          label: humanize(key),
          value: settingValue(value),
        })),
      })),
    },
    {
      title: "History",
      fields: [
        { label: "Created", value: [isoDate(row.WhenCreatedUTC), String(row.CreatedBy ?? "")].filter(Boolean).join(" by ") },
        { label: "Modified", value: [isoDate(row.WhenChangedUTC), String(row.LastModifiedBy ?? "")].filter(Boolean).join(" by ") },
      ],
    },
  ];
}

function retainFor(row: ReviewRow): string {
  const duration = asRecord(row.retentionDuration);
  if (String(duration["@odata.type"] ?? "").endsWith("Forever")) return "Forever";
  return duration.days != null ? `${duration.days} days` : "";
}

const yesNo = (value: unknown) => (value ? "Yes" : "No");
const byName = (value: unknown) => String(asRecord(asRecord(value).user).displayName ?? "");

function retentionSections(row: ReviewRow): ReviewSection[] {
  return [
    {
      title: "Retention",
      fields: [
        { label: "Retain for", value: retainFor(row) },
        { label: "Starts", value: humanize(row.retentionTrigger) },
        { label: "During retention", value: humanize(row.behaviorDuringRetentionPeriod) },
        { label: "After retention", value: humanize(row.actionAfterRetentionPeriod) },
        { label: "Label applied afterwards", value: String(row.labelToBeApplied ?? "") },
        { label: "Record behavior", value: humanize(row.defaultRecordBehavior) },
      ],
    },
    {
      title: "Descriptions",
      fields: [
        { label: "For admins", value: String(row.descriptionForAdmins ?? "") },
        { label: "For users", value: String(row.descriptionForUsers ?? "") },
      ],
    },
    {
      title: "Label",
      fields: [
        { label: "In use", value: yesNo(row.isInUse) },
        { label: "Created", value: [isoDate(row.createdDateTime), byName(row.createdBy)].filter(Boolean).join(" by ") },
        { label: "Modified", value: [isoDate(row.lastModifiedDateTime), byName(row.lastModifiedBy)].filter(Boolean).join(" by ") },
      ],
    },
  ];
}

const LABEL_COLUMNS: ReviewColumn[] = [
  { key: "priority", label: "Priority", value: (row) => (row.Priority != null ? String(row.Priority) : "") },
  { key: "kind", secondary: true, label: "Kind", value: labelKind },
  { key: "scope", label: "Applies to", value: labelScope },
  { key: "protection", label: "Protection", value: protectionSummary },
  { key: "status", label: "Status", value: (row) => (row.Disabled ? "Off" : "On") },
  { key: "modified", secondary: true, label: "Modified", value: (row) => isoDate(row.WhenChangedUTC) },
];

const RETENTION_COLUMNS: ReviewColumn[] = [
  { key: "duration", label: "Retain for", value: retainFor },
  { key: "trigger", label: "Starts", value: (row) => humanize(row.retentionTrigger) },
  { key: "behavior", secondary: true, label: "During retention", value: (row) => humanize(row.behaviorDuringRetentionPeriod) },
  { key: "action", label: "After retention", value: (row) => humanize(row.actionAfterRetentionPeriod) },
  { key: "inUse", secondary: true, label: "In use", value: (row) => (row.isInUse ? "Yes" : "No") },
  { key: "modified", secondary: true, label: "Modified", value: (row) => isoDate(row.lastModifiedDateTime ?? row.createdDateTime) },
];

export function PurviewWorkspace({ route, signedIn }: { route: { pathname: string; search: URLSearchParams }; signedIn: boolean }) {
  const { pathname, search } = route;
  if (pathname === RETENTION_LABELS_PATH) {
    return (
      <ReviewWorkbench
        key="retentionLabel"
        kind="retentionLabel"
        eyebrow="Purview · Data lifecycle"
        title="Retention labels"
        description="Every retention label with how long it keeps content and what happens afterwards."
        columns={RETENTION_COLUMNS}
        summary={(row) => <ReviewSections sections={retentionSections(row)} />}
        pathname={pathname}
        search={search}
        signedIn={signedIn}
      />
    );
  }
  return (
    <ReviewWorkbench
      key="purview:label"
      kind="purview:label"
      eyebrow="Purview · Information Protection"
      title="Sensitivity labels"
      description="Every sensitivity label and label group, with priority, scope and protection settings."
      note="Read from Security & Compliance PowerShell (not Graph). Needs Axis signed in with your own app registration, consented for Office 365 Exchange Online, and a Purview role that can read labels."
      columns={LABEL_COLUMNS}
      summary={(row) => <ReviewSections sections={labelSections(row)} />}
      titleOf={labelTitle}
      parentOf={labelParent}
      defaultSort="priority"
      pathname={pathname === "/purview" ? "/purview/information-protection/sensitivity-labels" : pathname}
      search={search}
      signedIn={signedIn}
    />
  );
}
