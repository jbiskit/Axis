import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TenantGlance } from "../types/glance";
import type {
  BaselineReferenceSourceInput,
  CatalogPolicySummary,
  E8BaselineReference,
  MobileAppSummary,
  TenantScriptSummary,
} from "../types/inventory";
import { useInventory } from "../hooks/useInventory";
import { useDocumentTabs } from "../hooks/useDocumentTabs";
import { POLICY_HUB_FAMILIES } from "../lib/nav";
import { matchesIntunePlatform, platformFromSearchParam, INTUNE_PLATFORM_LABELS } from "../lib/platforms";
import { appKindFromSearchParam, APP_KIND_LABELS } from "../lib/appKinds";
import {
  matchesAppFilters,
  matchesCatalogPolicyFilters,
  platformFilterOptionsFromList,
} from "../lib/listSelection";
import { hrefWithParam, navigate, type AppRoute } from "../lib/route";
import {
  fetchAppProtectionPolicies,
  fetchAutopilotDevices,
  fetchAutopilotProfiles,
  fetchCompliancePolicies,
  fetchConfigurationPolicies,
  fetchDeviceConfigurations,
  fetchEnrollmentConfigurations,
  fetchBaselineReferenceSources,
  fetchGroupPolicyConfigurations,
  openExternalUrl,
  fetchStoreApps,
  fetchTenantScripts,
  fetchMobileApps,
  fetchWindowsUpdatePolicies,
} from "../lib/tauri";
import {
  applyGitHubRepoInput,
  DEFAULT_E8_SOURCE,
  githubDirectoryUrl,
  isBuiltinSource,
  isSourceReady,
  loadStoredSources,
  newCustomSource,
  packTitle,
  sanitizeSource,
  saveStoredSources,
} from "../lib/baselines/sources";
import { DevicesList } from "./DevicesList";
import { DeviceDetailView, type DeviceDetailCacheEntry } from "./DeviceDetailView";
import { SettingsSearchView } from "./SettingsSearchView";
import { SettingsCatalogWorkbench } from "./SettingsCatalogWorkbench";
import { TenantOverview } from "./TenantOverview";
import { PageHeader, SignalCard } from "./ui/PageChrome";
import { CreateScriptDialog, type ScriptFamily } from "./workbench/CreateScriptDialog";
import { DocumentTabs } from "./workbench/DocumentTabs";
import {
  BulkAssignBar,
  AssignmentsDialog,
  SelectCheckbox,
  useCheckedIds,
} from "./workbench/PolicyBulkAssign";
import {
  CapabilityStub,
  CompactObjectList,
  formatRelative,
  IncompleteBanner,
  InspectorEmpty,
  InspectorErrorBoundary,
  SearchableTable,
  useListSearchState,
  WorkspaceSplit,
} from "./workbench/shared";
import type { ManagedDeviceSummary } from "../types/glance";

function LoadedInventoryBanner({ truncated }: { truncated?: boolean }) {
  if (!truncated) return null;
  return (
    <IncompleteBanner>
      Filter and select all apply to loaded rows. Axis keeps at most 500 items from Graph for this list.
    </IncompleteBanner>
  );
}

export function IntuneWorkspace({
  route,
  glance,
  glanceLoading,
  glanceError,
  accountName,
  signedIn,
  devices,
  devicesLoading,
  devicesError,
  devicesTruncated,
  devicesFetchedAt,
  onRefreshGlance,
  onRefreshDevices,
}: {
  route: AppRoute;
  glance: TenantGlance | null;
  glanceLoading: boolean;
  glanceError: string | null;
  accountName: string | null;
  signedIn: boolean;
  devices: ManagedDeviceSummary[];
  devicesLoading: boolean;
  devicesError: string | null;
  devicesTruncated: boolean;
  devicesFetchedAt: string | null;
  onRefreshGlance: () => void;
  onRefreshDevices: () => void;
}) {
  const { pathname, search } = route;
  const platform = platformFromSearchParam(search.get("platform"));
  const appKind = appKindFromSearchParam(search.get("type"));
  const selectedDevice = search.get("device");

  const loadMobile = useCallback(
    () =>
      fetchMobileApps({
        platform: platform ?? undefined,
        appKind: appKind ?? undefined,
      }),
    [appKind, platform],
  );
  const loadStore = useCallback(() => fetchStoreApps(), []);
  const loadCatalog = useCallback(() => fetchConfigurationPolicies(), []);
  const loadCompliance = useCallback(() => fetchCompliancePolicies(), []);
  const loadAdmx = useCallback(() => fetchGroupPolicyConfigurations(), []);
  const loadDeviceConfig = useCallback(() => fetchDeviceConfigurations(), []);
  const loadScripts = useCallback(() => fetchTenantScripts(), []);
  const loadAutopilotDevices = useCallback(() => fetchAutopilotDevices(), []);
  const loadAutopilotProfiles = useCallback(() => fetchAutopilotProfiles(), []);
  const loadWu = useCallback(() => fetchWindowsUpdatePolicies(), []);
  const loadMam = useCallback(() => fetchAppProtectionPolicies(), []);
  const loadEnrollment = useCallback(() => fetchEnrollmentConfigurations(), []);

  const appsInventory =
    pathname === "/intune/apps" ||
    pathname === "/intune/apps/tenant" ||
    pathname === "/intune/apps/lob";
  const mobile = useInventory(loadMobile, signedIn && appsInventory, signedIn);
  const store = useInventory(loadStore, signedIn && pathname === "/intune/apps/store", signedIn);
  const catalog = useInventory(
    loadCatalog,
    signedIn &&
      (pathname.startsWith("/intune/policies") ||
        pathname.startsWith("/intune/endpoint-security") ||
        pathname === "/intune/baselines"),
    signedIn,
  );
  const compliance = useInventory(
    loadCompliance,
    signedIn && pathname.includes("compliance"),
    signedIn,
  );
  const admx = useInventory(loadAdmx, signedIn && pathname.includes("admx"), signedIn);
  const deviceConfig = useInventory(
    loadDeviceConfig,
    signedIn && pathname.includes("device-configuration"),
    signedIn,
  );
  const scripts = useInventory(
    loadScripts,
    signedIn &&
      (pathname.includes("/scripts") ||
        pathname.includes("/remediations") ||
        pathname.includes("/devices/compliance")),
    signedIn,
  );
  const autopilotDevices = useInventory(
    loadAutopilotDevices,
    signedIn && pathname.includes("autopilot"),
    signedIn,
  );
  const autopilotProfiles = useInventory(
    loadAutopilotProfiles,
    signedIn && pathname.includes("autopilot"),
    signedIn,
  );
  const windowsUpdate = useInventory(
    loadWu,
    signedIn && pathname.startsWith("/intune/windows-update"),
    signedIn,
  );
  const mam = useInventory(loadMam, signedIn && pathname.includes("protection"), signedIn);
  const enrollment = useInventory(
    loadEnrollment,
    signedIn && pathname === "/intune/enrollment/windows",
    signedIn,
  );

  if (pathname === "/intune" || pathname === "/intune/") {
    return (
      <TenantOverview
        glance={glance}
        loading={glanceLoading}
        error={glanceError}
        accountName={accountName}
        onRefresh={onRefreshGlance}
      />
    );
  }

  if (pathname === "/intune/activity" || pathname === "/intune/reports") {
    return (
      <CapabilityStub
        title={pathname.endsWith("reports") ? "Environment report" : "Write activity"}
        description="Available in the web console; not rebuilt for this desktop pass."
        reason="These surfaces generate markdown/CSV reports and write-audit timelines from Next.js API routes. They are deferred until those jobs run in Rust."
      />
    );
  }

  if (pathname.startsWith("/intune/devices") && !pathname.includes("script") && !pathname.includes("remediation") && pathname !== "/intune/devices/compliance") {
    const devicesPath = pathname === "/intune/devices" ? "/intune/devices/all" : pathname;
    const filteredDevices = platform
      ? devices.filter((device) => matchesIntunePlatform(device.operatingSystem, platform))
      : devices;
    return (
      <DevicesWorkspace
        devicesPath={devicesPath}
        search={search}
        filteredDevices={filteredDevices}
        selectedDevice={selectedDevice}
        devicesLoading={devicesLoading}
        devicesError={devicesError}
        devicesTruncated={devicesTruncated}
        devicesFetchedAt={devicesFetchedAt}
        onRefreshDevices={onRefreshDevices}
      />
    );
  }

  if (pathname === "/intune/devices/scripts" || pathname === "/intune/devices/compliance" || pathname === "/intune/devices/remediations") {
    return (
      <ScriptsWorkbench
        pathname={pathname}
        items={scripts.items}
        loading={scripts.loading}
        error={scripts.error}
        selectedId={search.get("script")}
        onSelect={(id) => navigate(hrefWithParam(pathname, search, "script", id))}
        onClose={() => navigate(hrefWithParam(pathname, search, "script", null))}
        onRefresh={() => void scripts.reload()}
      />
    );
  }

  if (pathname.startsWith("/intune/enrollment")) {
    if (pathname === "/intune/enrollment/windows") {
      return (
        <NamedPolicyList
          eyebrow="Enrollment"
          title="Windows enrollment"
          description="Device enrollment configurations from Graph."
          items={enrollment.items}
          loading={enrollment.loading}
          error={enrollment.error}
          truncated={enrollment.truncated}
          selectedId={search.get("policy")}
          onSelect={(id) => navigate(hrefWithParam(pathname, search, "policy", id))}
          onRefresh={() => void enrollment.reload()}
          objectKind="enrollmentConfiguration"
          incomplete="ESP / enrollment profile authoring is not ported. Live Graph object, assignments, and JSON are shown."
        />
      );
    }
    return (
      <AutopilotWorkbench
        devices={autopilotDevices}
        profiles={autopilotProfiles}
        selectedDevice={search.get("autopilot")}
        selectedProfile={search.get("profile")}
        onSelectDevice={(id) => {
          const next = new URLSearchParams(search);
          if (id) next.set("autopilot", id);
          else next.delete("autopilot");
          next.delete("profile");
          const query = next.toString();
          navigate(query ? `/intune/enrollment/autopilot?${query}` : "/intune/enrollment/autopilot");
        }}
        onSelectProfile={(id) => {
          const next = new URLSearchParams(search);
          if (id) next.set("profile", id);
          else next.delete("profile");
          next.delete("autopilot");
          const query = next.toString();
          navigate(query ? `/intune/enrollment/autopilot?${query}` : "/intune/enrollment/autopilot");
        }}
      />
    );
  }

  if (pathname === "/intune/policies") {
    return (
      <PoliciesHub
        items={catalog.items}
        loading={catalog.loading}
        error={catalog.error}
        truncated={catalog.truncated}
        platform={platform}
        selectedId={search.get("policy")}
        onSelect={(id) => navigate(hrefWithParam(pathname, search, "policy", id))}
        onRefresh={() => void catalog.reload()}
      />
    );
  }

  if (pathname === "/intune/policies/settings-catalog" || pathname === "/intune/policies/browse") {
    return (
      <SettingsCatalogWorkbench
        tab={pathname.endsWith("browse") ? "browse" : "tenant"}
        platform={platform}
        policies={catalog.items}
        loading={catalog.loading}
        error={catalog.error}
        truncated={catalog.truncated}
        selectedId={search.get("policy")}
        search={search}
        pathname={pathname}
        onRefresh={() => void catalog.reload()}
      />
    );
  }

  if (pathname === "/intune/policies/admx-studio") {
    return (
      <NamedPolicyList
        eyebrow="Policies"
        title="ADMX Studio"
        description="Administrative Templates already in the tenant. Local ADMX authoring is not in this pass."
        items={admx.items}
        loading={admx.loading}
        error={admx.error}
        truncated={admx.truncated}
        selectedId={search.get("policy")}
        onSelect={(id) => navigate(hrefWithParam(pathname, search, "policy", id))}
        onRefresh={() => void admx.reload()}
        objectKind="groupPolicyConfiguration"
        incomplete="ADMX Studio (template authoring, .admx/.adml export, Monaco) is not ported. Definition values and assignments are live from Graph."
      />
    );
  }

  if (pathname === "/intune/policies/compliance") {
    const items = platform
      ? compliance.items.filter((item) => matchesIntunePlatform(item.platforms, platform))
      : compliance.items;
    return (
      <NamedPolicyList
        eyebrow="Compliance"
        title="Device compliance"
        description="Classic deviceCompliancePolicies from Graph."
        items={items}
        loading={compliance.loading}
        error={compliance.error}
        truncated={compliance.truncated}
        selectedId={search.get("policy")}
        onSelect={(id) => navigate(hrefWithParam(pathname, search, "policy", id))}
        onRefresh={() => void compliance.reload()}
        objectKind="compliancePolicy"
        incomplete="Compliance policy create/edit forms are not ported. The full Graph policy, scheduled actions, and assignments are shown."
      />
    );
  }

  if (pathname === "/intune/policies/custom" || pathname === "/intune/policies/domain") {
    return (
      <CapabilityStub
        title={pathname.endsWith("custom") ? "Custom" : "Domain"}
        description="Planned in the web product as well."
        reason="These families are marked planned in the Intune nav. No Graph workbench yet."
      />
    );
  }

  if (pathname === "/intune/policies/device-configuration") {
    return (
      <NamedPolicyList
        eyebrow="Policies"
        title="Device Configuration"
        description="Classic deviceConfigurations collection."
        items={deviceConfig.items}
        loading={deviceConfig.loading}
        error={deviceConfig.error}
        truncated={deviceConfig.truncated}
        selectedId={search.get("policy")}
        onSelect={(id) => navigate(hrefWithParam(pathname, search, "policy", id))}
        onRefresh={() => void deviceConfig.reload()}
        objectKind="deviceConfiguration"
        incomplete="Classic profile editors are planned. The full Graph configuration and assignments are shown."
      />
    );
  }

  if (pathname === "/intune/settings") {
    return <SettingsSearchView />;
  }

  if (pathname.startsWith("/intune/endpoint-security")) {
    const blade = pathname.split("/").pop() ?? "overview";
    const familyMap: Record<string, string> = {
      antivirus: "endpointSecurityAntivirus",
      "disk-encryption": "endpointSecurityDiskEncryption",
      firewall: "endpointSecurityFirewall",
      "endpoint-privilege-management": "endpointSecurityEndpointPrivilegeManagement",
      "endpoint-detection-and-response": "endpointSecurityEndpointDetectionAndResponse",
      "app-control": "endpointSecurityApplicationControl",
      "attack-surface-reduction": "endpointSecurityAttackSurfaceReduction",
      "account-protection": "endpointSecurityAccountProtection",
    };
    if (pathname === "/intune/endpoint-security") {
      return (
        <div className="stack">
          <PageHeader
            eyebrow="Endpoint Security"
            title="Overview"
            description="Manage blades filter Settings Catalog policies by templateFamily."
          />
          <div className="family-grid">
            {Object.entries(familyMap).map(([slug, family]) => {
              const count = catalog.items.filter((item) => item.templateFamily === family).length;
              return (
                <button
                  key={slug}
                  type="button"
                  className="axis-panel axis-panel-button"
                  onClick={() => navigate(`/intune/endpoint-security/${slug}`)}
                >
                  <strong>{slug.replace(/-/g, " ")}</strong>
                  <span className="muted">{count} policies</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    if (blade === "security-tasks" || blade === "conditional-access" || blade === "assignment-failures" || blade === "microsoft-defender-for-endpoint") {
      return (
        <CapabilityStub
          title="Planned Endpoint Security blade"
          description="This blade is planned in the web product."
          reason="No Graph list is wired for this blade yet."
        />
      );
    }
    const family = familyMap[blade];
    const items = family
      ? catalog.items.filter((item) => item.templateFamily === family)
      : catalog.items;
    return (
      <NamedPolicyList
        eyebrow="Endpoint Security"
        title={blade.replace(/-/g, " ")}
        description={family ? `templateFamily = ${family}` : "Endpoint security policies"}
        items={items}
        loading={catalog.loading}
        error={catalog.error}
        truncated={catalog.truncated}
        selectedId={search.get("policy")}
        onSelect={(id) => navigate(hrefWithParam(pathname, search, "policy", id))}
        onRefresh={() => void catalog.reload()}
        objectKind="configurationPolicy"
        incomplete="Endpoint Security setting editors are not ported. Setting instances and assignments are live from Graph."
      />
    );
  }

  if (pathname.startsWith("/intune/windows-update")) {
    const family =
      pathname.includes("feature") ? "feature" : pathname.includes("quality") ? "quality" : pathname.includes("driver") ? "drivers" : pathname.includes("rings") ? "rings" : null;
    if (pathname.endsWith("deployment-status")) {
      return (
        <CapabilityStub
          title="Deployment status"
          description="Monitor blade."
          reason="Update deployment reports are not fetched in this desktop pass."
        />
      );
    }
    const items = family ? windowsUpdate.items.filter((item) => item.family === family) : windowsUpdate.items;
    const selected = items.find((item) => item.id === search.get("policy"));
    return (
      <WorkspaceSplit
        inspectorPrimary={Boolean(selected)}
        master={
          selected ? (
            <CompactObjectList
              title={family ?? "Windows Update"}
              description="Select a profile to inspect it here."
              items={items.map((item) => ({
                id: item.id,
                title: item.name,
                meta: `${item.family} · ${formatRelative(item.lastModifiedDateTime)}`,
              }))}
              selectedId={selected.id}
              onSelect={(id) => navigate(hrefWithParam(pathname, search, "policy", id))}
              onRefresh={() => void windowsUpdate.reload()}
              loading={windowsUpdate.loading}
              error={windowsUpdate.error}
            />
          ) : (
            <div className="stack">
              <PageHeader
                eyebrow="Windows Update"
                title={family ?? "Overview"}
                description="Update rings, feature, quality, and driver profiles from Graph."
                actions={
                  <button type="button" className="axis-btn" onClick={() => void windowsUpdate.reload()}>
                    Refresh
                  </button>
                }
              />
              {windowsUpdate.error ? <div className="axis-alert axis-alert-danger">{windowsUpdate.error}</div> : null}
              <section className="axis-panel" style={{ overflow: "hidden" }}>
                <table className="axis-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Family</th>
                      <th>Modified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr
                        key={item.id}
                        className="row-link"
                        onClick={() => navigate(hrefWithParam(pathname, search, "policy", item.id))}
                      >
                        <td>{item.name}</td>
                        <td className="muted">{item.family}</td>
                        <td className="muted">{formatRelative(item.lastModifiedDateTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {windowsUpdate.loading && items.length === 0 ? <p className="muted" style={{ padding: "1rem" }}>Loading…</p> : null}
              </section>
            </div>
          )
        }
        inspector={
          selected ? (
            <GraphObjectInspector
              key={selected.id}
              kind={`windowsUpdate:${selected.family}`}
              id={selected.id}
              fallbackTitle={selected.name}
              incomplete="Ring/profile editors are not ported. The full Graph profile and assignments are shown."
              onClose={() => navigate(hrefWithParam(pathname, search, "policy", null))}
            />
          ) : (
            <InspectorEmpty label="Select an update profile to inspect it here. Close clears the selection and stays on Windows Update." />
          )
        }
      />
    );
  }

  if (pathname === "/intune/baselines") {
    return (
      <BaselinesWorkbench
        selectedId={search.get("check")}
        onSelect={(id) => navigate(hrefWithParam(pathname, search, "check", id))}
      />
    );
  }

  if (pathname.startsWith("/intune/apps")) {
    if (pathname === "/intune/apps/catalog" || pathname === "/intune/apps/uploads" || pathname === "/intune/apps/setup") {
      return (
        <CapabilityStub
          title={pathname.split("/").pop() ?? "Apps"}
          description="Local packaging and catalog sources."
          reason="Win32 packaging, local catalog folders, and IntuneWinAppUtil still run on the Next.js host. The Tauri shell has not wired local filesystem packaging yet — this is not a silent no-op."
        />
      );
    }
    if (pathname === "/intune/apps/protection") {
      const selected = mam.items.find((item) => item.id === search.get("policy"));
      return (
        <WorkspaceSplit
          inspectorPrimary={Boolean(selected)}
          master={
            selected ? (
              <CompactObjectList
                title="App protection"
                description="Select a policy to inspect it here."
                items={mam.items.map((item) => ({
                  id: item.id,
                  title: item.displayName,
                  meta: item.odataType ?? undefined,
                }))}
                selectedId={selected.id}
                onSelect={(id) => navigate(hrefWithParam(pathname, search, "policy", id))}
                onRefresh={() => void mam.reload()}
                loading={mam.loading}
                error={mam.error}
              />
            ) : (
              <div className="stack">
                <PageHeader eyebrow="Apps" title="App protection" description="managedAppPolicies from Graph." />
                {mam.error ? <div className="axis-alert axis-alert-danger">{mam.error}</div> : null}
                <section className="axis-panel" style={{ overflow: "hidden" }}>
                  <table className="axis-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mam.items.map((item) => (
                        <tr
                          key={item.id}
                          className="row-link"
                          onClick={() => navigate(hrefWithParam(pathname, search, "policy", item.id))}
                        >
                          <td>{item.displayName}</td>
                          <td className="muted">{item.odataType ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </div>
            )
          }
          inspector={
            selected ? (
              <GraphObjectInspector
                key={selected.id}
                kind="appProtection"
                id={selected.id}
                fallbackTitle={selected.displayName}
                incomplete="App protection editors are not ported. The full Graph policy and assignments are shown."
                onClose={() => navigate(hrefWithParam(pathname, search, "policy", null))}
              />
            ) : (
              <InspectorEmpty label="Select an app protection policy to inspect it here. Close clears the selection and stays on Apps." />
            )
          }
        />
      );
    }
    const source = pathname === "/intune/apps/store" ? store : mobile;
    const platformLabel = platform ? INTUNE_PLATFORM_LABELS[platform] : null;
    const typeLabel = appKind ? APP_KIND_LABELS[appKind] : null;
    const title =
      pathname === "/intune/apps/store"
        ? "Store apps"
        : [platformLabel, typeLabel, "applications"].filter(Boolean).join(" ");
    return (
      <AppsList
        title={title}
        items={source.items}
        loading={source.loading}
        error={source.error}
        truncated={source.truncated}
        selectedId={search.get("app")}
        onSelect={(id) => navigate(hrefWithParam(pathname === "/intune/apps" ? "/intune/apps/tenant" : pathname, search, "app", id))}
        onRefresh={() => void source.reload()}
      />
    );
  }

  return (
    <CapabilityStub
      title="Not found"
      description={pathname}
      reason="This route is not mapped in the desktop shell."
    />
  );
}

function DevicesWorkspace({
  devicesPath,
  search,
  filteredDevices,
  selectedDevice,
  devicesLoading,
  devicesError,
  devicesTruncated,
  devicesFetchedAt,
  onRefreshDevices,
}: {
  devicesPath: string;
  search: URLSearchParams;
  filteredDevices: ManagedDeviceSummary[];
  selectedDevice: string | null;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesTruncated: boolean;
  devicesFetchedAt: string | null;
  onRefreshDevices: () => void;
}) {
  const [detailCache, setDetailCache] = useState<Record<string, DeviceDetailCacheEntry>>({});
  const titleFor = useCallback(
    (id: string) => filteredDevices.find((device) => device.id === id)?.deviceName ?? id,
    [filteredDevices],
  );
  const { tabs, close } = useDocumentTabs(selectedDevice, titleFor);
  const selectDevice = (id: string | null) => navigate(hrefWithParam(devicesPath, search, "device", id));

  const updateDetailCache = useCallback((deviceId: string, entry: DeviceDetailCacheEntry) => {
    setDetailCache((current) => ({ ...current, [deviceId]: entry }));
  }, []);

  const evictDetailCache = useCallback((deviceId: string) => {
    setDetailCache((current) => {
      if (!(deviceId in current)) return current;
      const next = { ...current };
      delete next[deviceId];
      return next;
    });
  }, []);

  const closeDeviceTab = useCallback(
    (deviceId: string) => {
      evictDetailCache(deviceId);
      selectDevice(close(deviceId));
    },
    [close, evictDetailCache],
  );

  return (
    <WorkspaceSplit
      inspectorPrimary={Boolean(selectedDevice)}
      master={
        <DevicesList
          devices={filteredDevices}
          loading={devicesLoading}
          error={devicesError}
          truncated={devicesTruncated}
          fetchedAt={devicesFetchedAt}
          onRefresh={onRefreshDevices}
          selectedId={selectedDevice}
          compact={Boolean(selectedDevice)}
          onSelect={(id) => selectDevice(id)}
        />
      }
      inspector={
        selectedDevice ? (
          <div className="inspector-with-tabs">
            <DocumentTabs
              tabs={tabs}
              activeId={selectedDevice}
              onSelect={(id) => selectDevice(id)}
              onClose={(id) => closeDeviceTab(id)}
            />
            <DeviceDetailView
              deviceId={selectedDevice}
              cachedEntry={detailCache[selectedDevice]}
              onCacheUpdate={(entry) => updateDetailCache(selectedDevice, entry)}
              onClose={() => closeDeviceTab(selectedDevice)}
            />
          </div>
        ) : (
          <InspectorEmpty label="Select a device to inspect hardware, policies, apps, groups, and recovery here. Close clears the selection and stays on Devices. Open devices stay as workspace tabs." />
        )
      }
    />
  );
}

function PoliciesHub({
  items,
  loading,
  error,
  truncated,
  platform,
  selectedId,
  onSelect,
  onRefresh,
}: {
  items: CatalogPolicySummary[];
  loading: boolean;
  error: string | null;
  truncated?: boolean;
  platform: ReturnType<typeof platformFromSearchParam>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const { query, setQuery, assignedFilter, setAssignedFilter, platformFilter, setPlatformFilter } =
    useListSearchState();
  const scoped = platform
    ? items.filter((item) => matchesIntunePlatform(item.platforms, platform))
    : items;
  const platformOptions = useMemo(
    () => platformFilterOptionsFromList(scoped.map((item) => item.platforms)),
    [scoped],
  );
  const filtered = scoped.filter((item) =>
    matchesCatalogPolicyFilters(item, query, assignedFilter, platformFilter),
  );
  const selected =
    filtered.find((item) => item.id === selectedId) ?? scoped.find((item) => item.id === selectedId);
  const assigned = scoped.filter((item) => item.isAssigned).length;
  const filteredIds = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const selection = useCheckedIds(filteredIds);
  const checkedPolicies = filtered.filter((item) => selection.checkedIds.has(item.id));
  const bulkPolicies = filtered.filter((item) => selection.bulkTargetIds.includes(item.id));
  const showBulk = selection.bulkEditorOpen && bulkPolicies.length > 0;
  const inspectorOpen = Boolean(selected);
  return (
    <>
    <WorkspaceSplit
      inspectorPrimary={inspectorOpen}
      master={
        selected ? (
          <div className="stack">
            <BulkAssignBar
              count={checkedPolicies.length}
              onEdit={selection.openBulkEditor}
              onClear={selection.clear}
            />
            <LoadedInventoryBanner truncated={truncated} />
            <CompactObjectList
              title="Policies"
              description="Loaded catalog policies. Select a row to edit settings on this policy."
              items={filtered.map((item) => ({
                id: item.id,
                title: item.name,
                meta: `${item.platforms ?? "—"} · ${item.settingCount ?? 0} settings`,
              }))}
              selectedId={selected.id}
              onSelect={onSelect}
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
              eyebrow="Policies"
              title={platform ? `${platform} policies` : "Policies"}
              description="Platform-first configuration families. Select a catalog row to edit its settings here; checkboxes bulk-edit assignments. Family cards open that workspace."
            />
            {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
            <LoadedInventoryBanner truncated={truncated} />
            <div className="overview-grid-6">
              <SignalCard label="Catalog policies" value={loading ? "…" : scoped.length} />
              <SignalCard label="Assigned" value={assigned} tone="good" />
              <SignalCard label="Unassigned" value={scoped.length - assigned} tone="warn" />
            </div>
            <div className="family-grid">
              {POLICY_HUB_FAMILIES.map((family) => (
                <button
                  key={family.href}
                  type="button"
                  className="axis-panel axis-panel-button"
                  onClick={() =>
                    navigate(platform ? `${family.href}?platform=${platform}` : family.href)
                  }
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                    <strong>{family.label}</strong>
                    <span className="axis-pill">{family.status === "planned" ? "Planned" : "Ready"}</span>
                  </div>
                  <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
                    {family.platforms.join(", ")}
                  </p>
                </button>
              ))}
            </div>
            <BulkAssignBar
              count={checkedPolicies.length}
              onEdit={selection.openBulkEditor}
              onClear={selection.clear}
            />
            <SearchableTable
              query={query}
              onQueryChange={setQuery}
              assignedFilter={assignedFilter}
              onAssignedFilterChange={setAssignedFilter}
              platformFilter={platformFilter}
              onPlatformFilterChange={setPlatformFilter}
              platformOptions={platformOptions}
              showPlatformFilter
              countLabel={`${filtered.length} of ${scoped.length}`}
              placeholder="Name, platform, assigned…"
            >
              <table className="axis-table">
                <thead>
                  <tr>
                    <th className="axis-table-check">
                      <SelectCheckbox
                        checked={selection.allSelected}
                        indeterminate={checkedPolicies.length > 0 && !selection.allSelected}
                        disabled={filtered.length === 0}
                        label="Select all filtered policies"
                        onChange={selection.toggleAll}
                      />
                    </th>
                    <th>Name</th>
                    <th>Platform</th>
                    <th>Settings</th>
                    <th>Assigned</th>
                    <th>Last modified</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className={`row-link${selectedId === item.id ? " selected" : ""}`}
                      onClick={() => onSelect(item.id)}
                    >
                      <td className="axis-table-check">
                        <SelectCheckbox
                          checked={selection.checkedIds.has(item.id)}
                          label={`Select ${item.name}`}
                          onChange={() => selection.toggle(item.id)}
                        />
                      </td>
                      <td>{item.name}</td>
                      <td className="muted">{item.platforms ?? "—"}</td>
                      <td className="muted">{item.settingCount ?? "—"}</td>
                      <td className="muted">{item.isAssigned ? "Yes" : "No"}</td>
                      <td className="muted">{formatRelative(item.lastModifiedDateTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && filtered.length === 0 ? (
                <p className="muted" style={{ padding: "1rem" }}>
                  No policies.
                </p>
              ) : null}
            </SearchableTable>
          </div>
        )
      }
      inspector={
        selected ? (
          <GraphObjectInspector
            key={selected.id}
            kind="configurationPolicy"
            id={selected.id}
            fallbackTitle={selected.name}
            onClose={() => onSelect("")}
          />
        ) : null
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

function NamedPolicyList({
  eyebrow,
  title,
  description,
  items,
  loading,
  error,
  truncated,
  selectedId,
  onSelect,
  onRefresh,
  incomplete,
  objectKind,
}: {
  eyebrow: string;
  title: string;
  description: string;
  items: CatalogPolicySummary[];
  loading: boolean;
  error: string | null;
  truncated?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  incomplete: string;
  objectKind: string;
}) {
  const { query, setQuery, assignedFilter, setAssignedFilter, platformFilter, setPlatformFilter } =
    useListSearchState();
  const selected = items.find((item) => item.id === selectedId);
  const platformOptions = useMemo(
    () => platformFilterOptionsFromList(items.map((item) => item.platforms)),
    [items],
  );
  const filtered = items.filter((item) =>
    matchesCatalogPolicyFilters(item, query, assignedFilter, platformFilter),
  );
  const filteredIds = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const selection = useCheckedIds(filteredIds);
  const checkedPolicies = filtered.filter((item) => selection.checkedIds.has(item.id));
  const bulkPolicies = filtered.filter((item) => selection.bulkTargetIds.includes(item.id));
  const showBulk = selection.bulkEditorOpen && bulkPolicies.length > 0;
  const inspectorOpen = Boolean(selected);
  return (
    <>
    <WorkspaceSplit
      inspectorPrimary={inspectorOpen}
      master={
        selected ? (
          <div className="stack">
            <BulkAssignBar
              count={checkedPolicies.length}
              onEdit={selection.openBulkEditor}
              onClear={selection.clear}
            />
            <LoadedInventoryBanner truncated={truncated} />
            <CompactObjectList
              title={title}
              description="Select a policy to inspect it here."
              items={filtered.map((item) => ({
                id: item.id,
                title: item.name,
                meta: `${item.platforms ?? eyebrow} · ${formatRelative(item.lastModifiedDateTime)}`,
              }))}
              selectedId={selected.id}
              onSelect={onSelect}
              onRefresh={onRefresh}
              loading={loading}
              error={error}
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
              countLabel={`${filtered.length} of ${items.length}`}
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
              eyebrow={eyebrow}
              title={title}
              description={description}
              actions={
                <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              }
            />
            <IncompleteBanner>{incomplete}</IncompleteBanner>
            <LoadedInventoryBanner truncated={truncated} />
            {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
            <BulkAssignBar
              count={checkedPolicies.length}
              onEdit={selection.openBulkEditor}
              onClear={selection.clear}
            />
            <SearchableTable
              query={query}
              onQueryChange={setQuery}
              assignedFilter={assignedFilter}
              onAssignedFilterChange={setAssignedFilter}
              platformFilter={platformFilter}
              onPlatformFilterChange={setPlatformFilter}
              platformOptions={platformOptions}
              showPlatformFilter
              countLabel={`${filtered.length} of ${items.length}`}
              placeholder="Name, platform, assigned…"
            >
              <table className="axis-table">
                <thead>
                  <tr>
                    <th className="axis-table-check">
                      <SelectCheckbox
                        checked={selection.allSelected}
                        indeterminate={checkedPolicies.length > 0 && !selection.allSelected}
                        disabled={filtered.length === 0}
                        label="Select all filtered policies"
                        onChange={selection.toggleAll}
                      />
                    </th>
                    <th>Name</th>
                    <th>Platform</th>
                    <th>Settings</th>
                    <th>Assigned</th>
                    <th>Last modified</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className={`row-link${selectedId === item.id ? " selected" : ""}`}
                      onClick={() => onSelect(item.id)}
                    >
                      <td className="axis-table-check">
                        <SelectCheckbox
                          checked={selection.checkedIds.has(item.id)}
                          label={`Select ${item.name}`}
                          onChange={() => selection.toggle(item.id)}
                        />
                      </td>
                      <td>{item.name}</td>
                      <td className="muted">{item.platforms ?? "—"}</td>
                      <td className="muted">{item.settingCount ?? "—"}</td>
                      <td className="muted">{item.isAssigned ? "Yes" : "No"}</td>
                      <td className="muted">{formatRelative(item.lastModifiedDateTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && filtered.length === 0 ? <p className="muted" style={{ padding: "1rem" }}>No policies.</p> : null}
            </SearchableTable>
          </div>
        )
      }
      inspector={
        selected ? (
          <GraphObjectInspector
            key={selected.id}
            kind={objectKind}
            id={selected.id}
            fallbackTitle={selected.name}
            incomplete={incomplete}
            onClose={() => onSelect("")}
          />
        ) : (
          <InspectorEmpty label="Select a policy to inspect it in this workspace. Close clears the selection and stays here." />
        )
      }
    />
    <AssignmentsDialog
      open={showBulk}
      kind={objectKind}
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

function AppsList({
  title,
  items,
  loading,
  error,
  truncated,
  selectedId,
  onSelect,
  onRefresh,
}: {
  title: string;
  items: MobileAppSummary[];
  loading: boolean;
  error: string | null;
  truncated?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const { query, setQuery, assignedFilter, setAssignedFilter } = useListSearchState();
  const filtered = items.filter((item) => matchesAppFilters(item, query, assignedFilter));
  const selected = items.find((item) => item.id === selectedId);
  const filteredIds = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const selection = useCheckedIds(filteredIds);
  const checkedApps = filtered.filter((item) => selection.checkedIds.has(item.id));
  const bulkApps = filtered.filter((item) => selection.bulkTargetIds.includes(item.id));
  const showBulk = selection.bulkEditorOpen && bulkApps.length > 0;
  const inspectorOpen = Boolean(selected);
  const bulkPolicies: CatalogPolicySummary[] = bulkApps.map((item) => ({
    id: item.id,
    name: item.displayName,
    odataType: item.odataType,
  }));
  return (
    <>
    <WorkspaceSplit
      inspectorPrimary={inspectorOpen}
      master={
        selected ? (
          <div className="stack">
            <BulkAssignBar
              count={checkedApps.length}
              onEdit={selection.openBulkEditor}
              onClear={selection.clear}
            />
            <LoadedInventoryBanner truncated={truncated} />
            <CompactObjectList
              title={title}
              description="Select an app to inspect it here."
              items={filtered.map((item) => ({
                id: item.id,
                title: item.displayName,
                meta: [item.publisher, item.appTypeLabel ?? item.kind, item.platform, item.displayVersion].filter(Boolean).join(" · "),
              }))}
              selectedId={selected.id}
              onSelect={onSelect}
              onRefresh={onRefresh}
              loading={loading}
              error={error}
              checkedIds={selection.checkedIds}
              onToggleChecked={selection.toggle}
              query={query}
              onQueryChange={setQuery}
              assignedFilter={assignedFilter}
              onAssignedFilterChange={setAssignedFilter}
              countLabel={`${filtered.length} of ${items.length}`}
              searchPlaceholder="Name, publisher, assigned…"
              allSelected={selection.allSelected}
              onToggleAll={selection.toggleAll}
              selectAllIndeterminate={checkedApps.length > 0 && !selection.allSelected}
              selectAllDisabled={filtered.length === 0}
              selectAllLabel="Select all filtered apps"
            />
          </div>
        ) : (
          <div className="stack">
            <PageHeader
              eyebrow="Apps"
              title={title}
              description="Live Graph inventory. Local catalog / uploads remain host-only. Select a row to inspect it; checkboxes bulk-edit assignments."
              actions={
                <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              }
            />
            {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
            <LoadedInventoryBanner truncated={truncated} />
            <BulkAssignBar
              count={checkedApps.length}
              onEdit={selection.openBulkEditor}
              onClear={selection.clear}
            />
            <SearchableTable
              query={query}
              onQueryChange={setQuery}
              assignedFilter={assignedFilter}
              onAssignedFilterChange={setAssignedFilter}
              countLabel={`${filtered.length} of ${items.length}`}
              placeholder="Name, publisher, assigned…"
            >
              <table className="axis-table">
                <thead>
                  <tr>
                    <th className="axis-table-check">
                      <SelectCheckbox
                        checked={selection.allSelected}
                        indeterminate={checkedApps.length > 0 && !selection.allSelected}
                        disabled={filtered.length === 0}
                        label="Select all filtered apps"
                        onChange={selection.toggleAll}
                      />
                    </th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Platform</th>
                    <th>Publisher</th>
                    <th>Version</th>
                    <th>Assigned</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className={`row-link${selectedId === item.id ? " selected" : ""}`}
                      onClick={() => onSelect(item.id)}
                    >
                      <td className="axis-table-check">
                        <SelectCheckbox
                          checked={selection.checkedIds.has(item.id)}
                          label={`Select ${item.displayName}`}
                          onChange={() => selection.toggle(item.id)}
                        />
                      </td>
                      <td>{item.displayName}</td>
                      <td className="muted">{item.appTypeLabel ?? item.kind ?? "—"}</td>
                      <td className="muted">{item.platform ?? "—"}</td>
                      <td className="muted">{item.publisher ?? "—"}</td>
                      <td className="muted">{item.displayVersion ?? "—"}</td>
                      <td className="muted">{item.isAssigned ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && filtered.length === 0 ? (
                <p className="muted" style={{ padding: "1rem" }}>
                  No apps.
                </p>
              ) : null}
            </SearchableTable>
          </div>
        )
      }
      inspector={
        selected ? (
          <GraphObjectInspector
            key={selected.id}
            kind="mobileApp"
            id={selected.id}
            fallbackTitle={selected.displayName}
            incomplete="Win32 content replace, detection-rule editor, and intunewin packaging are not available in Tauri. Assignments can be updated from this inspector or bulk-selected apps."
            onClose={() => onSelect("")}
          />
        ) : (
          <InspectorEmpty label="Select an app to inspect it in this workspace. Close clears the selection and stays on Apps." />
        )
      }
    />
    <AssignmentsDialog
      open={showBulk}
      kind="mobileApp"
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

function ScriptsWorkbench({
  pathname,
  items,
  loading,
  error,
  selectedId,
  onSelect,
  onClose,
  onRefresh,
}: {
  pathname: string;
  items: TenantScriptSummary[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const kind =
    pathname.endsWith("remediations")
      ? "remediation"
      : pathname.endsWith("compliance")
        ? "compliance"
        : "platform";
  const scoped = items.filter((item) => {
    if (kind === "remediation") return item.kind === "remediation";
    if (kind === "compliance") return item.kind === "compliance";
    return item.kind.startsWith("platform");
  });
  const title = kind === "remediation" ? "Remediations" : kind === "compliance" ? "Compliance scripts" : "Scripts";
  const family: ScriptFamily =
    kind === "remediation" ? "remediation" : kind === "compliance" ? "compliance" : "platform";
  const [creating, setCreating] = useState(false);
  const [createdOverlay, setCreatedOverlay] = useState<TenantScriptSummary | null>(null);
  const visible = useMemo(() => {
    if (!createdOverlay) return scoped;
    if (scoped.some((item) => item.id === createdOverlay.id)) return scoped;
    return [createdOverlay, ...scoped];
  }, [createdOverlay, scoped]);
  const selected = visible.find((item) => item.id === selectedId) ?? items.find((item) => item.id === selectedId);
  const titleFor = useCallback(
    (id: string) =>
      visible.find((item) => item.id === id)?.displayName ??
      items.find((item) => item.id === id)?.displayName ??
      id,
    [items, visible],
  );
  const { tabs, close } = useDocumentTabs(selectedId, titleFor);
  const createButton = (
    <button type="button" className="axis-btn axis-btn-primary" onClick={() => setCreating(true)}>
      New
    </button>
  );
  return (
    <>
    <WorkspaceSplit
      inspectorPrimary={Boolean(selected)}
      master={
        selected ? (
          <CompactObjectList
            title={title}
            description="Select a script to inspect it here."
            items={visible.map((item) => ({
              id: item.id,
              title: item.displayName,
              meta: `${item.kind} · ${item.runAsAccount ?? "—"}`,
            }))}
            selectedId={selected.id}
            onSelect={onSelect}
            onRefresh={onRefresh}
            loading={loading}
            error={error}
            actions={createButton}
          />
        ) : (
          <div className="stack">
            <PageHeader
              eyebrow="Devices"
              title={title}
              description="Live Graph inventory. Create a script here, then assign it from the inspector."
              actions={
                <>
                  {createButton}
                  <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
                    Refresh
                  </button>
                </>
              }
            />
            {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
            <section className="axis-panel" style={{ overflow: "hidden" }}>
              <table className="axis-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Kind</th>
                    <th>Run as</th>
                    <th>Assignments</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.id} className="row-link" onClick={() => onSelect(item.id)}>
                      <td>{item.displayName}</td>
                      <td className="muted">{item.kind}</td>
                      <td className="muted">{item.runAsAccount ?? "—"}</td>
                      <td className="muted">{item.assignmentCount ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )
      }
      inspector={
        selected ? (
          <div className="inspector-with-tabs">
            <DocumentTabs
              tabs={tabs}
              activeId={selected.id}
              onSelect={onSelect}
              onClose={(id) => {
                const next = close(id);
                if (next) onSelect(next);
                else onClose();
              }}
            />
            <InspectorErrorBoundary>
            <GraphObjectInspector
              key={selected.id}
              kind={`script:${selected.kind}`}
              id={selected.id}
              fallbackTitle={selected.displayName}
              onClose={() => {
                const next = close(selected.id);
                if (next) onSelect(next);
                else onClose();
              }}
            />
            </InspectorErrorBoundary>
          </div>
        ) : (
          <InspectorEmpty label="Select a script to inspect it in this workspace. Close clears the selection and stays here." />
        )
      }
    />
    <CreateScriptDialog
      open={creating}
      family={family}
      onClose={() => setCreating(false)}
      onCreated={(script) => {
        setCreatedOverlay(script);
        onSelect(script.id);
        onRefresh();
      }}
    />
    </>
  );
}

function AutopilotWorkbench({
  devices,
  profiles,
  selectedDevice,
  selectedProfile,
  onSelectDevice,
  onSelectProfile,
}: {
  devices: ReturnType<typeof useInventory<import("../types/inventory").AutopilotDevice>>;
  profiles: ReturnType<typeof useInventory<import("../types/inventory").AutopilotProfile>>;
  selectedDevice: string | null;
  selectedProfile: string | null;
  onSelectDevice: (id: string) => void;
  onSelectProfile: (id: string) => void;
}) {
  const device = devices.items.find((item) => item.id === selectedDevice);
  const profile = profiles.items.find((item) => item.id === selectedProfile);
  const selected = Boolean(device || profile);
  const lists = (
    <>
      <CompactObjectList
        title="Devices"
        items={devices.items.map((item) => ({
          id: item.id,
          title: item.serialNumber ?? item.displayName ?? item.id,
          meta: [item.groupTag, item.enrollmentState].filter(Boolean).join(" · "),
        }))}
        selectedId={selectedDevice}
        onSelect={onSelectDevice}
        onRefresh={() => {
          void devices.reload();
          void profiles.reload();
        }}
        loading={devices.loading}
        error={devices.error}
      />
      <CompactObjectList
        title="Profiles"
        items={profiles.items.map((item) => ({
          id: item.id,
          title: item.displayName,
          meta: formatRelative(item.lastModifiedDateTime),
        }))}
        selectedId={selectedProfile}
        onSelect={onSelectProfile}
        loading={profiles.loading}
        error={profiles.error}
      />
    </>
  );
  return (
    <WorkspaceSplit
      inspectorPrimary={selected}
      master={
        selected ? (
          <div className="device-list-compact" style={{ gap: "0.85rem" }}>
            {lists}
          </div>
        ) : (
          <div className="stack">
            <PageHeader
              eyebrow="Enrollment"
              title="Autopilot"
              description="Device identities and deployment profiles from Graph. Select a row to inspect it here."
              actions={
                <button
                  type="button"
                  className="axis-btn"
                  onClick={() => {
                    void devices.reload();
                    void profiles.reload();
                  }}
                >
                  Refresh
                </button>
              }
            />
            {devices.error ? <div className="axis-alert axis-alert-danger">{devices.error}</div> : null}
            {profiles.error ? <div className="axis-alert axis-alert-danger">{profiles.error}</div> : null}
            <div className="overview-grid-2">
              <section className="axis-panel" style={{ overflow: "hidden" }}>
                <h2 style={{ margin: "0.75rem 1rem", fontSize: "0.85rem" }}>Devices</h2>
                <table className="axis-table">
                  <thead>
                    <tr>
                      <th>Serial</th>
                      <th>Tag</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.items.map((item) => (
                      <tr key={item.id} className="row-link" onClick={() => onSelectDevice(item.id)}>
                        <td>{item.serialNumber ?? item.displayName ?? item.id}</td>
                        <td className="muted">{item.groupTag ?? "—"}</td>
                        <td className="muted">{item.enrollmentState ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="axis-panel" style={{ overflow: "hidden" }}>
                <h2 style={{ margin: "0.75rem 1rem", fontSize: "0.85rem" }}>Profiles</h2>
                <table className="axis-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Modified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.items.map((item) => (
                      <tr key={item.id} className="row-link" onClick={() => onSelectProfile(item.id)}>
                        <td>{item.displayName}</td>
                        <td className="muted">{formatRelative(item.lastModifiedDateTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          </div>
        )
      }
      inspector={
        device ? (
          <GraphObjectInspector
            key={device.id}
            kind="autopilotDevice"
            id={device.id}
            fallbackTitle={device.serialNumber ?? device.displayName ?? device.id}
            incomplete="Group tag updates and profile assignment writes are not in this pass. The full Autopilot identity is shown."
            onClose={() => onSelectDevice("")}
          />
        ) : profile ? (
          <GraphObjectInspector
            key={profile.id}
            kind="autopilotProfile"
            id={profile.id}
            fallbackTitle={profile.displayName}
            incomplete="Profile create/edit and assignment drafts are not ported. The full profile and assignments are shown."
            onClose={() => onSelectProfile("")}
          />
        ) : (
          <InspectorEmpty label="Select an Autopilot device or profile to inspect it here. Close clears the selection and stays on Enrollment." />
        )
      }
    />
  );
}

function BaselinesWorkbench({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [sourceEntries, setSourceEntries] = useState<BaselineReferenceSourceInput[]>([
    DEFAULT_E8_SOURCE,
  ]);
  const [sourcesHydrated, setSourcesHydrated] = useState(false);
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
  const [referenceLoads, setReferenceLoads] = useState<
    Array<{
      source: {
        id: string;
        name: string;
        owner: string;
        repo: string;
        gitRef: string;
        path: string;
        directoryUrl: string;
        hasToken?: boolean;
      };
      references: E8BaselineReference[];
      warnings: string[];
      error: string | null;
    }>
  >([]);
  const [e8Loading, setE8Loading] = useState(false);
  const [referencesError, setReferencesError] = useState<string | null>(null);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    setSourceEntries(loadStoredSources());
    setSourcesHydrated(true);
  }, []);

  useEffect(() => {
    if (!sourcesHydrated) return;
    try {
      saveStoredSources(sourceEntries);
    } catch {
      // ignore write failures
    }
  }, [sourceEntries, sourcesHydrated]);

  const loadReferences = useCallback(async () => {
    const ready = sourceEntries.map(sanitizeSource).filter(isSourceReady);
    if (ready.length === 0) {
      setReferenceLoads([]);
      setReferencesError("Paste a GitHub repository URL to load baseline packs.");
      return;
    }
    setE8Loading(true);
    setReferencesError(null);
    try {
      const response = await fetchBaselineReferenceSources(ready);
      setReferenceLoads(response.sources);
    } catch (error) {
      setReferenceLoads([]);
      setReferencesError(error instanceof Error ? error.message : String(error));
    } finally {
      setE8Loading(false);
    }
  }, [sourceEntries]);

  useEffect(() => {
    if (!sourcesHydrated || initialLoadDone.current) return;
    initialLoadDone.current = true;
    void loadReferences();
  }, [loadReferences, sourcesHydrated]);

  const packs = useMemo(() => {
    const loadsById = new Map(referenceLoads.map((load) => [load.source.id, load]));
    return sourceEntries.filter(isSourceReady).map((entry) => {
      const load = loadsById.get(entry.id ?? "");
      const source = load?.source;
      const title = packTitle({
        id: entry.id,
        name: source?.name ?? entry.name,
        owner: source?.owner ?? entry.owner,
        repo: source?.repo ?? entry.repo,
      });
      return {
        id: entry.id ?? source?.id ?? title,
        title,
        kind: isBuiltinSource(entry) ? "Built-in" : "Custom pack",
        owner: source?.owner ?? entry.owner,
        repo: source?.repo ?? entry.repo,
        directoryUrl: source?.directoryUrl ?? githubDirectoryUrl(entry),
        error: load?.error ?? null,
        warning: load?.warnings[0] ?? null,
        references: (load?.references ?? []).map((reference) => ({
          ...reference,
          sourceId: source?.id ?? entry.id ?? "",
          sourceName: title,
        })),
      };
    });
  }, [referenceLoads, sourceEntries]);

  const allReferences = useMemo(
    () => packs.flatMap((pack) => pack.references),
    [packs],
  );

  const selectedReference = selectedId?.startsWith("ref:")
    ? allReferences.find(
        (reference) => `ref:${reference.sourceId}:${reference.id}` === selectedId,
      ) ?? null
    : null;
  const baselineModifiedMeta = (reference: E8BaselineReference) => {
    const repoModified = reference.repositoryLastModifiedDateTime;
    const policyExported = reference.policyExportedDateTime;
    const label = repoModified ? "repo" : policyExported ? "exported" : "unknown";
    return `${reference.version ?? "version n/a"} · ${label}: ${formatRelative(repoModified ?? policyExported)}`;
  };

  return (
    <WorkspaceSplit
      inspectorPrimary={Boolean(selectedReference)}
      master={
        selectedReference ? (
          <CompactObjectList
            title="Policies"
            description="Select a policy from a baseline pack to inspect it here."
            items={allReferences.map((reference) => ({
              id: `ref:${reference.sourceId}:${reference.id}`,
              title: reference.name,
              meta: baselineModifiedMeta(reference),
              group: reference.sourceName,
            }))}
            selectedId={selectedId ?? ""}
            onSelect={onSelect}
          />
        ) : (
          <div className="stack">
            <PageHeader
              eyebrow="Baselines"
              title="Baselines"
              description="Built-in ASD E8 stays here. Add a GitHub pack URL for your own titles; policies list under each pack. Open a device and use Baselines to grade applied settings."
              actions={
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" className="axis-btn" onClick={() => setSourceEditorOpen((open) => !open)}>
                    {sourceEditorOpen ? "Hide sources" : "Manage sources"}
                  </button>
                  <button type="button" className="axis-btn" onClick={() => void loadReferences()} disabled={e8Loading}>
                    {e8Loading ? "Refreshing…" : "Refresh references"}
                  </button>
                </div>
              }
            />
            <IncompleteBanner>
              These listings do not write back to Graph. Compare a device against a selected export from Devices → Baselines.
            </IncompleteBanner>
            {sourceEditorOpen ? (
              <section className="axis-panel" style={{ padding: "0.85rem" }}>
                <p className="muted" style={{ marginTop: 0 }}>
                  ASD E8 is built in. Add another GitHub URL for a custom pack — Axis uses{" "}
                  <code>axis-pack.json</code> for that pack’s title and policy source label. Mark a source private
                  only when the repo is private, then add a PAT with the <code>repo</code> scope.
                </p>
                <div className="stack" style={{ gap: "0.5rem" }}>
                  {sourceEntries.map((entry, index) => {
                    const sourceKey = entry.id ?? `source-${index}`;
                    const builtin = isBuiltinSource(entry);
                    return (
                    <div key={sourceKey} style={{ border: "1px solid var(--axis-border)", borderRadius: "0.5rem", padding: "0.6rem" }}>
                      <p className="baseline-pack-kicker">{builtin ? "Built-in" : "Custom pack"}</p>
                      <p style={{ margin: "0.2rem 0 0.5rem", fontWeight: 650 }}>{packTitle(entry)}</p>
                      {builtin ? (
                        <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
                          ASD Essential Eight reference from the ASD Blueprint repository.
                        </p>
                      ) : (
                        <>
                          <input
                            className="axis-input"
                            value={entry.url ?? ""}
                            placeholder="https://github.com/owner/repo"
                            onChange={(event) => {
                              const value = event.target.value;
                              setSourceEntries((current) =>
                                current.map((row, rowIndex) =>
                                  rowIndex === index ? applyGitHubRepoInput(row, value) : row,
                                ),
                              );
                            }}
                          />
                          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.5rem" }}>
                            <input
                              type="checkbox"
                              checked={Boolean(entry.private)}
                              onChange={(event) => {
                                const isPrivate = event.target.checked;
                                setSourceEntries((current) =>
                                  current.map((row, rowIndex) =>
                                    rowIndex === index
                                      ? { ...row, private: isPrivate, token: isPrivate ? row.token : undefined }
                                      : row,
                                  ),
                                );
                              }}
                            />
                            Private repository
                          </label>
                          {entry.private ? (
                            <input
                              className="axis-input"
                              style={{ marginTop: "0.4rem" }}
                              type="password"
                              autoComplete="off"
                              value={entry.token ?? ""}
                              placeholder="GitHub PAT"
                              onChange={(event) => {
                                const value = event.target.value;
                                setSourceEntries((current) =>
                                  current.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, token: value } : row,
                                  ),
                                );
                              }}
                            />
                          ) : null}
                        </>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.45rem" }}>
                        <button
                          type="button"
                          className="axis-link"
                          disabled={!isSourceReady(entry)}
                          onClick={() => void openExternalUrl(githubDirectoryUrl(entry))}
                        >
                          Open repository
                        </button>
                        {builtin ? (
                          <span className="muted" style={{ fontSize: "0.75rem" }}>Always available</span>
                        ) : (
                          <button
                            type="button"
                            className="axis-link"
                            onClick={() => {
                              setSourceEntries((current) => current.filter((_, rowIndex) => rowIndex !== index));
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="axis-btn"
                    onClick={() => setSourceEntries((current) => [...current, newCustomSource()])}
                  >
                    Add GitHub pack
                  </button>
                  <button type="button" className="axis-btn" onClick={() => void loadReferences()} disabled={e8Loading}>
                    Reload packs
                  </button>
                </div>
              </section>
            ) : null}
            {referencesError ? <div className="axis-alert axis-alert-danger">Reference loading failed: {referencesError}</div> : null}
            {packs.map((pack) => (
              <section key={pack.id} className="axis-panel" style={{ overflow: "hidden" }}>
                <div className="baseline-pack-head">
                  <div>
                    <p className="baseline-pack-kicker">{pack.kind}</p>
                    <h2>{pack.title}</h2>
                    <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.75rem" }}>
                      {pack.owner && pack.repo ? `${pack.owner}/${pack.repo}` : "Repository"}
                      {" · "}
                      {pack.references.length} {pack.references.length === 1 ? "policy" : "policies"}
                    </p>
                  </div>
                  <button type="button" className="axis-link" onClick={() => void openExternalUrl(pack.directoryUrl)}>
                    Open repository
                  </button>
                </div>
                {pack.error ? (
                  <div className="axis-alert axis-alert-danger" style={{ margin: "0.75rem" }}>
                    {pack.error}
                  </div>
                ) : null}
                {pack.warning ? (
                  <div className="axis-alert axis-alert-warning" style={{ margin: "0.75rem" }}>
                    {pack.warning}
                  </div>
                ) : null}
                <table className="axis-table">
                  <thead>
                    <tr>
                      <th>Policy</th>
                      <th>Version</th>
                      <th>Repository modified</th>
                      <th>Policy exported</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pack.references.map((reference) => (
                      <tr
                        key={`${reference.sourceId}:${reference.id}`}
                        className="row-link"
                        onClick={() => onSelect(`ref:${reference.sourceId}:${reference.id}`)}
                      >
                        <td>{reference.name}</td>
                        <td className="muted">{reference.version ?? "—"}</td>
                        <td className="muted">
                          {reference.repositoryLastModifiedDateTime
                            ? formatRelative(reference.repositoryLastModifiedDateTime)
                            : reference.policyExportedDateTime
                              ? `Fallback: ${formatRelative(reference.policyExportedDateTime)}`
                              : "—"}
                        </td>
                        <td className="muted">{formatRelative(reference.policyExportedDateTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!e8Loading && !pack.error && pack.references.length === 0 ? (
                  <p className="muted" style={{ padding: "1rem" }}>No policies were returned from this pack.</p>
                ) : null}
              </section>
            ))}
          </div>
        )
      }
      inspector={
        selectedReference ? (
          <div className="stack">
            <PageHeader
              eyebrow={selectedReference.sourceName}
              title={selectedReference.name}
              actions={
                <button type="button" className="axis-btn" onClick={() => onSelect("")}>
                  Close
                </button>
              }
            />
            <section className="axis-panel" style={{ padding: "0.85rem" }}>
              <dl className="meta-grid">
                <div>
                  <dt>Version</dt>
                  <dd>{selectedReference.version ?? "—"}</dd>
                </div>
                <div>
                  <dt>Repository modified</dt>
                  <dd>
                    {selectedReference.repositoryLastModifiedDateTime
                      ? formatRelative(selectedReference.repositoryLastModifiedDateTime)
                      : selectedReference.policyExportedDateTime
                        ? `Fallback: ${formatRelative(selectedReference.policyExportedDateTime)}`
                        : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Policy exported</dt>
                  <dd>{formatRelative(selectedReference.policyExportedDateTime)}</dd>
                </div>
                <div>
                  <dt>Pack</dt>
                  <dd>{selectedReference.sourceName}</dd>
                </div>
              </dl>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                <button type="button" className="axis-btn" onClick={() => void openExternalUrl(selectedReference.sourceUrl)}>
                  Open source entry
                </button>
                <button type="button" className="axis-btn" onClick={() => void openExternalUrl(selectedReference.downloadUrl)}>
                  Open raw export
                </button>
              </div>
            </section>
            <IncompleteBanner>
              This is a reference slice. Comparison/apply against repository sources is not implemented in this pass.
            </IncompleteBanner>
          </div>
        ) : (
          <InspectorEmpty label="Select a policy under a baseline pack to inspect it here. Close clears the selection and stays on Baselines." />
        )
      }
    />
  );
}
