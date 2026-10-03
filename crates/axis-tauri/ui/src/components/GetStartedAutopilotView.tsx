import { useEffect, useMemo, useState } from "react";
import {
  autopilotDeviceNameProblem,
  autopilotProfileNameProblem,
  defaultAutopilotProfileDraft,
  toCreateAutopilotInput,
  type AutopilotProfileDraft,
} from "../lib/autopilotProfile";
import { READ_ONLY_WRITE_HINT, useReadOnly } from "../lib/readOnly";
import {
  assignObjectAssignments,
  createAutopilotProfile,
  createDirectoryGroup,
  createDomainJoinProfile,
  searchDirectoryGroups,
} from "../lib/tauri";
import type { AssignmentDraft, CreateGroupMembership, DirectoryGroup } from "../types/inventory";
import { PageHeader } from "./ui/PageChrome";
import { AutopilotProfileForm } from "./workbench/AutopilotProfileForm";
import { BooleanToggle } from "./workbench/BooleanToggle";

const AUTOPILOT_DEVICE_RULE = '(device.devicePhysicalIDs -any (_ -contains "[ZTDID]"))';

function orderIdProblem(orderId: string): string | null {
  const trimmed = orderId.trim();
  if (!trimmed) return null;
  if (/["\r\n]/.test(trimmed)) return "Order ID cannot include quotes or line breaks.";
  return null;
}

function autopilotMembershipRule(orderId: string): string {
  const trimmed = orderId.trim();
  if (!trimmed) return AUTOPILOT_DEVICE_RULE;
  return `${AUTOPILOT_DEVICE_RULE} and (device.devicePhysicalIds -any (_ -eq "[OrderID]:${trimmed}"))`;
}

type StepId = "join" | "profile" | "group" | "domain" | "review";

type CreatedPiece = { label: string; id: string };

function computerNameProblem(prefix: string, randomCount: number): string | null {
  const trimmed = prefix.trim();
  if (trimmed.split("").some((ch) => !/[A-Za-z0-9-]/.test(ch))) {
    return "Computer name prefix can use letters, digits, and hyphens.";
  }
  if (!Number.isInteger(randomCount) || randomCount < 0 || randomCount > 15) {
    return "Random computer name length must be from 0 to 15.";
  }
  if (!trimmed && randomCount === 0) return "Enter a computer name prefix or a random length.";
  if (trimmed.length + randomCount > 15) {
    return "Computer name prefix plus the random length must be 15 characters or fewer.";
  }
  return null;
}

function domainProblem(domain: string): string | null {
  const trimmed = domain.trim();
  if (!trimmed || /\s/.test(trimmed) || !trimmed.includes(".")) {
    return "Active Directory domain name is required, such as contoso.com.";
  }
  return null;
}

function ouProblem(ou: string): string | null {
  const trimmed = ou.trim();
  if (!trimmed) return null;
  if (!trimmed.includes("=")) {
    return "Organizational unit is a distinguished name, such as OU=Computers,DC=contoso,DC=com.";
  }
  return null;
}

export function GetStartedAutopilotView({
  onOpenProfile,
}: {
  onOpenProfile: (profileId: string) => void;
}) {
  const readOnly = useReadOnly();
  const [draft, setDraft] = useState<AutopilotProfileDraft>(() => defaultAutopilotProfileDraft());
  const [joinChosen, setJoinChosen] = useState(false);
  const [step, setStep] = useState<StepId>("join");
  const [groupMode, setGroupMode] = useState<"existing" | "new">("new");
  const [groupQuery, setGroupQuery] = useState("");
  const [groupHits, setGroupHits] = useState<DirectoryGroup[]>([]);
  const [groupSearchError, setGroupSearchError] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<DirectoryGroup | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDynamic, setNewGroupDynamic] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [newGroupRule, setNewGroupRule] = useState(AUTOPILOT_DEVICE_RULE);
  const [domainName, setDomainName] = useState("");
  const [organizationalUnit, setOrganizationalUnit] = useState("");
  const [computerPrefix, setComputerPrefix] = useState("");
  const [randomCount, setRandomCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPiece[]>([]);
  const [finished, setFinished] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileAssigned, setProfileAssigned] = useState(false);
  const [domainId, setDomainId] = useState<string | null>(null);
  const [domainAssigned, setDomainAssigned] = useState(false);

  const hybrid = draft.joinKind === "hybrid";
  const steps = useMemo(() => {
    const rows: { id: StepId; label: string }[] = [
      { id: "join", label: "Join" },
      { id: "profile", label: "Profile" },
      { id: "group", label: "Group" },
    ];
    if (hybrid) rows.push({ id: "domain", label: "Domain join" });
    rows.push({ id: "review", label: "Review" });
    return rows;
  }, [hybrid]);

  useEffect(() => {
    if (steps.some((item) => item.id === step)) return;
    setStep("group");
  }, [steps, step]);

  useEffect(() => {
    if (groupMode !== "existing") return;
    const query = groupQuery.trim();
    if (query.length < 2) {
      setGroupHits([]);
      setGroupSearchError(null);
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(() => {
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
        });
    }, 250);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [groupMode, groupQuery]);

  const nameProblem = autopilotProfileNameProblem(draft.displayName);
  const deviceNameProblem = autopilotDeviceNameProblem(draft.deviceNameTemplate);
  const groupName = newGroupName.trim() || `${draft.displayName.trim() || "Autopilot"} devices`;
  const groupProblem =
    groupMode === "existing"
      ? selectedGroup
        ? null
        : "Choose a group."
      : newGroupDynamic && !newGroupRule.trim()
        ? "Enter a dynamic membership rule."
        : newGroupDynamic
          ? orderIdProblem(orderId)
          : null;
  const nameIssue = computerNameProblem(computerPrefix, randomCount);
  const domainIssue = hybrid ? domainProblem(domainName) ?? ouProblem(organizationalUnit) ?? nameIssue : null;
  const stepProblem =
    step === "join"
      ? joinChosen
        ? null
        : "Choose Entra or Hybrid."
      : step === "profile"
        ? nameProblem ?? deviceNameProblem
        : step === "group"
          ? groupProblem
          : step === "domain"
            ? domainIssue
            : nameProblem ?? deviceNameProblem ?? groupProblem ?? domainIssue;

  function chooseJoin(kind: AutopilotProfileDraft["joinKind"]) {
    setDraft((current) => ({ ...current, joinKind: kind }));
    setJoinChosen(true);
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
    let group = selectedGroup;
    let deploymentId = profileId;
    let deploymentAssigned = profileAssigned;
    let joinId = domainId;
    let joinAssigned = domainAssigned;
    try {
      if (groupMode === "new" && !pieces.some((piece) => piece.label === "Group")) {
        setProgress("Creating group…");
        const membership: CreateGroupMembership = newGroupDynamic ? "dynamicDevice" : "assigned";
        const response = await createDirectoryGroup({
          displayName: groupName,
          description: `Assignment group for ${draft.displayName.trim()}`,
          membership,
          membershipRule: newGroupDynamic ? newGroupRule.trim() : undefined,
        });
        if (!response.group) throw new Error(response.error ?? "Failed to create group.");
        group = response.group;
        setSelectedGroup(response.group);
        pieces.push({ label: "Group", id: response.group.id });
        setCreated([...pieces]);
      }
      if (!group) throw new Error("Choose a group.");
      const assignment: AssignmentDraft = {
        targetKind: "group",
        groupId: group.id,
        groupName: group.displayName,
      };
      if (!deploymentId) {
        setProgress("Creating deployment profile…");
        const response = await createAutopilotProfile(toCreateAutopilotInput(draft));
        if (!response.profile) throw new Error(response.error ?? "Failed to create the deployment profile.");
        deploymentId = response.profile.id;
        setProfileId(response.profile.id);
        pieces.push({ label: "Deployment profile", id: response.profile.id });
        setCreated([...pieces]);
      }
      if (deploymentId && !deploymentAssigned) {
        setProgress("Assigning deployment profile…");
        const assigned = await assignObjectAssignments({
          kind: "autopilotProfile",
          id: deploymentId,
          drafts: [assignment],
        });
        if (!assigned.ok) throw new Error(assigned.error ?? "Failed to assign the deployment profile.");
        deploymentAssigned = true;
        setProfileAssigned(true);
      }
      if (hybrid && !joinId) {
        setProgress("Creating domain join profile…");
        const response = await createDomainJoinProfile({
          displayName: `${draft.displayName.trim()} domain join`,
          description: `Domain join for ${draft.displayName.trim()}`,
          domainName: domainName.trim(),
          organizationalUnit: organizationalUnit.trim() || null,
          computerNamePrefix: computerPrefix.trim(),
          computerNameRandomCharCount: randomCount,
        });
        if (!response.profile) throw new Error(response.error ?? "Failed to create the domain join profile.");
        joinId = response.profile.id;
        setDomainId(response.profile.id);
        pieces.push({ label: "Domain join profile", id: response.profile.id });
        setCreated([...pieces]);
      }
      if (hybrid && joinId && !joinAssigned) {
        setProgress("Assigning domain join profile…");
        const assigned = await assignObjectAssignments({
          kind: "deviceConfiguration",
          id: joinId,
          drafts: [assignment],
          objectOdataType: "#microsoft.graph.windowsDomainJoinConfiguration",
        });
        if (!assigned.ok) throw new Error(assigned.error ?? "Failed to assign the domain join profile.");
        setDomainAssigned(true);
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
        title="Get started"
        description="Create the Windows Autopilot objects for an Entra or Hybrid join, and assign them to one group."
      />
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
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Autopilot objects created</h2>
            <ul className="catalog-delete-list">
              {created.map((piece) => (
                <li key={`${piece.label}:${piece.id}`}>
                  {piece.label}
                  <span className="muted"> · {piece.id}</span>
                </li>
              ))}
            </ul>
            {profileId ? (
              <div>
                <button type="button" className="axis-btn" onClick={() => onOpenProfile(profileId)}>
                  Open deployment profile
                </button>
              </div>
            ) : null}
            <div className="axis-alert axis-alert-info">
              <p style={{ margin: "0 0 0.35rem" }}>Finish these steps outside Axis.</p>
              <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                <li>Register each device hardware hash so it appears under Autopilot devices.</li>
                {hybrid ? (
                  <>
                    <li>Install the Intune Connector for Active Directory on a domain-joined server.</li>
                    <li>
                      Give that server account permission to create computer objects
                      {organizationalUnit.trim()
                        ? ` in ${organizationalUnit.trim()}.`
                        : " in the organizational unit on the domain join profile."}
                    </li>
                  </>
                ) : null}
              </ul>
            </div>
          </div>
        ) : (
          <>
            {step === "join" ? (
              <section className="stack" style={{ gap: "0.75rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>How should devices join?</h2>
                <div className="get-started-choices">
                  <button
                    type="button"
                    className="axis-btn get-started-choice"
                    aria-pressed={joinChosen && !hybrid}
                    onClick={() => chooseJoin("entra")}
                  >
                    <strong>Microsoft Entra joined</strong>
                    <span>Axis creates a deployment profile and assigns it to the group you choose.</span>
                  </button>
                  <button
                    type="button"
                    className="axis-btn get-started-choice"
                    aria-pressed={joinChosen && hybrid}
                    onClick={() => chooseJoin("hybrid")}
                  >
                    <strong>Hybrid Microsoft Entra joined</strong>
                    <span>
                      Axis creates the deployment profile, the domain join profile, and the assignments. The
                      Intune Connector is installed on a server afterwards.
                    </span>
                  </button>
                </div>
              </section>
            ) : null}

            {step === "profile" ? (
              <AutopilotProfileForm
                draft={draft}
                disabled={busy}
                onChange={(patch) => {
                  setDraft((current) => ({ ...current, ...patch }));
                  if (patch.joinKind) setJoinChosen(true);
                }}
              />
            ) : null}

            {step === "group" ? (
              <section className="stack" style={{ gap: "0.75rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Assignment group</h2>
                <div className="get-started-choices">
                  <button
                    type="button"
                    className="axis-btn"
                    aria-pressed={groupMode === "new"}
                    onClick={() => setGroupMode("new")}
                  >
                    New group
                  </button>
                  <button
                    type="button"
                    className="axis-btn"
                    aria-pressed={groupMode === "existing"}
                    onClick={() => setGroupMode("existing")}
                  >
                    Existing group
                  </button>
                </div>
                {groupMode === "new" ? (
                  <>
                    <label className="device-field">
                      Group name
                      <input
                        className="axis-input"
                        value={newGroupName}
                        placeholder={groupName}
                        onChange={(event) => setNewGroupName(event.target.value)}
                      />
                    </label>
                    <label className="device-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
                      <BooleanToggle
                        checked={newGroupDynamic}
                        ariaLabel="Dynamic device membership"
                        onChange={(checked) => {
                          setNewGroupDynamic(checked);
                          if (checked) setNewGroupRule(autopilotMembershipRule(orderId));
                        }}
                      />
                      <span>Dynamic device membership</span>
                    </label>
                    {newGroupDynamic ? (
                      <>
                        <label className="device-field">
                          Order ID
                          <span className="muted" style={{ display: "block", fontSize: "0.7rem" }}>
                            Optional. Adds (device.devicePhysicalIds -any (_ -eq "[OrderID]:…")) to the membership rule.
                          </span>
                          <input
                            className="axis-input"
                            value={orderId}
                            placeholder="179887111881"
                            onChange={(event) => {
                              const next = event.target.value;
                              setOrderId(next);
                              setNewGroupRule(autopilotMembershipRule(next));
                            }}
                          />
                        </label>
                        <label className="device-field">
                          Membership rule
                          <span className="muted" style={{ display: "block", fontSize: "0.7rem" }}>
                            {orderId.trim()
                              ? "Registered Autopilot devices with this order ID."
                              : "The Autopilot device rule includes every registered Autopilot device."}
                          </span>
                          <textarea className="axis-input" rows={3} value={newGroupRule} onChange={(event) => setNewGroupRule(event.target.value)} />
                        </label>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <label className="device-field">
                      Search groups
                      <input
                        className="axis-input"
                        value={groupQuery}
                        placeholder="Type at least two characters"
                        onChange={(event) => setGroupQuery(event.target.value)}
                      />
                    </label>
                    {selectedGroup ? (
                      <p className="muted" style={{ margin: 0 }}>
                        Selected: {selectedGroup.displayName}
                      </p>
                    ) : null}
                    {groupSearchError ? <p className="axis-alert axis-alert-danger">{groupSearchError}</p> : null}
                    {groupHits.length > 0 ? (
                      <ul className="catalog-delete-list">
                        {groupHits.map((group) => (
                          <li key={group.id}>
                            <button type="button" className="axis-btn" onClick={() => setSelectedGroup(group)}>
                              {group.displayName}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </section>
            ) : null}

            {step === "domain" ? (
              <section className="stack" style={{ gap: "0.75rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Domain join profile</h2>
                <p className="muted" style={{ margin: 0 }}>
                  This names the Active Directory computer. The device name template on the deployment profile stays separate.
                </p>
                <label className="device-field">
                  Domain name
                  <input className="axis-input" value={domainName} placeholder="contoso.com" onChange={(event) => setDomainName(event.target.value)} />
                </label>
                <label className="device-field">
                  Organizational unit
                  <input
                    className="axis-input"
                    value={organizationalUnit}
                    placeholder="OU=Autopilot,DC=contoso,DC=com"
                    onChange={(event) => setOrganizationalUnit(event.target.value)}
                  />
                </label>
                <label className="device-field">
                  Computer name prefix
                  <input
                    className={`axis-input${nameIssue ? " is-invalid" : ""}`}
                    value={computerPrefix}
                    placeholder="PC-"
                    aria-invalid={nameIssue ? true : undefined}
                    onChange={(event) => setComputerPrefix(event.target.value)}
                  />
                  {nameIssue ? (
                    <span className="setting-field-error" role="alert">
                      {nameIssue}
                    </span>
                  ) : null}
                </label>
                <label className="device-field">
                  Random characters
                  <input
                    className={`axis-input${nameIssue ? " is-invalid" : ""}`}
                    type="number"
                    min={0}
                    max={15}
                    value={randomCount}
                    aria-invalid={nameIssue ? true : undefined}
                    onChange={(event) => setRandomCount(Number(event.target.value))}
                  />
                </label>
                {domainProblem(domainName) || ouProblem(organizationalUnit) ? (
                  <p className="muted">{domainProblem(domainName) ?? ouProblem(organizationalUnit)}</p>
                ) : null}
              </section>
            ) : null}

            {step === "review" ? (
              <section className="stack" style={{ gap: "0.75rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Create these objects</h2>
                <ul className="catalog-delete-list">
                  <li>{hybrid ? "Hybrid Microsoft Entra joined" : "Microsoft Entra joined"} deployment profile: {draft.displayName.trim()}</li>
                  <li>
                    {groupMode === "existing" ? "Assign to" : "Create and assign"}{" "}
                    {groupMode === "existing" ? selectedGroup?.displayName : groupName}
                    {groupMode === "new" && newGroupDynamic && orderId.trim()
                      ? ` (order ID ${orderId.trim()})`
                      : ""}
                  </li>
                  {draft.configureEsp ? <li>Enrollment status settings on the deployment profile</li> : null}
                  {hybrid ? (
                    <li>
                      Domain join profile for {domainName.trim()}
                      {organizationalUnit.trim() ? ` in ${organizationalUnit.trim()}` : ""}
                    </li>
                  ) : null}
                </ul>
                {hybrid ? (
                  <div className="axis-alert axis-alert-info">
                    After Axis creates these objects, install the Intune Connector for Active Directory on a
                    domain-joined server and allow that server to create computer objects in the organizational unit.
                  </div>
                ) : null}
                {created.length > 0 ? (
                  <ul className="catalog-delete-list">
                    {created.map((piece) => (
                      <li key={`${piece.label}:${piece.id}`}>
                        Already created: {piece.label}
                      </li>
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
                <button type="button" className="axis-btn axis-btn-primary" disabled={Boolean(stepProblem) || busy} onClick={() => go(1)}>
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
