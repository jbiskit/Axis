import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  fetchManagedDeviceDetail,
  fetchPolicySettingIssues,
  fetchSettingConflictDetails,
} from "../lib/tauri";
import type {
  DetectedApp,
  DevicePolicyState,
  DirectoryGroupMembership,
  ManagedApp,
  ManagedDeviceDetail,
  PolicySettingIssue,
} from "../types/inventory";
import { DeviceActionsBar } from "./devices/DeviceActionsBar";
import { DeviceBaselineCompare } from "./devices/DeviceBaselineCompare";
import { DeviceHardwareDetailsPanel } from "./devices/DeviceHardwareDetailsPanel";
import { DeviceRecoveryPanel } from "./devices/DeviceRecoveryPanel";
import { closeThisWindow, popOutObject } from "../lib/popout";
import { intuneDeviceUrl } from "../lib/intune/portalLinks";
import { OpenInIntune } from "./intune/OpenInIntune";
import {
  describeGroup,
  humanizeAppToken,
  isConflictPolicyState,
  isProblemPolicyState,
  stateClass,
} from "./devices/deviceHelpers";

export type DeviceDetailCacheEntry = {
  device: ManagedDeviceDetail | null;
  error: string | null;
};

type DeviceTabId =
  | "details"
  | "recovery"
  | "managed-apps"
  | "detected-apps"
  | "groups"
  | "baselines"
  | "policies";

function SearchableTableShell({
  subtitle,
  query,
  onQueryChange,
  countLabel,
  children,
  empty,
}: {
  subtitle: string;
  query: string;
  onQueryChange: (value: string) => void;
  countLabel: string;
  children: ReactNode;
  empty: boolean;
}) {
  return (
    <section className="stack searchable-table">
      <div className="device-toolbar">
        <p className="muted" style={{ margin: 0, alignSelf: "center" }}>
          {subtitle}
        </p>
        <label className="device-field">
          Search
          <input
            className="axis-input"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search…"
          />
        </label>
      </div>
      <div className="axis-panel">
        <div className="muted" style={{ padding: "0.45rem 0.65rem", borderBottom: "1px solid var(--axis-border)", fontSize: "0.6875rem" }}>
          {countLabel}
        </div>
        {empty ? <p className="muted" style={{ padding: "1rem" }}>No matching items.</p> : children}
      </div>
    </section>
  );
}

export function DeviceDetailView({
  deviceId,
  onClose,
  popout = false,
  cachedEntry,
  onCacheUpdate,
}: {
  deviceId: string;
  onClose: () => void;
  popout?: boolean;
  cachedEntry?: DeviceDetailCacheEntry;
  onCacheUpdate?: (entry: DeviceDetailCacheEntry) => void;
}) {
  const [device, setDevice] = useState<ManagedDeviceDetail | null>(
    cachedEntry?.device ?? null,
  );
  const [loading, setLoading] = useState(!cachedEntry?.device);
  const [error, setError] = useState<string | null>(cachedEntry?.error ?? null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [appQuery, setAppQuery] = useState("");
  const [detectedQuery, setDetectedQuery] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [activeTab, setActiveTab] = useState<DeviceTabId>("details");
  const [expandedPolicyKey, setExpandedPolicyKey] = useState<string | null>(null);
  const [policyDrillLoading, setPolicyDrillLoading] = useState(false);
  const [policyDrillError, setPolicyDrillError] = useState<string | null>(null);
  const [settingDetailsKey, setSettingDetailsKey] = useState<string | null>(null);
  const [settingDetailsLoading, setSettingDetailsLoading] = useState(false);
  const [settingDetailsError, setSettingDetailsError] = useState<string | null>(null);

  const cachedEntryRef = useRef(cachedEntry);
  cachedEntryRef.current = cachedEntry;

  const [prevDeviceId, setPrevDeviceId] = useState(deviceId);
  if (deviceId !== prevDeviceId) {
    setPrevDeviceId(deviceId);
    if (cachedEntry?.device) {
      setDevice(cachedEntry.device);
      setError(cachedEntry.error ?? null);
      setLoading(false);
    } else if (cachedEntry !== undefined) {
      setDevice(null);
      setError(cachedEntry.error ?? null);
      setLoading(false);
    } else {
      setDevice(null);
      setError(null);
      setLoading(true);
    }
  }

  const loadDevice = useCallback(
    async (options?: { force?: boolean }) => {
      const force = options?.force === true;
      const cached = cachedEntryRef.current;
      if (!force && cached?.device) {
        setDevice(cached.device);
        setError(cached.error);
        setLoading(false);
        return;
      }
      setDevice(null);
      setLoading(true);
      setError(null);
      try {
        const response = await fetchManagedDeviceDetail(deviceId);
        setDevice(response.device);
        setError(response.error);
        if (!popout) {
          onCacheUpdate?.({ device: response.device, error: response.error });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load device";
        setDevice(null);
        setError(message);
        if (!popout) onCacheUpdate?.({ device: null, error: message });
      } finally {
        setLoading(false);
      }
    },
    [deviceId, onCacheUpdate, popout],
  );

  const mergeDevice = useCallback(
    (updater: (current: ManagedDeviceDetail) => ManagedDeviceDetail) => {
      setDevice((current) => {
        if (!current || current.id !== deviceId) return current;
        const next = updater(current);
        if (!popout) onCacheUpdate?.({ device: next, error });
        return next;
      });
    },
    [deviceId, error, onCacheUpdate, popout],
  );

  const loadDeviceRef = useRef(loadDevice);
  loadDeviceRef.current = loadDevice;

  useEffect(() => {
    setActiveTab("details");
    setExpandedPolicyKey(null);
    setPolicyDrillError(null);
    setSettingDetailsKey(null);
    setSettingDetailsError(null);
    setAppQuery("");
    setDetectedQuery("");
    setGroupQuery("");
    setActionMessage(null);
    setActionError(null);
  }, [deviceId]);

  useEffect(() => {
    void loadDeviceRef.current();
  }, [deviceId]);

  useEffect(() => {
    function onRefresh(event: Event) {
      const refreshId = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (refreshId === deviceId) void loadDeviceRef.current({ force: true });
    }
    window.addEventListener("axis:graph-object-refresh", onRefresh);
    return () => window.removeEventListener("axis:graph-object-refresh", onRefresh);
  }, [deviceId]);

  const openPolicyDrilldown = useCallback(
    async (rowKey: string, policy: DevicePolicyState) => {
      if (expandedPolicyKey === rowKey) {
        setExpandedPolicyKey(null);
        setPolicyDrillError(null);
        return;
      }
      setExpandedPolicyKey(rowKey);
      setPolicyDrillError(null);
      const hasSettingRows = (policy.issues ?? []).some((issue) => issue.setting !== "PolicyStatus");
      if (hasSettingRows) return;
      if (!isProblemPolicyState(policy.state)) return;

      setPolicyDrillLoading(true);
      try {
        const response = await fetchPolicySettingIssues({
          deviceId,
          policyId: policy.id,
          reportUserId: policy.reportUserId,
          deviceUserId: device?.userId,
        });
        if (response.error) {
          setPolicyDrillError(response.error);
        }
        const issues = response.issues;
        mergeDevice((current) => {
          const mapIssues = (items: DevicePolicyState[]) =>
            items.map((item) =>
              item.id === policy.id && item.source === policy.source
                ? { ...item, issues: issues.length > 0 ? issues : item.issues ?? [] }
                : item,
            );
          return {
            ...current,
            configurationStates: mapIssues(current.configurationStates),
            compliancePolicyStates: mapIssues(current.compliancePolicyStates),
          };
        });
        if (issues.length === 0 && !response.error) {
          setPolicyDrillError("Settings report returned no rows for this policy.");
        }
      } catch (err) {
        setPolicyDrillError(err instanceof Error ? err.message : String(err));
      } finally {
        setPolicyDrillLoading(false);
      }
    },
    [device?.userId, deviceId, expandedPolicyKey, mergeDevice],
  );

  const openSettingConflictDetails = useCallback(
    async (rowKey: string, policy: DevicePolicyState, issue: PolicySettingIssue) => {
      const settingKey = `${rowKey}::${issue.settingInstanceId ?? ""}::${issue.setting ?? ""}`;
      if (settingDetailsKey === settingKey && issue.sources.length > 0) {
        setSettingDetailsKey(null);
        setSettingDetailsError(null);
        return;
      }
      setSettingDetailsKey(settingKey);
      setSettingDetailsError(null);
      if (!issue.setting || !issue.settingInstanceId) {
        setSettingDetailsError(
          "Missing SettingId/SettingInstanceId for this row — cannot load conflicting policies.",
        );
        return;
      }
      if (
        issue.sources.length > 0 &&
        issue.sources.every(
          (source) =>
            source.configuredValue &&
            !/\bnested settings?\b/i.test(source.configuredValue) &&
            !/^Group ·/i.test(source.configuredValue),
        )
      ) {
        return;
      }
      setSettingDetailsLoading(true);
      try {
        const response = await fetchSettingConflictDetails({
          deviceId,
          settingId: issue.setting,
          settingInstanceId: issue.settingInstanceId,
          userId: policy.reportUserId,
          deviceUserId: device?.userId,
        });
        if (response.error) setSettingDetailsError(response.error);
        const details = response.details;
        mergeDevice((current) => {
          const attach = (items: DevicePolicyState[]) =>
            items.map((item) => {
              if (item.id !== policy.id || item.source !== policy.source) return item;
              return {
                ...item,
                issues: (item.issues ?? []).map((row) =>
                  row.setting === issue.setting && row.settingInstanceId === issue.settingInstanceId
                    ? {
                        ...row,
                        sources: details.map((detail) => ({
                          id: detail.id,
                          displayName: detail.displayName,
                          sourceType: detail.sourceType,
                          state: detail.state,
                          configuredValue: detail.configuredValue,
                          rawConfiguredValue: detail.rawConfiguredValue,
                        })),
                      }
                    : row,
                ),
              };
            });
          return {
            ...current,
            configurationStates: attach(current.configurationStates),
            compliancePolicyStates: attach(current.compliancePolicyStates),
          };
        });
        if (details.length === 0 && !response.error) {
          setSettingDetailsError("No contributing policies returned for this setting.");
        }
      } catch (err) {
        setSettingDetailsError(err instanceof Error ? err.message : String(err));
      } finally {
        setSettingDetailsLoading(false);
      }
    },
    [device?.userId, deviceId, mergeDevice, settingDetailsKey],
  );

  const filteredManagedApps = useMemo(() => {
    const apps = device?.managedApps ?? [];
    const needle = appQuery.trim().toLowerCase();
    if (!needle) return apps;
    return apps.filter((app) =>
      [app.displayName, app.displayVersion, app.installState, app.mobileAppIntent]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [appQuery, device?.managedApps]);

  const filteredDetectedApps = useMemo(() => {
    const apps = device?.detectedApps ?? [];
    const needle = detectedQuery.trim().toLowerCase();
    if (!needle) return apps;
    return apps.filter((app) =>
      [app.displayName, app.version, app.publisher].filter(Boolean).join(" ").toLowerCase().includes(needle),
    );
  }, [detectedQuery, device?.detectedApps]);

  const allGroups = useMemo(() => {
    if (!device) return [] as DirectoryGroupMembership[];
    return [...(device.deviceGroups ?? []), ...(device.userGroups ?? [])];
  }, [device]);

  const filteredGroups = useMemo(() => {
    const needle = groupQuery.trim().toLowerCase();
    if (!needle) return allGroups;
    return allGroups.filter((group) =>
      [group.displayName, group.membershipKind, describeGroup(group)].join(" ").toLowerCase().includes(needle),
    );
  }, [allGroups, groupQuery]);

  if (loading && !device) return <p className="muted">Loading device…</p>;
  if (!device || device.id !== deviceId) {
    return (
      <div className="stack">
        <button type="button" className="axis-btn" onClick={() => (popout ? void closeThisWindow() : onClose())}>
          {popout ? "Close window" : "Back to devices"}
        </button>
        <div className="axis-alert axis-alert-danger">{error ?? "Device not found."}</div>
      </div>
    );
  }

  const applied = [...(device.configurationStates ?? []), ...(device.compliancePolicyStates ?? [])];
  const conflictCount = applied.filter((item) => isConflictPolicyState(item.state)).length;
  const tabs: Array<{ id: DeviceTabId; label: string; count?: number }> = [
    { id: "details", label: "Device details" },
    { id: "recovery", label: "Recovery" },
    { id: "managed-apps", label: "Managed apps", count: device.managedApps?.length ?? 0 },
    { id: "detected-apps", label: "Detected apps", count: device.detectedApps?.length ?? 0 },
    { id: "groups", label: "Groups", count: allGroups.length },
    { id: "baselines", label: "Baselines" },
    {
      id: "policies",
      label: conflictCount > 0 ? `Policies (${conflictCount} conflict)` : "Policies",
      count: applied.length,
    },
  ];

  return (
    <div className="stack device-inspector">
      <div className="inspector-chrome">
      <div className="device-inspector-head">
        <div style={{ minWidth: 0 }}>
          <h1>{device.deviceName}</h1>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            {device.userPrincipalName ? `${device.userPrincipalName}` : null}
            {device.userPrincipalName && (device.operatingSystem || device.osVersion) ? " · " : null}
            {[device.operatingSystem, device.osVersion].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="device-actions">
          {!popout ? (
            <button
              type="button"
              className="axis-btn"
              onClick={() => void popOutObject("device", device.id, device.deviceName)}
            >
              Pop out
            </button>
          ) : null}
          <button
            type="button"
            className="axis-btn"
            onClick={() => {
              if (popout) void closeThisWindow();
              else onClose();
            }}
          >
            {popout ? "Close window" : "Close"}
          </button>
          <OpenInIntune href={intuneDeviceUrl(device.id)} label={device.deviceName} />
          <button type="button" className="axis-btn" onClick={() => void loadDevice({ force: true })}>
            Refresh
          </button>
        </div>
      </div>

      <DeviceActionsBar
        deviceId={device.id}
        deviceName={device.deviceName}
        disabled={loading}
        onActionMessage={(message, err) => {
          setActionMessage(message);
          setActionError(err ?? null);
        }}
        onDeleted={() => {
          if (popout) void closeThisWindow();
          else onClose();
        }}
      />

      {actionError ? <div className="axis-alert axis-alert-danger">{actionError}</div> : null}
      {actionMessage ? <div className="axis-alert axis-alert-info">{actionMessage}</div> : null}
      {error ? <div className="axis-alert axis-alert-warning">{error}</div> : null}
      {(device.enrichmentWarnings ?? []).length > 0 ? (
        <div className="axis-alert axis-alert-warning">
          <p style={{ margin: 0, fontWeight: 500 }}>Some device enrichment calls failed</p>
          <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
            {device.enrichmentWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="signal-row">
        {[
          ["Compliance", device.complianceState ?? "unknown"],
          [
            "Last sync",
            device.lastSyncDateTime ? new Date(device.lastSyncDateTime).toLocaleString() : "—",
          ],
          ["Hardware", [device.manufacturer, device.model].filter(Boolean).join(" ") || "—"],
          ["Encrypted", device.isEncrypted == null ? "—" : device.isEncrypted ? "Yes" : "No"],
        ].map(([label, value]) => (
          <div key={label} className="axis-panel" style={{ padding: "0.65rem 0.75rem" }}>
            <p className="muted" style={{ margin: 0, fontSize: "0.625rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>
              {label}
            </p>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.8125rem", fontWeight: 500 }}>{value}</p>
          </div>
        ))}
      </div>

      <div className="tab-row" aria-label="Device sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {typeof tab.count === "number" ? <span className="tab-count">{tab.count}</span> : null}
          </button>
        ))}
      </div>
      </div>

      <div className="inspector-scroll">
      {activeTab === "details" ? <DeviceHardwareDetailsPanel device={device} /> : null}
      {activeTab === "recovery" ? (
        <DeviceRecoveryPanel
          managedDeviceId={device.id}
          entraDeviceId={device.azureADDeviceId}
          deviceName={device.deviceName}
        />
      ) : null}

      {activeTab === "managed-apps" ? (
        <SearchableTableShell
          subtitle="Apps Intune has deployed/assigned to this device (install intent and state)."
          query={appQuery}
          onQueryChange={setAppQuery}
          countLabel={`${filteredManagedApps.length} of ${device.managedApps.length} managed apps`}
          empty={filteredManagedApps.length === 0}
        >
          <table className="axis-table">
            <thead>
              <tr>
                <th>App</th>
                <th>Intent</th>
                <th>Install state</th>
                <th>Version</th>
              </tr>
            </thead>
            <tbody>
              {filteredManagedApps.map((app: ManagedApp) => (
                <tr key={app.applicationId}>
                  <td>{app.displayName}</td>
                  <td className="muted">{humanizeAppToken(app.mobileAppIntent)}</td>
                  <td className="muted">{humanizeAppToken(app.installState)}</td>
                  <td className="muted">{app.displayVersion ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SearchableTableShell>
      ) : null}

      {activeTab === "detected-apps" ? (
        <SearchableTableShell
          subtitle="Discovered inventory on the device — not the same as Intune-deployed managed apps."
          query={detectedQuery}
          onQueryChange={setDetectedQuery}
          countLabel={`${filteredDetectedApps.length} of ${device.detectedApps.length} detected apps`}
          empty={filteredDetectedApps.length === 0}
        >
          <table className="axis-table">
            <thead>
              <tr>
                <th>App</th>
                <th>Version</th>
                <th>Publisher</th>
              </tr>
            </thead>
            <tbody>
              {filteredDetectedApps.map((app: DetectedApp) => (
                <tr key={app.id}>
                  <td>{app.displayName}</td>
                  <td className="muted">{app.version ?? "—"}</td>
                  <td className="muted">{app.publisher ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SearchableTableShell>
      ) : null}

      {activeTab === "baselines" ? <DeviceBaselineCompare device={device} /> : null}

      {activeTab === "groups" ? (
        <SearchableTableShell
          subtitle="Entra groups for this device object and its primary user."
          query={groupQuery}
          onQueryChange={setGroupQuery}
          countLabel={`${filteredGroups.length} of ${allGroups.length} groups · ${device.deviceGroups.length} device · ${device.userGroups.length} user`}
          empty={filteredGroups.length === 0}
        >
          <table className="axis-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Member as</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map((group) => (
                <tr key={`${group.membershipKind}-${group.id}`}>
                  <td>{group.displayName}</td>
                  <td className="muted">{group.membershipKind === "device" ? "Device" : "User"}</td>
                  <td className="muted">{describeGroup(group)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SearchableTableShell>
      ) : null}

      {activeTab === "policies" ? (
        <section className="stack">
          <div className="device-toolbar">
            <p className="muted" style={{ margin: 0 }}>
              Same flow as Intune: open a conflicted policy, then use Show contributing policies on a
              setting to see each policy&apos;s configured value side by side.
            </p>
            <button
              type="button"
              className="axis-btn"
              onClick={() => {
                const payload = {
                  deviceId: device.id,
                  deviceName: device.deviceName,
                  policyConflicts: device.policyConflicts,
                  policyDiagnostics: device.policyDiagnostics,
                  policies: applied.map((item) => ({
                    id: item.id,
                    displayName: item.displayName,
                    state: item.state,
                    source: item.source,
                    assigned: item.assigned,
                    issueCount: item.issues?.length ?? 0,
                    issues: item.issues ?? [],
                  })),
                };
                void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
              }}
            >
              Copy diagnostics
            </button>
          </div>

          {(device.policyConflicts ?? []).length > 0 ? (
            <div className="axis-alert axis-alert-danger">
              <p style={{ margin: 0, fontWeight: 500 }}>
                {device.policyConflicts.length} tenant conflict summar
                {device.policyConflicts.length === 1 ? "y" : "ies"} involving this device&apos;s assigned
                policies
              </p>
              <ul className="recovery-list">
                {device.policyConflicts.map((conflict) => (
                  <li key={conflict.id}>
                    <p style={{ margin: 0, fontWeight: 500 }}>
                      {conflict.conflictingPolicies.map((policy) => policy.displayName).join(" ↔ ")}
                    </p>
                    {conflict.contributingSettings.length > 0 ? (
                      <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                        Settings: {conflict.contributingSettings.join(", ")}
                      </p>
                    ) : null}
                    {conflict.deviceCheckinsImpacted != null ? (
                      <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                        Impacted check-ins: {conflict.deviceCheckinsImpacted}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {(device.policyDiagnostics?.notes ?? []).length > 0 ? (
            <div className="axis-alert axis-alert-warning">
              <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                {device.policyDiagnostics.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <details className="axis-panel" style={{ padding: "0.75rem" }}>
            <summary>Raw Graph policy diagnostics</summary>
            <p className="muted">
              configurationStates={device.policyDiagnostics?.rawConfigurationStateCount ?? 0},
              configurationPolicyStates=
              {device.policyDiagnostics?.rawConfigurationPolicyStateCount ?? 0}, complianceStates=
              {device.policyDiagnostics?.rawComplianceStateCount ?? 0}, tenantConflictSummaries=
              {device.policyDiagnostics?.conflictSummaryCount ?? 0}
            </p>
            <pre className="diagnostics-pre">
              {JSON.stringify(device.policyDiagnostics?.rawStates ?? [], null, 2)}
            </pre>
          </details>

          {applied.length === 0 ? (
            <p className="muted">No assigned configuration or compliance policies were matched for this device.</p>
          ) : (
            <div className="axis-panel" style={{ overflow: "hidden" }}>
              <table className="axis-table">
                <thead>
                  <tr>
                    <th>Policy</th>
                    <th>Source</th>
                    <th>Assignment</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {applied.map((item, index) => {
                    const problem = isProblemPolicyState(item.state);
                    const policyKey = `${item.source}-${item.id}-${index}`;
                    const expanded = expandedPolicyKey === policyKey;
                    const settingIssues = (item.issues ?? []).filter(
                      (issue) => issue.setting !== "PolicyStatus",
                    );
                    const conflictSettings = settingIssues.filter((issue) =>
                      isConflictPolicyState(issue.state),
                    );
                    const problemSettings = settingIssues.filter((issue) =>
                      isProblemPolicyState(issue.state),
                    );
                    return (
                      <Fragment key={policyKey}>
                        <tr
                          className={problem ? "row-link policy-problem" : undefined}
                          onClick={() => {
                            if (!problem) return;
                            void openPolicyDrilldown(policyKey, item);
                          }}
                        >
                          <td>
                            <div>
                              {problem ? <span className="muted">{expanded ? "▾ " : "▸ "}</span> : null}
                              {item.displayName}
                              {problem ? (
                                <p className="muted" style={{ margin: "0.2rem 0 0" }}>
                                  {expanded
                                    ? "Hide setting details"
                                    : settingIssues.length > 0
                                      ? `Open settings · ${conflictSettings.length} conflict`
                                      : "Open to view settings"}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td className="muted">{item.source}</td>
                          <td className="muted">{item.assigned ? "Assigned" : "Reported"}</td>
                          <td>
                            <span className={stateClass(item.state)}>{item.state}</span>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr>
                            <td colSpan={4}>
                              {policyDrillLoading ? <p className="muted">Loading settings for this policy…</p> : null}
                              {policyDrillError ? <p className="axis-alert axis-alert-warning">{policyDrillError}</p> : null}
                              {!policyDrillLoading && settingIssues.length > 0 ? (
                                <div className="stack">
                                  <p className="muted">
                                    {settingIssues.length} setting{settingIssues.length === 1 ? "" : "s"}
                                    {problemSettings.length > 0 ? ` · ${problemSettings.length} problem` : ""}
                                    {conflictSettings.length > 0 ? ` · ${conflictSettings.length} conflict` : ""}
                                  </p>
                                  <ul className="recovery-list">
                                    {settingIssues.map((issue, issueIndex) => {
                                      const rowProblem = isProblemPolicyState(issue.state);
                                      const detailKey = `${policyKey}::${issue.settingInstanceId ?? ""}::${issue.setting ?? ""}`;
                                      const detailsOpen = settingDetailsKey === detailKey;
                                      return (
                                        <li key={`${issue.setting}-${issue.settingName}-${issueIndex}`}>
                                          <p style={{ margin: 0, fontWeight: 500 }}>
                                            {issue.settingName}{" "}
                                            <span className={stateClass(issue.state)}>{issue.state}</span>
                                          </p>
                                          {issue.sources.length === 0 ? (
                                            <>
                                              {issue.currentValue ? (
                                                <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                                                  {issue.currentValue}
                                                </p>
                                              ) : null}
                                              {issue.errorDescription ? (
                                                <p className="muted" style={{ margin: "0.25rem 0 0" }}>
                                                  {issue.errorDescription}
                                                </p>
                                              ) : null}
                                            </>
                                          ) : null}
                                          {rowProblem ? (
                                            <button
                                              type="button"
                                              className="axis-link"
                                              style={{ marginTop: "0.4rem", background: "none", border: 0, padding: 0, cursor: "pointer" }}
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                void openSettingConflictDetails(policyKey, item, issue);
                                              }}
                                            >
                                              {detailsOpen && issue.sources.length > 0
                                                ? "Hide contributing policies"
                                                : "Show contributing policies"}
                                            </button>
                                          ) : null}
                                          {detailsOpen && settingDetailsLoading ? (
                                            <p className="muted">Loading contributing policies and configured values…</p>
                                          ) : null}
                                          {detailsOpen && settingDetailsError ? (
                                            <p className="axis-alert axis-alert-warning">{settingDetailsError}</p>
                                          ) : null}
                                          {issue.sources.length > 0 ? (
                                            <ul className="recovery-list" style={{ marginTop: "0.5rem" }}>
                                              {issue.sources.map((source) => (
                                                <li key={`${source.id}-${source.displayName}`}>
                                                  <p className="muted" style={{ margin: 0 }}>
                                                    {source.displayName}
                                                  </p>
                                                  {source.configuredValue ? (
                                                    <p style={{ margin: "0.2rem 0 0", fontWeight: 500 }}>
                                                      {source.configuredValue}
                                                    </p>
                                                  ) : (
                                                    <p className="muted" style={{ margin: "0.2rem 0 0" }}>
                                                      Configured value not found in policy
                                                    </p>
                                                  )}
                                                </li>
                                              ))}
                                            </ul>
                                          ) : null}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              ) : null}
                              {!policyDrillLoading && !policyDrillError && settingIssues.length === 0 ? (
                                <p className="muted">No settings loaded for this policy yet.</p>
                              ) : null}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
      </div>
    </div>
  );
}
