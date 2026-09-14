export type ClientStalePromptPrefs = {
  snoozeUntil?: string | null;
  snoozeDays?: number | null;
};

export type ClientContainerManifest = {
  schema: string;
  id: string;
  name: string;
  tenantId: string;
  primaryDomain?: string | null;
  createdAt: string;
  updatedAt: string;
  lastSnapshotAt?: string | null;
  stalePrompt?: ClientStalePromptPrefs | null;
};

export type ClientContainerStatus = {
  active: boolean;
  root?: string | null;
  manifest?: ClientContainerManifest | null;
  tenantMismatch: boolean;
  sessionTenantId?: string | null;
  stalePrompt: boolean;
  staleReason?: string | null;
  snapshotCount: number;
  staleAfterDays: number;
};

export type ClientSnapshotSummary = {
  id: string;
  path: string;
  exportedAt: string;
  packName?: string | null;
  filesWritten: number;
  catalogCount: number;
};

export type SnapshotManifest = {
  schema: string;
  id: string;
  exportedAt: string;
  tenantId: string;
  clientId?: string | null;
  clientName?: string | null;
  packName?: string | null;
  filesWritten: number;
  catalogCount: number;
  includeCount: number;
  reportHtml?: string | null;
  reportMarkdown?: string | null;
  reportObjectCount?: number | null;
  axisVersion?: string | null;
};

export type ClientSnapshotExportResult = {
  snapshot: SnapshotManifest;
  pack: {
    root: string;
    filesWritten: number;
    includeCount: number;
    catalogCount: number;
    skipped: string[];
    warnings: string[];
    baselinePath: string;
    catalogBaselinePath: string;
    platforms: string[];
  };
  report?: {
    html: string;
    markdown: string;
    organizationName?: string | null;
    suggestedName: string;
    suggestedMarkdownName: string;
    objectCount: number;
    generatedAt: string;
    warnings: string[];
  } | null;
  status: ClientContainerStatus;
};

export type PackDiffChangeKind = "added" | "removed" | "changed";

export type PackFieldChange = {
  path: string;
  before?: string | null;
  after?: string | null;
};

export type PackObjectDiff = {
  key: string;
  kind: string;
  displayName: string;
  change: PackDiffChangeKind;
  leftPath?: string | null;
  rightPath?: string | null;
  sourceId?: string | null;
  fieldChanges: PackFieldChange[];
};

export type PackDiffReport = {
  leftLabel: string;
  rightLabel: string;
  summary: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
  objects: PackObjectDiff[];
  warnings: string[];
};

export type RestoreMode = "add" | "replace";

export type RestoreItemStatus =
  | "willAdd"
  | "willReplace"
  | "skipExists"
  | "skipMissing"
  | "unsupported"
  | "applied"
  | "failed"
  | "skipped";

export type RestoreCandidate = {
  key: string;
  kind: string;
  displayName: string;
  sourceId?: string | null;
  relPaths: string[];
  restorable: boolean;
  note?: string | null;
};

export type RestorePlanItem = {
  key: string;
  kind: string;
  displayName: string;
  status: RestoreItemStatus;
  liveId?: string | null;
  message?: string | null;
};

export type RestorePlan = {
  mode: RestoreMode;
  snapshotId: string;
  items: RestorePlanItem[];
  warnings: string[];
};

export type RestoreApplyResult = {
  mode: RestoreMode;
  snapshotId: string;
  items: RestorePlanItem[];
  added: number;
  replaced: number;
  skipped: number;
  failed: number;
  warnings: string[];
};
