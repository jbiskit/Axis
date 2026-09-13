/** Graph-declared default on a Settings Catalog definition (never inferred). */
export type GraphDefaultSource = {
  defaultOptionId?: string | null;
  defaultString?: string | null;
  options?: Array<{ itemId: string; isDefault?: boolean | null }>;
};

export type ConfiguredSettingValue =
  | { kind: "choice"; optionItemId: string }
  | { kind: "choiceCollection"; optionItemIds: string[] }
  | { kind: "groupCollection"; rows: Array<{ children: Record<string, unknown> }> }
  | { kind: "simple"; value: string | number | boolean }
  | { kind: "simpleCollection"; values: string[] };

/** Official choice default: `defaultOptionId`, else an option with Graph `isDefault`. */
export function graphDefaultOptionId(source: GraphDefaultSource): string | null {
  const options = source.options ?? [];
  const fromField = source.defaultOptionId?.trim();
  if (fromField && options.some((option) => option.itemId === fromField)) return fromField;
  return options.find((option) => option.isDefault === true)?.itemId ?? null;
}

export function graphHasDeclaredDefault(source: GraphDefaultSource): boolean {
  if (graphDefaultOptionId(source)) return true;
  return source.defaultString != null;
}

function simpleValuesMatch(configured: unknown, defaultString: string): boolean {
  if (typeof configured === "number" && Number.isFinite(configured)) {
    const parsed = Number(defaultString);
    if (Number.isFinite(parsed)) return configured === parsed;
  }
  if (typeof configured === "boolean") {
    const normalized = defaultString.trim().toLowerCase();
    return configured ? normalized === "true" || normalized === "1" : normalized === "false" || normalized === "0";
  }
  const left = String(configured ?? "")
    .trim()
    .replace(/^"|"$/g, "")
    .toLowerCase();
  const right = defaultString.trim().replace(/^"|"$/g, "").toLowerCase();
  return left === right;
}

/**
 * True when a configured value equals the Graph definition default.
 * Returns false when Graph did not declare a default (do not infer).
 */
export function configuredValueMatchesGraphDefault(
  source: GraphDefaultSource,
  configured: ConfiguredSettingValue,
): boolean {
  if (configured.kind === "choice") {
    const defaultId = graphDefaultOptionId(source);
    return defaultId != null && configured.optionItemId === defaultId;
  }
  if (configured.kind === "choiceCollection") {
    const defaultId = graphDefaultOptionId(source);
    if (defaultId == null) return false;
    return (
      configured.optionItemIds.length === 1 && configured.optionItemIds[0] === defaultId
    );
  }
  // A group collection is a list of rows; "default" is not a meaningful
  // comparison for it, so never claim it matches.
  if (configured.kind === "groupCollection") return false;
  const defaultString = source.defaultString;
  if (defaultString == null) return false;
  if (configured.kind === "simple") return simpleValuesMatch(configured.value, defaultString);
  const filled = configured.values.map((value) => value.trim()).filter(Boolean);
  return filled.length === 1 && simpleValuesMatch(filled[0], defaultString);
}
