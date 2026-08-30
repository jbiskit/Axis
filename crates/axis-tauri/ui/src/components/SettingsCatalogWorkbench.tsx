import { useCallback, useMemo, useState } from "react";
import type { CatalogPolicySummary } from "../types/inventory";
import { BrowseCatalogPanel } from "./BrowseCatalogPanel";
import { PageHeader } from "./ui/PageChrome";
import { settingsCatalogPlatformFromScope } from "../lib/catalog";
import { matchesCatalogPolicyFilters, platformFilterOptionsFromList, type AssignedFilter, type ListFilterOption } from "../lib/listSelection";
import { INTUNE_PLATFORM_LABELS, type IntunePlatform } from "../lib/platforms";
import { hrefWithParam, navigate } from "../lib/route";
import { withTransientItem } from "../lib/duplicateObject";
import { GraphObjectInspector } from "./workbench/GraphObjectInspector";
import {
  BulkDeleteAction,
  listTargetProps,
  ObjectListMenuHost,
} from "./workbench/ObjectListMenu";
import { InspectorWithDocumentTabs } from "./workbench/DocumentTabs";
import {
  BulkAssignBar,
  AssignmentsDialog,
  SelectCheckbox,
  useCheckedIds,
} from "./workbench/PolicyBulkAssign";
import { IncompleteBanner, InspectorEmpty, SearchableTable, CompactObjectList, formatRelative, useListSearchState, WorkspaceSplit } from "./workbench/shared";

export function SettingsCatalogWorkbench({
  tab,
  platform,
  policies,
  loading,
  error,
  truncated,
  selectedId,
  search,
  pathname,
  onRefresh,
}: {
  tab: "tenant" | "browse";
  platform: IntunePlatform | null;
  policies: CatalogPolicySummary[];
  loading: boolean;
  error: string | null;
  truncated?: boolean;
  selectedId: string | null;
  search: URLSearchParams;
  pathname: string;
  onRefresh: () => void;
}) {
  const catalogPlatform = settingsCatalogPlatformFromScope(platform);
  const { query, setQuery, assignedFilter, setAssignedFilter, platformFilter, setPlatformFilter } =
    useListSearchState();
  const scoped = useMemo(() => {
    if (!catalogPlatform) return policies;
    return policies.filter((item) => {
      const value = (item.platforms ?? "").toLowerCase();
      return catalogPlatform === "macos"
        ? value.includes("macos") || value === "mac"
        : value.includes("windows");
    });
  }, [catalogPlatform, policies]);
  const [overlay, setOverlay] = useState<CatalogPolicySummary | null>(null);
  const listed = useMemo(() => withTransientItem(scoped, overlay), [overlay, scoped]);
  const platformOptions = useMemo(
    () => platformFilterOptionsFromList(listed.map((item) => item.platforms)),
    [listed],
  );
  const filtered = useMemo(
    () =>
      listed.filter((item) =>
        matchesCatalogPolicyFilters(item, query, assignedFilter, platformFilter),
      ),
    [assignedFilter, listed, platformFilter, query],
  );

  const selected = filtered.find((item) => item.id === selectedId) ?? listed.find((item) => item.id === selectedId) ?? policies.find((item) => item.id === selectedId);
  const filteredIds = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const selection = useCheckedIds(filteredIds);
  const checkedPolicies = filtered.filter((item) => selection.checkedIds.has(item.id));
  const bulkPolicies = filtered.filter((item) => selection.bulkTargetIds.includes(item.id));
  const showBulk = selection.bulkEditorOpen && bulkPolicies.length > 0;
  const bulkDelete = (
    <BulkDeleteAction
      targets={checkedPolicies.map((item) => ({
        id: item.id,
        title: item.name,
        kind: "configurationPolicy",
      }))}
      onDeleted={(deleted) => {
        if (deleted.some((target) => target.id === overlay?.id)) setOverlay(null);
        if (deleted.some((target) => target.id === selectedId)) selectPolicy("");
        selection.clear();
        onRefresh();
      }}
    />
  );
  const inspectorOpen = Boolean(selected);
  const titleFor = useCallback(
    (id: string) =>
      listed.find((item) => item.id === id)?.name ??
      policies.find((item) => item.id === id)?.name ??
      id,
    [listed, policies],
  );
  const selectPolicy = (id: string) => navigate(hrefWithParam(pathname, search, "policy", id || null));
  const loadedLimitBanner = truncated ? (
    <IncompleteBanner>
      Filter and select all apply to loaded Settings Catalog rows. Axis keeps at most 500 items from Graph for this list.
    </IncompleteBanner>
  ) : null;

  function setPlatform(next: "windows" | "macos") {
    navigate(hrefWithParam(pathname, search, "platform", next));
  }

  function setTab(next: "tenant" | "browse") {
    const href = next === "browse" ? "/intune/policies/browse" : "/intune/policies/settings-catalog";
    navigate(hrefWithParam(href, search, "platform", catalogPlatform ?? "windows"));
  }

  if (platform && !catalogPlatform) {
    return (
      <div className="stack">
        <PageHeader
          title="Settings Catalog"
          description="Settings Catalog is Windows and macOS only."
        />
        <IncompleteBanner>iOS / Android do not have a Settings Catalog surface. Switch platform to Windows or macOS.</IncompleteBanner>
      </div>
    );
  }

  const platformSwitcher = (
    <div className="tab-row">
      {(["windows", "macos"] as const).map((slug) => (
        <button
          key={slug}
          type="button"
          className={`tab-btn${(catalogPlatform ?? "windows") === slug ? " active" : ""}`}
          onClick={() => setPlatform(slug)}
        >
          {INTUNE_PLATFORM_LABELS[slug]}
        </button>
      ))}
    </div>
  );

  const catalogTabs = (
    <div className="tab-row">
      <button type="button" className={`tab-btn${tab === "tenant" ? " active" : ""}`} onClick={() => setTab("tenant")}>
        Tenant policies
      </button>
      <button type="button" className={`tab-btn${tab === "browse" ? " active" : ""}`} onClick={() => setTab("browse")}>
        Browse catalog
      </button>
    </div>
  );

  if (tab === "browse") {
    return (
      <div className="catalog-workbench">
        <div className="catalog-workbench-head">
          <PageHeader
            title="Browse catalog"
            description="Add settings from the Intune catalog to a new or existing freeform policy. One policy cannot mix Windows and macOS."
            onRefresh={onRefresh}
            refreshing={loading}
            actions={
              <div className="device-actions">
                {platformSwitcher}
                <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            }
          />
          {catalogTabs}
          {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        </div>
        <BrowseCatalogPanel
          platform={catalogPlatform ?? "windows"}
          policies={scoped}
          focusSettingId={search.get("setting")}
          focusCategoryId={search.get("category")}
          focusQuery={search.get("q")}
          onFocusHandled={() => {
            const next = new URLSearchParams(search);
            next.delete("setting");
            next.delete("category");
            next.delete("q");
            const query = next.toString();
            navigate(query ? `/intune/policies/browse?${query}` : "/intune/policies/browse");
          }}
          onPolicyCreated={(id) => {
            onRefresh();
            const next = new URLSearchParams(search);
            next.set("platform", catalogPlatform ?? "windows");
            next.set("policy", id);
            navigate(`/intune/policies/settings-catalog?${next.toString()}`);
          }}
          onSettingsAdded={(id) => {
            onRefresh();
            navigate(hrefWithParam("/intune/policies/settings-catalog", search, "policy", id));
          }}
        />
      </div>
    );
  }

  return (
    <>
    <WorkspaceSplit
      inspectorPrimary={inspectorOpen}
      master={
        <ObjectListMenuHost
          onDuplicated={(created) => {
            setOverlay({ id: created.id, name: created.title, isAssigned: false });
            selectPolicy(created.id);
            onRefresh();
          }}
          onMetadataUpdated={(updated) => {
            setOverlay({
              id: updated.id,
              name: updated.title,
              description: updated.description,
              isAssigned: selected?.isAssigned,
            });
            onRefresh();
          }}
          onDeleted={(target) => {
            if (overlay?.id === target.id) setOverlay(null);
            if (selectedId === target.id) selectPolicy("");
            onRefresh();
          }}
        >
        {selected ? (
          <div className="stack">
            <BulkAssignBar
              count={checkedPolicies.length}
              onEdit={selection.openBulkEditor}
              onClear={selection.clear}
              extra={bulkDelete}
            />
            {loadedLimitBanner}
            <CompactObjectList
              title="Settings Catalog"
              description="Select a policy to edit settings and assignments here."
              objectKind="configurationPolicy"
              items={filtered.map((item) => ({
                id: item.id,
                title: item.name,
                meta: `${item.platforms ?? "—"} · ${item.settingCount ?? 0} settings`,
              }))}
              selectedId={selected.id}
              onSelect={(id) => navigate(hrefWithParam(pathname, search, "policy", id))}
              onRefresh={onRefresh}
              loading={loading}
              error={error}
              actions={platformSwitcher}
              toolbar={catalogTabs}
              checkedIds={selection.checkedIds}
              onToggleChecked={selection.toggle}
              query={query}
              onQueryChange={setQuery}
              assignedFilter={assignedFilter}
              onAssignedFilterChange={setAssignedFilter}
              platformFilter={platformFilter}
              onPlatformFilterChange={setPlatformFilter}
              platformOptions={platformOptions}
              showPlatformFilter
              countLabel={`${filtered.length} of ${scoped.length}`}
              searchPlaceholder="Name, platform, assigned…"
              allSelected={selection.allSelected}
              onToggleAll={selection.toggleAll}
              selectAllIndeterminate={checkedPolicies.length > 0 && !selection.allSelected}
              selectAllDisabled={filtered.length === 0}
              selectAllLabel="Select all filtered policies"
            />
          </div>
        ) : (
          <div className="stack">
            <PageHeader
              title="Settings Catalog"
              description="Live configurationPolicies for this platform. Select a row to edit settings and assignments; checkboxes bulk-edit assignments."
              onRefresh={onRefresh}
              refreshing={loading}
              actions={
                <div className="device-actions">
                  {platformSwitcher}
                  <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
              }
            />
            {catalogTabs}
            {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
            {loadedLimitBanner}
            <BulkAssignBar
              count={checkedPolicies.length}
              onEdit={selection.openBulkEditor}
              onClear={selection.clear}
              extra={bulkDelete}
            />
            <TenantPolicyTable
              items={filtered}
              loadedCount={scoped.length}
              query={query}
              onQueryChange={setQuery}
              assignedFilter={assignedFilter}
              onAssignedFilterChange={setAssignedFilter}
              platformFilter={platformFilter}
              onPlatformFilterChange={setPlatformFilter}
              platformOptions={platformOptions}
              loading={loading}
              selectedId={null}
              onSelect={(id) => navigate(hrefWithParam(pathname, search, "policy", id))}
              checkedIds={selection.checkedIds}
              allSelected={selection.allSelected}
              onToggle={selection.toggle}
              onToggleAll={selection.toggleAll}
            />
          </div>
        )}
        </ObjectListMenuHost>
      }
      inspector={
        <InspectorWithDocumentTabs
          selectedId={selected?.id ?? null}
          titleFor={titleFor}
          onSelect={selectPolicy}
          onClear={() => selectPolicy("")}
          empty={
            <InspectorEmpty label="Select a Settings Catalog policy to edit settings and assignments in this workspace. Close clears the selection and stays here." />
          }
        >
          {({ closeActive }) =>
            selected ? (
              <GraphObjectInspector
                key={selected.id}
                kind="configurationPolicy"
                id={selected.id}
                fallbackTitle={selected.name}
                onClose={closeActive}
              />
            ) : null
          }
        </InspectorWithDocumentTabs>
      }
    />
    <AssignmentsDialog
      open={showBulk}
      kind="configurationPolicy"
      policies={bulkPolicies}
      onClose={selection.closeBulkEditor}
      onSaved={() => {
        onRefresh();
        selection.clear();
      }}
    />
    </>
  );
}

function TenantPolicyTable({
  items,
  loadedCount,
  query,
  onQueryChange,
  assignedFilter,
  onAssignedFilterChange,
  platformFilter,
  onPlatformFilterChange,
  platformOptions,
  loading,
  onSelect,
  selectedId,
  checkedIds,
  allSelected,
  onToggle,
  onToggleAll,
}: {
  items: CatalogPolicySummary[];
  loadedCount: number;
  query: string;
  onQueryChange: (value: string) => void;
  assignedFilter: AssignedFilter;
  onAssignedFilterChange: (value: AssignedFilter) => void;
  platformFilter: string;
  onPlatformFilterChange: (value: string) => void;
  platformOptions: ListFilterOption[];
  loading: boolean;
  onSelect: (id: string) => void;
  selectedId?: string | null;
  checkedIds: ReadonlySet<string>;
  allSelected: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  const selectedCount = items.filter((item) => checkedIds.has(item.id)).length;
  return (
    <SearchableTable
      query={query}
      onQueryChange={onQueryChange}
      assignedFilter={assignedFilter}
      onAssignedFilterChange={onAssignedFilterChange}
      platformFilter={platformFilter}
      onPlatformFilterChange={onPlatformFilterChange}
      platformOptions={platformOptions}
      showPlatformFilter
      countLabel={`${items.length} of ${loadedCount}`}
      placeholder="Name, platform, assigned…"
    >
      <table className="axis-table">
        <thead>
          <tr>
            <th className="axis-table-check">
              <SelectCheckbox
                checked={allSelected}
                indeterminate={selectedCount > 0 && !allSelected}
                disabled={items.length === 0}
                label="Select all filtered policies"
                onChange={onToggleAll}
              />
            </th>
            <th>Name</th>
            <th>Platform</th>
            <th>Settings</th>
            <th>Assigned</th>
            <th>Family</th>
            <th>Last modified</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className={`row-link${selectedId === item.id ? " selected" : ""}`}
              onClick={() => onSelect(item.id)}
              {...listTargetProps(item.id, item.name, "configurationPolicy")}
            >
              <td className="axis-table-check">
                <SelectCheckbox
                  checked={checkedIds.has(item.id)}
                  label={`Select ${item.name}`}
                  onChange={() => onToggle(item.id)}
                />
              </td>
              <td>{item.name}</td>
              <td className="muted">{item.platforms ?? "—"}</td>
              <td className="muted">{item.settingCount ?? "—"}</td>
              <td className="muted">{item.isAssigned ? "Yes" : "No"}</td>
              <td className="muted">{item.templateFamily ?? "none"}</td>
              <td className="muted">{formatRelative(item.lastModifiedDateTime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && items.length === 0 ? <p className="muted" style={{ padding: "1rem" }}>No policies.</p> : null}
    </SearchableTable>
  );
}
