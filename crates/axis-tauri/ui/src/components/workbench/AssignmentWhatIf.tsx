import { useCallback, useEffect, useMemo, useState } from "react";
import type { ManagedDeviceSummary } from "../../types/glance";
import type {
  AppProtectionPolicy,
  AutopilotProfile,
  CatalogPolicySummary,
  DirectoryGroup,
  DirectoryGroupMembership,
  GroupMembershipKind,
  MobileAppSummary,
  TenantScriptSummary,
  WindowsUpdatePolicy,
} from "../../types/inventory";
import {
  fetchAppProtectionPolicies,
  fetchAssignmentSnapshot,
  fetchAutopilotProfiles,
  fetchCompliancePolicies,
  fetchConfigurationPolicies,
  fetchDeviceConfigurations,
  fetchGroupPolicyConfigurations,
  fetchManagedDeviceDetail,
  fetchMobileApps,
  fetchTenantScripts,
  fetchUserGroupMemberships,
  fetchWindowsUpdatePolicies,
  searchDirectoryGroups,
  searchReadinessUsers,
} from "../../lib/tauri";
import { navigate } from "../../lib/route";
import { IncludeExcludeToggle } from "./IncludeExcludeToggle";

function membershipLabel(kind?: GroupMembershipKind | null): string | null {
  if (kind === "dynamicDevice") return "Dynamic device";
  if (kind === "dynamicUser") return "Dynamic user";
  if (kind === "dynamic") return "Dynamic";
  if (kind === "assigned") return "Assigned";
  return null;
}

function membershipPillClass(kind?: GroupMembershipKind | null): string {
  if (kind === "dynamicUser") return "axis-pill axis-pill-success";
  if (kind === "dynamicDevice" || kind === "dynamic") return "axis-pill axis-pill-warning";
  return "axis-pill";
}

type Subject = "device" | "user";

/** One assignable object, flattened across every inventory family. */
type Candidate = {
  id: string;
  kind: string;
  label: string;
  group: string;
  /** Platform string from the object, when the inventory exposes one. */
  platforms?: string | null;
  /** Where to open it. */
  href: string;
};

type AssignmentRow = {
  id: string;
  targetKind: "allDevices" | "allUsers" | "group" | "exclusionGroup";
  groupId?: string | null;
  groupName?: string | null;
  filterId?: string | null;
  filterName?: string | null;
  filterMode?: "include" | "exclude" | null;
};

type Verdict = "applies" | "excluded" | "filtered-out" | "wrong-scope" | "unknown";

type Result = {
  candidate: Candidate;
  verdict: Verdict;
  reason: string;
  matchedGroup?: string | null;
};

const VERDICT_LABEL: Record<Verdict, string> = {
  applies: "Applies",
  excluded: "Excluded",
  "filtered-out": "Filtered out",
  "wrong-scope": "Wrong scope",
  unknown: "Unknown",
};

function deviceMatchesPlatform(platforms: string | null | undefined, os: string | null | undefined): boolean {
  if (!platforms) return true;
  const value = platforms.toLowerCase();
  const osValue = (os ?? "").toLowerCase();
  if (value.includes("windows")) return osValue.includes("windows");
  if (value.includes("macos") || value === "mac") return osValue.includes("mac");
  if (value.includes("ios")) return osValue.includes("ios");
  if (value.includes("android")) return osValue.includes("android");
  return true;
}

export function AssignmentWhatIf({ devices }: { devices: ManagedDeviceSummary[] }) {
  const [subject, setSubject] = useState<Subject>("device");
  const [deviceQuery, setDeviceQuery] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [userHits, setUserHits] = useState<{ id: string; displayName: string; userPrincipalName: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [deviceGroups, setDeviceGroups] = useState<DirectoryGroupMembership[]>([]);
  const [userGroups, setUserGroups] = useState<DirectoryGroupMembership[]>([]);
  const [deviceOs, setDeviceOs] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [loadingSubject, setLoadingSubject] = useState(false);
  const [subjectError, setSubjectError] = useState<string | null>(null);

  const [manualGroups, setManualGroups] = useState<DirectoryGroupMembership[]>([]);
  const [groupQuery, setGroupQuery] = useState("");
  const [groupHits, setGroupHits] = useState<DirectoryGroup[]>([]);
  const [groupSearching, setGroupSearching] = useState(false);
  const [groupSearchError, setGroupSearchError] = useState<string | null>(null);
  const [groupPickerMode, setGroupPickerMode] = useState<"include" | "exclude">("include");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [assignments, setAssignments] = useState<Record<string, AssignmentRow[]>>({});
  const [snapshotWarnings, setSnapshotWarnings] = useState<string[]>([]);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [loadingAssignments, setLoadingAssignments] = useState(false);

  // ---- load every object's assignment targets -----------------------------
  const loadAssignments = useCallback(async () => {
    setLoadingAssignments(true);
    setSnapshotError(null);
    try {
      const response = await fetchAssignmentSnapshot();
      if (response.error || !response.snapshot) {
        setSnapshotError(response.error ?? "Could not read assignments.");
        return;
      }
      const byObject: Record<string, AssignmentRow[]> = {};
      for (const entry of response.snapshot.objects) {
        byObject[entry.id] = entry.drafts.map((draft) => ({
          id: `${entry.id}:${draft.targetKind}:${draft.groupId ?? "all"}`,
          targetKind: draft.targetKind,
          groupId: draft.groupId ?? null,
          groupName: draft.groupName ?? null,
          filterId: draft.filterId ?? null,
          filterName: draft.filterName ?? null,
          filterMode: draft.filterMode ?? null,
        }));
      }
      setAssignments(byObject);
      setSnapshotWarnings(response.snapshot.warnings);
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingAssignments(false);
    }
  }, []);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  // ---- load the subject's group memberships -------------------------------
  useEffect(() => {
    if (subject !== "device" || !selectedDeviceId) {
      setDeviceGroups([]);
      setUserGroups([]);
      setDeviceOs(null);
      setDeviceName(null);
      return;
    }
    let cancelled = false;
    setLoadingSubject(true);
    setSubjectError(null);
    void fetchManagedDeviceDetail(selectedDeviceId)
      .then((response) => {
        if (cancelled) return;
        if (!response.device) {
          setSubjectError(response.error ?? "Could not load this device.");
          return;
        }
        setDeviceGroups(response.device.deviceGroups ?? []);
        setUserGroups(response.device.userGroups ?? []);
        setDeviceOs(response.device.operatingSystem ?? null);
        setDeviceName(response.device.deviceName ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSubjectError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingSubject(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDeviceId, subject]);

  // ---- user search --------------------------------------------------------
  useEffect(() => {
    if (subject !== "user") return;
    const query = userQuery.trim();
    if (query.length < 2) {
      setUserHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchReadinessUsers(query)
        .then((response) => {
          if (!cancelled) setUserHits(response.users);
        })
        .catch(() => {
          if (!cancelled) setUserHits([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [subject, userQuery]);

  // ---- resolve the selected user's group memberships ----------------------
  useEffect(() => {
    if (subject !== "user" || !selectedUserId) {
      setUserGroups([]);
      return;
    }
    let cancelled = false;
    setLoadingSubject(true);
    setSubjectError(null);
    void fetchUserGroupMemberships(selectedUserId)
      .then((response) => {
        if (cancelled) return;
        setUserGroups(response.groups);
        setSubjectError(response.error);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSubjectError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingSubject(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedUserId, subject]);

  // ---- group search (same picker as the assignments editor) ---------------
  useEffect(() => {
    const query = groupQuery.trim();
    if (query.length < 2) {
      setGroupHits([]);
      setGroupSearchError(null);
      setGroupSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setGroupSearching(true);
      setGroupSearchError(null);
      void searchDirectoryGroups(query)
        .then((response) => {
          if (cancelled) return;
          setGroupHits(response.groups);
          setGroupSearchError(response.error);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setGroupHits([]);
          setGroupSearchError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setGroupSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [groupQuery]);

  function addManualGroup(group: DirectoryGroup) {
    setManualGroups((current) => {
      const rest = current.filter((row) => row.id !== group.id);
      return [
        ...rest,
        {
          id: group.id,
          displayName: group.displayName,
          groupTypes: [],
          membershipKind: group.membership ?? subject,
        },
      ];
    });
    setGroupQuery("");
    setGroupHits([]);
  }

  function removeManualGroup(id: string) {
    setManualGroups((current) => current.filter((row) => row.id !== id));
  }

  // ---- load every assignable object --------------------------------------
  const loadCandidates = useCallback(async () => {
    setLoadingCandidates(true);
    const push = (
      rows: Candidate[],
      list: { id: string; label: string; platforms?: string | null }[],
      kind: string,
      group: string,
      href: (id: string) => string,
    ) => {
      for (const row of list) {
        rows.push({
          id: row.id,
          kind,
          label: row.label,
          group,
          platforms: row.platforms ?? null,
          href: href(row.id),
        });
      }
    };
    const rows: Candidate[] = [];
    const settled = await Promise.allSettled([
      fetchConfigurationPolicies(),
      fetchCompliancePolicies(),
      fetchDeviceConfigurations(),
      fetchGroupPolicyConfigurations(),
      fetchMobileApps(),
      fetchTenantScripts(),
      fetchAppProtectionPolicies(),
      fetchWindowsUpdatePolicies(),
      fetchAutopilotProfiles(),
    ]);
    const [catalog, compliance, deviceConfig, admx, apps, scripts, mam, wu, autopilot] = settled;
    if (catalog.status === "fulfilled") {
      push(
        rows,
        catalog.value.list.items.map((p: CatalogPolicySummary) => ({
          id: p.id,
          label: p.name,
          platforms: p.platforms,
        })),
        "configurationPolicy",
        "Settings Catalog",
        (id) => `/intune/policies/settings-catalog?policy=${encodeURIComponent(id)}`,
      );
    }
    if (compliance.status === "fulfilled") {
      push(
        rows,
        compliance.value.list.items.map((p: CatalogPolicySummary) => ({
          id: p.id,
          label: p.name,
          platforms: p.platforms,
        })),
        "compliancePolicy",
        "Compliance",
        (id) => `/intune/policies/compliance?policy=${encodeURIComponent(id)}`,
      );
    }
    if (deviceConfig.status === "fulfilled") {
      push(
        rows,
        deviceConfig.value.list.items.map((p: CatalogPolicySummary) => ({
          id: p.id,
          label: p.name,
          platforms: p.platforms,
        })),
        "deviceConfiguration",
        "Device configuration",
        (id) => `/intune/policies/device-configuration?policy=${encodeURIComponent(id)}`,
      );
    }
    if (admx.status === "fulfilled") {
      push(
        rows,
        admx.value.list.items.map((p: CatalogPolicySummary) => ({ id: p.id, label: p.name })),
        "groupPolicyConfiguration",
        "ADMX",
        (id) => `/intune/policies/admx-studio?policy=${encodeURIComponent(id)}`,
      );
    }
    if (apps.status === "fulfilled") {
      push(
        rows,
        apps.value.list.items.map((a: MobileAppSummary) => ({
          id: a.id,
          label: a.displayName,
          platforms: a.platform,
        })),
        "mobileApp",
        "Apps",
        (id) => `/intune/apps/tenant?app=${encodeURIComponent(id)}`,
      );
    }
    if (scripts.status === "fulfilled") {
      push(
        rows,
        scripts.value.list.items.map((s: TenantScriptSummary) => ({ id: s.id, label: s.displayName })),
        "script",
        "Scripts",
        (id) => `/intune/devices/scripts?script=${encodeURIComponent(id)}`,
      );
    }
    if (mam.status === "fulfilled") {
      push(
        rows,
        mam.value.list.items.map((p: AppProtectionPolicy) => ({ id: p.id, label: p.displayName })),
        "appProtection",
        "App protection",
        (id) => `/intune/apps/protection?policy=${encodeURIComponent(id)}`,
      );
    }
    if (wu.status === "fulfilled") {
      push(
        rows,
        wu.value.list.items.map((p: WindowsUpdatePolicy) => ({ id: p.id, label: p.name })),
        "windowsUpdate",
        "Windows Update",
        (id) => `/intune/windows-update/update-rings?policy=${encodeURIComponent(id)}`,
      );
    }
    if (autopilot.status === "fulfilled") {
      push(
        rows,
        autopilot.value.list.items.map((p: AutopilotProfile) => ({ id: p.id, label: p.displayName })),
        "autopilotProfile",
        "Autopilot",
        (id) => `/intune/enrollment/windows/autopilot/profiles?profile=${encodeURIComponent(id)}`,
      );
    }
    setCandidates(rows);
    setLoadingCandidates(false);
  }, []);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  // ---- resolve the subject's effective group set --------------------------
  const subjectGroups = useMemo(() => {
    const base = subject === "device" ? [...deviceGroups, ...userGroups] : userGroups;
    const seen = new Set(base.map((group) => group.id));
    return [...base, ...manualGroups.filter((group) => !seen.has(group.id))];
  }, [deviceGroups, manualGroups, subject, userGroups]);

  const groupIds = useMemo(() => new Set(subjectGroups.map((group) => group.id)), [subjectGroups]);

  const results = useMemo<Result[]>(() => {
    const ready = subject === "device" ? Boolean(selectedDeviceId) : Boolean(selectedUserId);
    return candidates.map((candidate) => {
      const rows = assignments[candidate.id] ?? [];
      if (rows.length === 0) {
        return { candidate, verdict: "unknown", reason: "No assignments loaded for this object." };
      }
      if (!ready) {
        return { candidate, verdict: "unknown", reason: "Pick a subject to evaluate." };
      }

      const includes = rows.filter((row) => row.targetKind === "group");
      const excludes = rows.filter((row) => row.targetKind === "exclusionGroup");
      const allDevices = rows.some((row) => row.targetKind === "allDevices");
      const allUsers = rows.some((row) => row.targetKind === "allUsers");

      const excludedBy = excludes.find((row) => row.groupId && groupIds.has(row.groupId));
      if (excludedBy) {
        return {
          candidate,
          verdict: "excluded",
          reason: `Excluded by “${excludedBy.groupName ?? "group"}”.`,
          matchedGroup: excludedBy.groupName,
        };
      }

      const matchedInclude = includes.find((row) => row.groupId && groupIds.has(row.groupId));
      const scopeMatch = subject === "device" ? allDevices : allUsers;
      if (!matchedInclude && !scopeMatch) {
        return {
          candidate,
          verdict: "unknown",
          reason: "Subject is not in any assigned group, and no all-devices/all-users assignment.",
        };
      }

      const matchedRow = matchedInclude ?? rows.find((row) => (subject === "device" ? row.targetKind === "allDevices" : row.targetKind === "allUsers"));
      if (matchedRow?.filterId) {
        return {
          candidate,
          verdict: "filtered-out",
          reason: `Reached via “${matchedRow.groupName ?? "all devices"}”, but gated by filter “${matchedRow.filterName ?? matchedRow.filterId}” (${matchedRow.filterMode ?? "include"}). Axis cannot evaluate filter rules.`,
          matchedGroup: matchedRow.groupName,
        };
      }

      if (subject === "device" && !deviceMatchesPlatform(candidate.platforms, deviceOs)) {
        return { candidate, verdict: "wrong-scope", reason: "Platform mismatch." };
      }

      return {
        candidate,
        verdict: "applies",
        reason: matchedInclude
          ? `Included by “${matchedInclude.groupName ?? "group"}”.`
          : `Included by ${subject === "device" ? "All devices" : "All users"}.`,
        matchedGroup: matchedInclude?.groupName,
      };
    });
  }, [assignments, candidates, deviceOs, groupIds, selectedDeviceId, selectedUserId, subject]);

  const grouped = useMemo(() => {
    const byGroup = new Map<string, Result[]>();
    for (const result of results) {
      const list = byGroup.get(result.candidate.group) ?? [];
      list.push(result);
      byGroup.set(result.candidate.group, list);
    }
    return [...byGroup.entries()];
  }, [results]);

  const applies = results.filter((result) => result.verdict === "applies");

  const deviceHits = useMemo(() => {
    const query = deviceQuery.trim().toLowerCase();
    if (!query) return devices.slice(0, 8);
    return devices
      .filter((device) =>
        `${device.deviceName} ${device.userPrincipalName ?? ""}`.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [deviceQuery, devices]);

  return (
    <div className="stack" style={{ gap: "1rem" }}>
      {/* ---- step 1: subject ---- */}
      <div className="axis-panel axis-panel-padded">
        <p className="axis-kicker">1 · Who are we evaluating?</p>
        <div className="whatif-row" style={{ marginTop: "0.6rem" }}>
          <div className="seg" style={{ marginLeft: 0 }}>
            <button
              type="button"
              className={`seg-btn${subject === "device" ? " is-active" : ""}`}
              onClick={() => setSubject("device")}
            >
              A device
            </button>
            <button
              type="button"
              className={`seg-btn${subject === "user" ? " is-active" : ""}`}
              onClick={() => setSubject("user")}
            >
              A user
            </button>
          </div>
        </div>

        {subject === "device" ? (
          <div style={{ marginTop: "0.75rem" }}>
            <label className="device-field">
              Find a device
              <input
                className="axis-input"
                value={deviceQuery}
                placeholder="Device name or primary user…"
                onChange={(event) => setDeviceQuery(event.target.value)}
              />
            </label>
            <ul className="whatif-picks">
              {deviceHits.map((device) => (
                <li key={device.id}>
                  <button
                    type="button"
                    className={`whatif-pick${device.id === selectedDeviceId ? " is-selected" : ""}`}
                    onClick={() => setSelectedDeviceId(device.id)}
                  >
                    <span>{device.deviceName}</span>
                    <span className="muted">
                      {[device.operatingSystem, device.userPrincipalName].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div style={{ marginTop: "0.75rem" }}>
            <label className="device-field">
              Find a user
              <input
                className="axis-input"
                value={userQuery}
                placeholder="Name or UPN…"
                onChange={(event) => setUserQuery(event.target.value)}
              />
            </label>
            <ul className="whatif-picks">
              {userHits.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    className={`whatif-pick${user.id === selectedUserId ? " is-selected" : ""}`}
                    onClick={() => {
                      setSelectedUserId(user.id);
                    }}
                  >
                    <span>{user.displayName}</span>
                    <span className="muted">{user.userPrincipalName}</span>
                  </button>
                </li>
              ))}
            </ul>
            {selectedUserId ? (
              <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "var(--axis-text-2xs)" }}>
                Resolving group memberships…
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* ---- step 2: group memberships ---- */}
      <div className="axis-panel axis-panel-padded">
        <p className="axis-kicker">2 · Group memberships</p>
        {subject === "device" ? (
          loadingSubject ? (
            <p className="muted" style={{ margin: "0.5rem 0 0" }}>Resolving group memberships…</p>
          ) : subjectError ? (
            <p className="axis-alert axis-alert-danger" style={{ marginTop: "0.5rem" }}>{subjectError}</p>
          ) : selectedDeviceId ? (
            <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "var(--axis-text-xs)" }}>
              {deviceName} is in {subjectGroups.length} group{subjectGroups.length === 1 ? "" : "s"}
              {deviceOs ? ` · ${deviceOs}` : ""}.
            </p>
          ) : (
            <p className="muted" style={{ margin: "0.4rem 0 0" }}>Pick a device to resolve its groups.</p>
          )
        ) : loadingSubject ? (
          <p className="muted" style={{ margin: "0.5rem 0 0" }}>Resolving group memberships…</p>
        ) : subjectError ? (
          <p className="axis-alert axis-alert-danger" style={{ marginTop: "0.5rem" }}>{subjectError}</p>
        ) : selectedUserId ? (
          <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "var(--axis-text-xs)" }}>
            This user is in {subjectGroups.length} group{subjectGroups.length === 1 ? "" : "s"}.
          </p>
        ) : (
          <p className="muted" style={{ margin: "0.4rem 0 0" }}>Pick a user to resolve their groups.</p>
        )}

        {subjectGroups.length > 0 ? (
          <ul className="whatif-groups">
            {subjectGroups.map((group) => (
              <li key={group.id}>
                <span>{group.displayName}</span>
                {membershipLabel(group.membershipKind as GroupMembershipKind) ? (
                  <span className={membershipPillClass(group.membershipKind as GroupMembershipKind)}>
                    {membershipLabel(group.membershipKind as GroupMembershipKind)}
                  </span>
                ) : null}
                {manualGroups.some((row) => row.id === group.id) ? (
                  <button
                    type="button"
                    className="axis-btn-ghost"
                    onClick={() => removeManualGroup(group.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="assignment-quick" style={{ marginTop: "0.75rem" }}>
          <p className="muted" style={{ margin: 0 }}>
            Add a group membership
          </p>
          <div className="assignment-actions">
            <IncludeExcludeToggle
              value={groupPickerMode}
              includeLabel="Include"
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
            placeholder="Type at least 2 characters…"
            onChange={(event) => setGroupQuery(event.target.value)}
          />
        </label>

        {groupSearching ? <p className="muted">Searching…</p> : null}
        {groupSearchError ? (
          <p className="muted" style={{ color: "var(--axis-danger)" }}>
            {groupSearchError}
          </p>
        ) : null}
        {!groupSearching &&
        !groupSearchError &&
        groupQuery.trim().length >= 2 &&
        groupHits.length === 0 ? (
          <p className="muted">No groups matched.</p>
        ) : null}
        {groupHits.length > 0 ? (
          <ul className="assignment-hits">
            {groupHits.map((group) => {
              const added = subjectGroups.some((row) => row.id === group.id);
              return (
                <li key={group.id} className={added ? "assignment-hit is-assigned" : "assignment-hit"}>
                  <button
                    type="button"
                    className="assignment-hit-name assignment-hit-pick"
                    onClick={() => addManualGroup(group)}
                  >
                    <span>{group.displayName}</span>
                    {membershipLabel(group.membership) ? (
                      <span
                        className={membershipPillClass(group.membership)}
                        title={group.membershipRule ?? undefined}
                      >
                        {membershipLabel(group.membership)}
                      </span>
                    ) : null}
                  </button>
                  <span className="assignment-hit-actions">
                    <IncludeExcludeToggle
                      value={added ? "include" : null}
                      ariaLabel={`Add ${group.displayName} as a membership`}
                      onChange={() => addManualGroup(group)}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/* ---- step 3: results ---- */}
      <div className="axis-panel axis-panel-padded">
        <p className="axis-kicker">3 · What applies</p>
        <p className="muted" style={{ margin: "0.4rem 0 0.6rem", fontSize: "var(--axis-text-xs)" }}>
          {loadingCandidates || loadingAssignments
            ? "Loading tenant objects and assignments…"
            : `${applies.length} of ${candidates.length} objects would apply to this ${subject}.`}
        </p>
        {snapshotError ? (
          <p className="axis-alert axis-alert-danger" style={{ marginBottom: "0.6rem" }}>
            {snapshotError}{" "}
            <button type="button" className="axis-btn" onClick={() => void loadAssignments()}>
              Retry
            </button>
          </p>
        ) : null}
        {snapshotWarnings.length > 0 ? (
          <details style={{ marginBottom: "0.6rem" }}>
            <summary className="muted" style={{ cursor: "pointer", fontSize: "var(--axis-text-2xs)" }}>
              {snapshotWarnings.length} collection{snapshotWarnings.length === 1 ? "" : "s"} could not be read
            </summary>
            <ul className="overview-list" style={{ marginTop: "0.35rem" }}>
              {snapshotWarnings.map((warning) => (
                <li key={warning}>
                  <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-2xs)" }}>
                    {warning}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {grouped.map(([group, rows]) => {
          const hits = rows.filter((row) => row.verdict === "applies");
          if (hits.length === 0) return null;
          return (
            <div key={group} className="whatif-result-group">
              <p className="whatif-result-group-label">
                {group} <span className="muted">({hits.length})</span>
              </p>
              <ul className="whatif-results">
                {hits.map((row) => (
                  <li key={row.candidate.id} className={`whatif-result is-${row.verdict}`}>
                    <button
                      type="button"
                      className="whatif-result-name"
                      onClick={() => navigate(row.candidate.href)}
                    >
                      {row.candidate.label}
                    </button>
                    <span className="whatif-result-reason">{row.reason}</span>
                    <span className={`whatif-badge is-${row.verdict}`}>
                      {VERDICT_LABEL[row.verdict]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        {!loadingCandidates && !loadingAssignments && applies.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nothing applies. Either no object is assigned to this {subject}'s groups, or the
            assignments could not be read.
          </p>
        ) : null}
      </div>
    </div>
  );
}
