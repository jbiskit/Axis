import type {
  CatalogCategory,
  CatalogDependentRef,
  CatalogPolicySummary,
  CatalogSettingDetail,
  CatalogSettingOption,
  SettingsCatalogPlatform,
} from "../types/inventory";
import { matchesIntunePlatform } from "./platforms";

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
  const byId = new Map(categories.map((category) => [category.id, category]));
  const ancestors: string[] = [];
  let current = byId.get(categoryId);
  while (
    current?.parentCategoryId &&
    current.parentCategoryId !== NIL_CATEGORY_PARENT_ID &&
    current.parentCategoryId !== current.id
  ) {
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
  const byId = new Map(categories.map((category) => [category.id, category]));
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
  | { kind: "simple"; value: string | number | boolean }
  | { kind: "simpleCollection"; values: string[] }
  | { kind: "unsupported"; reason: string };

function isGroupCollection(detail: CatalogSettingDetail): boolean {
  return /settingGroup/i.test(detail.kind) || /SettingGroup/i.test(detail["@odata.type"] ?? "");
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

function dependentsForOption(detail: CatalogSettingDetail, optionItemId: string) {
  return detail.options.find((option) => option.itemId === optionItemId)?.dependedOnBy ?? [];
}

export function defaultDraftForSetting(
  detail: CatalogSettingDetail,
  dependents: Record<string, CatalogSettingDetail> = {},
): SettingValueDraft {
  if (isGroupCollection(detail)) {
    return {
      kind: "unsupported",
      reason: `“${detail.displayName}” is a ${detail.kind || "group collection"} setting — the row is listed like the portal, but this editor is not ported yet.`,
    };
  }
  if (detail.options.length > 0) {
    const preferred =
      (detail.defaultOptionId &&
        detail.options.find((option) => option.itemId === detail.defaultOptionId)?.itemId) ||
      detail.options.find((option) => /enabled|allow|yes/i.test(`${option.displayName} ${option.itemId}`))
        ?.itemId ||
      detail.options[0]!.itemId;
    const children: Record<string, SettingValueDraft> = {};
    for (const dep of dependentsForOption(detail, preferred)) {
      const child = dependents[dep.settingDefinitionId];
      if (child) children[dep.settingDefinitionId] = defaultDraftForSetting(child, dependents);
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
  for (const dep of dependentsForOption(detail, optionItemId)) {
    const child = dependents[dep.settingDefinitionId];
    if (!child) continue;
    const prior = previous?.kind === "choice" ? previous.children[dep.settingDefinitionId] : undefined;
    children[dep.settingDefinitionId] = prior ?? defaultDraftForSetting(child, dependents);
  }
  return { kind: "choice", optionItemId, children };
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
): Record<string, unknown> {
  if (draft.kind === "unsupported") throw new Error(draft.reason);
  if (draft.kind === "choice") {
    const children: Record<string, unknown>[] = [];
    for (const dep of dependentsForOption(detail, draft.optionItemId)) {
      const childDetail = dependents[dep.settingDefinitionId];
      const childDraft = draft.children[dep.settingDefinitionId];
      if (!childDetail || !childDraft) {
        if (dep.required) {
          throw new Error(`“${detail.displayName}” requires a value for “${dep.settingDefinitionId}”.`);
        }
        continue;
      }
      children.push(buildSettingInstance(childDetail, childDraft, dependents));
    }
    return {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance",
      settingDefinitionId: detail.id,
      choiceSettingValue: {
        "@odata.type": "#microsoft.graph.deviceManagementConfigurationChoiceSettingValue",
        value: draft.optionItemId,
        children,
      },
    };
  }
  if (draft.kind === "simpleCollection") {
    const filled = draft.values.map((value) => value.trim()).filter(Boolean);
    return {
      "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingCollectionInstance",
      settingDefinitionId: detail.id,
      simpleSettingCollectionValue: filled.map((value) => simpleValuePayload(detail, value)),
    };
  }
  return {
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance",
    settingDefinitionId: detail.id,
    simpleSettingValue: simpleValuePayload(detail, draft.value),
  };
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

function groupInstanceChildren(instance: Record<string, unknown>): Record<string, unknown>[] {
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

function mergeGroupInstances(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const children: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const child of [...groupInstanceChildren(existing), ...groupInstanceChildren(incoming)]) {
    const id = instanceDefinitionId(child) ?? JSON.stringify(child);
    if (seen.has(id)) {
      const index = children.findIndex((row) => instanceDefinitionId(row) === id);
      if (index >= 0) children[index] = child;
      continue;
    }
    seen.add(id);
    children.push(child);
  }
  const definitionId = instanceDefinitionId(incoming) ?? instanceDefinitionId(existing);
  if (existing.groupSettingCollectionValue != null || incoming.groupSettingCollectionValue != null) {
    return {
      "@odata.type":
        "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance",
      settingDefinitionId: definitionId,
      groupSettingCollectionValue: [groupSettingValue(children)],
    };
  }
  return {
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingInstance",
    settingDefinitionId: definitionId,
    groupSettingValue: groupSettingValue(children),
  };
}

/** Nest a leaf under its Apple/group parent so Graph accepts the policy. */
export function wrapSettingInstanceForPolicy(
  instance: Record<string, unknown>,
  detail: CatalogSettingDetail,
  byId: Record<string, CatalogSettingDetail> = {},
): Record<string, unknown> {
  const parentId = detail.rootDefinitionId?.trim();
  if (!parentId || parentId === detail.id) return instance;
  if (instanceDefinitionId(instance) === parentId) return instance;

  const parent = byId[parentId];
  const synthetic = isSyntheticTopLevelGroupId(parentId);
  const parentIsGroup = parent
    ? /settingGroup/i.test(parent.kind) || /SettingGroup/i.test(parent["@odata.type"] ?? "")
    : false;
  if (!synthetic && !parentIsGroup) return instance;

  const asCollection =
    synthetic ||
    /collection/i.test(parent?.kind ?? "") ||
    /Collection/i.test(parent?.["@odata.type"] ?? "");
  if (asCollection) {
    return {
      "@odata.type":
        "#microsoft.graph.deviceManagementConfigurationGroupSettingCollectionInstance",
      settingDefinitionId: parentId,
      groupSettingCollectionValue: [groupSettingValue([instance])],
    };
  }
  return {
    "@odata.type": "#microsoft.graph.deviceManagementConfigurationGroupSettingInstance",
    settingDefinitionId: parentId,
    groupSettingValue: groupSettingValue([instance]),
  };
}

/** Wrap Apple parents and merge siblings that share a group collection. */
export function instancesReadyForGraph(
  rows: Array<{
    instance: Record<string, unknown>;
    detail: CatalogSettingDetail;
    byId?: Record<string, CatalogSettingDetail>;
  }>,
): Record<string, unknown>[] {
  const wrapped = rows.map((row) =>
    wrapSettingInstanceForPolicy(row.instance, row.detail, {
      ...(row.byId ?? {}),
      [row.detail.id]: row.detail,
    }),
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

export function collectDependentIds(detail: CatalogSettingDetail): string[] {
  return [...new Set(detail.options.flatMap((option) => option.dependedOnBy.map((dep) => dep.settingDefinitionId)))];
}

export function bundleFromCategoryMap(
  settingId: string,
  byId: Record<string, CatalogSettingDetail>,
): { detail: CatalogSettingDetail; dependents: Record<string, CatalogSettingDetail> } | null {
  const detail = byId[settingId];
  if (!detail) return null;
  const dependents: Record<string, CatalogSettingDetail> = {};
  const queue = [...collectDependentIds(detail)];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || id === detail.id) continue;
    seen.add(id);
    const child = byId[id];
    if (!child) continue;
    dependents[id] = child;
    queue.push(...collectDependentIds(child));
  }
  return { detail, dependents };
}

export function draftValueSummary(
  detail: CatalogSettingDetail,
  draft: SettingValueDraft,
  _dependents: Record<string, CatalogSettingDetail>,
): string {
  if (draft.kind === "unsupported") return "Not configurable";
  if (draft.kind === "simple") {
    if (typeof draft.value === "boolean") return draft.value ? "True" : "False";
    return String(draft.value).trim() || "No value entered";
  }
  if (draft.kind === "simpleCollection") {
    const values = draft.values.map((value) => value.trim()).filter(Boolean);
    return values.length ? `${values.length} value(s)` : "No values added";
  }
  const option =
    detail.options.find((candidate) => candidate.itemId === draft.optionItemId)?.displayName ?? draft.optionItemId;
  return option;
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
        dependedOnBy.push({ settingDefinitionId: dep.trim(), required: true });
        continue;
      }
      const depRec = asRecord(dep);
      const settingDefinitionId =
        textField(depRec?.dependedOnBy) ?? textField(depRec?.settingDefinitionId);
      if (!settingDefinitionId) continue;
      dependedOnBy.push({
        settingDefinitionId,
        required: depRec?.required !== false,
      });
    }
    options.push({
      itemId,
      displayName: textField(rec.displayName) ?? textField(rec.name) ?? itemId,
      description: textField(rec.description),
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
    for (const dep of dependentsForOption(detail, choice.value)) {
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
  if (isSimpleSetting(detail) || detail.options.length > 0) {
    return defaultDraftForSetting(detail, dependents);
  }
  return {
    kind: "unsupported",
    reason: `Cannot edit “${detail.displayName}” (${detail.kind || "complex"}) from this inspector yet.`,
  };
}
