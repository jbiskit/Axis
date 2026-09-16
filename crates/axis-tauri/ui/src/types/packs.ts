export type PackManifestView = {
  id: string;
  name: string;
  version?: string | null;
  sourceLabel?: string | null;
  platforms: string[];
  root: string;
};

export type PackKitSummary = {
  id: string;
  name: string;
  description?: string | null;
  version?: string | null;
  includes: string[];
  relPath: string;
  includeCount: number;
};

export type PackArtifactRow = {
  relPath: string;
  name: string;
  platform: string;
  category: string;
  categoryLabel: string;
};

export type PackWorkspace = {
  pack: PackManifestView;
  kits: PackKitSummary[];
  artifacts: PackArtifactRow[];
  warnings: string[];
  writable: boolean;
  sourceKind: "local" | "github" | string;
  sourceId?: string | null;
};

export type PackKitWriteInput = {
  packRoot: string;
  relPath?: string | null;
  id: string;
  name: string;
  description?: string | null;
  version?: string | null;
  includes: string[];
};

export type CreateLocalPackInput = {
  parentDir: string;
  name: string;
  id?: string | null;
  version?: string | null;
  platforms?: string[];
};

export type KitApplyMode = "add" | "update";

export type KitApplyPlanItem = {
  key: string;
  kind: string;
  displayName: string;
  status:
    | "willAdd"
    | "willUpdate"
    | "skipExists"
    | "skipMissing"
    | "identical"
    | "settingsDiffer"
    | "unsupported"
    | "applied"
    | "failed"
    | "skipped";
  liveId?: string | null;
  message?: string | null;
};

export type KitApplyPlan = {
  mode: KitApplyMode;
  kitId: string;
  kitName: string;
  kitRelPath: string;
  items: KitApplyPlanItem[];
  warnings: string[];
};

export type KitApplyResult = {
  mode: KitApplyMode;
  kitId: string;
  kitName: string;
  kitRelPath: string;
  items: KitApplyPlanItem[];
  added: number;
  updated: number;
  skipped: number;
  failed: number;
  warnings: string[];
};
