import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInventory } from "../../hooks/useInventory";
import { compareText, sortRows } from "../../lib/listSelection";
import { hrefWithParam, navigate } from "../../lib/route";
import { fetchReviewObjects, saveTextFile, type ReviewKind } from "../../lib/tauri";
import type { InventoryResponse } from "../../types/inventory";
import { PageHeader } from "../ui/PageChrome";
import { InspectorWithDocumentTabs } from "../workbench/DocumentTabs";
import { GraphObjectInspector } from "../workbench/GraphObjectInspector";
import { BulkAssignBar, SelectCheckbox, useCheckedIds } from "../workbench/PolicyBulkAssign";
import { ListSearchToolbar, SortableTh, useColumnSort, WorkspaceSplit } from "../workbench/shared";

export type ReviewRow = Record<string, unknown>;
/** Object id → display name, from `resolveReviewNames`. */
export type ReviewNames = Record<string, string>;
export type ReviewColumn = {
  key: string;
  label: string;
  value: (row: ReviewRow, names: ReviewNames) => string;
  /** Hidden while the inspector is open, so the table narrows by dropping whole columns. */
  secondary?: boolean;
  /** Adds a dropdown above the list that keeps only rows with the chosen value. */
  filter?: boolean;
  /** For a multi-valued column: the row matches when any of these equals the chosen value. */
  filterValues?: (row: ReviewRow) => string[];
  /** Tick several values; a row matches when it has any of them. */
  filterMulti?: boolean;
};

function MultiFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  const ref = useRef<HTMLDetailsElement>(null);
  // Close like a native select: a click outside the menu, or Escape.
  useEffect(() => {
    const close = (event: Event) => {
      const details = ref.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <div className="device-field device-field-filter">
      {label}
      <details className="multi-filter" ref={ref}>
        <summary className="axis-input">
          {selected.length === 0 ? "All" : selected.length === 1 ? selected[0] : `${selected.length} selected`}
        </summary>
        <div className="multi-filter-menu" role="group" aria-label={label}>
          {options.map((option) => (
            <label key={option}>
              <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
              {option}
            </label>
          ))}
          {selected.length ? (
            <button type="button" className="ov-link" onClick={() => onChange([])}>
              Clear
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}

const columnFilterValues = (column: ReviewColumn, row: ReviewRow, names: ReviewNames) =>
  column.filterValues ? column.filterValues(row) : [column.value(row, names)];

export const asRecord = (value: unknown): ReviewRow =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as ReviewRow) : {};
export const asList = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
export const rowTitle = (row: ReviewRow) => String(row.displayName ?? row.name ?? row.id ?? "Untitled");
export const isoDate = (value: unknown) => (typeof value === "string" ? value.slice(0, 10) : "");

/** Graph enum token → words ("retainAsRecord" → "Retain as record", "mfa" → "MFA"). No Graph copy exists for these. */
export function humanize(value: unknown): string {
  const token = String(value ?? "").trim();
  if (!token) return "";
  if (token.length <= 3) return token.toUpperCase();
  const words = token.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "2 users, 1 group" from [[2, "user"], [1, "group"]]; zero counts drop out. */
export function counted(parts: Array<[number, string]>): string {
  return parts
    .filter(([count]) => count > 0)
    .map(([count, noun]) => `${count} ${count === 1 ? noun : noun.replace(/y$/, "ie") + "s"}`)
    .join(", ");
}

/** A read-only field; a list renders one entry per line, empty renders "Not configured". */
export type ReviewField = { label: string; value: string | string[] };
/** One topic card, laid out like the Windows Update ring sections. */
export type ReviewSection = { title: string; fields?: ReviewField[]; groups?: Array<{ label: string; fields: ReviewField[] }> };

function ReviewFieldView({ label, value }: ReviewField) {
  const items = (Array.isArray(value) ? value : [value]).filter(Boolean);
  return (
    <div className="device-field">
      <span>{label}</span>
      {items.length ? (
        <ul className="review-value">
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <span className="review-value is-unset">Not configured</span>
      )}
    </div>
  );
}

export function ReviewSections({ sections }: { sections: ReviewSection[] }) {
  return (
    <div className="stack" style={{ marginTop: "0.85rem" }}>
      {sections.map((section) => (
        <div key={section.title} className="axis-panel axis-panel-padded">
          <p className="axis-kicker">{section.title}</p>
          {section.fields?.length ? (
            <div className="wufb-grid">
              {section.fields.map((field) => (
                <ReviewFieldView key={field.label} {...field} />
              ))}
            </div>
          ) : null}
          {section.groups?.map((group) => (
            <div key={group.label} className="wufb-children">
              <p className="wufb-children-label">{group.label}</p>
              {group.fields.map((field) => (
                <ReviewFieldView key={field.label} {...field} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Stable loader per kind: useInventory caches by loader identity, so pages sharing a kind share one fetch.
const loaders = new Map<ReviewKind, () => Promise<InventoryResponse<ReviewRow>>>();
export function loaderFor(kind: ReviewKind) {
  let loader = loaders.get(kind);
  if (!loader) {
    loader = () => fetchReviewObjects(kind);
    loaders.set(kind, loader);
  }
  return loader;
}

export function ReviewWorkbench({
  kind,
  eyebrow,
  title,
  description,
  note,
  columns,
  titleOf = rowTitle,
  pathname,
  search,
  signedIn,
  resolveNames,
  summary,
  headline,
  parentOf,
  defaultSort = "name",
  groupings,
}: {
  kind: ReviewKind;
  eyebrow: string;
  title: string;
  description: string;
  /** Known limit of what Graph returns, shown above the list. */
  note?: string;
  columns: ReviewColumn[];
  titleOf?: (row: ReviewRow) => string;
  pathname: string;
  search: URLSearchParams;
  signedIn: boolean;
  /** Looks up names for the ids the rows reference. Unresolved ids stay as ids. */
  resolveNames?: (rows: ReviewRow[]) => Promise<ReviewNames>;
  /** Readable breakdown of one row for the inspector's overview tab. */
  summary?: (row: ReviewRow, names: ReviewNames) => ReactNode;
  /** Totals across the loaded rows, shown above the list. */
  headline?: (rows: ReviewRow[]) => ReactNode;
  /** Parent row id; children list under their parent (sorted among siblings) and indent. */
  parentOf?: (row: ReviewRow) => string | null;
  /** Column key the list starts sorted by. */
  defaultSort?: string;
  /** Ways to group the list (`?group=<key>`); rows sit under a collapsible header per group value. */
  groupings?: Array<{ key: string; label: string; value: (row: ReviewRow) => string }>;
}) {
  const inventory = useInventory(loaderFor(kind), signedIn, signedIn);
  const rows = useMemo(() => inventory.items.filter((row) => typeof row.id === "string"), [inventory.items]);
  const [names, setNames] = useState<ReviewNames>({});
  useEffect(() => {
    if (!resolveNames || rows.length === 0) return;
    let cancelled = false;
    resolveNames(rows)
      .then((resolved) => {
        if (!cancelled) setNames(resolved);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [resolveNames, rows]);
  const [query, setQuery] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [multiValues, setMultiValues] = useState<Record<string, string[]>>({});
  const filterColumns = columns.filter((column) => column.filter && !column.filterMulti);
  const multiColumns = columns.filter((column) => column.filter && column.filterMulti);
  const optionsFor = (column: ReviewColumn) =>
    [...new Set(rows.flatMap((row) => columnFilterValues(column, row, names)).filter(Boolean))].sort(compareText);
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const active = Object.entries(filterValues).filter(([, value]) => value !== "all");
    const activeMulti = Object.entries(multiValues).filter(([, values]) => values.length > 0);
    if (!needle && active.length === 0 && activeMulti.length === 0) return rows;
    return rows.filter((row) => {
      for (const [key, value] of active) {
        const column = columns.find((candidate) => candidate.key === key);
        if (column && !columnFilterValues(column, row, names).includes(value)) return false;
      }
      for (const [key, values] of activeMulti) {
        const column = columns.find((candidate) => candidate.key === key);
        if (column && !columnFilterValues(column, row, names).some((value) => values.includes(value))) return false;
      }
      if (!needle) return true;
      return [titleOf(row), ...columns.map((column) => column.value(row, names))].some((text) =>
        text.toLowerCase().includes(needle),
      );
    });
  }, [columns, filterValues, multiValues, names, query, rows, titleOf]);
  const { sort, toggle } = useColumnSort<string>(defaultSort);
  const { sorted, depth } = useMemo(() => {
    const column = columns.find((candidate) => candidate.key === sort.key);
    const flat = sortRows(visibleRows, sort.dir, (a, b) =>
      (column ? compareText(column.value(a, names), column.value(b, names)) : 0) || compareText(titleOf(a), titleOf(b)),
    );
    const depth = new Map<string, number>();
    if (!parentOf) return { sorted: flat, depth };
    // Depth-first: roots in sort order, each followed by its children in sort order.
    const ids = new Set(flat.map((row) => String(row.id)));
    const children = new Map<string, ReviewRow[]>();
    const roots: ReviewRow[] = [];
    for (const row of flat) {
      const parent = parentOf(row);
      if (parent && ids.has(parent) && parent !== row.id) children.set(parent, [...(children.get(parent) ?? []), row]);
      else roots.push(row);
    }
    const ordered: ReviewRow[] = [];
    const visit = (row: ReviewRow, level: number) => {
      const id = String(row.id);
      if (depth.has(id)) return;
      depth.set(id, level);
      ordered.push(row);
      for (const child of children.get(id) ?? []) visit(child, level + 1);
    };
    roots.forEach((row) => visit(row, 0));
    return { sorted: ordered, depth };
  }, [columns, names, parentOf, visibleRows, sort, titleOf]);
  const indent = (row: ReviewRow) => depth.get(String(row.id)) ?? 0;
  const grouping = groupings?.find((candidate) => candidate.key === search.get("group"));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    if (!grouping) return [{ label: "", rows: sorted }];
    const byLabel = new Map<string, ReviewRow[]>();
    for (const row of sorted) {
      const label = grouping.value(row) || "—";
      byLabel.set(label, [...(byLabel.get(label) ?? []), row]);
    }
    return [...byLabel].sort(([a], [b]) => compareText(a, b)).map(([label, rows]) => ({ label, rows }));
  }, [grouping, sorted]);
  const toggleGroup = (label: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(label)) next.add(label);
      return next;
    });
  const ids = useMemo(() => sorted.map((row) => String(row.id)), [sorted]);
  const selection = useCheckedIds(ids);
  const checked = sorted.filter((row) => selection.checkedIds.has(String(row.id)));
  const selectedId = search.get("object");
  const selected = rows.find((row) => row.id === selectedId);
  const select = (id: string) => navigate(hrefWithParam(pathname, search, "object", id || null));
  const titleFor = (id: string) => {
    const row = rows.find((candidate) => candidate.id === id);
    return row ? titleOf(row) : id;
  };
  const refresh = () => void inventory.reload();

  const bulkBar = (
    <BulkAssignBar
      count={checked.length}
      onClear={selection.clear}
      extra={
        <button
          type="button"
          className="axis-btn"
          onClick={() =>
            void saveTextFile({
              contents: JSON.stringify(checked, null, 2),
              suggestedName: `${kind}-review.json`,
              title: `Export ${title.toLowerCase()}`,
            })
          }
        >
          Export JSON
        </button>
      }
    />
  );

  const shown = selected ? columns.filter((column) => !column.secondary) : columns;
  const master = (
    <div className="stack review-master">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        onRefresh={refresh}
        refreshing={inventory.loading}
        actions={
          <button type="button" className="axis-btn" onClick={refresh} disabled={inventory.loading}>
            {inventory.loading ? "Refreshing…" : "Refresh"}
          </button>
        }
      />
      {note ? <div className="axis-alert">{note}</div> : null}
      {headline && rows.length > 0 ? headline(rows) : null}
      {inventory.error ? <div className="axis-alert axis-alert-danger">{inventory.error}</div> : null}
      {inventory.truncated ? <div className="axis-alert">Showing the first {rows.length} items.</div> : null}
      {bulkBar}
      {groupings?.length ? (
        <div className="platform-chips" role="group" aria-label="Group by">
          {[{ key: "", label: "No grouping" }, ...groupings.map(({ key, label }) => ({ key, label: `Group by ${label.toLowerCase()}` }))].map(
            ({ key, label }) => (
              <button
                key={key || "none"}
                type="button"
                className={`platform-chip${(grouping?.key ?? "") === key ? " is-active" : ""}`}
                aria-pressed={(grouping?.key ?? "") === key}
                onClick={() => navigate(hrefWithParam(pathname, search, "group", key || null))}
              >
                {label}
              </button>
            ),
          )}
        </div>
      ) : null}
      <ListSearchToolbar
        query={query}
        onQueryChange={setQuery}
        countLabel={`${sorted.length} of ${rows.length}`}
        filters={filterColumns.map((column) => ({
          label: column.label,
          value: filterValues[column.key] ?? "all",
          onChange: (value: string) => setFilterValues((current) => ({ ...current, [column.key]: value })),
          options: [{ value: "all", label: "All" }, ...optionsFor(column).map((value) => ({ value, label: value }))],
        }))}
        extra={multiColumns.map((column) => (
          <MultiFilter
            key={column.key}
            label={column.label}
            options={optionsFor(column)}
            selected={multiValues[column.key] ?? []}
            onChange={(values) => setMultiValues((current) => ({ ...current, [column.key]: values }))}
          />
        ))}
      />
      <section className="axis-panel axis-table-wrap workspace-scroll">
        <table className={`axis-table review-table${selected ? " is-inspecting" : ""}`}>
          <thead>
            <tr>
              <th className="axis-table-check">
                <SelectCheckbox
                  checked={selection.allSelected}
                  indeterminate={checked.length > 0 && !selection.allSelected}
                  disabled={sorted.length === 0}
                  label="Select all shown items"
                  onChange={selection.toggleAll}
                />
              </th>
              <SortableTh column="name" label="Name" sort={sort} onSort={toggle} />
              {shown.map((column) => (
                <SortableTh key={column.key} column={column.key} label={column.label} sort={sort} onSort={toggle} />
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.flatMap(({ label, rows: groupRows }) => [
              ...(grouping
                ? [
                    <tr key={`group:${label}`} className="review-group-row" onClick={() => toggleGroup(label)}>
                      <td colSpan={shown.length + 2}>
                        <button type="button" className="review-group-toggle" aria-expanded={!collapsed.has(label)}>
                          {collapsed.has(label) ? "▸" : "▾"} {label}
                        </button>
                        <span className="muted"> · {groupRows.length}</span>
                      </td>
                    </tr>,
                  ]
                : []),
              ...(grouping && collapsed.has(label) ? [] : groupRows).map((row) => {
              const id = String(row.id);
              const name = titleOf(row);
              return (
                <tr
                  key={id}
                  className={`row-link${id === selectedId ? " is-selected" : ""}`}
                  onClick={() => select(id === selectedId ? "" : id)}
                >
                  <td className="axis-table-check">
                    <SelectCheckbox
                      checked={selection.checkedIds.has(id)}
                      label={`Select ${name}`}
                      onChange={() => selection.toggle(id)}
                    />
                  </td>
                  <td style={indent(row) ? { paddingLeft: `${0.75 + indent(row) * 1.25}rem` } : undefined}>
                    {indent(row) ? <span className="muted">↳ </span> : null}
                    <span className="review-name">{name}</span>
                  </td>
                  {shown.map((column) => (
                    <td key={column.key} className="muted">
                      {column.value(row, names) || "—"}
                    </td>
                  ))}
                </tr>
              );
            }),
            ])}
            {!inventory.loading && !inventory.error && sorted.length === 0 ? (
              <tr>
                <td colSpan={shown.length + 2} className="muted">
                  Nothing found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );

  return (
    <WorkspaceSplit
      master={master}
      // No selection, no inspector: the table takes the full width.
      inspector={
        selected ? (
        <InspectorWithDocumentTabs
          selectedId={String(selected.id)}
          titleFor={titleFor}
          onSelect={select}
          onClear={() => select("")}
          empty={null}
        >
          {({ closeActive }) =>
            selected ? (
              <GraphObjectInspector
                key={String(selected.id)}
                kind={kind}
                id={String(selected.id)}
                fallbackTitle={titleOf(selected)}
                incomplete="Read-only review. The full Graph object is shown."
                onClose={closeActive}
                summary={summary?.(selected, names)}
              />
            ) : null
          }
        </InspectorWithDocumentTabs>
        ) : null
      }
    />
  );
}
