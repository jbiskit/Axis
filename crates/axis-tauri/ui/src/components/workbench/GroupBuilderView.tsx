import { useCallback, useEffect, useMemo, useState } from "react";
import type { DirectoryGroup, GroupMembershipKind } from "../../types/inventory";
import {
  addDirectoryGroupMember,
  deleteGraphObject,
  listDirectoryGroupMembers,
  listDirectoryGroups,
  removeDirectoryGroupMember,
  searchDirectoryGroups,
  searchReadinessUsers,
  updateDirectoryGroup,
} from "../../lib/tauri";
import type { DirectoryGroupMember } from "../../lib/tauri";
import { useWriteGate, WriteActionButton } from "../../lib/readOnly";
import { CreateEntraGroupPanel } from "./CreateEntraGroupPanel";

function membershipLabel(kind?: GroupMembershipKind | null): string {
  if (kind === "dynamicDevice") return "Dynamic device";
  if (kind === "dynamicUser") return "Dynamic user";
  if (kind === "dynamic") return "Dynamic";
  if (kind === "assigned") return "Assigned";
  return "Unknown";
}

function membershipPillClass(kind?: GroupMembershipKind | null): string {
  if (kind === "dynamicUser") return "axis-pill axis-pill-success";
  if (kind === "dynamicDevice" || kind === "dynamic") return "axis-pill axis-pill-warning";
  return "axis-pill";
}

/** Groups the viewer can filter by. */
const FILTERS: { value: "all" | GroupMembershipKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "assigned", label: "Assigned" },
  { value: "dynamicUser", label: "Dynamic user" },
  { value: "dynamicDevice", label: "Dynamic device" },
];

export function GroupBuilderView() {
  const [query, setQuery] = useState("");
  const [allGroups, setAllGroups] = useState<DirectoryGroup[]>([]);
  const [allLoading, setAllLoading] = useState(true);
  const [allError, setAllError] = useState<string | null>(null);
  const [searchHits, setSearchHits] = useState<DirectoryGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | GroupMembershipKind>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [created, setCreated] = useState<DirectoryGroup[]>([]);
  const [members, setMembers] = useState<DirectoryGroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const { writeDisabled, writeHint } = useWriteGate();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editRule, setEditRule] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [addHits, setAddHits] = useState<{ id: string; label: string; meta: string }[]>([]);
  const [addSearching, setAddSearching] = useState(false);

  // Enumerate every group once; the search box filters this list locally.
  const loadAll = useCallback(async () => {
    setAllLoading(true);
    setAllError(null);
    try {
      const response = await listDirectoryGroups();
      setAllGroups(response.groups);
      setAllError(response.error);
    } catch (err) {
      setAllGroups([]);
      setAllError(err instanceof Error ? err.message : String(err));
    } finally {
      setAllLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Fall back to a Graph search when the local list is incomplete or empty.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchDirectoryGroups(trimmed)
        .then((response) => {
          if (cancelled) return;
          setSearchHits(response.groups);
          setError(response.error);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setSearchHits([]);
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  // Groups created in this session stay visible even if they don't match the query.
  const listed = useMemo(() => {
    const base = query.trim().length >= 2 ? searchHits : allGroups;
    const seen = new Set(base.map((group) => group.id));
    return [...created.filter((group) => !seen.has(group.id)), ...base];
  }, [allGroups, created, query, searchHits]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return listed.filter((group) => {
      if (filter !== "all" && group.membership !== filter) return false;
      if (!needle) return true;
      return group.displayName.toLowerCase().includes(needle);
    });
  }, [filter, listed, query]);

  const selected = filtered.find((group) => group.id === selectedId) ?? null;

  // Load members whenever the selection changes.
  useEffect(() => {
    if (!selectedId) {
      setMembers([]);
      setMembersError(null);
      return;
    }
    let cancelled = false;
    setMembersLoading(true);
    setMembersError(null);
    setMemberQuery("");
    void listDirectoryGroupMembers(selectedId)
      .then((response) => {
        if (cancelled) return;
        setMembers(response.members);
        setMembersError(response.error);
      })
      .catch((err: unknown) => {
        if (!cancelled) setMembersError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const filteredMembers = useMemo(() => {
    const needle = memberQuery.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((member) =>
      `${member.displayName} ${member.userPrincipalName ?? ""} ${member.operatingSystem ?? ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [memberQuery, members]);

  // Search users and devices to add as members.
  useEffect(() => {
    const trimmed = addQuery.trim();
    if (trimmed.length < 2) {
      setAddHits([]);
      setAddSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setAddSearching(true);
      void Promise.allSettled([searchReadinessUsers(trimmed), searchDirectoryGroups(trimmed)])
        .then(([users, groups]) => {
          if (cancelled) return;
          const hits: { id: string; label: string; meta: string }[] = [];
          if (users.status === "fulfilled") {
            for (const user of users.value.users) {
              hits.push({
                id: user.id,
                label: user.displayName,
                meta: `user · ${user.userPrincipalName}`,
              });
            }
          }
          if (groups.status === "fulfilled") {
            for (const group of groups.value.groups) {
              hits.push({ id: group.id, label: group.displayName, meta: "group" });
            }
          }
          setAddHits(hits);
        })
        .finally(() => {
          if (!cancelled) setAddSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [addQuery]);

  async function addMember(group: DirectoryGroup, memberId: string) {
    setBusy(true);
    setActionError(null);
    try {
      const response = await addDirectoryGroupMember(group.id, memberId);
      if (!response.ok) throw new Error(response.error ?? "Could not add the member.");
      setAddQuery("");
      setAddHits([]);
      const refreshed = await listDirectoryGroupMembers(group.id);
      setMembers(refreshed.members);
      setMembersError(refreshed.error);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not add the member.");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(group: DirectoryGroup, memberId: string) {
    setBusy(true);
    setActionError(null);
    try {
      const response = await removeDirectoryGroupMember(group.id, memberId);
      if (!response.ok) throw new Error(response.error ?? "Could not remove the member.");
      setMembers((current) => current.filter((member) => member.id !== memberId));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not remove the member.");
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(group: DirectoryGroup) {
    setEditing(true);
    setEditName(group.displayName);
    setEditRule(group.membershipRule ?? "");
    setActionError(null);
  }

  async function saveEdit(group: DirectoryGroup) {
    setBusy(true);
    setActionError(null);
    try {
      const response = await updateDirectoryGroup({
        id: group.id,
        displayName: editName.trim() || undefined,
        membershipRule: group.membershipRule ? editRule.trim() || undefined : undefined,
      });
      if (!response.ok) throw new Error(response.error ?? "Update failed.");
      setEditing(false);
      await loadAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup(group: DirectoryGroup) {
    setBusy(true);
    setActionError(null);
    try {
      const response = await deleteGraphObject("directoryGroup", group.id);
      if (!response.ok) throw new Error(response.error ?? "Delete failed.");
      setConfirmDelete(false);
      setSelectedId(null);
      setCreated((current) => current.filter((row) => row.id !== group.id));
      await loadAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <div className="axis-panel axis-panel-padded">
        <div className="assignment-list-head">
          <p className="axis-kicker">All groups</p>
          <button type="button" className="axis-btn" onClick={() => void loadAll()} disabled={allLoading}>
            {allLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <label className="device-field" style={{ marginTop: "0.6rem" }}>
          Filter by display name
          <input
            className="axis-input"
            value={query}
            placeholder="Type to filter…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="catalog-filter-chips" style={{ marginTop: "0.6rem" }}>
          {FILTERS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              className={`catalog-filter-chip${filter === entry.value ? " is-active" : ""}`}
              onClick={() => setFilter(entry.value)}
            >
              {entry.label}
            </button>
          ))}
          <span className="catalog-filter-count">
            {filtered.length} of {listed.length}
          </span>
        </div>
        {allLoading ? <p className="muted">Loading groups…</p> : null}
        {allError ? (
          <p className="muted" style={{ color: "var(--axis-danger)" }}>
            {allError}
          </p>
        ) : null}
        {searching ? <p className="muted">Searching Graph…</p> : null}
        {error ? (
          <p className="muted" style={{ color: "var(--axis-danger)" }}>
            {error}
          </p>
        ) : null}
        {!allLoading && !allError && filtered.length === 0 ? (
          <p className="muted">No groups matched.</p>
        ) : null}
      </div>

      <div className="group-builder-grid">
        <div className="axis-panel">
          <div className="panel-head" style={{ padding: "0.75rem 0.9rem" }}>
            <h2 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600 }}>Groups</h2>
          </div>
          <ul className="group-list">
            {filtered.length === 0 ? (
              <li className="muted" style={{ padding: "0.75rem" }}>
                Nothing to show.
              </li>
            ) : (
              filtered.map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    className={`group-list-item${group.id === selectedId ? " is-selected" : ""}`}
                    onClick={() => setSelectedId(group.id)}
                  >
                    <span className="group-list-name">{group.displayName}</span>
                    <span className={membershipPillClass(group.membership)}>
                      {membershipLabel(group.membership)}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="axis-panel axis-panel-padded">
          {selected ? (
            <div className="stack" style={{ gap: "0.7rem" }}>
              <div className="assignment-list-head">
                <div>
                  <p className="axis-kicker">Group</p>
                  <h2 style={{ margin: "0.2rem 0 0", fontSize: "1rem", fontWeight: 600 }}>
                    {selected.displayName}
                  </h2>
                </div>
                <div className="assignment-actions">
                  {editing ? null : (
                    <button
                      type="button"
                      className="axis-btn"
                      disabled={writeDisabled || busy}
                      title={writeDisabled ? writeHint : undefined}
                      onClick={() => beginEdit(selected)}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="axis-btn axis-btn-danger"
                    disabled={writeDisabled || busy}
                    title={writeDisabled ? writeHint : undefined}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {actionError ? (
                <p className="axis-alert axis-alert-danger" style={{ margin: 0 }}>
                  {actionError}
                </p>
              ) : null}

              {confirmDelete ? (
                <div className="axis-alert axis-alert-danger">
                  <p style={{ margin: "0 0 0.5rem" }}>
                    Delete “{selected.displayName}”? Assignments that target this group stop
                    applying. This cannot be undone.
                  </p>
                  <div className="assignment-actions">
                    <button
                      type="button"
                      className="axis-btn axis-btn-danger"
                      disabled={busy}
                      onClick={() => void removeGroup(selected)}
                    >
                      {busy ? "Deleting…" : "Delete group"}
                    </button>
                    <button
                      type="button"
                      className="axis-btn"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {editing ? (
                <>
                  <label className="device-field">
                    Display name
                    <input
                      className="axis-input"
                      value={editName}
                      disabled={busy}
                      onChange={(event) => setEditName(event.target.value)}
                    />
                  </label>
                  {selected.membershipRule ? (
                    <label className="device-field">
                      Membership rule
                      <textarea
                        className="axis-input create-group-rule-input"
                        value={editRule}
                        disabled={busy}
                        onChange={(event) => setEditRule(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <div className="assignment-actions">
                    <WriteActionButton
                      type="button"
                      className="axis-btn axis-btn-primary"
                      disabled={busy || !editName.trim()}
                      onClick={() => void saveEdit(selected)}
                    >
                      {busy ? "Saving…" : "Save changes"}
                    </WriteActionButton>
                    <button
                      type="button"
                      className="axis-btn"
                      disabled={busy}
                      onClick={() => setEditing(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <dl className="stat-rows">
                <div>
                  <dt className="muted">Membership</dt>
                  <dd style={{ margin: 0 }}>{membershipLabel(selected.membership)}</dd>
                </div>
                <div>
                  <dt className="muted">Object id</dt>
                  <dd className="mono-code" style={{ margin: 0, wordBreak: "break-all" }}>
                    {selected.id}
                  </dd>
                </div>
              </dl>
              )}
              {selected.membershipRule ? (
                <div>
                  <p className="axis-kicker">Membership rule</p>
                  <pre className="group-rule">{selected.membershipRule}</pre>
                  <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "var(--axis-text-2xs)" }}>
                    Dynamic membership is evaluated by Entra, not by Axis. A device or user joins
                    when it matches this rule.
                  </p>
                </div>
              ) : null}

              <div>
                <div className="assignment-list-head">
                  <p className="axis-kicker">
                    Members{membersLoading ? "" : ` (${members.length})`}
                  </p>
                  {members.length > 0 ? (
                    <input
                      className="axis-input"
                      style={{ maxWidth: "14rem" }}
                      value={memberQuery}
                      placeholder="Filter members…"
                      onChange={(event) => setMemberQuery(event.target.value)}
                    />
                  ) : null}
                </div>

                {selected.membershipRule ? (
                  <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "var(--axis-text-2xs)" }}>
                    This group is dynamic — Entra manages its members. Add or remove users and
                    devices by editing the rule above.
                  </p>
                ) : (
                  <div style={{ marginTop: "0.5rem" }}>
                    <label className="device-field">
                      Add a member
                      <input
                        className="axis-input"
                        value={addQuery}
                        placeholder="Search users or groups…"
                        disabled={writeDisabled || busy}
                        onChange={(event) => setAddQuery(event.target.value)}
                      />
                    </label>
                    {addSearching ? <p className="muted">Searching…</p> : null}
                    {addHits.length > 0 ? (
                      <ul className="assignment-hits">
                        {addHits.map((hit) => (
                          <li key={hit.id} className="assignment-hit">
                            <button
                              type="button"
                              className="assignment-hit-name assignment-hit-pick"
                              disabled={writeDisabled || busy}
                              onClick={() => void addMember(selected, hit.id)}
                            >
                              <span>{hit.label}</span>
                              <span className="muted">{hit.meta}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}

                {membersLoading ? (
                  <p className="muted" style={{ margin: "0.4rem 0 0" }}>
                    Loading members…
                  </p>
                ) : membersError ? (
                  <p className="muted" style={{ margin: "0.4rem 0 0", color: "var(--axis-danger)" }}>
                    {membersError}
                  </p>
                ) : members.length === 0 ? (
                  <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "var(--axis-text-xs)" }}>
                    {selected.membershipRule
                      ? "No members match the rule right now."
                      : "This group has no members."}
                  </p>
                ) : (
                  <ul className="group-members">
                    {filteredMembers.map((member) => (
                      <li key={member.id}>
                        <span className="group-member-name">{member.displayName}</span>
                        <span className="muted group-member-meta">
                          {[
                            member.kind,
                            member.userPrincipalName,
                            member.operatingSystem,
                            member.accountEnabled === false ? "disabled" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {selected.membershipRule ? null : (
                          <button
                            type="button"
                            className="axis-btn axis-btn-ghost"
                            disabled={writeDisabled || busy}
                            title={writeDisabled ? writeHint : undefined}
                            onClick={() => void removeMember(selected, member.id)}
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Select a group to inspect its membership type and rule.
            </p>
          )}
        </div>
      </div>

      <div className="axis-panel axis-panel-padded">
        <p className="axis-kicker">Create</p>
        <div style={{ marginTop: "0.6rem" }}>
          <CreateEntraGroupPanel
            namePlaceholder="e.g. Contoso — Policy pilots"
            successHint="and added to the list above."
            onCreated={(group) => {
              setCreated((current) => [group, ...current.filter((row) => row.id !== group.id)]);
              setSelectedId(group.id);
            }}
          />
        </div>
      </div>
    </div>
  );
}
