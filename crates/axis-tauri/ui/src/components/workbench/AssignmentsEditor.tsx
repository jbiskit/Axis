import { useEffect, useMemo, useState } from "react";
import {
  assignmentTargetLabel,
  summarizeAssignmentDraft,
} from "../../lib/assignmentSummary";
import {
  defaultRemediationSchedule,
  remediationScheduleIntervalLabel,
  remediationScheduleKindLabel,
  summarizeRemediationSchedule,
} from "../../lib/remediationSchedule";
import type {
  AssignmentDraft,
  AssignmentFilter,
  AssignmentFilterMode,
  AssignmentIntent,
  AssignmentTargetKind,
  DirectoryGroup,
  GroupMembershipKind,
  RemediationScheduleKind,
} from "../../types/inventory";
import {
  assignObjectAssignments,
  loadAssignmentWorkspace,
  searchDirectoryGroups,
} from "../../lib/tauri";
import { CreateEntraGroupPanel } from "./CreateEntraGroupPanel";
import { IncludeExcludeToggle } from "./IncludeExcludeToggle";

type AssignmentRow = AssignmentDraft & { key: string };

function withRemediationScheduleDefaults(
  draft: AssignmentDraft,
  supportsSchedule: boolean,
): AssignmentDraft {
  if (
    !supportsSchedule ||
    draft.targetKind === "exclusionGroup" ||
    draft.runSchedule
  ) {
    return draft;
  }
  return {
    ...draft,
    runRemediationScript: draft.runRemediationScript ?? true,
    runSchedule: defaultRemediationSchedule(),
  };
}

function rowKey(
  targetKind: AssignmentTargetKind,
  groupId?: string | null,
  intent?: AssignmentIntent | null,
): string {
  return `${intent ?? ""}:${targetKind}:${groupId ?? ""}`;
}

function draftsToRows(drafts: AssignmentDraft[]): AssignmentRow[] {
  return drafts.map((draft) => ({
    ...draft,
    key: rowKey(draft.targetKind, draft.groupId, draft.intent),
  }));
}

/** Graph-relevant assignment identity, ignoring display-only names/membership. */
function assignmentFingerprint(drafts: AssignmentDraft[]): string {
  return drafts
    .map((draft) => {
      const filterId = draft.filterId ?? "";
      const filterMode = filterId ? (draft.filterMode ?? "include") : "";
      const schedule = draft.runSchedule;
      return [
        draft.targetKind,
        draft.groupId ?? "",
        draft.intent ?? "",
        filterId,
        filterMode,
        draft.runRemediationScript ?? "",
        schedule?.kind ?? "",
        schedule?.interval ?? "",
        schedule?.time ?? "",
        schedule?.useUtc ?? "",
        schedule?.date ?? "",
      ].join("\0");
    })
    .sort()
    .join("\n");
}

function membershipLabel(kind?: GroupMembershipKind | null): string | null {
  switch (kind) {
    case "assigned":
      return "Assigned";
    case "dynamicUser":
      return "Dynamic user";
    case "dynamicDevice":
      return "Dynamic device";
    case "dynamic":
      return "Dynamic";
    default:
      return null;
  }
}

function membershipPillClass(kind?: GroupMembershipKind | null): string {
  switch (kind) {
    case "dynamicUser":
      return "axis-pill axis-pill-success";
    case "dynamicDevice":
      return "axis-pill axis-pill-warning";
    case "dynamic":
      return "axis-pill axis-pill-warning";
    default:
      return "axis-pill";
  }
}

function formatFilterOption(filter: AssignmentFilter): string {
  const bits = [filter.displayName];
  if (filter.platform) bits.push(filter.platform);
  return bits.join(" · ");
}

function summarize(rows: AssignmentRow[], supportsIntent: boolean, supportsSchedule: boolean): string {
  if (rows.length === 0) return "No assignments (clear all)";
  return rows
    .map((row) =>
      summarizeAssignmentDraft(row, { supportsIntent, supportsSchedule }),
    )
    .join(" · ");
}

export type AssignmentEditorTarget = { id: string; title: string };

export function AssignmentsEditor({
  kind,
  id,
  title,
  targets,
  assignments,
  objectOdataType,
  onSaved,
}: {
  kind: string;
  id?: string;
  title: string;
  targets?: AssignmentEditorTarget[];
  assignments: Record<string, unknown>[];
  objectOdataType?: string | null;
  onSaved: () => void;
}) {
  const resolvedTargets = useMemo<AssignmentEditorTarget[]>(() => {
    if (targets && targets.length > 0) return targets;
    if (id) return [{ id, title }];
    return [];
  }, [targets, id, title]);
  const isBulk = resolvedTargets.length > 1;
  const workspaceId = resolvedTargets.map((target) => target.id).join("\0");
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [baselineFingerprint, setBaselineFingerprint] = useState("");
  const [filters, setFilters] = useState<AssignmentFilter[]>([]);
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [writable, setWritable] = useState(false);
  const [supportsIntent, setSupportsIntent] = useState(false);
  const [supportsSchedule, setSupportsSchedule] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupQuery, setGroupQuery] = useState("");
  const [groupHits, setGroupHits] = useState<DirectoryGroup[]>([]);
  const [groupPickerMode, setGroupPickerMode] = useState<"include" | "exclude">("include");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFiltersLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSaveMessage(null);
    setGroupQuery("");
    setGroupHits([]);
    void loadAssignmentWorkspace(kind, isBulk ? [] : assignments)
      .then((response) => {
        if (cancelled) return;
        const nextRows = draftsToRows(
          response.drafts.map((draft) =>
            withRemediationScheduleDefaults(draft, response.capabilities.supportsSchedule),
          ),
        );
        setRows(nextRows);
        setBaselineFingerprint(assignmentFingerprint(nextRows));
        setFilters(response.filters);
        setFiltersError(response.filtersError);
        setWritable(response.capabilities.writable);
        setSupportsIntent(response.capabilities.supportsIntent);
        setSupportsSchedule(response.capabilities.supportsSchedule);
        setLoadError(response.error);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load assignments.");
      })
      .finally(() => {
        if (!cancelled) setFiltersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, workspaceId, isBulk, assignments]);

  useEffect(() => {
    if (groupQuery.trim().length < 2) {
      setGroupHits([]);
      setSearchError(null);
      return;
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        setSearchError(null);
        try {
          const response = await searchDirectoryGroups(groupQuery);
          setGroupHits(response.groups);
          setSearchError(response.error);
        } catch (error) {
          setGroupHits([]);
          const message = error instanceof Error ? error.message : "Group search failed.";
          setSearchError(
            /403|401|permission|accessdenied|forbidden/i.test(message)
              ? "Missing Group.Read.All — re-consent or ask an admin to grant it."
              : message,
          );
        } finally {
          setSearching(false);
        }
      })();
    }, 300);
    return () => window.clearTimeout(handle);
  }, [groupQuery]);

  const summary = useMemo(
    () => summarize(rows, supportsIntent, supportsSchedule),
    [rows, supportsIntent, supportsSchedule],
  );
  const dirty = useMemo(
    () => assignmentFingerprint(rows) !== baselineFingerprint,
    [rows, baselineFingerprint],
  );

  const addRow = (targetKind: AssignmentTargetKind, group?: DirectoryGroup) => {
    const intent = supportsIntent ? "required" : undefined;
    const key = rowKey(targetKind, group?.id, intent);
    setRows((current) => {
      if (current.some((row) => row.key === key)) return current;
      const cleaned =
        group && (targetKind === "group" || targetKind === "exclusionGroup")
          ? current.filter(
              (row) =>
                !(
                  row.groupId === group.id &&
                  (row.targetKind === "group" || row.targetKind === "exclusionGroup")
                ),
            )
          : current;
      const scheduleDefaults =
        supportsSchedule && targetKind !== "exclusionGroup"
          ? {
              runRemediationScript: true,
              runSchedule: defaultRemediationSchedule(),
            }
          : {};
      return [
        ...cleaned,
        {
          key,
          targetKind,
          groupId: group?.id,
          groupName: group?.displayName,
          groupMembership: group?.membership,
          intent,
          ...scheduleDefaults,
        },
      ];
    });
    setSaveMessage(null);
  };

  const setRowFilter = (key: string, filterId: string) => {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        if (!filterId) {
          return {
            ...row,
            filterId: undefined,
            filterName: undefined,
            filterMode: undefined,
          };
        }
        const match = filters.find((filter) => filter.id === filterId);
        return {
          ...row,
          filterId,
          filterName: match?.displayName ?? filterId,
          filterMode: row.filterMode ?? "include",
        };
      }),
    );
  };

  const setRowFilterMode = (key: string, filterMode: AssignmentFilterMode) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, filterMode } : row)),
    );
  };

  const setRowIntent = (key: string, intent: AssignmentIntent) => {
    setRows((current) =>
      current.map((row) =>
        row.key === key
          ? { ...row, intent, key: rowKey(row.targetKind, row.groupId, intent) }
          : row,
      ),
    );
  };

  const setRowGroupMode = (key: string, exclude: boolean) => {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        if (row.targetKind !== "group" && row.targetKind !== "exclusionGroup") return row;
        const targetKind: AssignmentTargetKind = exclude ? "exclusionGroup" : "group";
        if (row.targetKind === targetKind) return row;
        const nextKey = rowKey(targetKind, row.groupId, row.intent);
        if (current.some((other) => other.key === nextKey && other.key !== key)) {
          return row;
        }
        const scheduleDefaults =
          supportsSchedule && !exclude
            ? {
                runRemediationScript: row.runRemediationScript ?? true,
                runSchedule: row.runSchedule ?? defaultRemediationSchedule(),
              }
            : {
                runRemediationScript: undefined,
                runSchedule: undefined,
              };
        return {
          ...row,
          targetKind,
          key: nextKey,
          filterId: exclude ? undefined : row.filterId,
          filterName: exclude ? undefined : row.filterName,
          filterMode: exclude ? undefined : row.filterMode,
          ...scheduleDefaults,
        };
      }),
    );
    setSaveMessage(null);
  };

  const setRowRunRemediationScript = (key: string, runRemediationScript: boolean) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, runRemediationScript } : row)),
    );
  };

  const setRowScheduleKind = (key: string, kind: RemediationScheduleKind) => {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const currentSchedule = row.runSchedule ?? defaultRemediationSchedule();
        return {
          ...row,
          runSchedule: {
            ...currentSchedule,
            kind,
            interval: kind === "runOnce" ? 1 : currentSchedule.interval,
            date: kind === "runOnce" ? currentSchedule.date ?? "" : undefined,
          },
        };
      }),
    );
  };

  const setRowScheduleInterval = (key: string, interval: number) => {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const currentSchedule = row.runSchedule ?? defaultRemediationSchedule();
        return {
          ...row,
          runSchedule: {
            ...currentSchedule,
            interval: Math.max(1, Math.min(23, interval)),
          },
        };
      }),
    );
  };

  const setRowScheduleTime = (key: string, time: string) => {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const currentSchedule = row.runSchedule ?? defaultRemediationSchedule();
        return { ...row, runSchedule: { ...currentSchedule, time } };
      }),
    );
  };

  const setRowScheduleDate = (key: string, date: string) => {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const currentSchedule = row.runSchedule ?? defaultRemediationSchedule();
        return { ...row, runSchedule: { ...currentSchedule, date } };
      }),
    );
  };

  const setRowScheduleUseUtc = (key: string, useUtc: boolean) => {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const currentSchedule = row.runSchedule ?? defaultRemediationSchedule();
        return { ...row, runSchedule: { ...currentSchedule, useUtc } };
      }),
    );
  };

  const removeRow = (key: string) => {
    setRows((current) => current.filter((row) => row.key !== key));
    setSaveMessage(null);
  };

  async function save() {
    setSaveBusy(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      if (resolvedTargets.length === 0) {
        setSaveError("No policies selected.");
        return;
      }
      const drafts: AssignmentDraft[] = rows.map(({ key: _key, ...draft }) => draft);
      const failures: string[] = [];
      for (const target of resolvedTargets) {
        const response = await assignObjectAssignments({
          kind,
          id: target.id,
          drafts,
          objectOdataType,
        });
        if (!response.ok) {
          failures.push(`${target.title}: ${response.error ?? "Save failed"}`);
        }
      }
      const okCount = resolvedTargets.length - failures.length;
      if (failures.length) {
        setSaveError(
          `Updated ${okCount}/${resolvedTargets.length}. ${failures.join(" · ")}`,
        );
        if (okCount > 0) {
          setBaselineFingerprint(assignmentFingerprint(drafts));
          onSaved();
        }
        return;
      }
      setSaveMessage(
        drafts.length
          ? isBulk
            ? `Updated assignments (${drafts.length}) on ${okCount} policies.`
            : `Updated assignments (${drafts.length}).`
          : isBulk
            ? `Cleared all assignments on ${okCount} policies.`
            : "Cleared all assignments.",
      );
      setBaselineFingerprint(assignmentFingerprint(drafts));
      onSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaveBusy(false);
    }
  }

  const saveBlockedReason = !writable
      ? "Assignment writes for this object type are not wired yet."
      : undefined;
  const canSave = writable && !saveBusy && (dirty || isBulk);
  const saveClassName = !(dirty || isBulk)
    ? "axis-btn"
    : rows.length > 0
      ? "axis-btn axis-btn-primary"
      : "axis-btn axis-btn-danger";

  return (
    <section className="axis-panel assignment-editor">
      <div className="assignment-editor-head">
        <div>
          <p className="muted" style={{ margin: 0 }}>
            {isBulk
              ? `Save writes this assignment list to ${resolvedTargets.length} selected policies (includes and excludes). Leave empty and save to clear assignments on all of them.`
              : `${title} — save writes the assignment list below to Intune (includes and excludes). Leave empty and save to clear all assignments.`}
          </p>
        </div>
        <button
          type="button"
          className={saveClassName}
          disabled={!canSave}
          title={
            saveBlockedReason ??
            (dirty || isBulk ? undefined : "No assignment changes to save.")
          }
          onClick={() => void save()}
        >
          {saveBusy
            ? "Saving…"
            : rows.length > 0
              ? isBulk
                ? `Update assignments (${rows.length}) · ${resolvedTargets.length}`
                : `Update assignments (${rows.length})`
              : isBulk
                ? `Clear all assignments · ${resolvedTargets.length}`
                : "Clear all assignments"}
        </button>
      </div>

      {loadError ? <div className="axis-alert axis-alert-danger">{loadError}</div> : null}
      {saveError ? <div className="axis-alert axis-alert-danger">{saveError}</div> : null}
      {saveMessage ? <div className="axis-alert axis-alert-info">{saveMessage}</div> : null}

      <div className="assignment-quick">
        <p className="muted" style={{ margin: 0 }}>
          Quick targets
        </p>
        <div className="assignment-actions">
          <button type="button" className="axis-btn" onClick={() => addRow("allUsers")}>
            All users
          </button>
          <button type="button" className="axis-btn" onClick={() => addRow("allDevices")}>
            All devices
          </button>
          <IncludeExcludeToggle
            value={groupPickerMode}            includeLabel="Include"
            excludeLabel="Exclude"
            ariaLabel="Add group as include or exclude"
            onChange={setGroupPickerMode}
          />
        </div>
      </div>

      <label className="device-field">
        {groupPickerMode === "exclude" ? "Find group to exclude" : "Find group to include"}
        <input
          className="axis-input"
          value={groupQuery}
          onChange={(event) => setGroupQuery(event.target.value)}
          placeholder="Type at least 2 characters…"        />
      </label>

      {searching ? <p className="muted">Searching…</p> : null}
      {searchError ? <p className="muted" style={{ color: "var(--axis-danger)" }}>{searchError}</p> : null}
      {!searching &&
      !searchError &&
      groupQuery.trim().length >= 2 &&
      groupHits.length === 0 ? (
        <p className="muted">No groups matched.</p>
      ) : null}
      {groupHits.length > 0 ? (
        <ul className="assignment-hits">
          {groupHits.map((group) => (
            <li key={group.id}>
              <button
                type="button"
                className="assignment-hit-name assignment-hit-pick"                onClick={() =>
                  addRow(groupPickerMode === "exclude" ? "exclusionGroup" : "group", group)
                }
              >
                <span>{group.displayName}</span>
                <span
                  className={membershipPillClass(group.membership)}
                  title={group.membershipRule ?? undefined}
                >
                  {membershipLabel(group.membership)}
                </span>
              </button>
              <span className="assignment-hit-actions">
                <IncludeExcludeToggle
                  value={groupPickerMode}                  ariaLabel={`Add ${group.displayName} as include or exclude`}
                  onChange={(mode) => {
                    setGroupPickerMode(mode);
                    addRow(mode === "exclude" ? "exclusionGroup" : "group", group);
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <CreateEntraGroupPanel        namePlaceholder="e.g. Contoso — Policy pilots"
        successHint={
          groupPickerMode === "exclude"
            ? "and added as an exclusion. Save assignments to apply."
            : "and added as an include. Save assignments to apply."
        }
        onCreated={(group) =>
          addRow(groupPickerMode === "exclude" ? "exclusionGroup" : "group", group)
        }
      />

      <div>
        <div className="assignment-list-head">
          <p className="muted" style={{ margin: 0 }}>
            Assignments
          </p>
          {filtersLoading ? (
            <p className="muted" style={{ margin: 0 }}>
              Loading filters…
            </p>
          ) : filtersError ? (
            <p className="muted" style={{ margin: 0, color: "var(--axis-danger)" }}>
              {filtersError}
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {filters.length} filter{filters.length === 1 ? "" : "s"} available
            </p>
          )}
        </div>
        <ul className="assignment-rows">
          {rows.length === 0 ? (
            <li className="muted">
              No targets — save below to <strong>clear all assignments</strong>. Or add All users,
              All devices, or include/exclude a group above.
            </li>
          ) : (
            rows.map((row) => (
              <li key={row.key} className="assignment-row">
                <div className="assignment-row-top">
                  <div className="assignment-hit-name">
                    <span className={row.targetKind === "exclusionGroup" ? "muted" : undefined}>
                      {assignmentTargetLabel(row)}
                    </span>
                    {membershipLabel(row.groupMembership) ? (
                      <span
                        className={membershipPillClass(row.groupMembership)}
                        title={row.groupId ?? undefined}
                      >
                        {membershipLabel(row.groupMembership)}
                      </span>
                    ) : null}
                  </div>
                  <div className="assignment-row-actions">
                    {row.targetKind === "group" || row.targetKind === "exclusionGroup" ? (
                      <IncludeExcludeToggle
                        value={row.targetKind === "exclusionGroup" ? "exclude" : "include"}                        ariaLabel={`Include or exclude ${row.groupName || row.groupId || "group"}`}
                        onChange={(mode) => setRowGroupMode(row.key, mode === "exclude")}
                      />
                    ) : null}
                    <button
                      type="button"
                      className="axis-btn axis-btn-ghost"                      onClick={() => removeRow(row.key)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {supportsIntent ? (
                  <label className="assignment-filter">
                    <span>Intent</span>
                    <select
                      className="axis-input"
                      value={row.intent ?? "required"}                      onChange={(event) =>
                        setRowIntent(row.key, event.target.value as AssignmentIntent)
                      }
                    >
                      <option value="available">Available</option>
                      <option value="required">Required</option>
                      <option value="uninstall">Uninstall</option>
                    </select>
                  </label>
                ) : null}
                {row.targetKind !== "exclusionGroup" ? (
                  <div className="assignment-filter-row">
                    <label className="assignment-filter">
                      <span>Filter</span>
                      <select
                        className="axis-input"
                        value={row.filterId ?? ""}
                        disabled={filters.length === 0}
                        onChange={(event) => setRowFilter(row.key, event.target.value)}
                        aria-label={`Filter for ${assignmentTargetLabel(row)}`}
                      >
                        <option value="">None</option>
                        {filters.map((filter) => (
                          <option key={filter.id} value={filter.id}>
                            {formatFilterOption(filter)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {row.filterId ? (
                      <IncludeExcludeToggle
                        value={row.filterMode ?? "include"}                        includeLabel="Include"
                        excludeLabel="Exclude"
                        ariaLabel={`Filter mode for ${assignmentTargetLabel(row)}`}
                        onChange={(mode) =>
                          setRowFilterMode(row.key, mode as AssignmentFilterMode)
                        }
                      />
                    ) : null}
                  </div>
                ) : (
                  <p className="muted" style={{ margin: 0, fontSize: "0.6875rem" }}>
                    Exclusion groups do not use assignment filters.
                  </p>
                )}
                {supportsSchedule && row.targetKind !== "exclusionGroup" ? (
                  <div className="assignment-schedule">
                    <p className="muted" style={{ margin: "0.35rem 0 0.5rem", fontSize: "0.6875rem" }}>
                      Schedule
                      {row.runSchedule
                        ? ` · ${summarizeRemediationSchedule(row.runSchedule, row.runRemediationScript)}`
                        : ""}
                    </p>
                    <div className="assignment-filter-row">
                      <label className="assignment-filter">
                        <span>Frequency</span>
                        <select
                          className="axis-input"
                          value={row.runSchedule?.kind ?? "daily"}
                          onChange={(event) =>
                            setRowScheduleKind(row.key, event.target.value as RemediationScheduleKind)
                          }
                        >
                          <option value="hourly">Hourly</option>
                          <option value="daily">Daily</option>
                          <option value="runOnce">Once</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </label>
                      {row.runSchedule?.kind !== "runOnce" ? (
                        <label className="assignment-filter">
                          <span>Interval</span>
                          <input
                            className="axis-input"
                            type="number"
                            min={1}
                            max={23}
                            value={row.runSchedule?.interval ?? 1}
                            onChange={(event) =>
                              setRowScheduleInterval(row.key, Number(event.target.value))
                            }
                            aria-label={`Schedule interval for ${assignmentTargetLabel(row)}`}
                          />
                        </label>
                      ) : null}
                      {row.runSchedule?.kind !== "hourly" ? (
                        <label className="assignment-filter">
                          <span>Time</span>
                          <input
                            className="axis-input"
                            type="time"
                            value={row.runSchedule?.time ?? "08:00"}
                            onChange={(event) => setRowScheduleTime(row.key, event.target.value)}
                            aria-label={`Schedule time for ${assignmentTargetLabel(row)}`}
                          />
                        </label>
                      ) : null}
                      {row.runSchedule?.kind === "runOnce" ? (
                        <label className="assignment-filter">
                          <span>Date</span>
                          <input
                            className="axis-input"
                            type="date"
                            value={row.runSchedule?.date ?? ""}
                            onChange={(event) => setRowScheduleDate(row.key, event.target.value)}
                            aria-label={`Schedule date for ${assignmentTargetLabel(row)}`}
                          />
                        </label>
                      ) : null}
                    </div>
                    <div className="assignment-filter-row">
                      {row.runSchedule?.kind !== "hourly" ? (
                        <label className="axis-check">
                          <input
                            type="checkbox"
                            checked={row.runSchedule?.useUtc ?? false}
                            onChange={(event) =>
                              setRowScheduleUseUtc(row.key, event.target.checked)
                            }
                          />
                          Use UTC
                        </label>
                      ) : null}
                      <label className="axis-check">
                        <input
                          type="checkbox"
                          checked={row.runRemediationScript ?? true}
                          onChange={(event) =>
                            setRowRunRemediationScript(row.key, event.target.checked)
                          }
                        />
                        Run remediation script
                      </label>
                      {row.runSchedule ? (
                        <span className="muted" style={{ fontSize: "0.6875rem" }}>
                          {remediationScheduleKindLabel(row.runSchedule.kind)} ·{" "}
                          {remediationScheduleIntervalLabel(
                            row.runSchedule.kind,
                            row.runSchedule.interval,
                          )}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </li>
            ))
          )}
        </ul>
      </div>

      <p className="assignment-summary">{summary}</p>
      {rows.length > 0 ? (
        <button
          type="button"
          className="axis-btn axis-btn-ghost"          onClick={() => setRows([])}
        >
          Clear list
        </button>
      ) : null}
    </section>
  );
}
