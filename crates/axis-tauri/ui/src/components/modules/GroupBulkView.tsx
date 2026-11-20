import { useCallback, useEffect, useMemo, useState } from "react";
import { createDirectoryGroup, exportDirectoryGroups, saveTextFile } from "../../lib/tauri";
import { WriteActionButton } from "../../lib/readOnly";
import type { CreateGroupMembership } from "../../types/inventory";
import { PageHeader, Panel, PanelHead } from "../ui/PageChrome";
import { BooleanToggle } from "../workbench/BooleanToggle";
import { SelectCheckbox, useCheckedIds } from "../workbench/PolicyBulkAssign";
import "../../styles/ca-viewer.css";

type Raw = Record<string, unknown>;
type Kind = CreateGroupMembership;
type Draft = {
  key: string;
  source: string;
  displayName: string;
  description: string;
  kind: Kind;
  rule: string;
  paused: boolean;
  notes: string[];
  status?: "creating" | "created" | "error";
  message?: string;
};

const KIND_LABEL: Record<Kind, string> = { assigned: "Assigned", dynamicUser: "Dynamic user", dynamicDevice: "Dynamic device" };
const CSV_COLUMNS = ["displayName", "description", "membershipType", "membershipRule", "membershipRuleProcessingState"];

/** Which object a rule filters on, from its `user.` / `device.` properties; "mixed" when it uses both. */
function ruleKind(rule: string): Kind | "mixed" | null {
  const user = /(^|[\s(])user\./i.test(rule);
  const device = /(^|[\s(])device\./i.test(rule);
  return user && device ? "mixed" : user ? "dynamicUser" : device ? "dynamicDevice" : null;
}

const groupTypes = (raw: Raw) => (Array.isArray(raw.groupTypes) ? raw.groupTypes.map(String) : []);
function kindOf(raw: Raw): Kind {
  const rule = String(raw.membershipRule ?? "");
  if (!groupTypes(raw).includes("DynamicMembership") && !rule) return "assigned";
  const found = ruleKind(rule);
  return found === "dynamicDevice" ? "dynamicDevice" : "dynamicUser";
}

/** Case-insensitive field lookup, so CSV headers like "Name" or "rule" work. */
function pick(record: Raw, ...names: string[]): string {
  const wanted = names.map((name) => name.toLowerCase());
  const entry = Object.entries(record).find(([key]) => wanted.includes(key.toLowerCase()));
  return entry && entry[1] !== null && entry[1] !== undefined ? String(entry[1]).trim() : "";
}

let nextKey = 0;
/** Raw Graph group, an Axis export row, or a CSV row → draft. */
function toDraft(record: Raw, source: string): Draft {
  const rule = pick(record, "membershipRule", "rule", "dynamicRule");
  const type = pick(record, "membershipType", "membership", "type").toLowerCase().replace(/[\s_-]/g, "");
  const kind: Kind =
    type === "assigned"
      ? "assigned"
      : type === "dynamicuser"
        ? "dynamicUser"
        : type === "dynamicdevice"
          ? "dynamicDevice"
          : type === "dynamic"
            ? ruleKind(rule) === "dynamicDevice"
              ? "dynamicDevice"
              : "dynamicUser"
            : kindOf({ ...record, membershipRule: rule });
  const notes: string[] = [];
  if (groupTypes(record).includes("Unified") || record.mailEnabled === true) notes.push("Created as a security group; mail and Microsoft 365 settings aren't copied");
  return {
    key: `group-${nextKey++}`,
    source,
    displayName: pick(record, "displayName", "name", "groupName"),
    description: pick(record, "description"),
    kind,
    rule,
    paused: /paused/i.test(pick(record, "membershipRuleProcessingState", "processingState", "processing")),
    notes,
  };
}

/** RFC 4180-style CSV: quoted fields may hold commas, quotes ("") and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      rows[rows.length - 1].push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      rows[rows.length - 1].push(field);
      field = "";
      rows.push([]);
    } else field += char;
  }
  rows[rows.length - 1].push(field);
  return rows.filter((row) => row.some((value) => value.trim()));
}

function parseGroups(text: string): Raw[] {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed: unknown = JSON.parse(trimmed);
    const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Raw) : {};
    const list = Array.isArray(parsed) ? parsed : Array.isArray(record.value) ? record.value : [parsed];
    return list.filter((item): item is Raw => Boolean(item) && typeof item === "object");
  }
  const [header, ...rows] = parseCsv(trimmed);
  if (!header) return [];
  return rows.map((row) => Object.fromEntries(header.map((name, index) => [name.trim(), row[index] ?? ""])));
}

const csvCell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
function toCsv(groups: Raw[]): string {
  const lines = groups.map((group) =>
    [
      String(group.displayName ?? ""),
      String(group.description ?? ""),
      kindOf(group),
      String(group.membershipRule ?? ""),
      String(group.membershipRuleProcessingState ?? ""),
    ]
      .map(csvCell)
      .join(","),
  );
  return [CSV_COLUMNS.join(","), ...lines].join("\r\n");
}

/** Bulk export (raw Graph JSON or CSV) and import of Entra groups, including dynamic user and device rules. */
export function GroupBulkView({ eyebrow }: { eyebrow: string }) {
  const [groups, setGroups] = useState<Raw[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | Kind>("all");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [paste, setPaste] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    exportDirectoryGroups()
      .then((rows) => setGroups(rows.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)))))
      .catch((error) => setLoadError(String(error)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups.filter(
      (group) =>
        (kindFilter === "all" || kindOf(group) === kindFilter) &&
        (!needle || `${group.displayName} ${group.description ?? ""} ${group.membershipRule ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [groups, query, kindFilter]);
  const groupSelection = useCheckedIds(visible.map((group) => String(group.id)));
  const selectedGroups = visible.filter((group) => groupSelection.checkedIds.has(String(group.id)));
  const draftSelection = useCheckedIds(drafts.map((draft) => draft.key));
  const selectedDrafts = drafts.filter((draft) => draftSelection.checkedIds.has(draft.key));

  const existing = useMemo(() => new Set(groups.map((group) => String(group.displayName ?? "").trim().toLowerCase())), [groups]);
  const update = (key: string, change: Partial<Draft>) => setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...change } : draft)));
  const addText = (text: string, source: string) => {
    try {
      const found = parseGroups(text).map((record) => toDraft(record, source));
      if (!found.length) throw new Error("No groups found.");
      setDrafts((current) => [...current, ...found]);
      setImportError(null);
    } catch (error) {
      setImportError(`${source}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const checks = (draft: Draft) => {
    const notes = [...draft.notes];
    const name = draft.displayName.trim().toLowerCase();
    if (!name) notes.push("Needs a name");
    else if (existing.has(name)) notes.push("A group with this name already exists");
    if (name && drafts.filter((other) => other.displayName.trim().toLowerCase() === name).length > 1) notes.push("Same name as another draft");
    if (draft.kind === "assigned") {
      if (draft.rule.trim()) notes.push("Rule is ignored for assigned groups");
      return notes;
    }
    const found = ruleKind(draft.rule);
    if (!draft.rule.trim()) notes.push("Needs a membership rule");
    else if (found === "mixed") notes.push("Rule mixes user. and device. properties");
    else if (found && found !== draft.kind) notes.push(`Rule filters ${found === "dynamicUser" ? "users" : "devices"}; type is ${KIND_LABEL[draft.kind]}`);
    return notes;
  };

  const createSelected = async () => {
    setBusy(true);
    // One at a time keeps Graph throttling and the per-row status readable.
    for (const draft of selectedDrafts.filter((item) => item.status !== "created")) {
      update(draft.key, { status: "creating", message: undefined });
      try {
        const response = await createDirectoryGroup({
          displayName: draft.displayName,
          description: draft.description || null,
          membership: draft.kind,
          membershipRule: draft.kind === "assigned" ? null : draft.rule,
          membershipRuleProcessingState: draft.kind === "assigned" ? null : draft.paused ? "Paused" : "On",
        });
        if (response.error || !response.group) throw new Error(response.error ?? "Graph returned no group.");
        update(draft.key, { status: "created", message: response.group.id });
      } catch (error) {
        update(draft.key, { status: "error", message: error instanceof Error ? error.message : String(error) });
      }
    }
    setBusy(false);
    load();
  };

  const save = (contents: string, suggestedName: string, title: string) => void saveTextFile({ contents, suggestedName, title });

  return (
    <div className="ca-viewer">
      <PageHeader
        eyebrow={eyebrow}
        title="Group import and export"
        description="Export groups with their dynamic user and device rules, or import a JSON or CSV file to create many groups at once."
        onRefresh={load}
        refreshing={loading}
        platformChips={false}
      />

      <Panel padded>
        <PanelHead title={`Export (${groups.length} groups)`} hint="JSON is the raw Graph object. CSV has one row per group: name, description, type, rule and processing state." />
        <div className="ca-form-actions">
          <input className="axis-input" value={query} placeholder="Filter by name, description or rule" onChange={(event) => setQuery(event.target.value)} />
          <select className="axis-input" style={{ flex: "0 0 auto", minWidth: 0 }} value={kindFilter} onChange={(event) => setKindFilter(event.target.value as "all" | Kind)}>
            <option value="all">All types</option>
            <option value="assigned">Assigned</option>
            <option value="dynamicUser">Dynamic user</option>
            <option value="dynamicDevice">Dynamic device</option>
          </select>
          <button type="button" className="axis-btn" disabled={!selectedGroups.length} onClick={() => save(JSON.stringify(selectedGroups, null, 2), "groups.json", "Export groups")}>
            Export JSON ({selectedGroups.length})
          </button>
          <button type="button" className="axis-btn" disabled={!selectedGroups.length} onClick={() => save(toCsv(selectedGroups), "groups.csv", "Export groups")}>
            Export CSV ({selectedGroups.length})
          </button>
          <button
            type="button"
            className="axis-btn"
            disabled={!selectedGroups.length}
            onClick={() => setDrafts((current) => [...current, ...selectedGroups.map((group) => toDraft(group, "Copy of tenant group"))])}
          >
            Copy to drafts ({selectedGroups.length})
          </button>
        </div>
        <div className="axis-table-wrap ca-signins">
          <table className="axis-table">
            <thead>
              <tr>
                <th className="axis-table-check">
                  <SelectCheckbox
                    checked={groupSelection.allSelected}
                    indeterminate={groupSelection.checkedIds.size > 0 && !groupSelection.allSelected}
                    disabled={!visible.length}
                    label="Select all groups"
                    onChange={groupSelection.toggleAll}
                  />
                </th>
                <th>Name</th>
                <th>Type</th>
                <th>Rule</th>
                <th>Processing</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((group) => {
                const id = String(group.id);
                return (
                  <tr key={id} className="row-link" onClick={() => groupSelection.toggle(id)}>
                    <td className="axis-table-check" onClick={(event) => event.stopPropagation()}>
                      <SelectCheckbox checked={groupSelection.checkedIds.has(id)} label={`Select ${group.displayName}`} onChange={() => groupSelection.toggle(id)} />
                    </td>
                    <td>{String(group.displayName ?? id)}</td>
                    <td className="muted">{KIND_LABEL[kindOf(group)]}</td>
                    <td className="muted">
                      <code>{String(group.membershipRule ?? "")}</code>
                    </td>
                    <td className="muted">{String(group.membershipRuleProcessingState ?? "")}</td>
                  </tr>
                );
              })}
              {!visible.length ? (
                <tr>
                  <td colSpan={5} className="muted">
                    {loading ? "Loading groups…" : "No groups matched."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {loadError ? <div className="axis-alert axis-alert-danger ca-error">{loadError}</div> : null}
      </Panel>

      <Panel padded>
        <PanelHead
          title="Import"
          hint="Accepts this page's JSON or CSV export, raw Graph groups, or any CSV with displayName, description, membershipType, membershipRule and membershipRuleProcessingState columns. Members of assigned groups aren't copied."
        />
        <div className="ca-import">
          <input
            type="file"
            accept=".json,.csv,application/json,text/csv"
            multiple
            onChange={(event) => {
              const input = event.target;
              void Promise.all(Array.from(input.files ?? []).map(async (file) => addText(await file.text(), file.name))).then(() => (input.value = ""));
            }}
          />
          <textarea className="axis-input ca-json" rows={5} value={paste} placeholder="…or paste JSON or CSV here" onChange={(event) => setPaste(event.target.value)} />
          <div className="ca-form-actions">
            <button
              type="button"
              className="axis-btn"
              disabled={!paste.trim()}
              onClick={() => {
                addText(paste, "Pasted");
                setPaste("");
              }}
            >
              Add pasted groups
            </button>
          </div>
          {importError ? <div className="axis-alert axis-alert-danger ca-error">{importError}</div> : null}
        </div>
      </Panel>

      <Panel padded>
        <PanelHead title={`Drafts (${drafts.length})`} hint="Nothing is written until you create the drafts. Groups are created as security groups." />
        <div className="ca-form-actions">
          <span className="ca-spacer" />
          <button
            type="button"
            className="axis-btn"
            disabled={!selectedDrafts.length}
            onClick={() =>
              save(
                toCsv(
                  selectedDrafts.map((draft) => ({
                    displayName: draft.displayName,
                    description: draft.description,
                    groupTypes: draft.kind === "assigned" ? [] : ["DynamicMembership"],
                    membershipRule: draft.kind === "assigned" ? "" : draft.rule,
                    membershipRuleProcessingState: draft.kind === "assigned" ? "" : draft.paused ? "Paused" : "On",
                  })),
                ),
                "group-drafts.csv",
                "Export drafts",
              )
            }
          >
            Export CSV ({selectedDrafts.length})
          </button>
          <button
            type="button"
            className="axis-btn"
            disabled={!selectedDrafts.length || busy}
            onClick={() => setDrafts((current) => current.filter((draft) => !draftSelection.checkedIds.has(draft.key)))}
          >
            Remove ({selectedDrafts.length})
          </button>
          <WriteActionButton type="button" className="axis-btn axis-btn-primary" disabled={!selectedDrafts.length || busy} onClick={() => void createSelected()}>
            {busy ? "Creating…" : `Create selected (${selectedDrafts.length})`}
          </WriteActionButton>
        </div>
        <div className="axis-table-wrap">
          <table className="axis-table">
            <thead>
              <tr>
                <th className="axis-table-check">
                  <SelectCheckbox
                    checked={draftSelection.allSelected}
                    indeterminate={draftSelection.checkedIds.size > 0 && !draftSelection.allSelected}
                    disabled={!drafts.length}
                    label="Select all drafts"
                    onChange={draftSelection.toggleAll}
                  />
                </th>
                <th>Name and description</th>
                <th>Type</th>
                <th>Membership rule</th>
                <th>Processing</th>
                <th>Checks</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => {
                const locked = draft.status === "created" || draft.status === "creating";
                return (
                  <tr key={draft.key}>
                    <td className="axis-table-check">
                      <SelectCheckbox checked={draftSelection.checkedIds.has(draft.key)} label={`Select ${draft.displayName}`} onChange={() => draftSelection.toggle(draft.key)} />
                    </td>
                    <td>
                      <div className="ca-import">
                        <input className="axis-input" value={draft.displayName} disabled={locked} placeholder="Name" onChange={(event) => update(draft.key, { displayName: event.target.value })} />
                        <input className="axis-input" value={draft.description} disabled={locked} placeholder="Description" onChange={(event) => update(draft.key, { description: event.target.value })} />
                        <span className="muted ca-reason">{draft.source}</span>
                      </div>
                    </td>
                    <td>
                      <select className="axis-input" value={draft.kind} disabled={locked} onChange={(event) => update(draft.key, { kind: event.target.value as Kind })}>
                        <option value="assigned">Assigned</option>
                        <option value="dynamicUser">Dynamic user</option>
                        <option value="dynamicDevice">Dynamic device</option>
                      </select>
                    </td>
                    <td style={{ minWidth: 280 }}>
                      {draft.kind === "assigned" ? (
                        <span className="muted">—</span>
                      ) : (
                        <textarea
                          className="axis-input ca-json"
                          rows={3}
                          value={draft.rule}
                          disabled={locked}
                          placeholder={draft.kind === "dynamicUser" ? '(user.department -eq "Finance")' : '(device.deviceOSType -eq "Windows")'}
                          onChange={(event) => update(draft.key, { rule: event.target.value })}
                        />
                      )}
                    </td>
                    <td>
                      {draft.kind === "assigned" ? (
                        <span className="muted">—</span>
                      ) : (
                        <label className="ca-toggle">
                          <BooleanToggle checked={!draft.paused} onChange={(on) => !locked && update(draft.key, { paused: !on })} ariaLabel="Rule processing on" />
                          {draft.paused ? "Paused" : "On"}
                        </label>
                      )}
                    </td>
                    <td className="ca-reason">
                      {checks(draft).map((note) => (
                        <div key={note} className="ca-warn">
                          {note}
                        </div>
                      ))}
                    </td>
                    <td>
                      {draft.status === "created" ? (
                        <span className="ca-state-on">Created</span>
                      ) : draft.status === "creating" ? (
                        <span className="muted">Creating…</span>
                      ) : draft.status === "error" ? (
                        <span className="ca-error">{draft.message}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!drafts.length ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No drafts yet. Import a file, paste JSON or CSV, or copy tenant groups from the export list.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
