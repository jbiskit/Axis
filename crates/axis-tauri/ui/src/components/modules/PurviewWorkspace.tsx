import {
  asList,
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

function sensitivityTitle(row: ReviewRow): string {
  const parent = asRecord(row.parent).name;
  const name = String(row.name ?? row.id ?? "Untitled");
  return parent ? `${parent} / ${name}` : name;
}

function retainFor(row: ReviewRow): string {
  const duration = asRecord(row.retentionDuration);
  if (String(duration["@odata.type"] ?? "").endsWith("Forever")) return "Forever";
  return duration.days != null ? `${duration.days} days` : "";
}

const yesNo = (value: unknown) => (value ? "Yes" : "No");
const byName = (value: unknown) => String(asRecord(asRecord(value).user).displayName ?? "");

function sensitivitySections(row: ReviewRow): ReviewSection[] {
  return [
    {
      title: "Label",
      fields: [
        { label: "Name", value: String(row.name ?? "") },
        { label: "Parent", value: String(asRecord(row.parent).name ?? "") },
        { label: "Priority", value: row.sensitivity != null ? String(row.sensitivity) : "" },
        { label: "Active", value: yesNo(row.isActive) },
        { label: "Can be applied", value: yesNo(row.isAppliable) },
      ],
    },
    {
      title: "Scope and protection",
      fields: [
        { label: "Applies to", value: asList(row.contentFormats).map(humanize) },
        { label: "Encryption", value: yesNo(row.hasProtection) },
      ],
    },
    {
      title: "Descriptions",
      fields: [
        { label: "Tooltip", value: String(row.tooltip ?? "") },
        { label: "Description", value: String(row.description ?? "") },
      ],
    },
  ];
}

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

const SENSITIVITY_COLUMNS: ReviewColumn[] = [
  { key: "priority", label: "Priority", value: (row) => (row.sensitivity != null ? String(row.sensitivity) : "") },
  { key: "active", label: "Active", value: (row) => (row.isActive ? "Yes" : "No") },
  { key: "protection", label: "Encryption", value: (row) => (row.hasProtection ? "Yes" : "No") },
  { key: "formats", label: "Applies to", value: (row) => asList(row.contentFormats).map(humanize).join(", ") },
];

const RETENTION_COLUMNS: ReviewColumn[] = [
  { key: "duration", label: "Retain for", value: retainFor },
  { key: "trigger", label: "Starts", value: (row) => humanize(row.retentionTrigger) },
  { key: "behavior", label: "During retention", value: (row) => humanize(row.behaviorDuringRetentionPeriod) },
  { key: "action", label: "After retention", value: (row) => humanize(row.actionAfterRetentionPeriod) },
  { key: "inUse", label: "In use", value: (row) => (row.isInUse ? "Yes" : "No") },
  { key: "modified", label: "Modified", value: (row) => isoDate(row.lastModifiedDateTime ?? row.createdDateTime) },
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
      key="sensitivityLabel"
      kind="sensitivityLabel"
      eyebrow="Purview · Information Protection"
      title="Sensitivity labels"
      description="Sensitivity labels with their priority, encryption, and where they apply."
      note="Graph only returns the labels published to your account. Labels in policies that don't include you won't appear here."
      columns={SENSITIVITY_COLUMNS}
      summary={(row) => <ReviewSections sections={sensitivitySections(row)} />}
      titleOf={sensitivityTitle}
      pathname={pathname === "/purview" ? "/purview/information-protection/sensitivity-labels" : pathname}
      search={search}
      signedIn={signedIn}
    />
  );
}
