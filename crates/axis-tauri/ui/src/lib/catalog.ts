import type {
  CatalogCategory,
  CatalogDependentRef,
  CatalogPolicySummary,
  CatalogSettingDetail,
  CatalogSettingOption,
  SettingsCatalogPlatform,
} from "../types/inventory";
import { matchesIntunePlatform } from "./platforms";
import { catalogUiLabel, isAdmxPlaceholderName, preferredLabel } from "./catalogSettingDisplay";
import {
  configuredValueMatchesGraphDefault,
  graphDefaultOptionId,
} from "./catalogDefaults";

export const NIL_CATEGORY_PARENT_ID = "00000000-0000-0000-0000-000000000000";
export const ADMINISTRATIVE_TEMPLATES_CATEGORY_ID = "48be5f9d-4941-4189-8015-dd78f87aacd5";
export const MACOS_MICROSOFT_EDGE_CATEGORY_ID = "9d14bbed-327d-4c38-ac02-6b916909bdd9";
export const WINDOWS_MICROSOFT_EDGE_CATEGORY_ID = "a25a7a02-4bac-411b-9d02-10cb3297cb17";

const PINNED_ROOT_CATEGORY_IDS = [
  ADMINISTRATIVE_TEMPLATES_CATEGORY_ID,
  "0a1347d2-90c0-407a-baa0-e4859260532a",
  "e8400c82-34c8-4d6e-bbf9-85220f3205ea",
  WINDOWS_MICROSOFT_EDGE_CATEGORY_ID,
  MACOS_MICROSOFT_EDGE_CATEGORY_ID,
  "f62e0f2a-4363-4246-8057-1dc811fe4360",
];

export function settingsCatalogPlatformFromScope(
  scope: string | null | undefined,
): SettingsCatalogPlatform | null {
  if (scope === "macos") return "macos";
  if (scope === "windows" || scope == null) return "windows";
  return null;
}

export function graphPlatformsForSettingsCatalog(platform: SettingsCatalogPlatform): string {
  return platform === "macos" ? "macOS" : "windows10";
}

/**
 * Apple payload categories hang every setting off a synthetic top-level group
 * whose id repeats the payload domain, e.g. `com.apple.mcx_com.apple.mcx-accounts`.
 * Intune shows the children; Graph still requires the parent on the policy.
 */
export function isSyntheticTopLevelGroupId(id?: string | null): boolean {
  if (!id) return false;
  const separator = id.indexOf("_");
  if (separator <= 0) return false;
  const domain = id.slice(0, separator);
  const rest = id.slice(separator + 1);
  return rest === domain || rest.startsWith(`${domain}-`);
}

export function isFreeformSettingsCatalogPolicy(
  policy: Pick<CatalogPolicySummary, "templateId" | "templateFamily">,
): boolean {
  if (policy.templateId?.trim()) return false;
  const family = policy.templateFamily?.trim();
  return !family || family === "none";
}

export function isFreeformSettingsCatalogPolicyForPlatform(
  policy: Pick<CatalogPolicySummary, "templateId" | "templateFamily" | "platforms">,
  platform: SettingsCatalogPlatform,
): boolean {
  return isFreeformSettingsCatalogPolicy(policy) && matchesIntunePlatform(policy.platforms, platform);
}

export function isRootCategory(category: CatalogCategory): boolean {
  const parent = category.parentCategoryId?.trim();
  return !parent || parent === NIL_CATEGORY_PARENT_ID || parent === category.id;
}

export function rootCatalogCategories(categories: CatalogCategory[]): CatalogCategory[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  let roots = categories.filter(isRootCategory);
  if (roots.length === 0) {
    roots = categories.filter((category) => {
      const parent = category.parentCategoryId?.trim();
      if (!parent || parent === NIL_CATEGORY_PARENT_ID) return true;
      return !byId.has(parent);
    });
  }
  if (roots.length === 0) {
    const mentioned = new Set(categories.flatMap((category) => category.childCategoryIds));
    roots = categories.filter((category) => !mentioned.has(category.id));
  }
  return roots.sort((a, b) => {
    const ai = PINNED_ROOT_CATEGORY_IDS.indexOf(a.id);
    const bi = PINNED_ROOT_CATEGORY_IDS.indexOf(b.id);
    const aPin = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
    const bPin = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
    if (aPin !== bPin) return aPin - bPin;
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
  });
}

export function childCatalogCategories(
  categories: CatalogCategory[],
  parentId: string,
): CatalogCategory[] {
  const parent = categories.find((category) => category.id === parentId);
  const byId = new Map(categories.map((category) => [category.id, category]));
  if (parent?.childCategoryIds.length) {
    return parent.childCategoryIds
      .map((id) => byId.get(id))
      .filter((category): category is CatalogCategory => category != null && category.id !== parentId)
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
  }
  return categories
    .filter((category) => category.parentCategoryId === parentId && category.id !== parentId)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
}

export function ancestorCategoryIds(categories: CatalogCategory[], categoryId: string): string[] {
  const list = Array.isArray(categories) ? categories : [];
  const byId = new Map(list.map((category) => [category.id, category]));
  const ancestors: string[] = [];
  const seen = new Set<string>([categoryId]);
  let current = byId.get(categoryId);
  while (
    current?.parentCategoryId &&
    current.parentCategoryId !== NIL_CATEGORY_PARENT_ID &&
    current.parentCategoryId !== current.id &&
    !seen.has(current.parentCategoryId)
  ) {
    seen.add(current.parentCategoryId);
    ancestors.unshift(current.parentCategoryId);
    current = byId.get(current.parentCategoryId);
  }
  return ancestors;
}

export function categoryBreadcrumb(
  categories: CatalogCategory[],
  categoryId: string | null | undefined,
): string {
  if (!categoryId) return "";
  const list = Array.isArray(categories) ? categories : [];
  const byId = new Map(list.map((category) => [category.id, category]));
  const category = byId.get(categoryId);
  if (!category) return "";
  const path = (category.description ?? "").trim();
  if (path.includes("\\")) return path.replace(/\\/g, " › ");
  return [
    ...ancestorCategoryIds(categories, categoryId)
      .map((id) => byId.get(id)?.displayName)
      .filter((name): name is string => Boolean(name)),
    category.displayName,
  ].join(" › ");
}

export type SettingValueDraft =
  | { kind: "choice"; optionItemId: string; children: Record<string, SettingValueDraft> }
  | { kind: "choiceCollection"; optionItemIds: string[] }
  | { kind: "groupCollection"; rows: GroupCollectionRow[] }
  | { kind: "simple"; value: string | number | boolean }
  | { kind: "simpleCollection"; values: string[] }
  | { kind: "unsupported"; reason: string };

/**
 * One row of a repeating group collection (e.g. a Defender scan exclusion).
 * `children` holds that row's own settings, keyed by definition id — the row's
 * `$type` choice plus whichever dependent field that choice requires.
 */
export type GroupCollectionRow = {
  children: Record<string, SettingValueDraft>;
  /**
   * Per-row `settingDefinitionId -> settingInstanceTemplateId`. Each row in a
   * group collection has its own template ids, so a single flat map cannot
   * represent them.
   */
  templateRefs?: Record<string, string>;
};

const BOOLEAN_TRUE_TOKENS = new Set(["true", "enabled", "enable", "allow", "allowed", "yes", "on"]);
const BOOLEAN_FALSE_TOKENS = new Set(["false", "disabled", "disable", "block", "blocked", "no", "off"]);

function classifyBooleanToken(raw: string): boolean | null {
  const text = raw.trim().toLowerCase().replace(/['’]/g, "");
  if (!text) return null;
  if (BOOLEAN_TRUE_TOKENS.has(text)) return true;
  if (BOOLEAN_FALSE_TOKENS.has(text)) return false;
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length !== 1) return null;
  if (BOOLEAN_TRUE_TOKENS.has(words[0]!)) return true;
  if (BOOLEAN_FALSE_TOKENS.has(words[0]!)) return false;
  return null;
}

function optionBooleanPolarity(option: CatalogSettingOption): boolean | null {
  const fromName = classifyBooleanToken(option.displayName);
  if (fromName !== null) return fromName;
  const segments = option.itemId.split(/[_/]/);
  return classifyBooleanToken(segments[segments.length - 1] ?? option.itemId);
}

/** Two-option Graph choice that is a clear boolean pair — not every two-value enum. */
export function booleanChoicePair(
  detail: Pick<CatalogSettingDetail, "options">,
): { trueItemId: string; falseItemId: string } | null {
  const options = detail.options ?? [];
  if (options.length !== 2) return null;
  const sides = options.map((option) => ({ option, side: optionBooleanPolarity(option) }));
  if (sides.some((entry) => entry.side === null)) return null;
  const on = sides.find((entry) => entry.side === true);
  const off = sides.find((entry) => entry.side === false);
  if (!on || !off) return null;
  return { trueItemId: on.option.itemId, falseItemId: off.option.itemId };
}

export function isSimpleBooleanDraft(
  detail: Pick<CatalogSettingDetail, "valueType">,
  draft: SettingValueDraft,
): boolean {
  if (draft.kind !== "simple") return false;
  return typeof draft.value === "boolean" || /Boolean/i.test(detail.valueType ?? "");
}

export function simpleBooleanValue(draft: Extract<SettingValueDraft, { kind: "simple" }>): boolean {
  if (typeof draft.value === "boolean") return draft.value;
  return draft.value === "true" || draft.value === 1 || draft.value === "1";
}

const MULTILINE_STRING_FORMATS = new Set(["xml", "json", "binary", "base64"]);
const SINGLE_LINE_STRING_FORMATS = new Set([
  "email",
  "guid",
  "ip",
  "url",
  "version",
  "date",
  "time",
  "datetime",
]);
/** Graph string fields at or above this length are treated as document-sized. */
const LARGE_STRING_MAX_LENGTH = 2048;

function normalizeGraphStringFormat(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const token = value
    .trim()
    .replace(/^#?microsoft\.graph\.deviceManagementConfigurationStringFormat\.?/i, "")
    .split(/[./]/)
    .filter(Boolean)
    .pop();
  return token ? token.toLowerCase() : null;
}

export function catalogStringFormat(
  detail: Pick<CatalogSettingDetail, "stringFormat" | "raw">,
): string | null {
  const mapped = normalizeGraphStringFormat(detail.stringFormat);
  if (mapped) return mapped;
  const raw = asRecord(detail.raw);
  const valueDefinition = asRecord(raw?.valueDefinition);
  return (
    normalizeGraphStringFormat(textField(valueDefinition?.format)) ??
    normalizeGraphStringFormat(textField(raw?.format))
  );
}

function catalogTextHaystack(
  detail: Pick<CatalogSettingDetail, "id" | "displayName" | "description" | "helpText">,
): string {
  return [detail.id, detail.displayName, detail.description, detail.helpText]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n")
    .toLowerCase();
}

/** XML / Exploit Protection config, Graph `format` xml|json, or a large string payload. */
export function usesMultilineTextEditor(
  detail: Pick<
    CatalogSettingDetail,
    | "id"
    | "displayName"
    | "description"
    | "helpText"
    | "valueType"
    | "stringFormat"
    | "maximumLength"
    | "raw"
  >,
): boolean {
  if (/Boolean|Integer|Number/i.test(detail.valueType ?? "")) return false;
  const format = catalogStringFormat(detail);
  if (format && MULTILINE_STRING_FORMATS.has(format)) return true;
  if (format && SINGLE_LINE_STRING_FORMATS.has(format)) return false;
  const haystack = catalogTextHaystack(detail);
  if (
    /\bxml\b/.test(haystack) ||
    /exploitguard|exploitprotection|exploit_protection|exploit-protection/.test(haystack)
  ) {
    return true;
  }
  return typeof detail.maximumLength === "number" && detail.maximumLength >= LARGE_STRING_MAX_LENGTH;
}

export function multilineXmlHint(
  detail: Pick<
    CatalogSettingDetail,
    | "id"
    | "displayName"
    | "description"
    | "helpText"
    | "valueType"
    | "stringFormat"
    | "maximumLength"
    | "raw"
  >,
  value: string,
): string | null {
  const format = catalogStringFormat(detail);
  const haystack = catalogTextHaystack(detail);
  const expectsXml =
    format === "xml" || /\bxml\b/.test(haystack) || /exploitguard|exploitprotection/.test(haystack);
  if (!expectsXml || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("<") && trimmed.includes(">")) return null;
  return "This setting is stored as a Graph string and typically expects an XML document.";
}

function isGroupCollection(detail: CatalogSettingDetail): boolean {
  return /settingGroup/i.test(detail.kind) || /SettingGroup/i.test(detail["@odata.type"] ?? "");
}

/**
 * A group *collection* holds repeating rows (e.g. scan exclusions), unlike a
 * plain group which holds one fixed set of children.
 */
export function isGroupCollectionDetail(detail: CatalogSettingDetail): boolean {
  return (
    /SettingGroupCollection/i.test(detail.kind) ||
    /SettingGroupCollection/i.test(detail["@odata.type"] ?? "")
  );
}

/**
 * A choice *collection* definition (`...ChoiceSettingCollectionDefinition`) holds
 * a set of selected options, not one. Graph rejects it when sent as a plain
 * ChoiceSetting instance, so it needs its own editor and payload shape.
 */
export function isChoiceCollection(detail: CatalogSettingDetail): boolean {
  return (
    /ChoiceSettingCollection/i.test(detail.kind) ||
    /ChoiceSettingCollection/i.test(detail["@odata.type"] ?? "")
  );
}

function isSimpleCollection(detail: CatalogSettingDetail): boolean {
  return /SimpleSettingCollection/i.test(detail.kind) || /SimpleSettingCollection/i.test(detail["@odata.type"] ?? "");
}

function isSimpleSetting(detail: CatalogSettingDetail): boolean {
  if (isSimpleCollection(detail) || isGroupCollection(detail)) return false;
  return (
    /SimpleSetting/i.test(detail.kind) ||
    /SimpleSetting/i.test(detail["@odata.type"] ?? "") ||
    Boolean(detail.valueType)
  );
}

function settingLabel(detail: CatalogSettingDetail): string {
  return catalogUiLabel([detail.displayName], detail.id);
}

/** Graph `required` on `dependedOnBy` / `dependentOn` — only `true` is mandatory. */
function graphMarksRequired(value: unknown): boolean {
  return value === true;
}

/** Graph rejects an empty `simpleSettingCollectionValue` but also 400s if a required dependent is omitted. */
export function requiredCollectionMessage(detail: CatalogSettingDetail): string {
  const name = settingLabel(detail);
  const help = preferredLabel(detail.helpText, detail.description);
  const mustAdd = `“${name}” requires at least one item. Add a value before saving.`;
  return help ? `${mustAdd} ${help}` : mustAdd;
}

function collectionDraftFilledCount(draft: SettingValueDraft): number {
  if (draft.kind !== "simpleCollection") return 0;
  return draft.values.map((value) => value.trim()).filter(Boolean).length;
}

function isEmptyCollectionDraft(detail: CatalogSettingDetail, draft: SettingValueDraft): boolean {
  return isSimpleCollection(detail) && draft.kind === "simpleCollection" && collectionDraftFilledCount(draft) === 0;
}

export function settingDraftSaveError(
  detail: CatalogSettingDetail,
  draft: SettingValueDraft,
  dependents: Record<string, CatalogSettingDetail> = {},
  required = false,
): string | null {
  if (draft.kind === "unsupported") return draft.reason;
  if (draft.kind === "groupCollection") {
    const min = detail.minimumCount && detail.minimumCount > 0 ? detail.minimumCount : 0;
    if (draft.rows.length < min) {
      return `“${settingLabel(detail)}” requires at least ${min} row${min === 1 ? "" : "s"}.`;
    }
    for (const row of draft.rows) {
      for (const [childId, childDraft] of Object.entries(row.children)) {
        const childDetail = dependents[childId];
        if (!childDetail || childDraft.kind === "unsupported") continue;
        const nested = settingDraftSaveError(childDetail, childDraft, dependents, true);
        if (nested) return nested;
      }
    }
    return null;
  }
  if (draft.kind === "choiceCollection") {
    const min = detail.minimumCount && detail.minimumCount > 0 ? detail.minimumCount : 0;
    if (draft.optionItemIds.length < min) {
      return `“${settingLabel(detail)}” requires at least ${min} selected option${min === 1 ? "" : "s"}.`;
    }
    return null;
  }
  if (draft.kind === "simpleCollection") {
    if (!required) return null;
    const min = detail.minimumCount && detail.minimumCount > 0 ? detail.minimumCount : 1;
    if (collectionDraftFilledCount(draft) < min) {
      return requiredCollectionMessage(detail);
    }
    return null;
  }
  if (draft.kind === "choice") {
    for (const dep of dependentsForOption(detail, draft.optionItemId, dependents)) {
      const childDetail = dependents[dep.settingDefinitionId];
      const childDraft =
        draft.children[dep.settingDefinitionId] ??
        (childDetail ? defaultDraftForSetting(childDetail, dependents) : undefined);
      if (!childDetail || !childDraft) {
        if (dep.required) {
          return `“${settingLabel(detail)}” requires a value for “${dep.settingDefinitionId}”.`;
        }
        continue;
      }
      const nested = settingDraftSaveError(childDetail, childDraft, dependents, dep.required);
      if (nested) return nested;
    }
  }
  return null;
}

export function dependentsForOption(
  detail: CatalogSettingDetail,
  optionItemId: string,
  dependents: Record<string, CatalogSettingDetail> = {},
): CatalogDependentRef[] {
  const listed =
    (detail.options ?? []).find((option) => option.itemId === optionItemId)?.dependedOnBy ?? [];
  const byId = new Map(listed.map((dep) => [dep.settingDefinitionId, { ...dep }]));
  for (const child of Object.values(dependents)) {
    const requiredOnOption = childRequiredForOption(child, optionItemId);
    if (requiredOnOption == null) continue;
    const existing = byId.get(child.id);
    byId.set(child.id, {
      settingDefinitionId: child.id,
      required: (existing?.required ?? false) || requiredOnOption,
    });
  }
  return [...byId.values()];
}

/**
 * Graph `dependentOn` on a child: whether it belongs to this option, and if it is required.
 * Belonging alone is not required — ASR Only Per Rule Exclusions (`*_asronlyperruleexclusions`)
 * attach to Block/Audit/Warn with `required: false` or no flag. `dependentOn` entries usually
 * omit `required` (that flag lives on the parent option’s `dependedOnBy`).
 */
function childRequiredForOption(child: CatalogSettingDetail, optionItemId: string): boolean | null {
  const entries = Array.isArray(child.raw?.dependentOn) ? child.raw.dependentOn : [];
  let matched = false;
  let required = false;
  for (const entry of entries) {
    if (typeof entry === "string") {
      if (entry === optionItemId) matched = true;
      continue;
    }
    const rec = asRecord(entry);
    if (!rec) continue;
    const onOption = textField(rec.dependentOn) ?? textField(rec.optionItemId);
    if (onOption !== optionItemId) continue;
    matched = true;
    required = required || graphMarksRequired(rec.required);
  }
  return matched ? required : null;
}

export function defaultDraftForSetting(
  detail: CatalogSettingDetail,
  dependents: Record<string, CatalogSettingDetail> = {},
  visiting: Set<string> = new Set(),
): SettingValueDraft {
  if (visiting.has(detail.id)) {
    return { kind: "unsupported", reason: `“${detail.displayName}” has a circular catalog dependency.` };
  }
  const nextVisit = new Set(visiting);
  nextVisit.add(detail.id);
  if (isGroupCollection(detail)) {
    if (!isGroupCollectionDetail(detail)) {
      return {
        kind: "unsupported",
        reason: `“${detail.displayName}” is a ${detail.kind || "group"} setting — the row is listed like the portal, but this editor is not ported yet.`,
      };
    }
    // A group collection starts empty; the portal adds rows on demand.
    return { kind: "groupCollection", rows: [] };
  }
  const options = detail.options ?? [];
  if (options.length > 0) {
    if (isChoiceCollection(detail)) {
      // `defaultOptionId` on a collection is the option the portal pre-checks;
      // an empty selection is valid when `minimumCount` is 0.
      const defaultId = graphDefaultOptionId(detail);
      return { kind: "choiceCollection", optionItemIds: defaultId ? [defaultId] : [] };
    }
    const preferred =
      graphDefaultOptionId(detail) ||
      options.find((option) => /enabled|allow|yes/i.test(`${option.displayName} ${option.itemId}`))
        ?.itemId ||
      options[0]!.itemId;
    const children: Record<string, SettingValueDraft> = {};
    for (const dep of dependentsForOption(detail, preferred, dependents)) {
      const child = dependents[dep.settingDefinitionId];
      if (child) children[dep.settingDefinitionId] = defaultDraftForSetting(child, dependents, nextVisit);
    }
    return { kind: "choice", optionItemId: preferred, children };
  }
  if (isSimpleCollection(detail)) {
    return { kind: "simpleCollection", values: detail.defaultString ? [detail.defaultString] : [""] };
  }
  if (isSimpleSetting(detail)) {
    if (/Boolean/i.test(detail.valueType ?? "")) {
      return { kind: "simple", value: detail.defaultString === "true" || detail.defaultString === "1" };
    }
    if (/Integer|Number/i.test(detail.valueType ?? "")) {
      const parsed = Number(detail.defaultString ?? detail.minValue ?? 0);
      return { kind: "simple", value: Number.isFinite(parsed) ? parsed : 0 };
    }
    return { kind: "simple", value: detail.defaultString ?? "" };
  }
  return {
    kind: "unsupported",
    reason: `“${detail.displayName}” is a ${detail.kind || "complex"} setting — group/collection editor not supported yet.`,
  };
}

export function draftWithChoiceOption(
  detail: CatalogSettingDetail,
  dependents: Record<string, CatalogSettingDetail>,
  optionItemId: string,
  previous?: SettingValueDraft,
): SettingValueDraft {
  const children: Record<string, SettingValueDraft> = {};
  for (const dep of dependentsForOption(detail, optionItemId, dependents)) {
    const child = dependents[dep.settingDefinitionId];
    if (!child) continue;
    const prior = previous?.kind === "choice" ? previous.children[dep.settingDefinitionId] : undefined;
    children[dep.settingDefinitionId] = prior ?? defaultDraftForSetting(child, dependents);
  }
  return { kind: "choice", optionItemId, children };
}

/**
 * The row's `$type` choice inside a group collection — the definition whose
 * options pick which dependent field the row shows (Path / File extension / …).
 */
export function groupCollectionTypeDetail(
  dependents: Record<string, CatalogSettingDetail>,
): CatalogSettingDetail | null {
  for (const child of Object.values(dependents)) {
    if ((child.options ?? []).length > 0) return child;
  }
  return null;
}

/** A fresh row for a group collection, defaulting its `$type` and dependents. */
export function newGroupCollectionRow(
  dependents: Record<string, CatalogSettingDetail>,
  templateRefs?: Record<string, string>,
): GroupCollectionRow {
  const typeDetail = groupCollectionTypeDetail(dependents);
  if (!typeDetail) return { children: {}, templateRefs };
  const draft = defaultDraftForSetting(typeDetail, dependents);
  return { children: { [typeDetail.id]: draft }, templateRefs };
}

/**
 * Switch a row's `$type`, keeping any dependent values that still apply and
 * seeding the newly required ones.
 */
export function rowWithTypeOption(
  row: GroupCollectionRow,
  dependents: Record<string, CatalogSettingDetail>,
  optionItemId: string,
): GroupCollectionRow {
  const typeDetail = groupCollectionTypeDetail(dependents);
  if (!typeDetail) return row;
  const previous = row.children[typeDetail.id];
  const next = draftWithChoiceOption(typeDetail, dependents, optionItemId, previous);
  return { ...row, children: { ...row.children, [typeDetail.id]: next } };
}

/**
 * Attach each row's own template ids to a group collection draft. Rows read
 * back from Graph carry none, and the flat ref map cannot represent them
 * (rows share definition ids), so the template's row at the same index is used.
 */
export function withRowTemplateRefs(
  draft: SettingValueDraft,
  rowTemplateRefs?: Array<Record<string, string>>,
): SettingValueDraft {
  if (draft.kind !== "groupCollection" || !rowTemplateRefs?.length) return draft;
  return {
    kind: "groupCollection",
    rows: draft.rows.map((row, index) => ({
      ...row,
      templateRefs: row.templateRefs ?? rowTemplateRefs[index],
    })),
  };
}

function simpleValuePayload(detail: CatalogSettingDetail, value: string | number | boolean) {
  if (typeof value === "boolean" || /Boolean/i.test(detail.valueType ?? "")) {
    return {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationBooleanSettingValue",
      value: Boolean(value),
    };
  }
  if (typeof value === "number" || /Integer|Number/i.test(detail.valueType ?? "")) {
    return {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationIntegerSettingValue",
      value: typeof value === "number" ? value : Number(value) || 0,
    };
  }
  return {
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationStringSettingValue",
    value: String(value),
  };
}

export function buildSettingInstance(
  detail: CatalogSettingDetail,
  draft: SettingValueDraft,
  dependents: Record<string, CatalogSettingDetail> = {},
  templateRefs: Record<string, string> = {},
  rowTemplateRefs?: Array<Record<string, string>>,
): Record<string, unknown> {
  if (draft.kind === "unsupported") throw new Error(draft.reason);
  if (draft.kind === "choiceCollection") {
    return withTemplateRef(
      {
        "@odata.type":
          "#microsoft.graph.deviceManagementConfigurationChoiceSettingCollectionInstance",
        settingDefinitionId: detail.id,
        choiceSettingCollectionValue: draft.optionItemIds.map((optionItemId) => ({
          "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingValue",
          value: optionItemId,
          children: [],
        })),
      },
      templateRefs[detail.id],
    );
  }
  if (draft.kind === "groupCollection") {
    const rows = draft.rows
      .map((row, index) => {
        const children: Record<string, unknown>[] = [];
        // Each row has its own template ids. The flat `templateRefs` map only
        // holds one row's ids (rows share definition ids, so they collide), and
        // reusing it would stamp the same reference on every row — Graph rejects
        // that as a duplicate reference. Prefer the row's own ids.
        const refs = {
          ...(row.templateRefs ?? {}),
          ...(rowTemplateRefs?.[index] ?? {}),
        };
        for (const [childId, childDraft] of Object.entries(row.children)) {
          const childDetail = dependents[childId];
          if (!childDetail || childDraft.kind === "unsupported") continue;
          const built = buildSettingInstance(childDetail, childDraft, dependents, refs);
          if (isEffectivelyEmptyInstance(built)) continue;
          children.push(built);
        }
        return children;
      })
      .filter((children) => children.length > 0);
    return withTemplateRef(
      {
        "@odata.type":
          "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance",
        settingDefinitionId: detail.id,
        groupSettingCollectionValue: rows.map((children) => groupSettingValue(children)),
      },
      templateRefs[detail.id],
    );
  }
  if (draft.kind === "choice") {
    const children: Record<string, unknown>[] = [];
    for (const dep of dependentsForOption(detail, draft.optionItemId, dependents)) {
      const childDetail = dependents[dep.settingDefinitionId];
      const childDraft =
        draft.children[dep.settingDefinitionId] ??
        (childDetail ? defaultDraftForSetting(childDetail, dependents) : undefined);
      if (!childDetail || !childDraft) {
        if (dep.required) {
          throw new Error(`“${detail.displayName}” requires a value for “${dep.settingDefinitionId}”.`);
        }
        continue;
      }
      if (dep.required && isEmptyCollectionDraft(childDetail, childDraft)) {
        throw new Error(requiredCollectionMessage(childDetail));
      }
      const built = buildSettingInstance(childDetail, childDraft, dependents, templateRefs);
      // Optional simple-collection dependents (e.g. ASR per-rule exclusions)
      // must be omitted when empty — Graph rejects `simpleSettingCollectionValue: []`.
      // Required collections must have at least one item: do not send `[]` and
      // do not omit the setting (either 400s Device Installation deny lists).
      if (isEffectivelyEmptyInstance(built)) continue;
      children.push(built);
    }
    return withTemplateRef(
      {
        "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
        settingDefinitionId: detail.id,
        choiceSettingValue: {
          "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingValue",
          value: draft.optionItemId,
          children,
        },
      },
      templateRefs[detail.id],
    );
  }
  if (draft.kind === "simpleCollection") {
    const filled = draft.values.map((value) => value.trim()).filter(Boolean);
    return withTemplateRef(
      {
        "@odata.type":
          "#microsoft.graph.deviceManagementConfigurationSimpleSettingCollectionInstance",
        settingDefinitionId: detail.id,
        simpleSettingCollectionValue: filled.map((value) => simpleValuePayload(detail, value)),
      },
      templateRefs[detail.id],
    );
  }
  return withTemplateRef(
    {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance",
      settingDefinitionId: detail.id,
      simpleSettingValue: simpleValuePayload(detail, draft.value),
    },
    templateRefs[detail.id],
  );
}

/**
 * Template-backed policies require every instance to carry the template id it
 * was created from; Graph rejects the write with "TemplateReference not found"
 * when a nested dependent is sent without one.
 */
function withTemplateRef(
  instance: Record<string, unknown>,
  templateId?: string,
): Record<string, unknown> {
  if (!templateId) return instance;
  return {
    ...instance,
    settingInstanceTemplateReference: { settingInstanceTemplateId: templateId },
  };
}

function isEffectivelyEmptyInstance(instance: Record<string, unknown>): boolean {
  const collection = instance.simpleSettingCollectionValue;
  return Array.isArray(collection) && collection.length === 0;
}

function groupSettingValue(children: Record<string, unknown>[]): Record<string, unknown> {
  return {
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingValue",
    children,
  };
}

function instanceDefinitionId(instance: Record<string, unknown>): string | null {
  return typeof instance.settingDefinitionId === "string" && instance.settingDefinitionId
    ? instance.settingDefinitionId
    : null;
}

function isGroupInstance(instance: Record<string, unknown>): boolean {
  return instance.groupSettingCollectionValue != null || instance.groupSettingValue != null;
}

export function groupInstanceChildren(instance: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(instance.groupSettingCollectionValue)) {
    return instance.groupSettingCollectionValue.flatMap((entry) => {
      const record = asRecord(entry);
      return Array.isArray(record?.children)
        ? record.children.filter((child): child is Record<string, unknown> => Boolean(asRecord(child)))
        : [];
    });
  }
  const group = asRecord(instance.groupSettingValue);
  return Array.isArray(group?.children)
    ? group.children.filter((child): child is Record<string, unknown> => Boolean(asRecord(child)))
    : [];
}

/** Rebuild a group collection instance from its child instances (for edits/removals). */
export function buildGroupCollectionInstance(
  groupDetail: CatalogSettingDetail,
  children: Record<string, unknown>[],
  templateId?: string,
): Record<string, unknown> {
  return withTemplateRef(
    {
      "@odata.type":
        "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance",
      settingDefinitionId: groupDetail.id,
      groupSettingCollectionValue: [groupSettingValue(children)],
    },
    templateId,
  );
}

function mergeGroupInstances(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const definitionId = instanceDefinitionId(incoming) ?? instanceDefinitionId(existing);
  // Rebuilding the group drops its template reference, which Graph requires on
  // template-backed policies. Carry it over from whichever side has one.
  const reference =
    asRecord(incoming.settingInstanceTemplateReference) ??
    asRecord(existing.settingInstanceTemplateReference);
  const templateId =
    textField(reference?.settingInstanceTemplateId) ?? undefined;

  // A group *collection* holds repeating rows whose children share definition
  // ids (e.g. `..._item_$type`). Deduping children across the whole collection
  // would collapse the rows into one, so merge row-by-row: row N of the
  // incoming instance updates row N of the existing one, extra rows append.
  if (existing.groupSettingCollectionValue != null || incoming.groupSettingCollectionValue != null) {
    const rowsOf = (value: unknown): Record<string, unknown>[] =>
      Array.isArray(value)
        ? value.filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry)))
        : [];
    const existingRows = rowsOf(existing.groupSettingCollectionValue);
    const incomingRows = rowsOf(incoming.groupSettingCollectionValue);
    const rows: Record<string, unknown>[] = [];
    for (let index = 0; index < Math.max(existingRows.length, incomingRows.length); index += 1) {
      const base = existingRows[index];
      const next = incomingRows[index];
      if (base && next) {
        rows.push(groupSettingValue(mergeChildrenById(base, next)));
      } else if (base) {
        rows.push(groupSettingValue(rowChildren(base)));
      } else if (next) {
        rows.push(groupSettingValue(rowChildren(next)));
      }
    }
    return withTemplateRef(
      {
        "@odata.type":
          "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance",
        settingDefinitionId: definitionId,
        groupSettingCollectionValue: rows,
      },
      templateId,
    );
  }

  return withTemplateRef(
    {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingInstance",
      settingDefinitionId: definitionId,
      groupSettingValue: groupSettingValue(mergeChildrenById(existing, incoming)),
    },
    templateId,
  );
}

/**
 * Children of a group instance or of a single `groupSettingCollectionValue` row.
 * A row is `{ children: [...] }`, which `groupInstanceChildren` does not read.
 */
function rowChildren(value: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(value.children)) {
    return value.children.filter((child): child is Record<string, unknown> =>
      Boolean(asRecord(child)),
    );
  }
  return groupInstanceChildren(value);
}

/** Merge two instances' children by definition id: incoming wins, order preserved. */
function mergeChildrenById(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown>[] {
  const children: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const child of [...rowChildren(existing), ...rowChildren(incoming)]) {
    const id = instanceDefinitionId(child) ?? JSON.stringify(child);
    if (seen.has(id)) {
      const index = children.findIndex((row) => instanceDefinitionId(row) === id);
      if (index >= 0) children[index] = child;
      continue;
    }
    seen.add(id);
    children.push(child);
  }
  return children;
}

/** Nest a leaf under its Apple/group parent so Graph accepts the policy. */
export function wrapSettingInstanceForPolicy(
  instance: Record<string, unknown>,
  detail: CatalogSettingDetail,
  byId: Record<string, CatalogSettingDetail> = {},
  templateRefs: Record<string, string> = {},
): Record<string, unknown> {
  // `buildSettingInstance` already stamped the leaf's own template reference.
  const leaf = instance;
  const parentId = detail.rootDefinitionId?.trim();
  if (!parentId || parentId === detail.id) return leaf;
  if (instanceDefinitionId(leaf) === parentId) return leaf;

  const parent = byId[parentId];
  const synthetic = isSyntheticTopLevelGroupId(parentId);
  const parentIsGroup = parent
    ? /settingGroup/i.test(parent.kind) || /SettingGroup/i.test(parent["@odata.type"] ?? "")
    : false;
  if (!synthetic && !parentIsGroup) return leaf;

  const parentRef = templateRefs[parentId];
  const group = (collection: boolean): Record<string, unknown> => {
    const wrapped: Record<string, unknown> = collection
      ? {
          "@odata.type":
            "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance",
          settingDefinitionId: parentId,
          groupSettingCollectionValue: [groupSettingValue([leaf])],
        }
      : {
          "@odata.type":
            "#microsoft.graph.deviceManagementConfigurationGroupSettingInstance",
          settingDefinitionId: parentId,
          groupSettingValue: groupSettingValue([leaf]),
        };
    if (parentRef) {
      wrapped.settingInstanceTemplateReference = { settingInstanceTemplateId: parentRef };
    }
    return wrapped;
  };
  // Only a group *collection* parent takes `groupSettingCollectionValue`. A plain
  // `...SettingGroupDefinition` takes `groupSettingValue`; wrapping it as a
  // collection makes Graph reject the child as ChoiceCollection when the child's
  // own definition is a plain ChoiceSetting.
  const asCollection = /collection/i.test(parent?.kind ?? "");
  return group(asCollection);
}

/** Wrap Apple parents and merge siblings that share a group collection. */
export function instancesReadyForGraph(
  rows: Array<{
    instance: Record<string, unknown>;
    detail: CatalogSettingDetail;
    byId?: Record<string, CatalogSettingDetail>;
  }>,
  templateRefs?: Record<string, string>,
): Record<string, unknown>[] {
  const wrapped = rows
    .filter((row) => !isEffectivelyEmptyInstance(row.instance))
    .map((row) =>
      wrapSettingInstanceForPolicy(
        row.instance,
        row.detail,
        {
          ...(row.byId ?? {}),
          [row.detail.id]: row.detail,
        },
        templateRefs,
      ),
    );
  const order: string[] = [];
  const merged = new Map<string, Record<string, unknown>>();
  for (const instance of wrapped) {
    const id = instanceDefinitionId(instance);
    if (!id) continue;
    const previous = merged.get(id);
    if (!previous) {
      order.push(id);
      merged.set(id, instance);
      continue;
    }
    merged.set(
      id,
      isGroupInstance(previous) && isGroupInstance(instance)
        ? mergeGroupInstances(previous, instance)
        : instance,
    );
  }
  return order.map((id) => merged.get(id)!);
}

export function collectDependentIds(
  detail: CatalogSettingDetail,
  byId: Record<string, CatalogSettingDetail> = {},
): string[] {
  const ids = new Set(
    (detail.options ?? []).flatMap((option) => option.dependedOnBy.map((dep) => dep.settingDefinitionId)),
  );
  // A group (collection) declares its children on the definition itself via
  // `dependedOnBy` / `childIds` — it has no options to hang them off.
  const ownDeps = Array.isArray(detail.raw?.dependedOnBy) ? detail.raw.dependedOnBy : [];
  for (const dep of ownDeps) {
    if (typeof dep === "string" && dep.trim()) {
      ids.add(dep.trim());
      continue;
    }
    const rec = asRecord(dep);
    const id = textField(rec?.dependedOnBy) ?? textField(rec?.settingDefinitionId);
    if (id) ids.add(id);
  }
  const childIds = Array.isArray(detail.raw?.childIds) ? detail.raw.childIds : [];
  for (const childId of childIds) {
    const id = textField(childId);
    if (id) ids.add(id);
  }
  for (const child of Object.values(byId)) {
    if (child.id === detail.id || ids.has(child.id)) continue;
    for (const option of detail.options ?? []) {
      if (childRequiredForOption(child, option.itemId) != null) {
        ids.add(child.id);
        break;
      }
    }
  }
  return [...ids];
}

export function bundleFromCategoryMap(
  settingId: string,
  byId: Record<string, CatalogSettingDetail>,
): { detail: CatalogSettingDetail; dependents: Record<string, CatalogSettingDetail> } | null {
  const detail = byId[settingId];
  if (!detail) return null;
  const dependents: Record<string, CatalogSettingDetail> = {};
  const queue = [...collectDependentIds(detail, byId)];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || id === detail.id) continue;
    seen.add(id);
    const child = byId[id];
    if (!child) continue;
    dependents[id] = child;
    queue.push(...collectDependentIds(child, byId));
  }
  return { detail, dependents };
}

export function draftValueSummary(
  detail: CatalogSettingDetail,
  draft: SettingValueDraft,
  _dependents: Record<string, CatalogSettingDetail>,
): string {
  if (draft.kind === "unsupported") return "Not configurable";
  if (draft.kind === "groupCollection") {
    const count = draft.rows.length;
    return count === 0 ? "No rows" : `${count} row${count === 1 ? "" : "s"}`;
  }
  if (draft.kind === "simple") {
    if (typeof draft.value === "boolean") return draft.value ? "True" : "False";
    return String(draft.value).trim() || "No value entered";
  }
  if (draft.kind === "simpleCollection") {
    const values = draft.values.map((value) => value.trim()).filter(Boolean);
    return values.length ? `${values.length} value(s)` : "No values added";
  }
  if (draft.kind === "choiceCollection") {
    if (draft.optionItemIds.length === 0) return "No options selected";
    // Option labels on these definitions are full sentences, so joining them
    // makes the collapsed row unreadable. Name the first option and count the rest.
    const first = detail.options.find((candidate) => candidate.itemId === draft.optionItemIds[0]);
    const firstLabel = catalogUiLabel([first?.displayName], draft.optionItemIds[0]!, detail.id);
    const extra = draft.optionItemIds.length - 1;
    return extra > 0 ? `${firstLabel} (+${extra} more)` : firstLabel;
  }
  const match = detail.options.find((candidate) => candidate.itemId === draft.optionItemId);
  return catalogUiLabel(
    [match?.displayName],
    match?.itemId ?? draft.optionItemId,
    detail.id,
  );
}

/** Configured draft equals Graph `defaultOptionId` / `isDefault` / `defaultValue` — not inferred. */
export function draftMatchesGraphDefault(
  detail: CatalogSettingDetail,
  draft: SettingValueDraft,
): boolean {
  if (draft.kind === "unsupported") return false;
  return configuredValueMatchesGraphDefault(detail, draft);
}

export type SettingDraftDiffLine = {
  label: string;
  before: string;
  after: string;
};

function flattenDraftLeaves(
  detail: CatalogSettingDetail,
  draft: SettingValueDraft,
  dependents: Record<string, CatalogSettingDetail>,
  parentPath?: string,
): Array<{ path: string; value: string; unnamed: boolean }> {
  const unnamed = Boolean(parentPath) && isAdmxPlaceholderName(detail.displayName);
  const title = unnamed ? detail.id : catalogUiLabel([detail.displayName], detail.id);
  const path = parentPath ? `${parentPath} › ${title}` : catalogUiLabel([detail.displayName], detail.id);
  if (draft.kind === "groupCollection") {
    const rows: Array<{ path: string; value: string; unnamed: boolean }> = [];
    draft.rows.forEach((row, index) => {
      const rowPath = `Row ${index + 1}`;
      // Summarize each row as "<type> — <field>: <value>" so the diff reads as
      // an entry, not a path through the `$type` choice.
      const parts: string[] = [];
      for (const [childId, childDraft] of Object.entries(row.children)) {
        const child = dependents[childId];
        if (!child) continue;
        if (childDraft.kind === "choice") {
          parts.push(draftValueSummary(child, childDraft, dependents));
          for (const [depId, depDraft] of Object.entries(childDraft.children)) {
            const dep = dependents[depId];
            if (!dep) continue;
            const value = draftValueSummary(dep, depDraft, dependents);
            if (value && value !== "No value entered") {
              parts.push(`${catalogUiLabel([dep.displayName], dep.id)}: ${value}`);
            }
          }
          continue;
        }
        const value = draftValueSummary(child, childDraft, dependents);
        if (value) parts.push(`${catalogUiLabel([child.displayName], child.id)}: ${value}`);
      }
      rows.push({
        path: rowPath,
        value: parts.length ? parts.join(" — ") : "Empty row",
        unnamed: false,
      });
    });
    return rows.length ? rows : [{ path, value: "No rows", unnamed }];
  }
  if (draft.kind === "choice") {
    const rows = [{ path, value: draftValueSummary(detail, draft, dependents), unnamed }];
    for (const [id, childDraft] of Object.entries(draft.children)) {
      const child = dependents[id];
      if (!child) continue;
      rows.push(...flattenDraftLeaves(child, childDraft, dependents, path));
    }
    return rows;
  }
  return [{ path, value: draftValueSummary(detail, draft, dependents), unnamed }];
}

function relativeDraftLabel(path: string, rootName: string): string {
  if (path === rootName) return "Value";
  const prefix = `${rootName} › `;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function diffSettingDrafts(
  detail: CatalogSettingDetail,
  original: SettingValueDraft,
  draft: SettingValueDraft,
  dependents: Record<string, CatalogSettingDetail>,
  options?: { added?: boolean },
): SettingDraftDiffLine[] {
  const afterLeaves = flattenDraftLeaves(detail, draft, dependents);
  const rootName = catalogUiLabel([detail.displayName], detail.id);
  const unnamedByPath = new Map(afterLeaves.map((leaf) => [leaf.path, leaf.unnamed]));
  if (options?.added) {
    return afterLeaves.map((leaf, index) => ({
      label: leaf.unnamed ? "Value" : relativeDraftLabel(leaf.path, rootName),
      before: index === 0 ? "Not on this policy" : "—",
      after: leaf.value,
    }));
  }
  const beforeLeaves = flattenDraftLeaves(detail, original, dependents);
  for (const leaf of beforeLeaves) {
    if (leaf.unnamed) unnamedByPath.set(leaf.path, true);
  }
  const beforeMap = new Map(beforeLeaves.map((leaf) => [leaf.path, leaf.value]));
  const afterMap = new Map(afterLeaves.map((leaf) => [leaf.path, leaf.value]));
  const paths = [...new Set([...beforeMap.keys(), ...afterMap.keys()])];
  const lines = paths.map((path) => ({
    label: unnamedByPath.get(path) ? "Value" : relativeDraftLabel(path, rootName),
    before: beforeMap.get(path) ?? "—",
    after: afterMap.get(path) ?? "—",
  }));
  const changed = lines.filter((line) => line.before !== line.after);
  return changed.length > 0 ? changed : lines;
}

function usableCatalogText(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^l[_/]/i.test(trimmed) || /^l[A-Z]/.test(trimmed)) return null;
  return trimmed;
}

export function catalogSettingSourceLabel(setting: {
  id: string;
  keywords?: string[];
}): string | null {
  const hay = `${setting.id} ${(setting.keywords ?? []).join(" ")}`.toLowerCase();
  if (hay.includes("microsoft_edge") || hay.includes("microsoftedge") || hay.includes("msedge")) {
    return "Microsoft Edge";
  }
  if (hay.includes("googlechrome") || hay.includes("chromeintune") || hay.includes("google_chrome")) {
    return "Google Chrome";
  }
  if (hay.includes("firefox")) return "Mozilla Firefox";
  if (hay.includes("office16") || hay.includes("microsoftoffice") || hay.includes("~office~")) {
    return "Microsoft Office";
  }
  return null;
}

export function catalogSettingBlurb(setting: {
  description?: string | null;
  helpText?: string | null;
}): { summary: string | null; detail: string | null } {
  const description = usableCatalogText(setting.description);
  const help = usableCatalogText(setting.helpText);
  if (description && help && help !== description) {
    return { summary: description, detail: help };
  }
  return { summary: description ?? help, detail: null };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function shortOdataType(value?: string | null): string {
  return (value ?? "settingDefinition")
    .replace("#microsoft.graph.deviceManagementConfiguration", "")
    .replace("microsoft.graph.deviceManagementConfiguration", "");
}

export function settingsCatalogPlatformFromGraph(
  platforms?: string | null,
): SettingsCatalogPlatform {
  const value = (platforms ?? "").toLowerCase();
  if (value.includes("macos") || value === "mac") return "macos";
  return "windows";
}

export function catalogDetailFromGraphDefinition(raw: unknown): CatalogSettingDetail | null {
  const map = asRecord(raw);
  const id = textField(map?.id);
  if (!map || !id) return null;
  const applicability = asRecord(map.applicability);
  const keywords = Array.isArray(map.keywords)
    ? map.keywords.filter((item): item is string => typeof item === "string")
    : [];
  const rootDefinitionId = textField(map.rootDefinitionId);
  const options: CatalogSettingOption[] = [];
  const rawOptions = Array.isArray(map.options) ? map.options : [];
  for (const option of rawOptions) {
    const rec = asRecord(option);
    const itemId = textField(rec?.itemId) ?? textField(rec?.name);
    if (!rec || !itemId) continue;
    const dependedOnBy: CatalogDependentRef[] = [];
    const deps = Array.isArray(rec.dependedOnBy) ? rec.dependedOnBy : [];
    for (const dep of deps) {
      if (typeof dep === "string" && dep.trim()) {
        dependedOnBy.push({ settingDefinitionId: dep.trim(), required: false });
        continue;
      }
      const depRec = asRecord(dep);
      const settingDefinitionId =
        textField(depRec?.dependedOnBy) ?? textField(depRec?.settingDefinitionId);
      if (!settingDefinitionId) continue;
      dependedOnBy.push({
        settingDefinitionId,
        required: graphMarksRequired(depRec?.required),
      });
    }
    options.push({
      itemId,
      displayName: textField(rec.displayName) ?? textField(rec.name) ?? itemId,
      description: textField(rec.description),
      isDefault: typeof rec.isDefault === "boolean" ? rec.isDefault : null,
      valueType: asRecord(rec.optionValue)
        ? shortOdataType(textField(asRecord(rec.optionValue)?.["@odata.type"]))
        : null,
      dependedOnBy,
    });
  }

  const valueDefinition = asRecord(map.valueDefinition);
  const defaultValue = asRecord(map.defaultValue);
  let defaultString: string | null = null;
  if (defaultValue && "value" in defaultValue && defaultValue.value != null) {
    defaultString = String(defaultValue.value).trim().replace(/^"|"$/g, "") || null;
  }

  return {
    id,
    displayName: textField(map.displayName) ?? textField(map.name) ?? id,
    description: textField(map.description),
    helpText: textField(map.helpText),
    categoryId: textField(map.categoryId),
    keywords,
    platform: textField(applicability?.platform),
    technologies: textField(applicability?.technologies),
    kind: shortOdataType(textField(map["@odata.type"]) ?? textField(map.kind)),
    visibility: textField(map.visibility),
    rootDefinitionId,
    isRoot: rootDefinitionId == null || rootDefinitionId === id,
    options,
    defaultOptionId: textField(map.defaultOptionId),
    valueType: valueDefinition
      ? shortOdataType(textField(valueDefinition["@odata.type"]))
      : null,
    stringFormat:
      textField(valueDefinition?.format) ?? textField(map.format) ?? null,
    defaultString,
    minValue: typeof valueDefinition?.minimumValue === "number" ? valueDefinition.minimumValue : null,
    maxValue: typeof valueDefinition?.maximumValue === "number" ? valueDefinition.maximumValue : null,
    maximumLength:
      typeof valueDefinition?.maximumLength === "number" ? valueDefinition.maximumLength : null,
    minimumLength:
      typeof valueDefinition?.minimumLength === "number" ? valueDefinition.minimumLength : null,
    minimumCount: typeof map.minimumCount === "number" ? map.minimumCount : null,
    maximumCount: typeof map.maximumCount === "number" ? map.maximumCount : null,
    "@odata.type": textField(map["@odata.type"]) ?? undefined,
    raw: map,
  };
}

export function collectCatalogDetailsFromPolicySettings(
  settings: Record<string, unknown>[],
): Record<string, CatalogSettingDetail> {
  const byId: Record<string, CatalogSettingDetail> = {};
  for (const row of settings) {
    const defs = Array.isArray(row.settingDefinitions) ? row.settingDefinitions : [];
    for (const def of defs) {
      const mapped = catalogDetailFromGraphDefinition(def);
      if (mapped) byId[mapped.id] = mapped;
    }
  }
  return byId;
}

export function settingInstanceFromRow(
  row: Record<string, unknown>,
): Record<string, unknown> | null {
  return asRecord(row.settingInstance) ?? (typeof row.settingDefinitionId === "string" ? row : null);
}

function collectInstanceDefinitionIds(instance: Record<string, unknown>, into: Set<string>): void {
  const id = textField(instance.settingDefinitionId);
  if (id) into.add(id);
  const group = asRecord(instance.groupSettingValue);
  if (group && Array.isArray(group.children)) {
    for (const child of group.children) {
      const childInstance = childInstanceFromValue(child);
      if (childInstance) collectInstanceDefinitionIds(childInstance, into);
    }
  }
  const groupCollection = instance.groupSettingCollectionValue;
  if (Array.isArray(groupCollection)) {
    for (const groupValue of groupCollection) {
      const rec = asRecord(groupValue);
      if (!rec || !Array.isArray(rec.children)) continue;
      for (const child of rec.children) {
        const childInstance = childInstanceFromValue(child);
        if (childInstance) collectInstanceDefinitionIds(childInstance, into);
      }
    }
  }
  const choice = asRecord(instance.choiceSettingValue);
  if (choice && Array.isArray(choice.children)) {
    for (const child of choice.children) {
      const childInstance = childInstanceFromValue(child);
      if (childInstance) collectInstanceDefinitionIds(childInstance, into);
    }
  }
}

/**
 * All definition ids that carry a value on this policy, including nested
 * group/choice children. Used to tell configured settings apart from
 * template settings that are genuinely not configured.
 */
export function collectConfiguredSettingIds(settings: Record<string, unknown>[]): Set<string> {
  const ids = new Set<string>();
  for (const row of settings) {
    const instance = settingInstanceFromRow(row);
    if (instance) collectInstanceDefinitionIds(instance, ids);
  }
  return ids;
}

function childInstanceFromValue(child: unknown): Record<string, unknown> | null {
  const rec = asRecord(child);
  if (!rec) return null;
  return asRecord(rec.settingInstance) ?? rec;
}

function settingDefinitionIdFromInstance(instance: Record<string, unknown> | null): string | null {
  return instance ? textField(instance.settingDefinitionId) : null;
}

export function draftFromSettingInstance(
  instance: Record<string, unknown>,
  detail: CatalogSettingDetail,
  dependents: Record<string, CatalogSettingDetail> = {},
): SettingValueDraft {
  if (Array.isArray(instance.groupSettingCollectionValue)) {
    const rows: GroupCollectionRow[] = [];
    for (const entry of instance.groupSettingCollectionValue) {
      const rec = asRecord(entry);
      const rawChildren = Array.isArray(rec?.children) ? rec.children : [];
      const children: Record<string, SettingValueDraft> = {};
      for (const child of rawChildren) {
        const childInstance = childInstanceFromValue(child);
        const childId = settingDefinitionIdFromInstance(childInstance);
        if (!childId || !childInstance) continue;
        const childDetail = dependents[childId];
        if (!childDetail) {
          children[childId] = {
            kind: "unsupported",
            reason: `Dependent setting “${childId}” definition was not loaded.`,
          };
          continue;
        }
        children[childId] = draftFromSettingInstance(childInstance, childDetail, dependents);
      }
      rows.push({ children });
    }
    return { kind: "groupCollection", rows };
  }

  if (Array.isArray(instance.choiceSettingCollectionValue)) {
    const optionItemIds: string[] = [];
    for (const item of instance.choiceSettingCollectionValue) {
      const rec = asRecord(item);
      const value = textField(rec?.value);
      if (value) optionItemIds.push(value);
    }
    return { kind: "choiceCollection", optionItemIds };
  }

  const choice = asRecord(instance.choiceSettingValue);
  if (choice && typeof choice.value === "string") {
    const children: Record<string, SettingValueDraft> = {};
    const nested = Array.isArray(choice.children) ? choice.children : [];
    for (const child of nested) {
      const childInstance = childInstanceFromValue(child);
      const childId = settingDefinitionIdFromInstance(childInstance);
      if (!childId || !childInstance) continue;
      const childDetail = dependents[childId];
      if (!childDetail) {
        children[childId] = {
          kind: "unsupported",
          reason: `Dependent setting “${childId}” definition was not loaded.`,
        };
        continue;
      }
      children[childId] = draftFromSettingInstance(childInstance, childDetail, dependents);
    }
    for (const dep of dependentsForOption(detail, choice.value, dependents)) {
      if (children[dep.settingDefinitionId]) continue;
      const childDetail = dependents[dep.settingDefinitionId];
      if (!childDetail) continue;
      children[dep.settingDefinitionId] = defaultDraftForSetting(childDetail, dependents);
    }
    return { kind: "choice", optionItemId: choice.value, children };
  }

  if (Array.isArray(instance.simpleSettingCollectionValue)) {
    const values: string[] = [];
    for (const item of instance.simpleSettingCollectionValue) {
      const rec = asRecord(item);
      if (!rec || rec.value == null) continue;
      values.push(String(rec.value));
    }
    return { kind: "simpleCollection", values };
  }

  const simple = asRecord(instance.simpleSettingValue);
  if (simple && "value" in simple) {
    const value = simple.value;
    if (typeof value === "boolean") return { kind: "simple", value };
    if (typeof value === "number") return { kind: "simple", value };
    if (/Boolean/i.test(detail.valueType ?? "")) {
      return { kind: "simple", value: value === true || value === "true" || value === "1" };
    }
    if (/Integer|Number/i.test(detail.valueType ?? "")) {
      const parsed = Number(value);
      return { kind: "simple", value: Number.isFinite(parsed) ? parsed : 0 };
    }
    return { kind: "simple", value: value == null ? "" : String(value) };
  }

  if (isSimpleCollection(detail)) return { kind: "simpleCollection", values: [] };
  if (isSimpleSetting(detail) || (detail.options ?? []).length > 0) {
    return defaultDraftForSetting(detail, dependents);
  }
  return {
    kind: "unsupported",
    reason: `Cannot edit “${detail.displayName}” (${detail.kind || "complex"}) from this inspector yet.`,
  };
}

export type TemplateSettingChild = {
  definitionId: string;
  instanceTemplate: Record<string, unknown>;
  definition: CatalogSettingDetail | null;
};

export type TemplateSettingNode = {
  id: string;
  definitionId: string;
  instanceTemplate: Record<string, unknown>;
  definitions: Record<string, CatalogSettingDetail>;
  children: TemplateSettingChild[];
  /**
   * Every definition id this template setting can write, mapped to its
   * `settingInstanceTemplateId`. Includes group children *and* choice
   * dependents, which Graph requires a template reference for on
   * template-backed policies.
   */
  templateRefs: Record<string, string>;
  /**
   * For a group collection, one entry per template row, each mapping that row's
   * definition ids to their own template ids. Rows are independent, so their
   * refs cannot be flattened into a single map.
   */
  rowTemplateRefs: Array<Record<string, string>>;
};

/**
 * Collect `settingDefinitionId -> settingInstanceTemplateId` from an instance
 * template, walking group and choice value templates so dependents are covered.
 */
function collectTemplateRefs(
  instanceTemplate: Record<string, unknown>,
  into: Record<string, string> = {},
): Record<string, string> {
  const definitionId = textField(instanceTemplate.settingDefinitionId);
  const templateId = textField(instanceTemplate.settingInstanceTemplateId);
  if (definitionId && templateId) into[definitionId] = templateId;

  const nested: unknown[] = [];
  const groupCollection = instanceTemplate.groupSettingCollectionValueTemplate;
  if (Array.isArray(groupCollection)) {
    for (const entry of groupCollection) {
      const rec = asRecord(entry);
      if (rec && Array.isArray(rec.children)) nested.push(...rec.children);
    }
  }
  const group = asRecord(instanceTemplate.groupSettingValueTemplate);
  if (group && Array.isArray(group.children)) nested.push(...group.children);
  const choiceCollection = instanceTemplate.choiceSettingCollectionValueTemplate;
  if (Array.isArray(choiceCollection)) {
    for (const entry of choiceCollection) {
      const rec = asRecord(entry);
      if (rec && Array.isArray(rec.children)) nested.push(...rec.children);
    }
  }
  const choice = asRecord(instanceTemplate.choiceSettingValueTemplate);
  if (choice && Array.isArray(choice.children)) nested.push(...choice.children);

  for (const child of nested) {
    const rec = asRecord(child);
    if (rec) collectTemplateRefs(rec, into);
  }
  return into;
}

/**
 * Per-row template refs for a group collection. Each entry in
 * `groupSettingCollectionValueTemplate` is one row, and its children carry that
 * row's own `settingInstanceTemplateId`s.
 */
function collectRowTemplateRefs(
  instanceTemplate: Record<string, unknown>,
): Array<Record<string, string>> {
  const collection = instanceTemplate.groupSettingCollectionValueTemplate;
  if (!Array.isArray(collection)) return [];
  const rows: Array<Record<string, string>> = [];
  for (const entry of collection) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const refs: Record<string, string> = {};
    const children = Array.isArray(rec.children) ? rec.children : [];
    for (const child of children) {
      const childRec = asRecord(child);
      if (childRec) collectTemplateRefs(childRec, refs);
    }
    rows.push(refs);
  }
  return rows;
}

function templateChildrenFrom(
  instanceTemplate: Record<string, unknown>,
  definitions: Record<string, CatalogSettingDetail>,
): TemplateSettingChild[] {
  const rawChildren: unknown[] = [];
  const collection = instanceTemplate.groupSettingCollectionValueTemplate;
  if (Array.isArray(collection)) {
    for (const entry of collection) {
      const rec = asRecord(entry);
      if (rec && Array.isArray(rec.children)) rawChildren.push(...rec.children);
    }
  }
  const group = asRecord(instanceTemplate.groupSettingValueTemplate);
  if (group && Array.isArray(group.children)) rawChildren.push(...group.children);
  return rawChildren.flatMap((child) => {
    const rec = asRecord(child);
    const definitionId = rec ? textField(rec.settingDefinitionId) : null;
    if (!rec || !definitionId) return [];
    return [
      {
        definitionId,
        instanceTemplate: rec,
        definition: definitions[definitionId] ?? null,
      },
    ];
  });
}

/**
 * Parse a configuration policy template (`…/settingTemplates?$expand=settingDefinitions`)
 * into its top-level settings. Group templates carry their children, and every
 * node's `definitions` map holds that template setting's own definitions
 * (including child and dependent definitions).
 */
export function parseConfigurationPolicyTemplate(raw: unknown): TemplateSettingNode[] {
  const root = asRecord(raw);
  const value = Array.isArray(raw) ? raw : Array.isArray(root?.value) ? root.value : [];
  const nodes: TemplateSettingNode[] = [];
  for (const item of value) {
    const rec = asRecord(item);
    if (!rec) continue;
    const instanceTemplate = asRecord(rec.settingInstanceTemplate);
    const definitionId = instanceTemplate ? textField(instanceTemplate.settingDefinitionId) : null;
    if (!instanceTemplate || !definitionId) continue;
    const definitions: Record<string, CatalogSettingDetail> = {};
    const defs = Array.isArray(rec.settingDefinitions) ? rec.settingDefinitions : [];
    for (const def of defs) {
      const mapped = catalogDetailFromGraphDefinition(def);
      if (mapped) definitions[mapped.id] = mapped;
    }
    nodes.push({
      id: textField(rec.id) ?? definitionId,
      definitionId,
      instanceTemplate,
      definitions,
      children: templateChildrenFrom(instanceTemplate, definitions),
      templateRefs: collectTemplateRefs(instanceTemplate),
      rowTemplateRefs: collectRowTemplateRefs(instanceTemplate),
    });
  }
  return nodes;
}

function collectInstanceIds(instance: Record<string, unknown>, into: Map<string, Record<string, unknown>>): void {
  const id = textField(instance.settingDefinitionId);
  if (id) into.set(id, instance);
  const group = asRecord(instance.groupSettingValue);
  if (group && Array.isArray(group.children)) {
    for (const child of group.children) {
      const childInstance = childInstanceFromValue(child);
      if (childInstance) collectInstanceIds(childInstance, into);
    }
  }
  const groupCollection = instance.groupSettingCollectionValue;
  if (Array.isArray(groupCollection)) {
    for (const groupValue of groupCollection) {
      const rec = asRecord(groupValue);
      if (!rec || !Array.isArray(rec.children)) continue;
      for (const child of rec.children) {
        const childInstance = childInstanceFromValue(child);
        if (childInstance) collectInstanceIds(childInstance, into);
      }
    }
  }
  const choice = asRecord(instance.choiceSettingValue);
  if (choice && Array.isArray(choice.children)) {
    for (const child of choice.children) {
      const childInstance = childInstanceFromValue(child);
      if (childInstance) collectInstanceIds(childInstance, into);
    }
  }
}

/** Current instances keyed by definition id, including nested group/choice children. */
export function collectInstancesByDefinition(
  settings: Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of settings) {
    const instance = settingInstanceFromRow(row);
    if (instance) collectInstanceIds(instance, map);
  }
  return map;
}
