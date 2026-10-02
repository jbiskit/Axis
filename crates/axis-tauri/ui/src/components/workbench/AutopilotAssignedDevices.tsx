import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ENROLLMENT_STATE_LABELS,
  PROFILE_ASSIGNMENT_LABELS,
  autopilotDeviceStateFilterOptions,
  autopilotDeviceTagFilterOptions,
  enumLabel,
  matchesAutopilotDeviceFilters,
} from "../../lib/autopilotProfile";
import { compareText, sortRows } from "../../lib/listSelection";
import { fetchAutopilotProfileAssignedDevices } from "../../lib/tauri";
import type { AutopilotDevice } from "../../types/inventory";
import { AutopilotGroupTagDialog } from "./AutopilotGroupTagDialog";
import { BulkListActions } from "./ObjectListMenu";
import { BulkAssignBar, SelectCheckbox, useCheckedIds } from "./PolicyBulkAssign";
import { SearchableTable, SortableTh, useColumnSort, useListSearchState } from "./shared";

function deviceTitle(item: AutopilotDevice): string {
  return item.serialNumber ?? item.displayName ?? item.id;
}

export function AutopilotAssignedDevices({ profileId }: { profileId: string }) {
  const [devices, setDevices] = useState<AutopilotDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [groupTagOpen, setGroupTagOpen] = useState(false);
  const { query, setQuery } = useListSearchState();
  const [stateFilter, setStateFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const { sort, toggle } = useColumnSort<"serial" | "tag" | "model" | "state" | "profile">("serial");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAutopilotProfileAssignedDevices(profileId);
      setDevices(response.list.items);
      setTruncated(response.list.truncated);
      setError(response.error);
    } catch (err) {
      setDevices([]);
      setTruncated(false);
      setError(err instanceof Error ? err.message : "Failed to load assigned devices.");
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stateOptions = useMemo(() => autopilotDeviceStateFilterOptions(devices), [devices]);
  const tagOptions = useMemo(() => autopilotDeviceTagFilterOptions(devices), [devices]);
  const listFilters = useMemo(
    () => [
      { label: "State", value: stateFilter, onChange: setStateFilter, options: stateOptions },
      { label: "Group tag", value: tagFilter, onChange: setTagFilter, options: tagOptions },
    ],
    [stateFilter, tagFilter, stateOptions, tagOptions],
  );
  const filtered = useMemo(
    () => devices.filter((item) => matchesAutopilotDeviceFilters(item, query, stateFilter, tagFilter)),
    [devices, query, stateFilter, tagFilter],
  );
  const sorted = useMemo(
    () =>
      sortRows(filtered, sort.dir, (a, b) => {
        const aName = deviceTitle(a);
        const bName = deviceTitle(b);
        if (sort.key === "tag") return compareText(a.groupTag, b.groupTag) || compareText(aName, bName);
        if (sort.key === "state") {
          return compareText(a.enrollmentState, b.enrollmentState) || compareText(aName, bName);
        }
        if (sort.key === "profile") {
          return (
            compareText(a.deploymentProfileAssignmentStatus, b.deploymentProfileAssignmentStatus) ||
            compareText(aName, bName)
          );
        }
        if (sort.key === "model") {
          return (
            compareText(a.manufacturer, b.manufacturer) ||
            compareText(a.model, b.model) ||
            compareText(aName, bName)
          );
        }
        return compareText(aName, bName) || compareText(a.id, b.id);
      }),
    [filtered, sort],
  );
  const filteredIds = useMemo(() => sorted.map((item) => item.id), [sorted]);
  const selection = useCheckedIds(filteredIds);
  const checked = sorted.filter((item) => selection.checkedIds.has(item.id));
  const sharedTag = checked.length === 1 ? (checked[0]?.groupTag ?? "") : "";

  return (
    <section className="axis-panel" style={{ padding: "0.85rem" }}>
      <div className="device-toolbar">
        <p className="muted" style={{ margin: 0 }}>
          {loading
            ? "Loading assigned devices…"
            : devices.length === 0
              ? "No devices are assigned to this deployment profile."
              : `${devices.length} assigned device${devices.length === 1 ? "" : "s"}.`}
        </p>
        <button type="button" className="axis-btn" disabled={loading} onClick={() => void load()}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {error ? (
        <div className="axis-alert axis-alert-danger" style={{ marginTop: "0.75rem" }}>
          {error}
        </div>
      ) : null}
      {truncated ? (
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          This list stops at 500 devices.
        </p>
      ) : null}
      <div style={{ marginTop: "0.75rem" }}>
        <BulkAssignBar
          count={checked.length}
          editLabel="Update group tag"
          editHint="Set the same group tag on every selected Autopilot device"
          onEdit={() => setGroupTagOpen(true)}
          onClear={selection.clear}
          extra={
            <BulkListActions
              targets={checked.map((item) => ({
                id: item.id,
                title: deviceTitle(item),
                kind: "autopilotDevice",
              }))}
              onDeleted={() => {
                selection.clear();
                void load();
              }}
            />
          }
        />
        <SearchableTable
          query={query}
          onQueryChange={setQuery}
          countLabel={`${sorted.length} of ${devices.length}`}
          placeholder="Serial, tag, model, state, user…"
          filters={listFilters}
        >
          <table className="axis-table">
            <thead>
              <tr>
                <th className="axis-table-check">
                  <SelectCheckbox
                    checked={selection.allSelected}
                    indeterminate={checked.length > 0 && !selection.allSelected}
                    disabled={sorted.length === 0}
                    label="Select all shown devices"
                    onChange={selection.toggleAll}
                  />
                </th>
                <SortableTh column="serial" label="Serial" sort={sort} onSort={toggle} />
                <SortableTh column="tag" label="Group tag" sort={sort} onSort={toggle} />
                <SortableTh column="model" label="Model" sort={sort} onSort={toggle} />
                <SortableTh column="state" label="Enrollment" sort={sort} onSort={toggle} />
                <SortableTh column="profile" label="Profile status" sort={sort} onSort={toggle} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id}>
                  <td className="axis-table-check">
                    <SelectCheckbox
                      checked={selection.checkedIds.has(item.id)}
                      label={`Select ${deviceTitle(item)}`}
                      onChange={() => selection.toggle(item.id)}
                    />
                  </td>
                  <td>{deviceTitle(item)}</td>
                  <td className="muted">{item.groupTag ?? "—"}</td>
                  <td className="muted">
                    {[item.manufacturer, item.model].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="muted">{enumLabel(item.enrollmentState, ENROLLMENT_STATE_LABELS)}</td>
                  <td className="muted">
                    {enumLabel(item.deploymentProfileAssignmentStatus, PROFILE_ASSIGNMENT_LABELS)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && sorted.length === 0 && devices.length > 0 ? (
            <p className="muted" style={{ padding: "1rem" }}>
              No matching devices.
            </p>
          ) : null}
        </SearchableTable>
      </div>
      <AutopilotGroupTagDialog
        open={groupTagOpen}
        targets={checked.map((item) => ({ id: item.id, title: deviceTitle(item) }))}
        initialTag={sharedTag}
        onClose={() => setGroupTagOpen(false)}
        onSaved={() => {
          selection.clear();
          void load();
        }}
      />
    </section>
  );
}
