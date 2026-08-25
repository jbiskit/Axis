import { humanizeSettingToken } from "../catalogSettingDisplay";

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function collectionEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (record && Array.isArray(record.value)) return record.value;
  return [];
}

export type SettingLeaf = {
  definitionId: string;
  displayName?: string;
  valueSummary: string;
  rawValue?: string;
  presentOnly?: boolean;
};

function formatPrimitive(value: unknown, definitionId: string): { summary: string; raw: string } {
  if (typeof value === "boolean") {
    return { summary: value ? "Enabled" : "Disabled", raw: String(value) };
  }
  const raw = String(value ?? "");
  return { summary: humanizeSettingToken(raw, definitionId), raw };
}

function leafFromInstance(
  instance: Record<string, unknown>,
  definitionId: string,
  displayName?: string,
): SettingLeaf | null {
  const simple = asRecord(instance.simpleSettingValue);
  if (simple && "value" in simple) {
    const formatted = formatPrimitive(simple.value, definitionId);
    return { definitionId, displayName, valueSummary: formatted.summary, rawValue: formatted.raw };
  }

  const choice = asRecord(instance.choiceSettingValue);
  if (choice && "value" in choice) {
    const formatted = formatPrimitive(choice.value, definitionId);
    return { definitionId, displayName, valueSummary: formatted.summary, rawValue: formatted.raw };
  }

  if (instance.simpleSettingCollectionValue != null) {
    const values = collectionEntries(instance.simpleSettingCollectionValue).map((entry) => {
      const rec = asRecord(entry);
      return String(rec?.value ?? entry);
    });
    if (values.length > 0 && values.every((value) => /^(Name:|OMA-URI:|IsEncrypted:)/i.test(value.trim()))) {
      return { definitionId, displayName, valueSummary: "Present", rawValue: values.join(" | "), presentOnly: true };
    }
    return {
      definitionId,
      displayName,
      valueSummary: values.length === 0 ? "No values" : values.join(", "),
      rawValue: values.join(" | "),
    };
  }

  if (instance.choiceSettingCollectionValue != null) {
    const values = collectionEntries(instance.choiceSettingCollectionValue).map((entry) => {
      const rec = asRecord(entry);
      return humanizeSettingToken(String(rec?.value ?? entry), definitionId);
    });
    return {
      definitionId,
      displayName,
      valueSummary: values.length === 0 ? "No selections" : values.join(", "),
      rawValue: values.join(" | "),
    };
  }

  return null;
}

function walkChildren(children: unknown, out: SettingLeaf[], names: Map<string, string>): void {
  if (!Array.isArray(children)) return;
  for (const child of children) {
    const rec = asRecord(child);
    walkInstance(rec?.settingInstance ? asRecord(rec.settingInstance) : rec, out, names);
  }
}

export function walkInstance(
  instance: Record<string, unknown> | null,
  out: SettingLeaf[],
  names: Map<string, string> = new Map(),
): void {
  if (!instance) return;
  const definitionId =
    typeof instance.settingDefinitionId === "string" ? instance.settingDefinitionId : "";
  if (!definitionId) return;

  const leaf = leafFromInstance(instance, definitionId, names.get(definitionId));
  if (leaf) out.push(leaf);

  walkChildren(asRecord(instance.choiceSettingValue)?.children, out, names);
  walkChildren(asRecord(instance.groupSettingValue)?.children, out, names);
  for (const entry of collectionEntries(instance.groupSettingCollectionValue)) {
    walkChildren(asRecord(entry)?.children, out, names);
  }
  for (const entry of collectionEntries(instance.choiceSettingCollectionValue)) {
    walkChildren(asRecord(entry)?.children, out, names);
  }
}

export function definitionNamesFromRow(row: Record<string, unknown>): Map<string, string> {
  const names = new Map<string, string>();
  const defs = Array.isArray(row.settingDefinitions) ? row.settingDefinitions : [];
  for (const def of defs) {
    const rec = asRecord(def);
    const id = typeof rec?.id === "string" ? rec.id : "";
    const label =
      (typeof rec?.displayName === "string" && rec.displayName.trim()) ||
      (typeof rec?.name === "string" && rec.name.trim()) ||
      "";
    if (id && label) names.set(id, label);
  }
  return names;
}

export function leavesFromSettingRows(rows: unknown[]): SettingLeaf[] {
  const out: SettingLeaf[] = [];
  for (const row of rows) {
    const rec = asRecord(row);
    if (!rec) continue;
    const instance = asRecord(rec.settingInstance) ?? rec;
    walkInstance(instance, out, definitionNamesFromRow(rec));
  }
  return out;
}
