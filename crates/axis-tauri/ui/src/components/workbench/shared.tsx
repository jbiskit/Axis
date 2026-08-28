import { Fragment, useState, type ReactNode, Component, type ErrorInfo } from "react";
import type { AssignedFilter, ListFilterOption } from "../../lib/listSelection";
import { PageHeader } from "../ui/PageChrome";
import { SelectCheckbox } from "./PolicyBulkAssign";

export function useListSearchState() {
  const [query, setQuery] = useState("");
  const [assignedFilter, setAssignedFilter] = useState<AssignedFilter>("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  return { query, setQuery, assignedFilter, setAssignedFilter, platformFilter, setPlatformFilter };
}

export function formatRelative(iso?: string | null): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const delta = Date.now() - then;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function IncompleteBanner({ children }: { children: ReactNode }) {
  return <div className="axis-alert axis-alert-warning">{children}</div>;
}

export function CapabilityStub({
  title,
  description,
  reason,
}: {
  title: string;
  description: string;
  reason: string;
}) {
  return (
    <div className="stack">
      <PageHeader title={title} description={description} />
      <div className="axis-panel axis-panel-padded">
        <p style={{ margin: 0, fontWeight: 500 }}>Not available in this desktop pass</p>
        <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", lineHeight: 1.45 }}>
          {reason}
        </p>
      </div>
    </div>
  );
}

export function WorkspaceSplit({
  master,
  inspector,
  inspectorPrimary = false,
}: {
  master: ReactNode;
  inspector?: ReactNode | null;
  /** Give the inspector the majority width (list shrinks). Used when a device is selected. */
  inspectorPrimary?: boolean;
}) {
  const showInspector = inspector != null;
  return (
    <div
      className={`workspace-split${inspectorPrimary && showInspector ? " inspector-primary" : ""}${
        showInspector ? "" : " inspector-hidden"
      }`}
    >
      <div className="workspace-master">{master}</div>
      {showInspector ? <aside className="workspace-inspector">{inspector}</aside> : null}
    </div>
  );
}

export function InspectorEmpty({ label }: { label: string }) {
  return (
    <div className="inspector-empty">
      <p className="muted" style={{ margin: 0, fontSize: "0.8125rem", lineHeight: 1.45 }}>
        {label}
      </p>
    </div>
  );
}

export class InspectorErrorBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: Error): { message: string } {
    return { message: error.message || "Inspector failed." };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Inspector crashed", error, info.componentStack);
  }

  render() {
    if (this.state.message) {
      return (
        <div className="stack" style={{ padding: "1rem" }}>
          <div className="axis-alert axis-alert-danger">
            This inspector crashed: {this.state.message}
          </div>
          <button
            type="button"
            className="axis-btn"
            onClick={() => this.setState({ message: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function MetaEditor({
  title,
  incomplete,
  rows,
}: {
  title: string;
  incomplete: string;
  rows: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <div className="stack">
      <IncompleteBanner>{incomplete}</IncompleteBanner>
      <section className="axis-panel" style={{ padding: "0.85rem" }}>
        <h2 style={{ margin: "0 0 0.75rem", fontSize: "0.95rem" }}>{title}</h2>
        <dl className="meta-grid">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

export type CompactListItem = {
  id: string;
  title: string;
  meta?: string;
  group?: string;
};

export function SearchableTable({
  query,
  onQueryChange,
  countLabel,
  placeholder = "Search…",
  assignedFilter,
  onAssignedFilterChange,
  platformFilter,
  onPlatformFilterChange,
  platformOptions,
  showPlatformFilter = false,
  children,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  countLabel: string;
  placeholder?: string;
  assignedFilter?: AssignedFilter;
  onAssignedFilterChange?: (value: AssignedFilter) => void;
  platformFilter?: string;
  onPlatformFilterChange?: (value: string) => void;
  platformOptions?: ListFilterOption[];
  showPlatformFilter?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="stack">
      <ListSearchToolbar
        query={query}
        onQueryChange={onQueryChange}
        countLabel={countLabel}
        placeholder={placeholder}
        assignedFilter={assignedFilter}
        onAssignedFilterChange={onAssignedFilterChange}
        platformFilter={platformFilter}
        onPlatformFilterChange={onPlatformFilterChange}
        platformOptions={platformOptions}
        showPlatformFilter={showPlatformFilter}
      />
      <section className="axis-panel" style={{ overflow: "hidden" }}>
        {children}
      </section>
    </div>
  );
}

export function ListSearchToolbar({
  query,
  onQueryChange,
  countLabel,
  placeholder = "Search…",
  assignedFilter,
  onAssignedFilterChange,
  platformFilter,
  onPlatformFilterChange,
  platformOptions,
  showPlatformFilter = false,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  countLabel?: string;
  placeholder?: string;
  assignedFilter?: AssignedFilter;
  onAssignedFilterChange?: (value: AssignedFilter) => void;
  platformFilter?: string;
  onPlatformFilterChange?: (value: string) => void;
  platformOptions?: ListFilterOption[];
  showPlatformFilter?: boolean;
}) {
  return (
    <div className="device-toolbar">
      <label className="device-field">
        Search
        <input
          className="axis-input"
          value={query}
          placeholder={placeholder}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      {onAssignedFilterChange && assignedFilter != null ? (
        <label className="device-field device-field-filter">
          Assigned
          <select
            className="axis-input"
            value={assignedFilter}
            onChange={(event) => onAssignedFilterChange(event.target.value as AssignedFilter)}
          >
            <option value="all">All</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
      ) : null}
      {showPlatformFilter && onPlatformFilterChange && platformFilter != null ? (
        <label className="device-field device-field-filter">
          Platform
          <select
            className="axis-input"
            value={platformFilter}
            onChange={(event) => onPlatformFilterChange(event.target.value)}
          >
            {(platformOptions ?? [{ value: "all", label: "All" }]).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {countLabel ? (
        <p className="muted" style={{ margin: 0, fontSize: "0.6875rem", alignSelf: "end" }}>
          {countLabel}
        </p>
      ) : null}
    </div>
  );
}

export function CompactObjectList({
  title,
  description,
  items,
  selectedId,
  onSelect,
  onRefresh,
  loading,
  error,
  actions,
  toolbar,
  checkedIds,
  onToggleChecked,
  query,
  onQueryChange,
  countLabel,
  searchPlaceholder,
  assignedFilter,
  onAssignedFilterChange,
  platformFilter,
  onPlatformFilterChange,
  platformOptions,
  showPlatformFilter,
  allSelected,
  onToggleAll,
  selectAllIndeterminate,
  selectAllDisabled,
  selectAllLabel,
}: {
  title: string;
  description?: string;
  items: CompactListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh?: () => void;
  loading?: boolean;
  error?: string | null;
  actions?: ReactNode;
  toolbar?: ReactNode;
  checkedIds?: ReadonlySet<string>;
  onToggleChecked?: (id: string) => void;
  query?: string;
  onQueryChange?: (value: string) => void;
  countLabel?: string;
  searchPlaceholder?: string;
  assignedFilter?: AssignedFilter;
  onAssignedFilterChange?: (value: AssignedFilter) => void;
  platformFilter?: string;
  onPlatformFilterChange?: (value: string) => void;
  platformOptions?: ListFilterOption[];
  showPlatformFilter?: boolean;
  allSelected?: boolean;
  onToggleAll?: () => void;
  selectAllIndeterminate?: boolean;
  selectAllDisabled?: boolean;
  selectAllLabel?: string;
}) {
  return (
    <div className="device-list-compact">
      <div className="device-inspector-head">
        <div>
          <h1 style={{ fontSize: "0.95rem" }}>{title}</h1>
          {description ? (
            <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.6875rem" }}>
              {description}
            </p>
          ) : null}
        </div>
        <div className="device-actions">
          {actions}
          {onRefresh ? (
            <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          ) : null}
        </div>
      </div>
      {toolbar}
      {onQueryChange != null && query != null ? (
        <ListSearchToolbar
          query={query}
          onQueryChange={onQueryChange}
          countLabel={countLabel}
          placeholder={searchPlaceholder}
          assignedFilter={assignedFilter}
          onAssignedFilterChange={onAssignedFilterChange}
          platformFilter={platformFilter}
          onPlatformFilterChange={onPlatformFilterChange}
          platformOptions={platformOptions}
          showPlatformFilter={showPlatformFilter}
        />
      ) : null}
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {loading && items.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted">
          {query?.trim() ||
          (assignedFilter != null && assignedFilter !== "all") ||
          (showPlatformFilter && platformFilter != null && platformFilter !== "all")
            ? "No matching items."
            : "No items."}
        </p>
      ) : (
        <ul className="device-card-list">
          {onToggleAll && checkedIds ? (
            <li className="device-card-row">
              <SelectCheckbox
                checked={Boolean(allSelected)}
                indeterminate={Boolean(selectAllIndeterminate)}
                disabled={selectAllDisabled}
                label={selectAllLabel ?? "Select all shown"}
                onChange={onToggleAll}
              />
              <p className="muted" style={{ margin: 0, fontSize: "0.6875rem", alignSelf: "center" }}>
                Select all shown
              </p>
            </li>
          ) : null}
          {items.map((item, index) => (
            <Fragment key={item.id}>
              {item.group && item.group !== items[index - 1]?.group ? (
                <li className="device-card-group">{item.group}</li>
              ) : null}
              <li className={onToggleChecked ? "device-card-row" : undefined}>
                {onToggleChecked && checkedIds ? (
                  <SelectCheckbox
                    checked={checkedIds.has(item.id)}
                    label={`Select ${item.title}`}
                    onChange={() => onToggleChecked(item.id)}
                  />
                ) : null}
                <button
                  type="button"
                  className={`device-card${selectedId === item.id ? " selected" : ""}`}
                  onClick={() => onSelect(item.id)}
                >
                  <p className="device-card-name">{item.title}</p>
                  {item.meta ? <p className="device-card-meta">{item.meta}</p> : null}
                </button>
              </li>
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
