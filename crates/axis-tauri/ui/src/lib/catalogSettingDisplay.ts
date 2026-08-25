export type CatalogDefinitionOption = {
  itemId: string;
  name?: string;
  displayName?: string;
};

export type CatalogDefinitionMeta = {
  id: string;
  displayName?: string;
  name?: string;
  description?: string;
  helpText?: string;
  categoryId?: string | null;
  options: CatalogDefinitionOption[];
  kind?: string;
};

export type FormattedSettingChild = {
  label: string;
  value: string;
  children?: FormattedSettingChild[];
};

export type FormattedSettingRow = {
  key: string;
  definitionId: string;
  displayName: string;
  description?: string;
  valueSummary: string;
  instanceKind: string;
  unsupportedEditor: boolean;
  children: FormattedSettingChild[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function collectionEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (record && Array.isArray(record.value)) return record.value;
  return [];
}

function isLocalizationKey(value?: string | null): boolean {
  if (!value?.trim()) return true;
  const trimmed = value.trim();
  return /^l[_/]/i.test(trimmed) || /^l[A-Z]/.test(trimmed);
}

function preferredLabel(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate?.trim() && !isLocalizationKey(candidate)) return candidate.trim();
  }
  return null;
}

function titleCaseWords(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      const known: Record<string, string> = {
        mdm: "MDM",
        id: "ID",
        url: "URL",
        uri: "URI",
        os: "OS",
        wifi: "Wi-Fi",
        vpn: "VPN",
        bitlocker: "BitLocker",
        defender: "Defender",
      };
      if (known[lower]) return known[lower];
      if (/^\d+$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export function humanizeSettingToken(value: string, definitionId?: string): string {
  let token = value.trim();
  if (!token) return "(empty)";
  if (definitionId) {
    if (token.startsWith(`${definitionId}_`)) token = token.slice(definitionId.length + 1);
    else if (token.startsWith(definitionId)) token = token.slice(definitionId.length).replace(/^_+/, "");
  }
  if (token.includes("device_vendor_")) {
    const match = token.match(/_([a-z0-9]+)$/i);
    if (match) token = match[1];
  }
  const lower = token.toLowerCase();
  const literals: Record<string, string> = {
    true: "Enabled",
    false: "Disabled",
    enabled: "Enabled",
    disabled: "Disabled",
    allow: "Allow",
    block: "Block",
    notconfigured: "Not configured",
    not_configured: "Not configured",
    userdefined: "User defined",
    devicedefault: "Device default",
  };
  if (literals[lower]) return literals[lower];
  const parts = token.split("_").filter(Boolean);
  const tail = parts.length > 4 ? parts.slice(-3).join(" ") : parts.join(" ") || token;
  return titleCaseWords(tail.replace(/([a-z])([A-Z])/g, "$1 $2"));
}

function shortInstanceKind(odataType: unknown): string {
  const raw = typeof odataType === "string" ? odataType : "";
  return raw
    .replace("#microsoft.graph.deviceManagementConfiguration", "")
    .replace("SettingInstance", "")
    .replace(/^./, (ch) => ch.toLowerCase()) || "setting";
}

function parseDefinition(raw: unknown): CatalogDefinitionMeta | null {
  const record = asRecord(raw);
  const id = text(record?.id);
  if (!record || !id) return null;
  const options: CatalogDefinitionOption[] = [];
  const rawOptions = Array.isArray(record.options) ? record.options : [];
  for (const option of rawOptions) {
    const item = asRecord(option);
    const itemId = text(item?.itemId) ?? text(item?.name);
    if (!item || !itemId) continue;
    options.push({
      itemId,
      name: text(item.name) ?? undefined,
      displayName: text(item.displayName) ?? undefined,
    });
  }
  return {
    id,
    displayName: text(record.displayName) ?? undefined,
    name: text(record.name) ?? undefined,
    description: text(record.description) ?? undefined,
    helpText: text(record.helpText) ?? undefined,
    categoryId: text(record.categoryId),
    options,
    kind: text(record["@odata.type"]) ?? text(record.kind) ?? undefined,
  };
}

function collectDefinitions(settings: Record<string, unknown>[]): Map<string, CatalogDefinitionMeta> {
  const definitions = new Map<string, CatalogDefinitionMeta>();
  for (const row of settings) {
    const defs = Array.isArray(row.settingDefinitions) ? row.settingDefinitions : [];
    for (const def of defs) {
      const parsed = parseDefinition(def);
      if (parsed) definitions.set(parsed.id, parsed);
    }
  }
  return definitions;
}

function optionLabel(
  optionId: string,
  definition: CatalogDefinitionMeta | undefined,
  definitionId: string,
): string {
  const match =
    definition?.options.find((option) => option.itemId === optionId) ||
    definition?.options.find((option) => option.itemId.toLowerCase() === optionId.toLowerCase()) ||
    definition?.options.find((option) => option.name === optionId);
  return (
    preferredLabel(match?.displayName, match?.name) || humanizeSettingToken(optionId, definitionId)
  );
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (typeof value === "number") return String(value);
  return String(value);
}

function childInstance(child: unknown): Record<string, unknown> | null {
  const record = asRecord(child);
  if (!record) return null;
  return asRecord(record.settingInstance) ?? record;
}

function summarizeChildren(
  children: unknown[],
  definitions: Map<string, CatalogDefinitionMeta>,
): FormattedSettingChild[] {
  return children.flatMap((child) => {
    const instance = childInstance(child);
    if (!instance) return [];
    const summary = summarizeInstance(instance, definitions);
    return [
      {
        label: summary.displayName,
        value: summary.valueSummary,
        children: summary.children.length ? summary.children : undefined,
      },
    ];
  });
}

function summarizeInstance(
  instance: Record<string, unknown>,
  definitions: Map<string, CatalogDefinitionMeta>,
): {
  displayName: string;
  description?: string;
  valueSummary: string;
  instanceKind: string;
  unsupportedEditor: boolean;
  children: FormattedSettingChild[];
  definitionId: string;
} {
  const definitionId = text(instance.settingDefinitionId) ?? "unknown";
  const def = definitions.get(definitionId);
  const displayName =
    preferredLabel(def?.displayName, def?.name) ||
    (definitionId !== "unknown" ? humanizeSettingToken(definitionId) : "Unknown setting");
  const description = preferredLabel(def?.description, def?.helpText) ?? undefined;
  const instanceKind = shortInstanceKind(instance["@odata.type"]);

  const choice = asRecord(instance.choiceSettingValue);
  if (choice && typeof choice.value === "string") {
    const option = optionLabel(choice.value, def, definitionId);
    const nested = summarizeChildren(Array.isArray(choice.children) ? choice.children : [], definitions);
    const nestedSummary = nested.map((item) => `${item.label}: ${item.value}`).join("; ");
    return {
      definitionId,
      displayName,
      description,
      valueSummary: nestedSummary ? `${option} · ${nestedSummary}` : option,
      instanceKind,
      unsupportedEditor: false,
      children: nested,
    };
  }

  const simple = asRecord(instance.simpleSettingValue);
  if (simple && "value" in simple) {
    return {
      definitionId,
      displayName,
      description,
      valueSummary: formatPrimitive(simple.value),
      instanceKind,
      unsupportedEditor: false,
      children: [],
    };
  }

  const group = asRecord(instance.groupSettingValue);
  if (group) {
    const rawChildren = Array.isArray(group.children) ? group.children : [];
    const nested = summarizeChildren(rawChildren, definitions);
    return {
      definitionId,
      displayName,
      description,
      valueSummary:
        nested.length > 0
          ? nested
              .slice(0, 4)
              .map((item) => `${item.label}: ${item.value}`)
              .join("; ") + (nested.length > 4 ? ` (+${nested.length - 4} more)` : "")
          : rawChildren.length
            ? `${rawChildren.length} nested setting${rawChildren.length === 1 ? "" : "s"}`
            : "Empty group",
      instanceKind,
      unsupportedEditor: /group/i.test(instanceKind),
      children: nested,
    };
  }

  if (instance.simpleSettingCollectionValue != null) {
    const values = collectionEntries(instance.simpleSettingCollectionValue).map((item) => {
      const record = asRecord(item);
      return formatPrimitive(record?.value ?? item);
    });
    const children = values.map((value, index) => ({
      label: `Value ${index + 1}`,
      value,
    }));
    return {
      definitionId,
      displayName,
      description,
      valueSummary:
        values.length === 0
          ? "No values"
          : values.length <= 4
            ? values.join(", ")
            : `${values.slice(0, 4).join(", ")} (+${values.length - 4} more)`,
      instanceKind,
      unsupportedEditor: false,
      children,
    };
  }

  if (instance.choiceSettingCollectionValue != null) {
    const labels = collectionEntries(instance.choiceSettingCollectionValue).map((item) => {
      const record = asRecord(item);
      const value = String(record?.value ?? item);
      return optionLabel(value, def, definitionId);
    });
    const children = labels.map((value, index) => ({
      label: `Selection ${index + 1}`,
      value,
    }));
    return {
      definitionId,
      displayName,
      description,
      valueSummary:
        labels.length === 0
          ? "No selections"
          : labels.length <= 4
            ? labels.join(", ")
            : `${labels.slice(0, 4).join(", ")} (+${labels.length - 4} more)`,
      instanceKind,
      unsupportedEditor: false,
      children,
    };
  }

  if (instance.groupSettingCollectionValue != null) {
    const groups = collectionEntries(instance.groupSettingCollectionValue);
    const children = groups.map((groupValue, index) => {
      const record = asRecord(groupValue);
      const rawChildren = Array.isArray(record?.children) ? record.children : [];
      const nested = summarizeChildren(rawChildren, definitions);
      return {
        label: `Group ${index + 1}`,
        value:
          nested.length > 0
            ? nested.map((item) => `${item.label}: ${item.value}`).join("; ")
            : rawChildren.length
              ? `${rawChildren.length} nested setting${rawChildren.length === 1 ? "" : "s"}`
              : "Empty group",
        children: nested.length ? nested : undefined,
      };
    });
    return {
      definitionId,
      displayName,
      description,
      valueSummary:
        groups.length === 0
          ? "No groups"
          : `${groups.length} group${groups.length === 1 ? "" : "s"}`,
      instanceKind,
      unsupportedEditor: true,
      children,
    };
  }

  return {
    definitionId,
    displayName,
    description,
    valueSummary: "Configured",
    instanceKind,
    unsupportedEditor: /group|collection/i.test(instanceKind),
    children: [],
  };
}

export function looksLikeSettingsCatalogRows(settings: Record<string, unknown>[]): boolean {
  return settings.some((row) => Boolean(asRecord(row.settingInstance) ?? row.settingDefinitionId));
}

export function formatCatalogSettingRows(settings: Record<string, unknown>[]): FormattedSettingRow[] {
  const definitions = collectDefinitions(settings);
  return settings.flatMap((row, index) => {
    const instance = asRecord(row.settingInstance) ?? (row.settingDefinitionId ? row : null);
    if (!instance) return [];
    const summary = summarizeInstance(instance, definitions);
    return [
      {
        key: text(row.id) ?? `${summary.definitionId}::${index}`,
        definitionId: summary.definitionId,
        displayName: summary.displayName,
        description: summary.description,
        valueSummary: summary.valueSummary,
        instanceKind: summary.instanceKind,
        unsupportedEditor: summary.unsupportedEditor,
        children: summary.children,
      },
    ];
  });
}

export type FormattedAdmxRow = {
  key: string;
  displayName: string;
  description?: string;
  valueSummary: string;
  children: FormattedSettingChild[];
};

export function looksLikeAdmxDefinitionValues(settings: Record<string, unknown>[]): boolean {
  return settings.some((row) => Boolean(asRecord(row.definition) || typeof row.enabled === "boolean"));
}

export function formatAdmxDefinitionValues(settings: Record<string, unknown>[]): FormattedAdmxRow[] {
  return settings.map((row, index) => {
    const definition = asRecord(row.definition);
    const displayName =
      preferredLabel(text(definition?.displayName), text(definition?.name)) ||
      text(row.id) ||
      `Setting ${index + 1}`;
    const description = preferredLabel(text(definition?.explainText), text(definition?.categoryPath)) ?? undefined;
    const enabled = row.enabled;
    const state =
      typeof enabled === "boolean" ? (enabled ? "Enabled" : "Disabled") : "Configured";
    const presentations = Array.isArray(row.presentationValues) ? row.presentationValues : [];
    const children = presentations.flatMap((item, presentationIndex) => {
      const record = asRecord(item);
      if (!record) return [];
      const presentation = asRecord(record.presentation);
      const label =
        preferredLabel(text(presentation?.label), text(presentation?.displayName)) ||
        `Value ${presentationIndex + 1}`;
      return [{ label, value: formatPrimitive(record.value) }];
    });
    const valueSummary =
      children.length > 0
        ? `${state} · ${children.map((item) => `${item.label}: ${item.value}`).join("; ")}`
        : state;
    return {
      key: text(row.id) ?? `admx-${index}`,
      displayName,
      description,
      valueSummary,
      children,
    };
  });
}
