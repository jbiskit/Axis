/** Graph device enrolment platform restrictions — read + edit helpers. */

export type PlatformRestrictionBlob = {
  platformBlocked?: boolean | null;
  personalDeviceEnrollmentBlocked?: boolean | null;
  osMinimumVersion?: string | null;
  osMaximumVersion?: string | null;
  blockedManufacturers?: string[] | null;
  blockedSkus?: string[] | null;
};

export type RestrictionDraft = {
  key: string;
  label: string;
  platformBlocked: boolean;
  personalBlocked: boolean;
  osMinimum: string;
  osMaximum: string;
  blockedManufacturers: string;
  blockedSkus: string;
};

export type RestrictionPlatformRow = {
  platform: string;
  platformBlocked: boolean;
  personalBlocked: boolean;
  osMinimum: string;
  osMaximum: string;
  blockedManufacturers: string;
  blockedSkus: string;
};

/**
 * Platforms the Intune admin center surfaces for device type restrictions.
 * Order follows the portal / Learn docs.
 */
export const PORTAL_PLATFORM_KEYS: Array<[string, string]> = [
  ["androidRestriction", "Android (device administrator)"],
  ["androidForWorkRestriction", "Android Enterprise"],
  ["iosRestriction", "iOS/iPadOS"],
  ["macOSRestriction", "macOS"],
  ["windowsRestriction", "Windows"],
  ["visionOSRestriction", "visionOS"],
  ["tvosRestriction", "tvOS"],
];

/**
 * Graph still returns these on the default multi-platform object, but the portal
 * does not show them as first-class platform rows (Home is usually filter-based;
 * Mobile / Mac are legacy).
 */
export const ADVANCED_PLATFORM_KEYS: Array<[string, string]> = [
  ["windowsHomeSkuRestriction", "Windows Home SKU"],
  ["windowsMobileRestriction", "Windows Mobile (legacy)"],
  ["macRestriction", "Mac (legacy)"],
];

export const MULTI_PLATFORM_KEYS: Array<[string, string]> = [
  ...PORTAL_PLATFORM_KEYS,
  ...ADVANCED_PLATFORM_KEYS,
];

const ADVANCED_KEY_SET = new Set(ADVANCED_PLATFORM_KEYS.map(([key]) => key));

export function isAdvancedRestrictionKey(key: string): boolean {
  return ADVANCED_KEY_SET.has(key);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asBlob(value: unknown): PlatformRestrictionBlob | null {
  const row = asRecord(value);
  if (!row) return null;
  return row as PlatformRestrictionBlob;
}

function textList(values: string[] | null | undefined): string {
  if (!values?.length) return "—";
  return values.join(", ");
}

function versionText(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

function listField(values: string[] | null | undefined): string {
  return (values ?? []).filter((s) => s.trim()).join(", ");
}

function versionField(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function draftFromBlob(key: string, label: string, blob: PlatformRestrictionBlob): RestrictionDraft {
  return {
    key,
    label,
    platformBlocked: blob.platformBlocked === true,
    personalBlocked: blob.personalDeviceEnrollmentBlocked === true,
    osMinimum: versionField(blob.osMinimumVersion),
    osMaximum: versionField(blob.osMaximumVersion),
    blockedManufacturers: listField(blob.blockedManufacturers),
    blockedSkus: listField(blob.blockedSkus),
  };
}

function rowFromBlob(platform: string, blob: PlatformRestrictionBlob): RestrictionPlatformRow {
  return {
    platform,
    platformBlocked: blob.platformBlocked === true,
    personalBlocked: blob.personalDeviceEnrollmentBlocked === true,
    osMinimum: versionText(blob.osMinimumVersion),
    osMaximum: versionText(blob.osMaximumVersion),
    blockedManufacturers: textList(blob.blockedManufacturers),
    blockedSkus: textList(blob.blockedSkus),
  };
}

export function enrollmentOdataType(object: Record<string, unknown> | null | undefined): string {
  return typeof object?.["@odata.type"] === "string" ? object["@odata.type"] : "";
}

export function isSinglePlatformRestriction(object: Record<string, unknown> | null | undefined): boolean {
  const odata = enrollmentOdataType(object);
  return (
    odata.includes("deviceEnrollmentPlatformRestrictionConfiguration") &&
    !odata.includes("deviceEnrollmentPlatformRestrictionsConfiguration")
  );
}

export function isEnrollmentPlatformRestrictionsObject(
  object: Record<string, unknown> | null | undefined,
): boolean {
  if (!object) return false;
  const odata = enrollmentOdataType(object);
  if (odata.includes("deviceEnrollmentPlatformRestriction")) return true;
  if (object.platformRestriction != null || object.platformType != null) return true;
  return MULTI_PLATFORM_KEYS.some(([key]) => object[key] != null);
}

/** Flatten default (multi) or single-platform restriction payloads for the inspector table. */
export function enrollmentRestrictionRows(
  object: Record<string, unknown> | null | undefined,
): RestrictionPlatformRow[] {
  if (!object) return [];

  const single = asBlob(object.platformRestriction);
  if (single) {
    const platform =
      typeof object.platformType === "string" && object.platformType.trim()
        ? object.platformType.trim()
        : "Platform";
    return [rowFromBlob(platform, single)];
  }

  const rows: RestrictionPlatformRow[] = [];
  for (const [key, label] of MULTI_PLATFORM_KEYS) {
    const blob = asBlob(object[key]);
    if (!blob) continue;
    rows.push(rowFromBlob(label, blob));
  }
  return rows;
}

export function draftsFromEnrollmentObject(
  object: Record<string, unknown> | null | undefined,
): RestrictionDraft[] {
  if (!object) return [];

  if (isSinglePlatformRestriction(object)) {
    const blob = asBlob(object.platformRestriction) ?? {};
    const platform =
      typeof object.platformType === "string" && object.platformType.trim()
        ? object.platformType.trim()
        : "Platform";
    return [draftFromBlob("platformRestriction", platform, blob)];
  }

  const drafts: RestrictionDraft[] = [];
  for (const [key, label] of MULTI_PLATFORM_KEYS) {
    const blob = asBlob(object[key]);
    if (!blob) continue;
    drafts.push(draftFromBlob(key, label, blob));
  }
  return drafts;
}

export function partitionRestrictionDrafts(drafts: RestrictionDraft[]): {
  portal: RestrictionDraft[];
  advanced: RestrictionDraft[];
} {
  const portal: RestrictionDraft[] = [];
  const advanced: RestrictionDraft[] = [];
  for (const draft of drafts) {
    if (isAdvancedRestrictionKey(draft.key)) advanced.push(draft);
    else portal.push(draft);
  }
  return { portal, advanced };
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function draftToBlob(draft: RestrictionDraft): PlatformRestrictionBlob {
  return {
    platformBlocked: draft.platformBlocked,
    personalDeviceEnrollmentBlocked: draft.personalBlocked,
    osMinimumVersion: draft.osMinimum.trim() || null,
    osMaximumVersion: draft.osMaximum.trim() || null,
    blockedManufacturers: parseCsv(draft.blockedManufacturers),
    blockedSkus: parseCsv(draft.blockedSkus),
  };
}

export function draftsEqual(a: RestrictionDraft[], b: RestrictionDraft[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((row, index) => {
    const other = b[index];
    return (
      row.key === other.key &&
      row.platformBlocked === other.platformBlocked &&
      row.personalBlocked === other.personalBlocked &&
      row.osMinimum === other.osMinimum &&
      row.osMaximum === other.osMaximum &&
      row.blockedManufacturers === other.blockedManufacturers &&
      row.blockedSkus === other.blockedSkus
    );
  });
}

export function allowBlockLabel(blocked: boolean): string {
  return blocked ? "Block" : "Allow";
}

export type UpdateEnrollmentPlatformRestrictionsInput = {
  id: string;
  odataType: string;
  displayName?: string | null;
  description?: string | null;
  restrictions?: Record<string, PlatformRestrictionBlob> | null;
  platformRestriction?: PlatformRestrictionBlob | null;
  platformType?: string | null;
};

export function buildUpdateInput(
  id: string,
  object: Record<string, unknown>,
  drafts: RestrictionDraft[],
): UpdateEnrollmentPlatformRestrictionsInput {
  const odataType = enrollmentOdataType(object);
  if (isSinglePlatformRestriction(object)) {
    const draft = drafts[0];
    return {
      id,
      odataType,
      platformType: typeof object.platformType === "string" ? object.platformType : null,
      platformRestriction: draft ? draftToBlob(draft) : null,
    };
  }
  const restrictions: Record<string, PlatformRestrictionBlob> = {};
  for (const draft of drafts) {
    restrictions[draft.key] = draftToBlob(draft);
  }
  return { id, odataType, restrictions };
}
