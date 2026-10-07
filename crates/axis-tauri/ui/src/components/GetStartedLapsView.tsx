import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LAPS_BACKUP_OPTIONS,
  LAPS_COMPLEXITY_OPTIONS,
  LAPS_POST_AUTH_OPTIONS,
  defaultLapsPolicyDraft,
  lapsComplexityIsPassphrase,
  lapsManagedAccountNameProblem,
  lapsPassphraseLengthProblem,
  lapsPasswordAgeProblem,
  lapsPasswordLengthProblem,
  lapsPolicyNameProblem,
  lapsResetDelayProblem,
  toCreateLapsInput,
  type LapsPolicyDraft,
} from "../lib/laps";
import { READ_ONLY_WRITE_HINT, useReadOnly } from "../lib/readOnly";
import { navigate } from "../lib/route";
import {
  assignObjectAssignments,
  createLapsPolicy,
  enableLapsForTenant,
  fetchLapsTenantStatus,
  searchDirectoryGroups,
  type LapsTenantStatus,
} from "../lib/tauri";
import { assignmentTargetLabel } from "../lib/assignmentSummary";
import type { AssignmentDraft, DirectoryGroup, GroupMembershipKind } from "../types/inventory";
import { PageHeader } from "./ui/PageChrome";
import { CreateEntraGroupPanel } from "./workbench/CreateEntraGroupPanel";
import { IncludeExcludeToggle } from "./workbench/IncludeExcludeToggle";

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

type StepId = "basics" | "password" | "options" | "group" | "review";

type CreatedPiece = { label: string; id: string };

function backupLabel(value: number): string {
  return LAPS_BACKUP_OPTIONS.find((option) => option.value === value)?.label ?? "Microsoft Entra ID only";
}

function complexityLabel(value: number): string {
  return LAPS_COMPLEXITY_OPTIONS.find((option) => option.value === value)?.label ?? String(value);
}

function postAuthLabel(value: number): string {
  return LAPS_POST_AUTH_OPTIONS.find((option) => option.value === value)?.label ?? String(value);
}

export function GetStartedLapsView() {
  const readOnly = useReadOnly();
  const [draft, setDraft] = useState<LapsPolicyDraft>(() => defaultLapsPolicyDraft());
  const [step, setStep] = useState<StepId>("basics");
  const [assignments, setAssignments] = useState<AssignmentDraft[]>([]);
  const [groupPickerMode, setGroupPickerMode] = useState<"include" | "exclude">("include");
  const [groupQuery, setGroupQuery] = useState("");
  const [groupHits, setGroupHits] = useState<DirectoryGroup[]>([]);
  const [groupSearching, setGroupSearching] = useState(false);
  const [groupSearchError, setGroupSearchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPiece[]>([]);
  const [finished, setFinished] = useState(false);
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [policyAssigned, setPolicyAssigned] = useState(false);
  const [tenantStatus, setTenantStatus] = useState<LapsTenantStatus | null>(null);
  const [tenantLoading, setTenantLoading] = useState(true);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);

  const loadTenantStatus = useCallback(() => {
    setTenantLoading(true);
    setTenantError(null);
    void fetchLapsTenantStatus()
      .then((response) => {
        setTenantStatus(response.status);
        setTenantError(response.error);
      })
      .catch((err: unknown) => {
        setTenantStatus(null);
        setTenantError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setTenantLoading(false));
  }, []);

  useEffect(() => {
    loadTenantStatus();
  }, [loadTenantStatus]);

  async function enableTenant() {
    if (readOnly || enabling) return;
    setEnabling(true);
    setTenantError(null);
    try {
      const response = await enableLapsForTenant();
      if (!response.ok) throw new Error(response.error ?? "Failed to enable Windows LAPS.");
      loadTenantStatus();
    } catch (err) {
      setTenantError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnabling(false);
    }
  }

  const steps = useMemo<{ id: StepId; label: string }[]>(
    () => [
      { id: "basics", label: "Basics" },
      { id: "password", label: "Password" },
      { id: "options", label: "Options" },
      { id: "group", label: "Groups" },
      { id: "review", label: "Review" },
    ],
    [],
  );

  useEffect(() => {
    const query = groupQuery.trim();
    if (query.length < 2) {
      setGroupHits([]);
      setGroupSearchError(null);
      setGroupSearching(false);
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(() => {
      setGroupSearching(true);
      setGroupSearchError(null);
      void searchDirectoryGroups(query)
        .then((response) => {
          if (cancel) return;
          setGroupHits(response.groups);
          setGroupSearchError(response.error);
        })
        .catch((err: unknown) => {
          if (cancel) return;
          setGroupHits([]);
          setGroupSearchError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancel) setGroupSearching(false);
        });
    }, 300);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [groupQuery]);

  const nameProblem = lapsPolicyNameProblem(draft.displayName);
  const ageProblem = lapsPasswordAgeProblem(draft.passwordAgeDays);
  const passphrase = lapsComplexityIsPassphrase(draft.passwordComplexity);
  const lengthProblem = passphrase
    ? lapsPassphraseLengthProblem(draft.passphraseLength)
    : lapsPasswordLengthProblem(draft.passwordLength);
  const adminProblem = lapsManagedAccountNameProblem(draft.managedAccountName);
  const delayProblem = lapsResetDelayProblem(draft.postAuthenticationResetDelay);
  const groupProblem = assignments.some((row) => row.targetKind === "group")
    ? null
    : "Add at least one include group.";

  const stepProblem =
    step === "basics"
      ? nameProblem
      : step === "password"
        ? ageProblem ?? lengthProblem
        : step === "options"
          ? adminProblem ?? delayProblem
          : step === "group"
            ? groupProblem
            : nameProblem ?? ageProblem ?? lengthProblem ?? adminProblem ?? delayProblem ?? groupProblem;

  function addGroup(targetKind: "group" | "exclusionGroup", group: DirectoryGroup) {
    setAssignments((current) => {
      const rest = current.filter(
        (row) =>
          row.groupId !== group.id ||
          (row.targetKind !== "group" && row.targetKind !== "exclusionGroup"),
      );
      return [
        ...rest,
        {
          targetKind,
          groupId: group.id,
          groupName: group.displayName,
          groupMembership: group.membership,
        },
      ];
    });
  }

  function assignedMode(groupId: string): "include" | "exclude" | null {
    const match = assignments.find(
      (row) =>
        row.groupId === groupId && (row.targetKind === "group" || row.targetKind === "exclusionGroup"),
    );
    if (!match) return null;
    return match.targetKind === "exclusionGroup" ? "exclude" : "include";
  }

  function go(next: number) {
    const index = steps.findIndex((item) => item.id === step);
    const target = steps[index + next];
    if (!target) return;
    if (next > 0 && stepProblem) return;
    setStep(target.id);
  }

  async function create() {
    if (readOnly || busy || finished || stepProblem) return;
    setBusy(true);
    setError(null);
    const pieces = [...created];
    let id = policyId;
    let assigned = policyAssigned;
    try {
      if (!assignments.some((row) => row.targetKind === "group")) {
        throw new Error("Add at least one include group.");
      }
      for (const row of assignments) {
        if (!row.groupId || pieces.some((piece) => piece.id === row.groupId)) continue;
        pieces.push({
          label:
            row.targetKind === "exclusionGroup"
              ? `Exclude ${row.groupName ?? "group"}`
              : `Include ${row.groupName ?? "group"}`,
          id: row.groupId,
        });
      }
      setCreated([...pieces]);
      if (!id) {
        setProgress("Creating LAPS policy…");
        const response = await createLapsPolicy(toCreateLapsInput(draft));
        if (!response.policy) throw new Error(response.error ?? "Failed to create the LAPS policy.");
        id = response.policy.id;
        setPolicyId(response.policy.id);
        pieces.push({ label: "LAPS policy", id: response.policy.id });
        setCreated([...pieces]);
      }
      if (id && !assigned) {
        setProgress("Assigning LAPS policy…");
        const result = await assignObjectAssignments({
          kind: "configurationPolicy",
          id,
          drafts: assignments,
        });
        if (!result.ok) throw new Error(result.error ?? "Failed to assign the LAPS policy.");
        assigned = true;
        setPolicyAssigned(true);
      }
      setFinished(true);
      setProgress(null);
    } catch (err) {
      setCreated(pieces);
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  const index = steps.findIndex((item) => item.id === step);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Get Started"
        title="Windows LAPS"
        description="Create an Endpoint Security account protection policy that turns on Windows LAPS, then assign it to the groups whose devices should rotate their local administrator password."
      />
      {tenantLoading ? (
        <p className="muted">Checking whether Windows LAPS is enabled for this tenant…</p>
      ) : tenantError ? (
        <div className="axis-alert axis-alert-danger">
          <p style={{ margin: "0 0 0.35rem" }}>Could not read the tenant LAPS setting.</p>
          <p className="muted" style={{ margin: "0 0 0.5rem" }}>
            {tenantError}
          </p>
          <button type="button" className="axis-btn" onClick={loadTenantStatus}>
            Retry
          </button>
        </div>
      ) : tenantStatus?.enabled ? (
        <div className="axis-alert axis-alert-info">Windows LAPS is enabled for this tenant.</div>
      ) : (
        <div className="axis-alert axis-alert-danger">
          <p style={{ margin: "0 0 0.35rem" }}>
            Windows LAPS is not enabled for this tenant. Devices can't back up local administrator
            passwords until it's turned on.
          </p>
          <button
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={readOnly || enabling}
            onClick={() => void enableTenant()}
          >
            {enabling ? "Enabling…" : "Enable Windows LAPS"}
          </button>
        </div>
      )}
      <div className="axis-panel axis-panel-padded get-started">
        <ol className="get-started-steps">
          {steps.map((item, itemIndex) => (
            <li key={item.id}>
              <button
                type="button"
                className="axis-btn get-started-step"
                aria-current={item.id === step ? "step" : undefined}
                disabled={itemIndex > index}
                onClick={() => setStep(item.id)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ol>

        {finished ? (
          <div className="stack" style={{ gap: "0.85rem" }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>LAPS policy created</h2>
            <ul className="catalog-delete-list">
              {created.map((piece) => (
                <li key={`${piece.label}:${piece.id}`}>
                  {piece.label}
                  <span className="muted"> · {piece.id}</span>
                </li>
              ))}
            </ul>
            {policyId ? (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="axis-btn"
                  onClick={() =>
                    navigate(
                      `/intune/endpoint-security/account-protection?policy=${encodeURIComponent(
                        policyId,
                      )}`,
                    )
                  }
                >
                  Open LAPS policy
                </button>
              </div>
            ) : null}
            <div className="axis-alert axis-alert-info">
              <p style={{ margin: "0 0 0.35rem" }}>Finish these steps outside Axis.</p>
              <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                <li>Confirm the assigned devices are running a Windows build that supports Windows LAPS.</li>
                {draft.backupDirectory === 2 ? (
                  <li>
                    Grant the devices permission to write the password to Active Directory, and confirm the
                    domain functional level supports password encryption.
                  </li>
                ) : (
                  <li>
                    Grant the signed-in operators the DeviceLocalCredential.Read.All permission so they can
                    read the backed-up passwords.
                  </li>
                )}
              </ul>
            </div>
          </div>
        ) : (
          <>
            {step === "basics" ? (
              <section className="stack" style={{ gap: "0.75rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Name and backup directory</h2>
                <label className="device-field">
                  Policy name
                  <input
                    className={`axis-input${nameProblem ? " is-invalid" : ""}`}
                    value={draft.displayName}
                    placeholder="Windows LAPS"
                    aria-invalid={nameProblem ? true : undefined}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, displayName: event.target.value }))
                    }
                  />
                  {nameProblem ? (
                    <span className="setting-field-error" role="alert">
                      {nameProblem}
                    </span>
                  ) : null}
                </label>
                <p className="muted" style={{ margin: 0 }}>
                  Where should the local administrator password be backed up?
                </p>
                <div className="get-started-choices">
                  {LAPS_BACKUP_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="axis-btn get-started-choice"
                      aria-pressed={draft.backupDirectory === option.value}
                      onClick={() =>
                        setDraft((current) => ({ ...current, backupDirectory: option.value }))
                      }
                    >
                      <strong>{option.label}</strong>
                      <span>{option.hint}</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {step === "password" ? (
              <section className="stack" style={{ gap: "0.75rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Password policy</h2>
                <label className="device-field">
                  Maximum password age (days)
                  <input
                    className={`axis-input${ageProblem ? " is-invalid" : ""}`}
                    type="number"
                    min={1}
                    max={365}
                    value={draft.passwordAgeDays}
                    aria-invalid={ageProblem ? true : undefined}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        passwordAgeDays: Number(event.target.value),
                      }))
                    }
                  />
                  {ageProblem ? (
                    <span className="setting-field-error" role="alert">
                      {ageProblem}
                    </span>
                  ) : null}
                </label>
                <label className="device-field">
                  Password complexity
                  <select
                    className="axis-input"
                    value={draft.passwordComplexity}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        passwordComplexity: Number(event.target.value),
                      }))
                    }
                  >
                    {LAPS_COMPLEXITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {passphrase ? (
                  <label className="device-field">
                    Passphrase length (words)
                    <input
                      className={`axis-input${lengthProblem ? " is-invalid" : ""}`}
                      type="number"
                      min={3}
                      max={10}
                      value={draft.passphraseLength}
                      aria-invalid={lengthProblem ? true : undefined}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          passphraseLength: Number(event.target.value),
                        }))
                      }
                    />
                    {lengthProblem ? (
                      <span className="setting-field-error" role="alert">
                        {lengthProblem}
                      </span>
                    ) : (
                      <span className="muted">Passphrases need Windows 11 24H2 or later.</span>
                    )}
                  </label>
                ) : (
                  <label className="device-field">
                    Password length (characters)
                    <input
                      className={`axis-input${lengthProblem ? " is-invalid" : ""}`}
                      type="number"
                      min={8}
                      max={64}
                      value={draft.passwordLength}
                      aria-invalid={lengthProblem ? true : undefined}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          passwordLength: Number(event.target.value),
                        }))
                      }
                    />
                    {lengthProblem ? (
                      <span className="setting-field-error" role="alert">
                        {lengthProblem}
                      </span>
                    ) : null}
                  </label>
                )}
              </section>
            ) : null}

            {step === "options" ? (
              <section className="stack" style={{ gap: "0.75rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Account and post-authentication actions</h2>
                <label className="device-field">
                  Managed account name or prefix
                  <span className="muted" style={{ display: "block", fontSize: "0.7rem" }}>
                    Optional. When set, Windows LAPS creates and manages this local administrator account.
                    Leave blank to manage the built-in local administrator account.
                  </span>
                  <input
                    className={`axis-input${adminProblem ? " is-invalid" : ""}`}
                    value={draft.managedAccountName}
                    placeholder="Optional"
                    aria-invalid={adminProblem ? true : undefined}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        managedAccountName: event.target.value,
                      }))
                    }
                  />
                  {adminProblem ? (
                    <span className="setting-field-error" role="alert">
                      {adminProblem}
                    </span>
                  ) : null}
                </label>
                <label className="device-field">
                  Post-authentication action
                  <select
                    className="axis-input"
                    value={draft.postAuthenticationActions}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        postAuthenticationActions: Number(event.target.value),
                      }))
                    }
                  >
                    {LAPS_POST_AUTH_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="device-field">
                  Post-authentication reset delay (hours)
                  <input
                    className={`axis-input${delayProblem ? " is-invalid" : ""}`}
                    type="number"
                    min={0}
                    max={24}
                    value={draft.postAuthenticationResetDelay}
                    aria-invalid={delayProblem ? true : undefined}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        postAuthenticationResetDelay: Number(event.target.value),
                      }))
                    }
                  />
                  {delayProblem ? (
                    <span className="setting-field-error" role="alert">
                      {delayProblem}
                    </span>
                  ) : (
                    <span className="muted">Set to 0 to disable post-authentication actions.</span>
                  )}
                </label>
              </section>
            ) : null}

            {step === "group" ? (
              <section className="stack" style={{ gap: "0.75rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Include and exclude groups</h2>
                <p className="muted" style={{ margin: 0 }}>
                  These groups are assigned to the LAPS policy. Include groups receive the policy; excludes
                  are optional.
                </p>
                <div className="assignment-quick">
                  <IncludeExcludeToggle
                    value={groupPickerMode}
                    includeLabel="Include"
                    excludeLabel="Exclude"
                    ariaLabel="Add group as include or exclude"
                    onChange={setGroupPickerMode}
                  />
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
                {!groupSearching && !groupSearchError && groupQuery.trim().length >= 2 && groupHits.length === 0 ? (
                  <p className="muted">No groups matched.</p>
                ) : null}
                {groupHits.length > 0 ? (
                  <ul className="assignment-hits">
                    {groupHits.map((group) => {
                      const mode = assignedMode(group.id);
                      return (
                        <li key={group.id} className={mode ? "assignment-hit is-assigned" : "assignment-hit"}>
                          <button
                            type="button"
                            className="assignment-hit-name assignment-hit-pick"
                            onClick={() =>
                              addGroup(groupPickerMode === "exclude" ? "exclusionGroup" : "group", group)
                            }
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
                              value={mode}
                              ariaLabel={`Add ${group.displayName} as an assignment`}
                              onChange={(next) =>
                                addGroup(next === "exclude" ? "exclusionGroup" : "group", group)
                              }
                            />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <CreateEntraGroupPanel
                  disabled={readOnly || busy}
                  autopilotOrderId
                  namePlaceholder="e.g. LAPS devices"
                  successHint={
                    groupPickerMode === "exclude"
                      ? "and added as an exclude."
                      : "and added as an include."
                  }
                  onCreated={(group) =>
                    addGroup(groupPickerMode === "exclude" ? "exclusionGroup" : "group", group)
                  }
                />
                <div>
                  <p className="muted" style={{ margin: 0 }}>
                    Assignments
                  </p>
                  <ul className="assignment-rows">
                    {assignments.length === 0 ? (
                      <li className="muted">Include at least one group. Excludes are optional.</li>
                    ) : (
                      assignments.map((row) => (
                        <li key={`${row.targetKind}:${row.groupId}`} className="assignment-row">
                          <div className="assignment-row-top">
                            <div className="assignment-hit-name">
                              <span className={row.targetKind === "exclusionGroup" ? "muted" : undefined}>
                                {assignmentTargetLabel(row)}
                              </span>
                              {membershipLabel(row.groupMembership) ? (
                                <span className={membershipPillClass(row.groupMembership)}>
                                  {membershipLabel(row.groupMembership)}
                                </span>
                              ) : null}
                            </div>
                            <div className="assignment-row-actions">
                              <IncludeExcludeToggle
                                value={row.targetKind === "exclusionGroup" ? "exclude" : "include"}
                                ariaLabel={`Include or exclude ${row.groupName || "group"}`}
                                onChange={(mode) =>
                                  setAssignments((current) =>
                                    current.map((item) =>
                                      item.groupId === row.groupId
                                        ? {
                                            ...item,
                                            targetKind: mode === "exclude" ? "exclusionGroup" : "group",
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              />
                              <button
                                type="button"
                                className="axis-btn axis-btn-ghost"
                                onClick={() =>
                                  setAssignments((current) =>
                                    current.filter((item) => item.groupId !== row.groupId),
                                  )
                                }
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </section>
            ) : null}

            {step === "review" ? (
              <section className="stack" style={{ gap: "0.75rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Create this policy</h2>
                <ul className="catalog-delete-list">
                  <li>Windows LAPS policy: {draft.displayName.trim()}</li>
                  <li>Back up the password to {backupLabel(draft.backupDirectory)}</li>
                  <li>
                    Password age {draft.passwordAgeDays} days, {complexityLabel(draft.passwordComplexity)},{" "}
                    {passphrase
                      ? `${draft.passphraseLength} word${draft.passphraseLength === 1 ? "" : "s"}`
                      : `${draft.passwordLength} characters`}
                  </li>
                  <li>
                    {postAuthLabel(draft.postAuthenticationActions)} after{" "}
                    {draft.postAuthenticationResetDelay} hour
                    {draft.postAuthenticationResetDelay === 1 ? "" : "s"}
                  </li>
                  {draft.managedAccountName.trim() ? (
                    <li>Automatically manage the “{draft.managedAccountName.trim()}” account</li>
                  ) : null}
                  {assignments.map((row) => (
                    <li key={`${row.targetKind}:${row.groupId}`}>{assignmentTargetLabel(row)}</li>
                  ))}
                </ul>
                {created.length > 0 ? (
                  <ul className="catalog-delete-list">
                    {created.map((piece) => (
                      <li key={`${piece.label}:${piece.id}`}>Already created: {piece.label}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {stepProblem ? <p className="muted">{stepProblem}</p> : null}
            {readOnly ? <p className="muted">{READ_ONLY_WRITE_HINT}</p> : null}
            {error ? <p className="axis-alert axis-alert-danger">{error}</p> : null}
            {progress ? <p className="muted">{progress}</p> : null}

            <div className="page-header-actions">
              <button type="button" className="axis-btn" disabled={index <= 0 || busy} onClick={() => go(-1)}>
                Back
              </button>
              {step === "review" ? (
                <button
                  type="button"
                  className="axis-btn axis-btn-primary"
                  disabled={Boolean(stepProblem) || busy || readOnly}
                  onClick={() => void create()}
                >
                  {busy ? "Creating…" : "Create"}
                </button>
              ) : (
                <button
                  type="button"
                  className="axis-btn axis-btn-primary"
                  disabled={Boolean(stepProblem) || busy}
                  onClick={() => go(1)}
                >
                  Next
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
