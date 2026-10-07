import { useEffect, useMemo, useState } from "react";
import {
  autopilotDeviceNameProblem,
  autopilotProfileNameProblem,
  defaultAutopilotProfileDraft,
  toCreateAutopilotInput,
  type AutopilotProfileDraft,
} from "../lib/autopilotProfile";
import { ENROLLMENT_ESP_PATH } from "../lib/enrollment";
import { READ_ONLY_WRITE_HINT, useReadOnly } from "../lib/readOnly";
import { hrefWithParam, navigate } from "../lib/route";
import {
  assignObjectAssignments,
  createAutopilotProfile,
  createDomainJoinProfile,
  createEnrollmentStatusPage,
  fetchEspBlockingApps,
  searchDirectoryGroups,
  type EspBlockingApp,
} from "../lib/tauri";
import { assignmentTargetLabel } from "../lib/assignmentSummary";
import type { AssignmentDraft, DirectoryGroup, GroupMembershipKind } from "../types/inventory";
import { PageHeader } from "./ui/PageChrome";
import { AutopilotProfileForm } from "./workbench/AutopilotProfileForm";
import { BooleanToggle } from "./workbench/BooleanToggle";
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

type StepId = "join" | "profile" | "group" | "esp" | "domain" | "review";

type EspDraft = {
  enabled: boolean;
  showInstallationProgress: boolean;
  blockDeviceUseUntilAllAppsInstalled: boolean;
  allowDeviceResetOnInstallFailure: boolean;
  allowDeviceUseOnInstallFailure: boolean;
  blockDeviceSetupRetryByUser: boolean;
  allowLogCollectionOnInstallFailure: boolean;
  onlyShowDuringOobe: boolean;
  installQualityUpdates: boolean;
  installProgressTimeoutInMinutes: number;
  customErrorMessage: string;
  blockAppsMode: "all" | "selected";
  selectedAppIds: string[];
};

function espAppTypeLabel(odataType?: string | null): string | null {
  const value = (odataType ?? "").toLowerCase();
  if (value.includes("win32catalogapp")) return "Enterprise catalog";
  if (value.includes("win32lobapp")) return "Win32";
  if (value.includes("wingetapp")) return "WinGet";
  if (value.includes("officesuiteapp")) return "Microsoft 365";
  if (value.includes("windowsmicrosoftedgeapp")) return "Edge";
  if (value.includes("windowsmobilemsi")) return "MSI";
  if (value.includes("windowsappx") || value.includes("windowsuniversalappx")) return "AppX";
  return null;
}

function defaultEspDraft(): EspDraft {
  return {
    enabled: true,
    showInstallationProgress: true,
    blockDeviceUseUntilAllAppsInstalled: true,
    allowDeviceResetOnInstallFailure: false,
    allowDeviceUseOnInstallFailure: false,
    blockDeviceSetupRetryByUser: false,
    allowLogCollectionOnInstallFailure: true,
    onlyShowDuringOobe: true,
    installQualityUpdates: false,
    installProgressTimeoutInMinutes: 60,
    customErrorMessage: "",
    blockAppsMode: "all",
    selectedAppIds: [],
  };
}

function espTimeoutProblem(esp: EspDraft): string | null {
  if (!esp.enabled || !esp.showInstallationProgress) return null;
  const timeout = esp.installProgressTimeoutInMinutes;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 1440) {
    return "Install progress timeout must be from 1 to 1440 minutes.";
  }
  return null;
}

function espProblem(esp: EspDraft): string | null {
  if (!esp.enabled) return null;
  if (esp.customErrorMessage.trim().length > 10000) {
    return "Custom error message must be 10000 characters or fewer.";
  }
  if (
    esp.showInstallationProgress &&
    esp.blockDeviceUseUntilAllAppsInstalled &&
    esp.blockAppsMode === "selected" &&
    esp.selectedAppIds.length === 0
  ) {
    return "Select at least one app to block on.";
  }
  if (esp.selectedAppIds.length > 100) return "Select 100 apps or fewer.";
  return espTimeoutProblem(esp);
}

function EspAppPicker({
  apps,
  loading,
  error,
  query,
  selectedIds,
  onQuery,
  onSelectedIds,
  onRetry,
}: {
  apps: EspBlockingApp[] | null;
  loading: boolean;
  error: string | null;
  query: string;
  selectedIds: string[];
  onQuery: (value: string) => void;
  onSelectedIds: (ids: string[]) => void;
  onRetry: () => void;
}) {
  const needle = query.trim().toLowerCase();
  const shown = (apps ?? []).filter((app) => {
    if (!needle) return true;
    const type = espAppTypeLabel(app.odataType)?.toLowerCase() ?? "";
    return (
      app.displayName.toLowerCase().includes(needle) ||
      (app.displayVersion ?? "").toLowerCase().includes(needle) ||
      (app.publisher ?? "").toLowerCase().includes(needle) ||
      type.includes(needle)
    );
  });
  const shownIds = shown.map((app) => app.id);
  const allShown = shownIds.length > 0 && shownIds.every((id) => selectedIds.includes(id));

  function toggle(id: string, checked: boolean) {
    if (checked) onSelectedIds([...selectedIds, id].filter((value, index, all) => all.indexOf(value) === index));
    else onSelectedIds(selectedIds.filter((value) => value !== id));
  }

  function toggleShown(checked: boolean) {
    if (checked) {
      onSelectedIds([...selectedIds, ...shownIds].filter((value, index, all) => all.indexOf(value) === index));
      return;
    }
    const hide = new Set(shownIds);
    onSelectedIds(selectedIds.filter((id) => !hide.has(id)));
  }

  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      <label className="device-field">
        Find an app
        <input
          className="axis-input"
          value={query}
          placeholder="Name, version, or publisher"
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      {loading ? <p className="muted">Loading apps…</p> : null}
      {error ? (
        <p className="axis-alert axis-alert-danger">
          {error}{" "}
          <button type="button" className="axis-btn" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : null}
      {!loading && !error && apps && shown.length === 0 ? <p className="muted">No apps matched.</p> : null}
      {shown.length > 0 ? (
        <ul className="catalog-delete-list" style={{ maxHeight: "16rem", overflow: "auto" }}>
          <li>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input type="checkbox" checked={allShown} onChange={(event) => toggleShown(event.target.checked)} />
              <span>Select shown ({selectedIds.length} selected)</span>
            </label>
          </li>
          {shown.map((app) => {
            const type = espAppTypeLabel(app.odataType);
            return (
              <li key={app.id}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(app.id)}
                    onChange={(event) => toggle(app.id, event.target.checked)}
                  />
                  <span>
                    {app.displayName}
                    {app.displayVersion ? <span className="muted"> · {app.displayVersion}</span> : null}
                    {app.publisher ? <span className="muted"> · {app.publisher}</span> : null}
                    {type ? <span className="muted"> · {type}</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

type CreatedPiece = { label: string; id: string };

function computerNameProblem(prefix: string): string | null {
  const trimmed = prefix.trim();
  if (!trimmed) return "Computer name prefix is required.";
  if (trimmed.split("").some((ch) => !/[A-Za-z0-9-]/.test(ch))) {
    return "Computer name prefix can use letters, digits, and hyphens.";
  }
  if (trimmed.length > 15) return "Computer name prefix must be 15 characters or fewer.";
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
  const [assignments, setAssignments] = useState<AssignmentDraft[]>([]);
  const [groupPickerMode, setGroupPickerMode] = useState<"include" | "exclude">("include");
  const [groupQuery, setGroupQuery] = useState("");
  const [groupHits, setGroupHits] = useState<DirectoryGroup[]>([]);
  const [groupSearching, setGroupSearching] = useState(false);
  const [groupSearchError, setGroupSearchError] = useState<string | null>(null);
  const [domainName, setDomainName] = useState("");
  const [organizationalUnit, setOrganizationalUnit] = useState("");
  const [computerPrefix, setComputerPrefix] = useState("");
  const [esp, setEsp] = useState<EspDraft>(() => defaultEspDraft());
  const [espApps, setEspApps] = useState<EspBlockingApp[] | null>(null);
  const [espAppsLoading, setEspAppsLoading] = useState(false);
  const [espAppsError, setEspAppsError] = useState<string | null>(null);
  const [espAppQuery, setEspAppQuery] = useState("");
  const [espId, setEspId] = useState<string | null>(null);
  const [espAssigned, setEspAssigned] = useState(false);
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
      { id: "group", label: "Groups" },
      { id: "esp", label: "Enrollment Status Page" },
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

  useEffect(() => {
    if (step !== "esp" || !esp.showInstallationProgress || !esp.blockDeviceUseUntilAllAppsInstalled) return;
    if (esp.blockAppsMode !== "selected" || espApps) return;
    let cancel = false;
    setEspAppsLoading(true);
    setEspAppsError(null);
    void fetchEspBlockingApps()
      .then((response) => {
        if (cancel) return;
        setEspApps(response.apps);
        setEspAppsError(response.error);
      })
      .catch((err: unknown) => {
        if (cancel) return;
        setEspApps([]);
        setEspAppsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancel) setEspAppsLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [esp.blockAppsMode, esp.blockDeviceUseUntilAllAppsInstalled, esp.showInstallationProgress, espApps, step]);

  const nameProblem = autopilotProfileNameProblem(draft.displayName);
  const deviceNameProblem = hybrid ? null : autopilotDeviceNameProblem(draft.deviceNameTemplate);
  const groupProblem = assignments.some((row) => row.targetKind === "group")
    ? null
    : "Add at least one include group.";
  const pageProblem = espProblem(esp);
  const timeoutProblem = espTimeoutProblem(esp);
  const messageProblem =
    esp.enabled && esp.customErrorMessage.trim().length > 10000
      ? "Custom error message must be 10000 characters or fewer."
      : null;
  const nameIssue = computerNameProblem(computerPrefix);
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
          : step === "esp"
            ? pageProblem
            : step === "domain"
              ? domainIssue
              : nameProblem ?? deviceNameProblem ?? groupProblem ?? pageProblem ?? domainIssue;

  function chooseJoin(kind: AutopilotProfileDraft["joinKind"]) {
    setDraft((current) => ({
      ...current,
      joinKind: kind,
      ...(kind === "hybrid" ? { deviceNameTemplate: "", deviceUsageType: "singleUser" } : {}),
    }));
    setJoinChosen(true);
  }

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
    let deploymentId = profileId;
    let deploymentAssigned = profileAssigned;
    let joinId = domainId;
    let joinAssigned = domainAssigned;
    let pageId = espId;
    let pageAssigned = espAssigned;
    try {
      if (!assignments.some((row) => row.targetKind === "group")) {
        throw new Error("Add at least one include group.");
      }
      for (const row of assignments) {
        if (!row.groupId || pieces.some((piece) => piece.id === row.groupId)) continue;
        pieces.push({
          label: row.targetKind === "exclusionGroup" ? `Exclude ${row.groupName ?? "group"}` : `Include ${row.groupName ?? "group"}`,
          id: row.groupId,
        });
      }
      setCreated([...pieces]);
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
          drafts: assignments,
        });
        if (!assigned.ok) throw new Error(assigned.error ?? "Failed to assign the deployment profile.");
        deploymentAssigned = true;
        setProfileAssigned(true);
      }
      if (esp.enabled && !pageId) {
        setProgress("Creating Enrollment Status Page…");
        const response = await createEnrollmentStatusPage({
          displayName: `${draft.displayName.trim()} enrollment status page`,
          description: `Enrollment Status Page for ${draft.displayName.trim()}`,
          showInstallationProgress: esp.showInstallationProgress,
          blockDeviceUseUntilAllAppsInstalled: esp.blockDeviceUseUntilAllAppsInstalled,
          allowDeviceResetOnInstallFailure: esp.allowDeviceResetOnInstallFailure,
          allowDeviceUseOnInstallFailure: esp.allowDeviceUseOnInstallFailure,
          blockDeviceSetupRetryByUser: false,
          allowLogCollectionOnInstallFailure: esp.allowLogCollectionOnInstallFailure,
          onlyShowDuringOobe: esp.onlyShowDuringOobe,
          installQualityUpdates: esp.installQualityUpdates,
          installProgressTimeoutInMinutes: esp.installProgressTimeoutInMinutes,
          customErrorMessage: esp.customErrorMessage.trim() || null,
          selectedMobileAppIds:
            esp.showInstallationProgress &&
            esp.blockDeviceUseUntilAllAppsInstalled &&
            esp.blockAppsMode === "selected"
              ? esp.selectedAppIds
              : [],
        });
        if (!response.page) throw new Error(response.error ?? "Failed to create the Enrollment Status Page.");
        pageId = response.page.id;
        setEspId(response.page.id);
        pieces.push({ label: "Enrollment Status Page", id: response.page.id });
        setCreated([...pieces]);
      }
      if (esp.enabled && pageId && !pageAssigned) {
        setProgress("Assigning Enrollment Status Page…");
        const assigned = await assignObjectAssignments({
          kind: "enrollmentConfiguration",
          id: pageId,
          drafts: assignments.filter((row) => row.targetKind !== "exclusionGroup"),
          objectOdataType: "#microsoft.graph.windows10EnrollmentCompletionPageConfiguration",
        });
        if (!assigned.ok) throw new Error(assigned.error ?? "Failed to assign the Enrollment Status Page.");
        pageAssigned = true;
        setEspAssigned(true);
      }
      if (hybrid && !joinId) {
        setProgress("Creating domain join profile…");
        const response = await createDomainJoinProfile({
          displayName: `${draft.displayName.trim()} domain join`,
          description: `Domain join for ${draft.displayName.trim()}`,
          domainName: domainName.trim(),
          organizationalUnit: organizationalUnit.trim() || null,
          computerNamePrefix: computerPrefix.trim(),
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
          drafts: assignments,
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
        description="Create the Windows Autopilot deployment profile, Enrollment Status Page, and include and exclude groups for an Entra or Hybrid join."
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
            {profileId || espId ? (
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {profileId ? (
                  <button type="button" className="axis-btn" onClick={() => onOpenProfile(profileId)}>
                    Open deployment profile
                  </button>
                ) : null}
                {espId ? (
                  <button
                    type="button"
                    className="axis-btn"
                    onClick={() =>
                      navigate(hrefWithParam(ENROLLMENT_ESP_PATH, new URLSearchParams(), "policy", espId))
                    }
                  >
                    Open Enrollment Status Page
                  </button>
                ) : null}
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
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Include and exclude groups</h2>
                <p className="muted" style={{ margin: 0 }}>
                  These groups are assigned to the deployment profile
                  {hybrid ? " and the domain join profile" : ""}.
                  {esp.enabled
                    ? " The Enrollment Status Page receives the include groups."
                    : ""}
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
                            onClick={() => addGroup(groupPickerMode === "exclude" ? "exclusionGroup" : "group", group)}
                          >
                            <span>{group.displayName}</span>
                            {membershipLabel(group.membership) ? (
                              <span className={membershipPillClass(group.membership)} title={group.membershipRule ?? undefined}>
                                {membershipLabel(group.membership)}
                              </span>
                            ) : null}
                          </button>
                          <span className="assignment-hit-actions">
                            <IncludeExcludeToggle
                              value={mode}
                              ariaLabel={`Add ${group.displayName} as an assignment`}
                              onChange={(next) => addGroup(next === "exclude" ? "exclusionGroup" : "group", group)}
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
                  namePlaceholder="e.g. Autopilot devices"
                  successHint={
                    groupPickerMode === "exclude"
                      ? "and added as an exclude."
                      : "and added as an include."
                  }
                  onCreated={(group) => addGroup(groupPickerMode === "exclude" ? "exclusionGroup" : "group", group)}
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
                                        ? { ...item, targetKind: mode === "exclude" ? "exclusionGroup" : "group" }
                                        : item,
                                    ),
                                  )
                                }
                              />
                              <button
                                type="button"
                                className="axis-btn axis-btn-ghost"
                                onClick={() =>
                                  setAssignments((current) => current.filter((item) => item.groupId !== row.groupId))
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

            {step === "esp" ? (
              <section className="stack" style={{ gap: "0.75rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Enrollment Status Page</h2>
                <p className="muted" style={{ margin: 0 }}>
                  Creates an Enrollment Status Page and assigns the include groups. Exclude groups stay on the deployment profile.
                </p>
                <label className="device-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
                  <BooleanToggle
                    checked={esp.enabled}
                    ariaLabel="Create an Enrollment Status Page"
                    onChange={(enabled) => setEsp((current) => ({ ...current, enabled }))}
                  />
                  <span>Create an Enrollment Status Page</span>
                </label>
                {esp.enabled ? (
                  <>
                    <label className="device-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
                      <BooleanToggle
                        checked={esp.showInstallationProgress}
                        ariaLabel="Show app and profile configuration progress"
                        onChange={(showInstallationProgress) =>
                          setEsp((current) => ({ ...current, showInstallationProgress }))
                        }
                      />
                      <span>Show app and profile configuration progress</span>
                    </label>
                    {esp.showInstallationProgress ? (
                      <>
                        <label className="device-field">
                          Show an error when installation takes longer than (minutes)
                          <input
                            className={`axis-input${timeoutProblem ? " is-invalid" : ""}`}
                            type="number"
                            min={1}
                            max={1440}
                            value={esp.installProgressTimeoutInMinutes}
                            aria-invalid={timeoutProblem ? true : undefined}
                            onChange={(event) =>
                              setEsp((current) => ({
                                ...current,
                                installProgressTimeoutInMinutes: Number(event.target.value),
                              }))
                            }
                          />
                          {timeoutProblem ? (
                            <span className="setting-field-error" role="alert">
                              {timeoutProblem}
                            </span>
                          ) : null}
                        </label>
                        <label className="device-field">
                          Custom error message
                          <span className="muted" style={{ display: "block", fontSize: "0.7rem" }}>
                            Optional. Leave blank to use the default setup failure message.
                          </span>
                          <input
                            className={`axis-input${messageProblem ? " is-invalid" : ""}`}
                            value={esp.customErrorMessage}
                            placeholder="Optional"
                            aria-invalid={messageProblem ? true : undefined}
                            onChange={(event) =>
                              setEsp((current) => ({ ...current, customErrorMessage: event.target.value }))
                            }
                          />
                          {messageProblem ? (
                            <span className="setting-field-error" role="alert">
                              {messageProblem}
                            </span>
                          ) : null}
                        </label>
                        <label className="device-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
                          <BooleanToggle
                            checked={esp.allowLogCollectionOnInstallFailure}
                            ariaLabel="Turn on log collection and diagnostics page for end users"
                            onChange={(allowLogCollectionOnInstallFailure) =>
                              setEsp((current) => ({ ...current, allowLogCollectionOnInstallFailure }))
                            }
                          />
                          <span>Turn on log collection and diagnostics page for end users</span>
                        </label>
                        <label className="device-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
                          <BooleanToggle
                            checked={esp.onlyShowDuringOobe}
                            ariaLabel="Only show page to devices provisioned by out-of-box experience"
                            onChange={(onlyShowDuringOobe) =>
                              setEsp((current) => ({ ...current, onlyShowDuringOobe }))
                            }
                          />
                          <span>Only show page to devices provisioned by out-of-box experience (OOBE)</span>
                        </label>
                        <label className="device-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
                          <BooleanToggle
                            checked={esp.installQualityUpdates}
                            ariaLabel="Install Windows quality updates"
                            onChange={(installQualityUpdates) =>
                              setEsp((current) => ({ ...current, installQualityUpdates }))
                            }
                          />
                          <span>Install Windows quality updates</span>
                        </label>
                        <label className="device-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
                          <BooleanToggle
                            checked={esp.blockDeviceUseUntilAllAppsInstalled}
                            ariaLabel="Block device use until all apps and profiles are installed"
                            onChange={(blockDeviceUseUntilAllAppsInstalled) =>
                              setEsp((current) => ({ ...current, blockDeviceUseUntilAllAppsInstalled }))
                            }
                          />
                          <span>Block device use until all apps and profiles are installed</span>
                        </label>
                        {esp.blockDeviceUseUntilAllAppsInstalled ? (
                          <>
                            <p className="muted" style={{ margin: 0 }}>
                              Block device use until these required apps are installed if they are assigned to the user/device
                            </p>
                            <div className="get-started-choices">
                              <button
                                type="button"
                                className="axis-btn"
                                aria-pressed={esp.blockAppsMode === "all"}
                                onClick={() => setEsp((current) => ({ ...current, blockAppsMode: "all" }))}
                              >
                                All
                              </button>
                              <button
                                type="button"
                                className="axis-btn"
                                aria-pressed={esp.blockAppsMode === "selected"}
                                onClick={() => setEsp((current) => ({ ...current, blockAppsMode: "selected" }))}
                              >
                                Selected
                              </button>
                            </div>
                            {esp.blockAppsMode === "all" ? (
                              <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
                                All assigned apps must finish before the device can be used.
                              </p>
                            ) : (
                              <EspAppPicker
                                apps={espApps}
                                loading={espAppsLoading}
                                error={espAppsError}
                                query={espAppQuery}
                                selectedIds={esp.selectedAppIds}
                                onQuery={setEspAppQuery}
                                onSelectedIds={(selectedAppIds) => setEsp((current) => ({ ...current, selectedAppIds }))}
                                onRetry={() => {
                                  setEspApps(null);
                                  setEspAppsError(null);
                                }}
                              />
                            )}
                          </>
                        ) : null}
                        {esp.blockDeviceUseUntilAllAppsInstalled ? (
                          <>
                            <label className="device-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
                              <BooleanToggle
                                checked={esp.allowDeviceResetOnInstallFailure}
                                ariaLabel="Allow users to reset device if installation error occurs"
                                onChange={(allowDeviceResetOnInstallFailure) =>
                                  setEsp((current) => ({ ...current, allowDeviceResetOnInstallFailure }))
                                }
                              />
                              <span>Allow users to reset device if installation error occurs</span>
                            </label>
                            <label className="device-field" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row" }}>
                              <BooleanToggle
                                checked={esp.allowDeviceUseOnInstallFailure}
                                ariaLabel="Allow users to use device if installation error occurs"
                                onChange={(allowDeviceUseOnInstallFailure) =>
                                  setEsp((current) => ({ ...current, allowDeviceUseOnInstallFailure }))
                                }
                              />
                              <span>Allow users to use device if installation error occurs</span>
                            </label>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </>
                ) : null}
              </section>
            ) : null}

            {step === "domain" ? (
              <section className="stack" style={{ gap: "0.75rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Domain join profile</h2>
                <p className="muted" style={{ margin: 0 }}>
                  This names the Active Directory computer. Hybrid deployment profiles do not set a device name template.
                </p>
                <label className="device-field">
                  Computer name prefix
                  <input
                    className={`axis-input${nameIssue ? " is-invalid" : ""}`}
                    value={computerPrefix}
                    placeholder="AX-"
                    aria-invalid={nameIssue ? true : undefined}
                    onChange={(event) => setComputerPrefix(event.target.value)}
                  />
                  {nameIssue ? (
                    <span className="setting-field-error" role="alert">
                      {nameIssue}
                    </span>
                  ) : (
                    <span className="muted">The rest of the 15-character computer name is random.</span>
                  )}
                </label>
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
                  {assignments.map((row) => (
                    <li key={`${row.targetKind}:${row.groupId}`}>{assignmentTargetLabel(row)}</li>
                  ))}
                  {esp.enabled ? (
                    <li>
                      Enrollment Status Page assigned to the include groups
                      {esp.showInstallationProgress ? ", showing setup progress" : ", with setup progress hidden"}
                      {esp.showInstallationProgress && esp.blockDeviceUseUntilAllAppsInstalled
                        ? esp.blockAppsMode === "selected"
                          ? `, blocking on ${esp.selectedAppIds.length} selected app${esp.selectedAppIds.length === 1 ? "" : "s"}`
                          : ", blocking on all assigned apps"
                        : ""}
                    </li>
                  ) : null}
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
