import { useCallback, useEffect, useMemo, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TenantGlance } from "../types/glance";
import type {
  BaselineReferenceSourceInput,
  CatalogPolicySummary,
  ConfigurationPolicyTemplateSummary,
  E8BaselineReference,
  MobileAppSummary,
  PackExportProgress,
  PackExportResult,
  TemplateStoreKind,
  TenantScriptSummary,
  WindowsUpdatePolicy,
  AppProtectionPolicy,
  AutopilotProfile,
} from "../types/inventory";
import { useInventory } from "../hooks/useInventory";
import { useDocumentTabs } from "../hooks/useDocumentTabs";
import { matchesIntunePlatform, platformFromSearchParam, INTUNE_PLATFORM_LABELS } from "../lib/platforms";
import { appKindFromSearchParam, APP_KIND_LABELS } from "../lib/appKinds";
import {
  compareBool,
  compareCatalogPolicy,
  compareIso,
  compareNumber,
  compareText,
  matchesAppFilters,
  matchesCatalogPolicyFilters,
  platformFilterOptionsFromList,
  sortRows,
  type CatalogPolicySortKey,
} from "../lib/listSelection";
import { hrefWithParam, navigate, type AppRoute } from "../lib/route";
import {
  homogeneousBulkAssignKind,
  inspectorKindForTenantScript,
  matchesScriptFilters,
  matchesScriptWorkbenchScope,
  scriptKindFilterOptions,
  scriptWorkbenchScopeFromPath,
  tenantScriptKindLabel,
  type ScriptKindFilter,
} from "../lib/scriptKinds";
import { withTransientItem } from "../lib/duplicateObject";
import {
  fetchAppProtectionPolicies,
  fetchAutopilotDevices,
  fetchAutopilotProfiles,
  fetchCompliancePolicies,
  fetchConfigurationPolicies,
  fetchDeviceConfigurations,
  fetchEnrollmentConfigurations,
  fetchBaselineReferenceSources,
  fetchBaselineExport,
  fetchGroupPolicyConfigurations,
  createSettingsCatalogPolicy,
  exportTenantPack,
  openExternalUrl,
  pickLocalPackFolder,
  fetchStoreApps,
  fetchTenantScripts,
  fetchMobileApps,
  fetchWindowsUpdatePolicies,
  listConfigurationPolicyTemplates,
} from "../lib/tauri";
import { catalogPolicyProfileName } from "../lib/catalogPolicyProfile";
import {
  applyGitHubRepoInput,
  DEFAULT_E8_SOURCE,
  GITHUB_FINE_GRAINED_TOKEN_DOCS_URL,
  GITHUB_FINE_GRAINED_TOKEN_URL,
  isBuiltinSource,
  isLocalSource,
  isSourceReady,
  loadStoredSources,
  newCustomSource,
  newLocalSource,
  packTitle,
  resolveStoreKind,
  sanitizeSource,
  saveStoredSources,
  sourceOpenUrl,
  templateKicker,
  tokenForSource,
} from "../lib/baselines/sources";
import { normalizeIntunePolicyExport, catalogDescriptionFromPolicy, catalogPlatformFromPolicy, catalogSettingsFromPolicy } from "../lib/baselines/policyExport";
import {
  groupPackArtifacts,
  isCatalogPackArtifact,
  isPolicySettingsExportArtifact,
  packArtifactKindLabel,
} from "../lib/baselines/packArtifacts";
import {
  PolicyExportInspect,
  type PolicyExportResolved,
} from "./workbench/PolicyExportInspect";
import { BaselineMergeDialog } from "./workbench/BaselineMergeDialog";
import { DevicesList } from "./DevicesList";
import { DeviceDetailView, type DeviceDetailCacheEntry } from "./DeviceDetailView";
import { SettingsSearchView } from "./SettingsSearchView";
import { SettingsCatalogWorkbench } from "./SettingsCatalogWorkbench";
import { TenantOverview } from "./TenantOverview";
import { WriteActivityView } from "./WriteActivityView";
import { EnvironmentReportView } from "./EnvironmentReportView";
import { GraphObjectInspector } from "./workbench/GraphObjectInspector";
import { PageHeader, SignalCard } from "./ui/PageChrome";
import { CreateCompliancePolicyDialog } from "./workbench/CreateCompliancePolicyDialog";
import { CreateEndpointSecurityPolicyDialog } from "./workbench/CreateEndpointSecurityPolicyDialog";
import { CreateScriptDialog, type ScriptFamily } from "./workbench/CreateScriptDialog";
import { DocumentTabs, InspectorWithDocumentTabs } from "./workbench/DocumentTabs";
import { useCatalogFileImport } from "./workbench/CatalogFileImportDialog";
import { useScriptFileImport } from "./workbench/ScriptFileImportDialog";
import {
  BulkListActions,
  listTargetProps,
  ObjectListMenuHost,
} from "./workbench/ObjectListMenu";
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
  SortableTh,
  useColumnSort,
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

  if (pathname === "/intune/activity") {
    return <WriteActivityView pathname={pathname} search={search} />;
  }

  if (pathname === "/intune/reports") {
    return (
      <EnvironmentReportView
        signedIn={signedIn}
        defaultPreparedFor={glance?.organizationName ?? null}
        defaultPreparedBy={accountName}
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
        key={pathname}
        pathname={pathname}
        items={scripts.items}
        loading={scripts.loading}
        error={scripts.error}
        selectedId={search.get("script")}
        onSelect={(id) => {
          const kind = scripts.items.find((item) => item.id === id)?.kind;
          const scriptPath =
            kind === "remediation"
              ? "/intune/devices/remediations"
              : kind === "compliance"
                ? "/intune/devices/compliance"
                : "/intune/devices/scripts";
          navigate(hrefWithParam(scriptPath, search, "script", id));
        }}
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
        createFamily={platform ?? "windows"}
        incomplete="Create a policy here, then assign it from the inspector. Actions for noncompliance are set at create time."
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
      <EndpointSecurityBlade
        blade={blade}
        family={family}
        items={items}
        loading={catalog.loading}
        error={catalog.error}
        truncated={catalog.truncated}
        selectedId={search.get("policy")}
        onSelect={(id) => navigate(hrefWithParam(pathname, search, "policy", id))}
        onRefresh={() => void catalog.reload()}
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
    return (
      <WindowsUpdateWorkbench
        family={family}
        items={family ? windowsUpdate.items.filter((item) => item.family === family) : windowsUpdate.items}
        loading={windowsUpdate.loading}
        error={windowsUpdate.error}
        selectedId={search.get("policy")}
        pathname={pathname}
        search={search}
        onRefresh={() => void windowsUpdate.reload()}
      />
    );
  }

  if (pathname === "/intune/baselines" || pathname === "/intune/templates") {
    return (
      <BaselinesWorkbench
        surface={pathname === "/intune/templates" ? "templates" : "baselines"}
        selectedId={search.get("check")}
        onSelect={(id) => navigate(hrefWithParam(pathname, search, "check", id))}
        signedIn={signedIn}
        organizationName={glance?.organizationName ?? null}
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
      return (
        <AppProtectionWorkbench
          items={mam.items}
          loading={mam.loading}
          error={mam.error}
          selectedId={search.get("policy")}
          pathname={pathname}
          search={search}
          onRefresh={() => void mam.reload()}
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
  const { tabs, close, reorder } = useDocumentTabs(selectedDevice, titleFor);
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
              onReorder={reorder}
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

function WindowsUpdateWorkbench({
  family,
  items,
  loading,
  error,
  selectedId,
  pathname,
  search,
  onRefresh,
}: {
  family: string | null;
  items: WindowsUpdatePolicy[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  pathname: string;
  search: URLSearchParams;
  onRefresh: () => void;
}) {
  const [overlay, setOverlay] = useState<WindowsUpdatePolicy | null>(null);
  const listed = useMemo(() => withTransientItem(items, overlay), [items, overlay]);
  const { sort, toggle: toggleSort } = useColumnSort<"name" | "family" | "modified">("name");
  const sorted = useMemo(
    () =>
      sortRows(listed, sort.dir, (a, b) => {
        if (sort.key === "family") return compareText(a.family, b.family) || compareText(a.name, b.name);
        if (sort.key === "modified") {
          return compareIso(a.lastModifiedDateTime, b.lastModifiedDateTime) || compareText(a.name, b.name);
        }
        return compareText(a.name, b.name) || compareText(a.id, b.id);
      }),
    [listed, sort],
  );
  const selected = listed.find((item) => item.id === selectedId);
  const titleFor = useCallback(
    (id: string) => listed.find((item) => item.id === id)?.name ?? id,
    [listed],
  );
  const selectPolicy = (id: string) => navigate(hrefWithParam(pathname, search, "policy", id || null));
  const menu = (
    <ObjectListMenuHost
      onDuplicated={(created, source) => {
        const sourceFamily = source.kind.startsWith("windowsUpdate:")
          ? source.kind.slice("windowsUpdate:".length)
          : family ?? "rings";
        setOverlay({
          id: created.id,
          family: sourceFamily,
          name: created.title,
        });
        selectPolicy(created.id);
        onRefresh();
      }}
      onMetadataUpdated={(updated, source) => {
        const sourceFamily = source.kind.startsWith("windowsUpdate:")
          ? source.kind.slice("windowsUpdate:".length)
          : family ?? "rings";
        setOverlay({ id: updated.id, family: sourceFamily, name: updated.title });
        onRefresh();
      }}
      onDeleted={(target) => {
        if (overlay?.id === target.id) setOverlay(null);
        if (selectedId === target.id) selectPolicy("");
        onRefresh();
      }}
    >
      {selected ? (
          <CompactObjectList
            title={family ?? "Windows Update"}
            description="Select a profile to inspect it here."
            items={sorted.map((item) => ({
              id: item.id,
              title: item.name,
              kind: `windowsUpdate:${item.family}`,
              meta: `${item.family} · ${formatRelative(item.lastModifiedDateTime)}`,
            }))}
            selectedId={selected.id}
            onSelect={(id) => navigate(hrefWithParam(pathname, search, "policy", id))}
            onRefresh={onRefresh}
            loading={loading}
            error={error}
          />
        ) : (
          <div className="stack">
            <PageHeader
              eyebrow="Windows Update"
              title={family ?? "Overview"}
              description="Update rings, feature, quality, and driver profiles from Graph."
              onRefresh={onRefresh}
              refreshing={loading}
              actions={
                <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              }
            />
            {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
            <section className="axis-panel" style={{ overflow: "hidden" }}>
              <table className="axis-table">
                <thead>
                  <tr>
                    <SortableTh column="name" label="Name" sort={sort} onSort={toggleSort} />
                    <SortableTh column="family" label="Family" sort={sort} onSort={toggleSort} />
                    <SortableTh column="modified" label="Modified" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((item) => (
                    <tr
                      key={item.id}
                      className="row-link"
                      onClick={() => navigate(hrefWithParam(pathname, search, "policy", item.id))}
                      {...listTargetProps(item.id, item.name, `windowsUpdate:${item.family}`)}
                    >
                      <td>{item.name}</td>
                      <td className="muted">{item.family}</td>
                      <td className="muted">{formatRelative(item.lastModifiedDateTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {loading && listed.length === 0 ? <p className="muted" style={{ padding: "1rem" }}>Loading…</p> : null}
            </section>
          </div>
        )}
    </ObjectListMenuHost>
  );
  return (
    <WorkspaceSplit
      inspectorPrimary={Boolean(selected)}
      master={menu}
      inspector={
        <InspectorWithDocumentTabs
          selectedId={selected?.id ?? null}
          titleFor={titleFor}
          onSelect={selectPolicy}
          onClear={() => selectPolicy("")}
          empty={
            <InspectorEmpty label="Select an update profile to inspect it here. Close clears the selection and stays on Windows Update." />
          }
        >
          {({ closeActive }) =>
            selected ? (
              <GraphObjectInspector
                key={selected.id}
                kind={`windowsUpdate:${selected.family}`}
                id={selected.id}
                fallbackTitle={selected.name}
                incomplete="Ring/profile editors are not ported. The full Graph profile and assignments are shown."
                onClose={closeActive}
              />
            ) : null
          }
        </InspectorWithDocumentTabs>
      }
    />
  );
}

function AppProtectionWorkbench({
  items,
  loading,
  error,
  selectedId,
  pathname,
  search,
  onRefresh,
}: {
  items: AppProtectionPolicy[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  pathname: string;
  search: URLSearchParams;
  onRefresh: () => void;
}) {
  const [overlay, setOverlay] = useState<AppProtectionPolicy | null>(null);
  const listed = useMemo(() => withTransientItem(items, overlay), [items, overlay]);
  const { sort, toggle: toggleSort } = useColumnSort<"name" | "type" | "modified">("name");
  const sorted = useMemo(
    () =>
      sortRows(listed, sort.dir, (a, b) => {
        if (sort.key === "type") return compareText(a.odataType, b.odataType) || compareText(a.displayName, b.displayName);
        if (sort.key === "modified") {
          return compareIso(a.lastModifiedDateTime, b.lastModifiedDateTime) || compareText(a.displayName, b.displayName);
        }
        return compareText(a.displayName, b.displayName) || compareText(a.id, b.id);
      }),
    [listed, sort],
  );
  const selected = listed.find((item) => item.id === selectedId);
  const titleFor = useCallback(
    (id: string) => listed.find((item) => item.id === id)?.displayName ?? id,
    [listed],
  );
  const selectPolicy = (id: string) =>
    navigate(hrefWithParam(pathname, search, "policy", id || null));
  return (
    <WorkspaceSplit
      inspectorPrimary={Boolean(selected)}
      master={
        <ObjectListMenuHost
          onDuplicated={(created) => {
            setOverlay({ id: created.id, displayName: created.title });
            selectPolicy(created.id);
            onRefresh();
          }}
          onMetadataUpdated={(updated) => {
            setOverlay({
              id: updated.id,
              displayName: updated.title,
              description: updated.description,
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
          <CompactObjectList
            title="App protection"
            description="Select a policy to inspect it here."
            objectKind="appProtection"
            items={sorted.map((item) => ({
              id: item.id,
              title: item.displayName,
              meta: item.odataType ?? undefined,
            }))}
            selectedId={selected.id}
            onSelect={(id) => navigate(hrefWithParam(pathname, search, "policy", id))}
            onRefresh={onRefresh}
            loading={loading}
            error={error}
          />
        ) : (
          <div className="stack">
            <PageHeader
              eyebrow="Apps"
              title="App protection"
              description="managedAppPolicies from Graph."
              onRefresh={onRefresh}
              refreshing={loading}
              actions={
                <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
                  {loading ? "Refreshing…" : "Refresh"}
                </button>
              }
            />
            {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
            <section className="axis-panel" style={{ overflow: "hidden" }}>
              <table className="axis-table">
                <thead>
                  <tr>
                    <SortableTh column="name" label="Name" sort={sort} onSort={toggleSort} />
                    <SortableTh column="type" label="Type" sort={sort} onSort={toggleSort} />
                    <SortableTh column="modified" label="Modified" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((item) => (
                    <tr
                      key={item.id}
                      className="row-link"
                      onClick={() => navigate(hrefWithParam(pathname, search, "policy", item.id))}
                      {...listTargetProps(item.id, item.displayName, "appProtection")}
                    >
                      <td>{item.displayName}</td>
                      <td className="muted">{item.odataType ?? "—"}</td>
                      <td className="muted">{formatRelative(item.lastModifiedDateTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
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
            <InspectorEmpty label="Select an app protection policy to inspect it here. Close clears the selection and stays on Apps." />
          }
        >
          {({ closeActive }) =>
            selected ? (
              <GraphObjectInspector
                key={selected.id}
                kind="appProtection"
                id={selected.id}
                fallbackTitle={selected.displayName}
                incomplete="App protection editors are not ported. The full Graph policy and assignments are shown."
                onClose={closeActive}
              />
            ) : null
          }
        </InspectorWithDocumentTabs>
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
  const { sort, toggle: toggleSort } = useColumnSort<CatalogPolicySortKey>("name");
  const [overlay, setOverlay] = useState<CatalogPolicySummary | null>(null);
  const listed = useMemo(() => withTransientItem(items, overlay), [items, overlay]);
  const scoped = platform
    ? listed.filter((item) => matchesIntunePlatform(item.platforms, platform))
    : listed;
  const platformOptions = useMemo(
    () => platformFilterOptionsFromList(scoped.map((item) => item.platforms)),
    [scoped],
  );
  const filtered = useMemo(() => {
    const rows = scoped.filter((item) =>
      matchesCatalogPolicyFilters(item, query, assignedFilter, platformFilter),
    );
    return sortRows(rows, sort.dir, (a, b) => compareCatalogPolicy(a, b, sort.key));
  }, [assignedFilter, platformFilter, query, scoped, sort]);
  const selected =
    filtered.find((item) => item.id === selectedId) ?? scoped.find((item) => item.id === selectedId);
  const assigned = scoped.filter((item) => item.isAssigned).length;
  const filteredIds = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const selection = useCheckedIds(filteredIds);
  const checkedPolicies = filtered.filter((item) => selection.checkedIds.has(item.id));
  const bulkPolicies = filtered.filter((item) => selection.bulkTargetIds.includes(item.id));
  const showBulk = selection.bulkEditorOpen && bulkPolicies.length > 0;
  const bulkDelete = (
    <BulkListActions
      targets={checkedPolicies.map((item) => ({
        id: item.id,
        title: item.name,
        kind: "configurationPolicy",
      }))}
      onDeleted={(deleted) => {
        if (deleted.some((target) => target.id === overlay?.id)) setOverlay(null);
        if (deleted.some((target) => target.id === selectedId)) onSelect("");
        selection.clear();
        onRefresh();
      }}
    />
  );
  const inspectorOpen = Boolean(selected);
  const titleFor = useCallback(
    (id: string) =>
      scoped.find((item) => item.id === id)?.name ??
      items.find((item) => item.id === id)?.name ??
      id,
    [items, scoped],
  );
  const catalogImport = useCatalogFileImport((created) => {
    const first = created[0];
    if (first) {
      setOverlay({
        id: first.id,
        name: first.name,
        isAssigned: false,
      });
    }
    window.setTimeout(() => onRefresh(), 0);
  }, platform === "macos" ? "macos" : "windows");
  const importButton = (
    <button type="button" className="axis-btn" onClick={() => void catalogImport.openPicker()}>
      Import
    </button>
  );
  return (
    <>
    <WorkspaceSplit
      inspectorPrimary={inspectorOpen}
      master={
        <ObjectListMenuHost
          onDuplicated={(created) => {
            setOverlay({ id: created.id, name: created.title, isAssigned: false });
            onSelect(created.id);
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
            if (selectedId === target.id) onSelect("");
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
            <LoadedInventoryBanner truncated={truncated} />
            <CompactObjectList
              title="Policies"
              description="Loaded catalog policies. Select a row to edit settings on this policy."
              objectKind="configurationPolicy"
              items={filtered.map((item) => ({
                id: item.id,
                title: item.name,
                meta: `${item.platforms ?? "—"} · ${item.settingCount ?? 0} settings`,
              }))}
              selectedId={selected.id}
              onSelect={onSelect}
              onRefresh={onRefresh}
              loading={loading}
              error={error}
              actions={importButton}
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
              description="Select a catalog row to edit its settings here; checkboxes bulk-edit assignments."
              onRefresh={onRefresh}
              refreshing={loading}
              actions={
                <div className="device-actions">
                  {importButton}
                  <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
              }
            />
            {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
            <LoadedInventoryBanner truncated={truncated} />
            <div className="overview-grid-6">
              <SignalCard label="Catalog policies" value={loading ? "…" : scoped.length} />
              <SignalCard label="Assigned" value={assigned} tone="good" />
              <SignalCard label="Unassigned" value={scoped.length - assigned} tone="warn" />
            </div>
            <BulkAssignBar
              count={checkedPolicies.length}
              onEdit={selection.openBulkEditor}
              onClear={selection.clear}
              extra={bulkDelete}
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
                    <SortableTh column="name" label="Name" sort={sort} onSort={toggleSort} />
                    <SortableTh column="platform" label="Platform" sort={sort} onSort={toggleSort} />
                    <SortableTh column="settings" label="Settings" sort={sort} onSort={toggleSort} />
                    <SortableTh column="assigned" label="Assigned" sort={sort} onSort={toggleSort} />
                    <SortableTh column="modified" label="Last modified" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className={`row-link${selectedId === item.id ? " selected" : ""}`}
                      onClick={() => onSelect(item.id)}
                      {...listTargetProps(item.id, item.name, "configurationPolicy")}
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
        )}
        </ObjectListMenuHost>
      }
      inspector={
        <InspectorWithDocumentTabs
          selectedId={selected?.id ?? null}
          titleFor={titleFor}
          onSelect={onSelect}
          onClear={() => onSelect("")}
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
    {catalogImport.dialog}
    </>
  );
}

function EndpointSecurityBlade({
  blade,
  family,
  items,
  loading,
  error,
  truncated,
  selectedId,
  onSelect,
  onRefresh,
}: {
  blade: string;
  family: string | undefined;
  items: CatalogPolicySummary[];
  loading: boolean;
  error: string | null;
  truncated?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <NamedPolicyList
        eyebrow="Endpoint Security"
        title={blade.replace(/-/g, " ")}
        description={
          family
            ? "Template-backed policies. Create chooses a Graph profile for this blade (for example Attack surface reduction rules, Device control, or Exploit protection), then edits settings from that template."
            : "Endpoint security policies"
        }
        items={items}
        loading={loading}
        error={error}
        truncated={truncated}
        selectedId={selectedId}
        onSelect={onSelect}
        onRefresh={onRefresh}
        objectKind="configurationPolicy"
        templateFamily={family}
        onCreate={family ? () => setCreating(true) : undefined}
      />
      {creating && family ? (
        <CreateEndpointSecurityPolicyDialog
          family={family}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            onSelect(id);
            onRefresh();
          }}
        />
      ) : null}
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
  createFamily,
  templateFamily,
  onCreate,
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
  incomplete?: string;
  objectKind: string;
  createFamily?: "windows" | "macos" | "ios" | "android";
  /** Endpoint Security family: load Graph templates and show a Profile column. */
  templateFamily?: string;
  /** When provided, show a primary "Create" action (template-backed lists). */
  onCreate?: () => void;
}) {
  const { query, setQuery, assignedFilter, setAssignedFilter, platformFilter, setPlatformFilter } =
    useListSearchState();
  const { sort, toggle: toggleSort } = useColumnSort<CatalogPolicySortKey>("name");
  const [overlay, setOverlay] = useState<CatalogPolicySummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<ConfigurationPolicyTemplateSummary[] | null>(null);
  const showProfile = Boolean(templateFamily);

  useEffect(() => {
    if (!templateFamily) {
      setTemplates(null);
      return;
    }
    let cancelled = false;
    setTemplates(null);
    void listConfigurationPolicyTemplates(templateFamily)
      .then((response) => {
        if (!cancelled) setTemplates(response.error ? [] : response.templates);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [templateFamily]);

  const profileName = useCallback(
    (item: CatalogPolicySummary) => catalogPolicyProfileName(item, templates),
    [templates],
  );
  const canCreate = objectKind === "compliancePolicy";
  const createButton = canCreate ? (
    <button type="button" className="axis-btn axis-btn-primary" onClick={() => setCreating(true)}>
      New
    </button>
  ) : onCreate ? (
    <button type="button" className="axis-btn axis-btn-primary" onClick={onCreate}>
      Create
    </button>
  ) : null;
  const listed = useMemo(() => withTransientItem(items, overlay), [items, overlay]);
  const selected = listed.find((item) => item.id === selectedId);
  const platformOptions = useMemo(
    () => platformFilterOptionsFromList(listed.map((item) => item.platforms)),
    [listed],
  );
  const filtered = useMemo(() => {
    const rows = listed.filter((item) =>
      matchesCatalogPolicyFilters(
        item,
        query,
        assignedFilter,
        platformFilter,
        showProfile ? profileName(item) : undefined,
      ),
    );
    return sortRows(rows, sort.dir, (a, b) => compareCatalogPolicy(a, b, sort.key, profileName));
  }, [assignedFilter, listed, platformFilter, profileName, query, showProfile, sort]);
  const filteredIds = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const selection = useCheckedIds(filteredIds);
  const checkedPolicies = filtered.filter((item) => selection.checkedIds.has(item.id));
  const bulkPolicies = filtered.filter((item) => selection.bulkTargetIds.includes(item.id));
  const showBulk = selection.bulkEditorOpen && bulkPolicies.length > 0;
  const inspectorOpen = Boolean(selected);
  const bulkDelete = (
    <BulkListActions
      targets={checkedPolicies.map((item) => ({
        id: item.id,
        title: item.name,
        kind: objectKind,
      }))}
      onDeleted={(deleted) => {
        if (deleted.some((target) => target.id === overlay?.id)) setOverlay(null);
        if (deleted.some((target) => target.id === selectedId)) onSelect("");
        selection.clear();
        onRefresh();
      }}
    />
  );
  const titleFor = useCallback(
    (id: string) => listed.find((item) => item.id === id)?.name ?? id,
    [listed],
  );
  return (
    <>
    <WorkspaceSplit
      inspectorPrimary={inspectorOpen}
      master={
        <ObjectListMenuHost
          onDuplicated={(created) => {
            setOverlay({ id: created.id, name: created.title, isAssigned: false });
            onSelect(created.id);
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
            if (selectedId === target.id) onSelect("");
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
            <LoadedInventoryBanner truncated={truncated} />
            <CompactObjectList
              title={title}
              description="Select a policy to inspect it here."
              objectKind={objectKind}
              items={filtered.map((item) => ({
                id: item.id,
                title: item.name,
                meta: showProfile
                  ? `${profileName(item)} · ${item.platforms ?? eyebrow} · ${formatRelative(item.lastModifiedDateTime)}`
                  : `${item.platforms ?? eyebrow} · ${formatRelative(item.lastModifiedDateTime)}`,
              }))}
              selectedId={selected.id}
              onSelect={onSelect}
              onRefresh={onRefresh}
              loading={loading}
              error={error}
              actions={createButton}
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
              searchPlaceholder={showProfile ? "Name, profile, platform, assigned…" : "Name, platform, assigned…"}
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
              onRefresh={onRefresh}
              refreshing={loading}
              actions={
                <>
                  {createButton}
                  <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                </>
              }
            />
            {incomplete ? <IncompleteBanner>{incomplete}</IncompleteBanner> : null}
            <LoadedInventoryBanner truncated={truncated} />
            {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
            <BulkAssignBar
              count={checkedPolicies.length}
              onEdit={selection.openBulkEditor}
              onClear={selection.clear}
              extra={bulkDelete}
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
              placeholder={showProfile ? "Name, profile, platform, assigned…" : "Name, platform, assigned…"}
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
                    <SortableTh column="name" label="Name" sort={sort} onSort={toggleSort} />
                    {showProfile ? (
                      <SortableTh column="profile" label="Profile" sort={sort} onSort={toggleSort} />
                    ) : null}
                    <SortableTh column="platform" label="Platform" sort={sort} onSort={toggleSort} />
                    <SortableTh column="settings" label="Settings" sort={sort} onSort={toggleSort} />
                    <SortableTh column="assigned" label="Assigned" sort={sort} onSort={toggleSort} />
                    <SortableTh column="modified" label="Last modified" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className={`row-link${selectedId === item.id ? " selected" : ""}`}
                      onClick={() => onSelect(item.id)}
                      {...listTargetProps(item.id, item.name, objectKind)}
                    >
                      <td className="axis-table-check">
                        <SelectCheckbox
                          checked={selection.checkedIds.has(item.id)}
                          label={`Select ${item.name}`}
                          onChange={() => selection.toggle(item.id)}
                        />
                      </td>
                      <td>{item.name}</td>
                      {showProfile ? <td className="muted">{profileName(item)}</td> : null}
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
        )}
        </ObjectListMenuHost>
      }
      inspector={
        <InspectorWithDocumentTabs
          selectedId={selected?.id ?? null}
          titleFor={titleFor}
          onSelect={onSelect}
          onClear={() => onSelect("")}
          empty={
            <InspectorEmpty label="Select a policy to inspect it in this workspace. Close clears the selection and stays here." />
          }
        >
          {({ closeActive }) =>
            selected ? (
              <GraphObjectInspector
                key={selected.id}
                kind={objectKind}
                id={selected.id}
                fallbackTitle={selected.name}
                incomplete={incomplete}
                onClose={closeActive}
              />
            ) : null
          }
        </InspectorWithDocumentTabs>
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
    {canCreate ? (
      <CreateCompliancePolicyDialog
        open={creating}
        initialFamily={createFamily}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setOverlay({
            id: created.id,
            name: created.name,
            description: created.description,
            platforms: created.platforms,
            isAssigned: false,
            odataType: created.odataType,
          });
          onSelect(created.id);
          onRefresh();
        }}
      />
    ) : null}
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
  const { sort, toggle: toggleSort } = useColumnSort<
    "name" | "type" | "platform" | "publisher" | "version" | "assigned" | "modified"
  >("name");
  const filtered = useMemo(() => {
    const rows = items.filter((item) => matchesAppFilters(item, query, assignedFilter));
    return sortRows(rows, sort.dir, (a, b) => {
      switch (sort.key) {
        case "type":
          return compareText(a.appTypeLabel ?? a.kind, b.appTypeLabel ?? b.kind) || compareText(a.displayName, b.displayName);
        case "platform":
          return compareText(a.platform, b.platform) || compareText(a.displayName, b.displayName);
        case "publisher":
          return compareText(a.publisher, b.publisher) || compareText(a.displayName, b.displayName);
        case "version":
          return compareText(a.displayVersion, b.displayVersion) || compareText(a.displayName, b.displayName);
        case "assigned":
          return compareBool(a.isAssigned, b.isAssigned) || compareText(a.displayName, b.displayName);
        case "modified":
          return compareIso(a.lastModifiedDateTime, b.lastModifiedDateTime) || compareText(a.displayName, b.displayName);
        default:
          return compareText(a.displayName, b.displayName) || compareText(a.id, b.id);
      }
    });
  }, [assignedFilter, items, query, sort]);
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
              extra={
                <BulkListActions
                  targets={checkedApps.map((item) => ({
                    id: item.id,
                    title: item.displayName,
                    kind: "mobileApp",
                  }))}
                />
              }
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
              onRefresh={onRefresh}
              refreshing={loading}
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
              extra={
                <BulkListActions
                  targets={checkedApps.map((item) => ({
                    id: item.id,
                    title: item.displayName,
                    kind: "mobileApp",
                  }))}
                />
              }
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
                    <SortableTh column="name" label="Name" sort={sort} onSort={toggleSort} />
                    <SortableTh column="type" label="Type" sort={sort} onSort={toggleSort} />
                    <SortableTh column="platform" label="Platform" sort={sort} onSort={toggleSort} />
                    <SortableTh column="publisher" label="Publisher" sort={sort} onSort={toggleSort} />
                    <SortableTh column="version" label="Version" sort={sort} onSort={toggleSort} />
                    <SortableTh column="assigned" label="Assigned" sort={sort} onSort={toggleSort} />
                    <SortableTh column="modified" label="Last modified" sort={sort} onSort={toggleSort} />
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
                      <td className="muted">{formatRelative(item.lastModifiedDateTime)}</td>
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
  const scope = scriptWorkbenchScopeFromPath(pathname);
  const scoped = items.filter((item) => matchesScriptWorkbenchScope(item.kind, scope));
  const title =
    scope === "remediation" ? "Remediations" : scope === "compliance" ? "Compliance scripts" : "Scripts";
  const family: ScriptFamily = scope;
  const { query, setQuery, assignedFilter, setAssignedFilter } = useListSearchState();
  const { sort, toggle: toggleSort } = useColumnSort<
    "name" | "kind" | "runAs" | "assignments" | "modified"
  >("name");
  const [kindFilter, setKindFilter] = useState<ScriptKindFilter>("all");
  const [creating, setCreating] = useState(false);
  const [createdOverlay, setCreatedOverlay] = useState<TenantScriptSummary | null>(null);
  const visible = useMemo(() => {
    if (!createdOverlay) return scoped;
    if (scoped.some((item) => item.id === createdOverlay.id)) return scoped;
    return [createdOverlay, ...scoped];
  }, [createdOverlay, scoped]);
  const filtered = useMemo(
    () => {
      const rows = visible.filter((item) => matchesScriptFilters(item, query, assignedFilter, kindFilter));
      return sortRows(rows, sort.dir, (a, b) => {
        switch (sort.key) {
          case "kind":
            return compareText(tenantScriptKindLabel(a.kind), tenantScriptKindLabel(b.kind)) || compareText(a.displayName, b.displayName);
          case "runAs":
            return compareText(a.runAsAccount, b.runAsAccount) || compareText(a.displayName, b.displayName);
          case "assignments":
            return compareNumber(a.assignmentCount, b.assignmentCount) || compareText(a.displayName, b.displayName);
          case "modified":
            return compareIso(a.lastModifiedDateTime, b.lastModifiedDateTime) || compareText(a.displayName, b.displayName);
          default:
            return compareText(a.displayName, b.displayName) || compareText(a.id, b.id);
        }
      });
    },
    [visible, query, assignedFilter, kindFilter, sort],
  );
  const selected =
    visible.find((item) => item.id === selectedId) ??
    items.find((item) => item.id === selectedId) ??
    (createdOverlay?.id === selectedId ? createdOverlay : null);
  useEffect(() => {
    setKindFilter("all");
  }, [scope]);
  useEffect(() => {
    if (!selectedId || loading) return;
    if (items.some((item) => item.id === selectedId) || createdOverlay?.id === selectedId) return;
    onClose();
  }, [createdOverlay, items, loading, onClose, selectedId]);
  const titleFor = useCallback(
    (id: string) =>
      visible.find((item) => item.id === id)?.displayName ??
      items.find((item) => item.id === id)?.displayName ??
      id,
    [items, visible],
  );
  const { tabs, close, reorder } = useDocumentTabs(
    selectedId,
    titleFor,
    `axis:script-document-tabs:${scope}`,
  );
  const filteredIds = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const selection = useCheckedIds(filteredIds);
  const checkedScripts = filtered.filter((item) => selection.checkedIds.has(item.id));
  const bulkScripts = filtered.filter((item) => selection.bulkTargetIds.includes(item.id));
  const bulkAssignKind = homogeneousBulkAssignKind(bulkScripts);
  const bulkKindConflict =
    scope === "platform" &&
    checkedScripts.length > 0 &&
    new Set(checkedScripts.map((item) => item.kind)).size > 1;
  const showBulk = selection.bulkEditorOpen && bulkScripts.length > 0 && bulkAssignKind != null;
  const bulkPolicies: CatalogPolicySummary[] = bulkScripts.map((item) => ({
    id: item.id,
    name: item.displayName,
  }));
  const bulkBar = (
    <BulkAssignBar
      count={checkedScripts.length}
      onEdit={selection.openBulkEditor}
      onClear={selection.clear}
      extra={
        <BulkListActions
          targets={checkedScripts.map((item) => ({
            id: item.id,
            title: item.displayName,
            kind: inspectorKindForTenantScript(item.kind),
          }))}
          onDeleted={(deleted) => {
            if (deleted.some((target) => target.id === createdOverlay?.id)) {
              setCreatedOverlay(null);
            }
            if (deleted.some((target) => target.id === selectedId)) onClose();
            selection.clear();
            onRefresh();
          }}
        />
      }
      editDisabled={bulkKindConflict}
      editHint={
        bulkKindConflict
          ? "Select scripts of the same kind (PowerShell or shell) to bulk-edit assignments."
          : undefined
      }
    />
  );
  const createButton = (
    <button type="button" className="axis-btn axis-btn-primary" onClick={() => setCreating(true)}>
      New
    </button>
  );
  const scriptImport = useScriptFileImport(family, (created) => {
    const first = created[0];
    if (first) setCreatedOverlay(first);
    window.setTimeout(() => onRefresh(), 0);
  });
  const importButton = (
    <button type="button" className="axis-btn" onClick={() => void scriptImport.openPicker()}>
      Import
    </button>
  );
  const searchPlaceholder =
    scope === "remediation"
      ? "Name, run as, assigned…"
      : scope === "compliance"
        ? "Name, run as, assigned…"
        : "Name, kind, run as, assigned…";
  const countLabel = `${filtered.length} of ${visible.length}`;
  const kindSecondaryFilter =
    scope === "platform"
      ? {
          label: "Kind",
          value: kindFilter,
          onChange: (value: string) => setKindFilter(value as ScriptKindFilter),
          options: scriptKindFilterOptions(),
        }
      : undefined;
  return (
    <>
    <WorkspaceSplit
      inspectorPrimary={Boolean(selected)}
      master={
        <ObjectListMenuHost
          onDuplicated={(created, source) => {
            setCreatedOverlay({
              id: created.id,
              kind: source.kind.startsWith("script:") ? source.kind.slice("script:".length) : source.kind,
              displayName: created.title,
              assignmentCount: 0,
            });
            onSelect(created.id);
            onRefresh();
          }}
          onMetadataUpdated={(updated, source) => {
            setCreatedOverlay({
              id: updated.id,
              kind: source.kind.startsWith("script:")
                ? source.kind.slice("script:".length)
                : source.kind,
              displayName: updated.title,
              description: updated.description,
              assignmentCount: selected?.assignmentCount,
            });
            onRefresh();
          }}
          onDeleted={(target) => {
            if (createdOverlay?.id === target.id) setCreatedOverlay(null);
            if (selectedId === target.id) onClose();
            onRefresh();
          }}
        >
        {selected ? (
          <div className="stack">
            {bulkBar}
            <CompactObjectList
              title={title}
              description="Select a script to inspect it here."
              items={filtered.map((item) => ({
                id: item.id,
                title: item.displayName,
                kind: inspectorKindForTenantScript(item.kind),
                meta: `${tenantScriptKindLabel(item.kind)} · ${item.runAsAccount ?? "—"}`,
              }))}
              selectedId={selected.id}
              onSelect={onSelect}
              onRefresh={onRefresh}
              loading={loading}
              error={error}
              actions={
                <div className="device-actions">
                  {importButton}
                  {createButton}
                </div>
              }
              checkedIds={selection.checkedIds}
              onToggleChecked={selection.toggle}
              query={query}
              onQueryChange={setQuery}
              assignedFilter={assignedFilter}
              onAssignedFilterChange={setAssignedFilter}
              countLabel={countLabel}
              searchPlaceholder={searchPlaceholder}
              secondaryFilter={kindSecondaryFilter}
              allSelected={selection.allSelected}
              onToggleAll={selection.toggleAll}
              selectAllIndeterminate={checkedScripts.length > 0 && !selection.allSelected}
              selectAllDisabled={filtered.length === 0}
              selectAllLabel={`Select all filtered ${title.toLowerCase()}`}
            />
          </div>
        ) : (
          <div className="stack">
            <PageHeader
              eyebrow="Devices"
              title={title}
              description="Live Graph inventory. Create a script here, then bulk-select rows to update assignments on multiple scripts at once."
              onRefresh={onRefresh}
              refreshing={loading}
              actions={
                <>
                  {importButton}
                  {createButton}
                  <button type="button" className="axis-btn" onClick={onRefresh} disabled={loading}>
                    Refresh
                  </button>
                </>
              }
            />
            {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
            {bulkBar}
            <SearchableTable
              query={query}
              onQueryChange={setQuery}
              assignedFilter={assignedFilter}
              onAssignedFilterChange={setAssignedFilter}
              countLabel={countLabel}
              placeholder={searchPlaceholder}
              secondaryFilter={kindSecondaryFilter}
            >
              <table className="axis-table">
                <thead>
                  <tr>
                    <th className="axis-table-check">
                      <SelectCheckbox
                        checked={selection.allSelected}
                        indeterminate={checkedScripts.length > 0 && !selection.allSelected}
                        disabled={filtered.length === 0}
                        label={`Select all filtered ${title.toLowerCase()}`}
                        onChange={selection.toggleAll}
                      />
                    </th>
                    <SortableTh column="name" label="Name" sort={sort} onSort={toggleSort} />
                    <SortableTh column="kind" label="Kind" sort={sort} onSort={toggleSort} />
                    <SortableTh column="runAs" label="Run as" sort={sort} onSort={toggleSort} />
                    <SortableTh column="assignments" label="Assignments" sort={sort} onSort={toggleSort} />
                    <SortableTh column="modified" label="Last modified" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className={`row-link${selectedId === item.id ? " selected" : ""}`}
                      onClick={() => onSelect(item.id)}
                      {...listTargetProps(
                        item.id,
                        item.displayName,
                        inspectorKindForTenantScript(item.kind),
                      )}
                    >
                      <td className="axis-table-check">
                        <SelectCheckbox
                          checked={selection.checkedIds.has(item.id)}
                          label={`Select ${item.displayName}`}
                          onChange={() => selection.toggle(item.id)}
                        />
                      </td>
                      <td>{item.displayName}</td>
                      <td className="muted">{tenantScriptKindLabel(item.kind)}</td>
                      <td className="muted">{item.runAsAccount ?? "—"}</td>
                      <td className="muted">{item.assignmentCount ?? "—"}</td>
                      <td className="muted">{formatRelative(item.lastModifiedDateTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && filtered.length === 0 ? (
                <p className="muted" style={{ padding: "1rem" }}>
                  No matching {title.toLowerCase()}.
                </p>
              ) : null}
            </SearchableTable>
          </div>
        )}
        </ObjectListMenuHost>
      }
      inspector={
        selected || tabs.length > 0 ? (
          <div className="inspector-with-tabs">
            <DocumentTabs
              tabs={tabs}
              activeId={selected?.id ?? null}
              onSelect={onSelect}
              onClose={(id) => {
                const next = close(id);
                if (next) onSelect(next);
                else onClose();
              }}
              onReorder={reorder}
            />
            {selected ? (
              <InspectorErrorBoundary>
                <GraphObjectInspector
                  key={selected.id}
                  kind={inspectorKindForTenantScript(selected.kind)}
                  id={selected.id}
                  fallbackTitle={selected.displayName}
                  onClose={() => {
                    const next = close(selected.id);
                    if (next) onSelect(next);
                    else onClose();
                  }}
                />
              </InspectorErrorBoundary>
            ) : (
              <InspectorEmpty label="Select a script or choose one of the persistent tabs above." />
            )}
          </div>
        ) : (
          <InspectorEmpty label="Select a script to inspect it in this workspace. Close clears the selection and stays here." />
        )
      }
    />
    <AssignmentsDialog
      open={showBulk}
      kind={bulkAssignKind ?? "script:remediation"}
      policies={bulkPolicies}
      onClose={selection.closeBulkEditor}
      onSaved={() => {
        onRefresh();
        selection.clear();
      }}
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
    {scriptImport.dialog}
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
  const [profileOverlay, setProfileOverlay] = useState<AutopilotProfile | null>(null);
  const profileItems = useMemo(
    () => withTransientItem(profiles.items, profileOverlay),
    [profiles.items, profileOverlay],
  );
  const { sort: deviceSort, toggle: toggleDeviceSort } = useColumnSort<"serial" | "tag" | "state">("serial");
  const { sort: profileSort, toggle: toggleProfileSort } = useColumnSort<"name" | "modified">("name");
  const sortedDevices = useMemo(
    () =>
      sortRows(devices.items, deviceSort.dir, (a, b) => {
        const aName = a.serialNumber ?? a.displayName ?? a.id;
        const bName = b.serialNumber ?? b.displayName ?? b.id;
        if (deviceSort.key === "tag") return compareText(a.groupTag, b.groupTag) || compareText(aName, bName);
        if (deviceSort.key === "state") return compareText(a.enrollmentState, b.enrollmentState) || compareText(aName, bName);
        return compareText(aName, bName) || compareText(a.id, b.id);
      }),
    [deviceSort, devices.items],
  );
  const sortedProfiles = useMemo(
    () =>
      sortRows(profileItems, profileSort.dir, (a, b) => {
        if (profileSort.key === "modified") {
          return compareIso(a.lastModifiedDateTime, b.lastModifiedDateTime) || compareText(a.displayName, b.displayName);
        }
        return compareText(a.displayName, b.displayName) || compareText(a.id, b.id);
      }),
    [profileItems, profileSort],
  );
  const device = devices.items.find((item) => item.id === selectedDevice);
  const profile = profileItems.find((item) => item.id === selectedProfile);
  const selected = Boolean(device || profile);
  const lists = (
    <>
      <CompactObjectList
        title="Devices"
        items={sortedDevices.map((item) => ({
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
        objectKind="autopilotProfile"
        items={sortedProfiles.map((item) => ({
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
        <ObjectListMenuHost
          onDuplicated={(created) => {
            setProfileOverlay({ id: created.id, displayName: created.title });
            onSelectProfile(created.id);
            void profiles.reload();
          }}
          onMetadataUpdated={(updated) => {
            setProfileOverlay({
              id: updated.id,
              displayName: updated.title,
              description: updated.description,
            });
            void profiles.reload();
          }}
        >
        {selected ? (
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
                      <SortableTh column="serial" label="Serial" sort={deviceSort} onSort={toggleDeviceSort} />
                      <SortableTh column="tag" label="Tag" sort={deviceSort} onSort={toggleDeviceSort} />
                      <SortableTh column="state" label="State" sort={deviceSort} onSort={toggleDeviceSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedDevices.map((item) => (
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
                      <SortableTh column="name" label="Name" sort={profileSort} onSort={toggleProfileSort} />
                      <SortableTh column="modified" label="Modified" sort={profileSort} onSort={toggleProfileSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProfiles.map((item) => (
                      <tr
                        key={item.id}
                        className="row-link"
                        onClick={() => onSelectProfile(item.id)}
                        {...listTargetProps(item.id, item.displayName, "autopilotProfile")}
                      >
                        <td>{item.displayName}</td>
                        <td className="muted">{formatRelative(item.lastModifiedDateTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          </div>
        )}
        </ObjectListMenuHost>
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

function GitHubLeastPrivilegePatHelp() {
  return (
    <div className="muted" style={{ marginTop: "0.45rem", fontSize: "0.75rem" }}>
      <p style={{ margin: "0 0 0.4rem" }}>
        Axis only reads files from this pack. Use a fine-grained token, not a classic PAT with the{" "}
        <code>repo</code> scope.
      </p>
      <ol style={{ margin: "0 0 0.45rem", paddingLeft: "1.15rem" }}>
        <li>Open GitHub’s fine-grained token form.</li>
        <li>Resource owner: the user or organization that owns the pack.</li>
        <li>Repository access: Only select repositories, then this pack.</li>
        <li>
          Under Permissions, open Repository permissions. Set <strong>Contents</strong> to{" "}
          <strong>Read</strong> (the dropdown is No access, Read, or Read and write — there is no
          “Read-only” permission name). Leave every other permission at No access. Metadata is
          granted automatically.
        </li>
        <li>Generate the token and paste it above. It stays on this machine only.</li>
      </ol>
      <p style={{ margin: "0 0 0.45rem" }}>
        Organization repos may require an owner to approve the token.
      </p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="axis-link"
          onClick={() => void openExternalUrl(GITHUB_FINE_GRAINED_TOKEN_URL)}
        >
          Create a fine-grained token
        </button>
        <button
          type="button"
          className="axis-link"
          onClick={() => void openExternalUrl(GITHUB_FINE_GRAINED_TOKEN_DOCS_URL)}
        >
          GitHub documentation
        </button>
      </div>
    </div>
  );
}

function BaselinesWorkbench({
  surface,
  selectedId,
  onSelect,
  signedIn,
  organizationName,
}: {
  surface: "baselines" | "templates";
  selectedId: string | null;
  onSelect: (id: string) => void;
  signedIn: boolean;
  organizationName: string | null;
}) {
  const templates = surface === "templates";
  const [sourceEntries, setSourceEntries] = useState<BaselineReferenceSourceInput[]>([
    DEFAULT_E8_SOURCE,
  ]);
  const [sourcesHydrated, setSourcesHydrated] = useState(false);
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
  const [editingSourceKey, setEditingSourceKey] = useState<string | null>(null);
  const [deletingSourceKey, setDeletingSourceKey] = useState<string | null>(null);
  const [referenceLoads, setReferenceLoads] = useState<
    Array<{
      source: {
        id: string;
        name: string;
        kind?: string;
        owner: string;
        repo: string;
        gitRef: string;
        path: string;
        localPath?: string;
        directoryUrl: string;
        hasToken?: boolean;
      };
      references: E8BaselineReference[];
      warnings: string[];
      error: string | null;
    }>
  >([]);
  const [e8Loading, setE8Loading] = useState(false);
  const [refreshingSourceIds, setRefreshingSourceIds] = useState<Set<string>>(new Set());
  const [referencesError, setReferencesError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportTargets, setBulkImportTargets] = useState<
    Array<E8BaselineReference & { sourceId: string; sourceName: string }>
  >([]);
  const [bulkMergeOpen, setBulkMergeOpen] = useState(false);
  const [bulkMergeTargets, setBulkMergeTargets] = useState<
    Array<E8BaselineReference & { sourceId: string; sourceName: string }>
  >([]);
  /** null = use defaults (single pack expanded, or pack with selection; else collapsed). */
  const [expandedPackIds, setExpandedPackIds] = useState<Set<string> | null>(null);
  const [exportResolved, setExportResolved] = useState<PolicyExportResolved | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<PackExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<PackExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    void listen<PackExportProgress>("axis-pack-export-progress", (event) => {
      if (!cancelled) setExportProgress(event.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

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
    const ready = sourceEntries
      .map(sanitizeSource)
      .filter(isSourceReady)
      .filter((entry) => (templates ? !isBuiltinSource(entry) : isBuiltinSource(entry)));
    if (ready.length === 0) {
      setReferenceLoads([]);
      setReferencesError(null);
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
  }, [sourceEntries, templates]);

  const refreshSource = useCallback(
    async (entry: BaselineReferenceSourceInput) => {
      const normalized = sanitizeSource(entry);
      const key = normalized.id;
      if (!key || !isSourceReady(normalized)) return;
      setRefreshingSourceIds((current) => new Set(current).add(key));
      try {
        const response = await fetchBaselineReferenceSources([normalized]);
        const load = response.sources[0];
        setReferenceLoads((current) => {
          const next = current.filter((row) => row.source.id !== key);
          return load ? [...next, load] : next;
        });
      } catch (error) {
        setReferencesError(error instanceof Error ? error.message : String(error));
      } finally {
        setRefreshingSourceIds((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (!sourcesHydrated) return;
    const timer = window.setTimeout(() => void loadReferences(), 500);
    return () => window.clearTimeout(timer);
  }, [loadReferences, sourcesHydrated]);

  const sameLocalPath = (left: string, right: string) =>
    left.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() ===
    right.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

  const sourceKeyFor = useCallback(
    (entry: BaselineReferenceSourceInput, index: number) => entry.id ?? `source-${index}`,
    [],
  );

  const openSourceEditor = useCallback((key: string) => {
    setEditingSourceKey(key);
    setSourceEditorOpen(true);
  }, []);

  const removeSource = useCallback(
    (key: string) => {
      setSourceEntries((current) =>
        current.filter((row, rowIndex) => (row.id ?? `source-${rowIndex}`) !== key),
      );
      if (editingSourceKey === key) setEditingSourceKey(null);
    },
    [editingSourceKey],
  );

  const addLocalFolderSource = useCallback(async () => {
    const folder = await pickLocalPackFolder("Select a local template folder");
    if (!folder) return;
    const entry = {
      ...newLocalSource(),
      localPath: folder,
      kind: "local",
      storeKind: "axisTemplated",
    } as BaselineReferenceSourceInput;
    setSourceEntries((current) => {
      if (current.some((row) => isLocalSource(row) && sameLocalPath(row.localPath ?? "", folder))) {
        return current;
      }
      return [...current, entry];
    });
    if (entry.id) openSourceEditor(entry.id);
  }, [openSourceEditor]);

  const addGitHubSource = useCallback(() => {
    const entry = newCustomSource();
    setSourceEntries((current) => [...current, entry]);
    if (entry.id) openSourceEditor(entry.id);
  }, [openSourceEditor]);

  const runTenantExport = useCallback(async () => {
    if (!signedIn || exportBusy) return;
    setExportBusy(true);
    setExportError(null);
    setExportResult(null);
    setExportProgress({ phase: "listing", current: 0, total: 0, message: "Choose where to save…" });
    try {
      const packName = organizationName
        ? `${organizationName} Intune export`
        : "Tenant Intune export";
      const result = await exportTenantPack({ packName });
      if (!result) {
        setExportProgress(null);
        return;
      }
      setExportResult(result);
      const exportEntry = {
        ...newLocalSource(),
        name: packName,
        localPath: result.root,
        kind: "local",
        storeKind: "axisTemplated",
      } as BaselineReferenceSourceInput;
      setSourceEntries((current) => {
        if (current.some((row) => isLocalSource(row) && sameLocalPath(row.localPath ?? "", result.root))) {
          return current;
        }
        return [...current, exportEntry];
      });
      if (exportEntry.id) openSourceEditor(exportEntry.id);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExportBusy(false);
    }
  }, [exportBusy, organizationName, signedIn]);

  const packs = useMemo(() => {
    const loadsById = new Map(referenceLoads.map((load) => [load.source.id, load]));
    return sourceEntries.filter(isSourceReady).filter((entry) => (templates ? !isBuiltinSource(entry) : isBuiltinSource(entry))).map((entry) => {
      const normalizedEntry = sanitizeSource(entry);
      const load = loadsById.get(normalizedEntry.id ?? "");
      const source = load?.source;
      const title = packTitle({
        id: entry.id,
        name: source?.name ?? entry.name,
        owner: source?.owner ?? entry.owner,
        repo: source?.repo ?? entry.repo,
      });
      return {
        id: source?.id ?? normalizedEntry.id ?? title,
        title,
        kind: templateKicker(entry),
        owner: source?.owner ?? entry.owner,
        repo: source?.repo ?? entry.repo,
        local: isLocalSource(entry) || source?.kind === "local",
        directoryUrl: source?.directoryUrl ?? sourceOpenUrl(entry),
        error: load?.error ?? null,
        warning: load?.warnings[0] ?? null,
        entry,
        references: (load?.references ?? []).map((reference) => ({
          ...reference,
          sourceId: source?.id ?? normalizedEntry.id ?? "",
          sourceName: title,
        })),
      };
    });
  }, [referenceLoads, sourceEntries, templates]);

  const allReferences = useMemo(
    () => packs.flatMap((pack) => pack.references),
    [packs],
  );

  const catalogReferences = useMemo(
    () => allReferences.filter((reference) => isCatalogPackArtifact(reference.artifactKind)),
    [allReferences],
  );
  const catalogSelectionIds = useMemo(
    () => catalogReferences.map((reference) => `ref:${reference.sourceId}:${reference.id}`),
    [catalogReferences],
  );
  const selection = useCheckedIds(catalogSelectionIds);
  const checkedCatalog = catalogReferences.filter((reference) =>
    selection.checkedIds.has(`ref:${reference.sourceId}:${reference.id}`),
  );

  const selectedReference = selectedId?.startsWith("ref:")
    ? allReferences.find(
        (reference) => `ref:${reference.sourceId}:${reference.id}` === selectedId,
      ) ?? null
    : null;
  const selectedIsPolicyExport = selectedReference
    ? isPolicySettingsExportArtifact(selectedReference.artifactKind)
    : false;

  const packExpanded = useCallback(
    (packId: string) => {
      if (expandedPackIds != null) return expandedPackIds.has(packId);
      if (packs.length <= 1) return true;
      if (selectedReference?.sourceId === packId) return true;
      return false;
    },
    [expandedPackIds, packs.length, selectedReference?.sourceId],
  );

  const togglePackExpanded = useCallback((packId: string) => {
    setExpandedPackIds((current) => {
      const base =
        current ??
        new Set(
          packs.length <= 1
            ? packs.map((pack) => pack.id)
            : selectedReference?.sourceId
              ? [selectedReference.sourceId]
              : [],
        );
      const next = new Set(base);
      if (next.has(packId)) next.delete(packId);
      else next.add(packId);
      return next;
    });
  }, [packs, selectedReference?.sourceId]);

  useEffect(() => {
    if (!selectedReference) return;
    const packId = selectedReference.sourceId;
    setExpandedPackIds((current) => {
      if (current == null) return current;
      if (current.has(packId)) return current;
      const next = new Set(current);
      next.add(packId);
      return next;
    });
  }, [selectedReference]);

  useEffect(() => {
    setExportResolved(null);
    setImportOpen(false);
  }, [selectedId]);

  const onExportResolved = useCallback((info: PolicyExportResolved | null) => {
    setExportResolved(info);
  }, []);

  const baselineModifiedMeta = (reference: E8BaselineReference) => {
    const repoModified = reference.repositoryLastModifiedDateTime;
    const policyExported = reference.policyExportedDateTime;
    const label = repoModified ? "repo" : policyExported ? "exported" : "unknown";
    return `${reference.version ?? "version n/a"} · ${label}: ${formatRelative(repoModified ?? policyExported)}`;
  };

  return (
    <>
    <WorkspaceSplit
      inspectorPrimary={Boolean(selectedReference)}
      master={
        selectedReference ? (
          <CompactObjectList
            title={templates ? "Template items" : "Baselines"}
            description={
              templates
                ? "Select an item from a template store to inspect it here."
                : "Select an ASD baseline to inspect it here."
            }
            items={allReferences.map((reference) => ({
              id: `ref:${reference.sourceId}:${reference.id}`,
              title: reference.name,
              meta: baselineModifiedMeta(reference),
              group: `${reference.sourceName} · ${packArtifactKindLabel(reference.artifactKind)}`,
            }))}
            selectedId={selectedId ?? ""}
            onSelect={onSelect}
          />
        ) : (
          <div className="stack">
            <PageHeader
              eyebrow={templates ? "Templates" : "Baselines"}
              title={templates ? "Templates" : "Baselines"}
              description={
                templates
                  ? "User template stores from a local folder or GitHub. Axis Templated reads axis-pack.json at the store root. Flat JSON lists a folder of policy files. Open a device to grade an ASD baseline or an expanded policy set."
                  : "Built-in ASD Essential Eight hard baselines. Used to compare a device and to import one policy. User GitHub and local stores are listed under Templates."
              }
              actions={
                <div className="baseline-actions">
                  {templates ? (
                    <button
                      type="button"
                      className="axis-btn axis-btn-primary"
                      onClick={() => void runTenantExport()}
                      disabled={!signedIn || exportBusy}
                      title={signedIn ? undefined : "Sign in to export this tenant"}
                    >
                      {exportBusy ? "Exporting…" : "Export tenant pack"}
                    </button>
                  ) : (
                    <button type="button" className="axis-btn" onClick={() => navigate("/intune/templates")}>
                      Templates
                    </button>
                  )}
                  {templates ? (
                    <>
                      <button
                        type="button"
                        className="axis-btn"
                        onClick={addGitHubSource}
                      >
                        Add GitHub pack
                      </button>
                      <button
                        type="button"
                        className="axis-btn"
                        onClick={() => void addLocalFolderSource()}
                      >
                        Add local folder
                      </button>
                      <button
                        type="button"
                        className={`axis-btn${sourceEditorOpen ? " is-active" : ""}`}
                        aria-pressed={sourceEditorOpen}
                        onClick={() => setSourceEditorOpen((open) => !open)}
                      >
                        {sourceEditorOpen ? "Hide sources" : "Manage sources"}
                      </button>
                    </>
                  ) : null}
                  <button type="button" className="axis-btn axis-btn-ghost" onClick={() => void loadReferences()} disabled={e8Loading}>
                    {e8Loading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
              }
            />
            <div className="workspace-scroll">
            {templates ? (
            <IncompleteBanner>
              Template stores are an external listing. Import applies to Settings Catalog files under
              each platform’s policies/ folder. Tenant export writes the same layout (catalog JSON,
              scripts with an <code>@axis-pack</code> header, compliance, Endpoint Security, Group
              Policy, Windows Update, Autopilot) plus policy-set JSON that selects those files.
              iOS, Linux, apps, and classic device configuration profiles are not exported.
            </IncompleteBanner>
            ) : (
            <IncompleteBanner>
              ASD baselines stay on this page. One-policy import creates a new Settings Catalog policy.
              Template stores, including policy sets, are listed under Templates.
            </IncompleteBanner>
            )}
            {templates && (exportBusy || exportProgress || exportResult || exportError) ? (
              <section className="axis-panel baseline-status">
                <div className="baseline-status-head">
                  <p className="baseline-pack-kicker">Tenant export</p>
                  {exportBusy ? <span className="axis-pill">Running</span> : null}
                  {!exportBusy && exportError ? <span className="axis-pill axis-pill-danger">Failed</span> : null}
                  {!exportBusy && exportResult ? <span className="axis-pill axis-pill-success">Done</span> : null}
                </div>
                {exportBusy && exportProgress ? (
                  <p className="baseline-status-line">
                    {exportProgress.total > 0
                      ? `${exportProgress.current} / ${exportProgress.total} · ${exportProgress.message}`
                      : exportProgress.message}
                  </p>
                ) : null}
                {exportError ? (
                  <p className="baseline-status-line baseline-status-error">{exportError}</p>
                ) : null}
                {exportResult && !exportBusy ? (
                  <div className="muted baseline-status-detail">
                    <p>
                      Wrote {exportResult.filesWritten} files ({exportResult.catalogCount} Settings Catalog)
                      under {exportResult.root}.
                    </p>
                    {exportResult.skipped.length ? (
                      <p>
                        Skipped {exportResult.skipped.length} (unsupported platform):{" "}
                        {exportResult.skipped.slice(0, 8).join(", ")}
                        {exportResult.skipped.length > 8 ? "…" : ""}
                      </p>
                    ) : null}
                    {exportResult.warnings.length ? (
                      <p>
                        {exportResult.warnings.length} warning
                        {exportResult.warnings.length === 1 ? "" : "s"} (Graph gaps or empty objects).
                        First: {exportResult.warnings[0]}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}
            {templates && sourceEditorOpen ? (
              <section className="axis-panel baseline-sources">
                <div className="baseline-sources-head">
                  <p className="baseline-pack-kicker">Template stores</p>
                  <p className="muted baseline-sources-hint">
                    Stores are read-only listings of policy files. Axis Templated reads{" "}
                    <code>axis-pack.json</code> at the store root; Flat JSON lists a folder of policy
                    files.{" "}
                    <button
                      type="button"
                      className="axis-link"
                      onClick={() => void openExternalUrl("https://github.com/jbiskit/axis-pack-template")}
                    >
                      Start from the template repo
                    </button>
                  </p>
                </div>
                <ul className="baseline-source-rows">
                  {sourceEntries.map((entry, index) => {
                    if (isBuiltinSource(entry)) return null;
                    const sourceKey = sourceKeyFor(entry, index);
                    const ready = isSourceReady(entry);
                    return (
                      <li key={sourceKey} className="baseline-source-row">
                        <span className="axis-pill">{templateKicker(entry)}</span>
                        <div className="baseline-source-row-copy">
                          <p className="baseline-source-row-name">{packTitle(entry)}</p>
                          <p className="muted baseline-source-row-meta">
                            {isLocalSource(entry)
                              ? entry.localPath || "No folder set"
                              : entry.url || "No repository set"}
                          </p>
                        </div>
                        <div className="baseline-source-row-actions">
                          <button
                            type="button"
                            className="axis-btn axis-btn-ghost"
                            disabled={!ready}
                            onClick={() => void openExternalUrl(sourceOpenUrl(entry))}
                          >
                            {isLocalSource(entry) ? "Open folder" : "Open repo"}
                          </button>
                          <button
                            type="button"
                            className="axis-btn"
                            onClick={() => openSourceEditor(sourceKey)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="axis-btn axis-btn-ghost baseline-source-remove"
                            onClick={() => setDeletingSourceKey(sourceKey)}
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {sourceEntries.every((entry) => isBuiltinSource(entry)) ? (
                  <p className="muted baseline-source-empty">No template stores yet.</p>
                ) : null}
                <div className="baseline-sources-foot">
                  <button type="button" className="axis-btn" onClick={addGitHubSource}>
                    Add GitHub pack
                  </button>
                  <button type="button" className="axis-btn" onClick={() => void addLocalFolderSource()}>
                    Add local folder
                  </button>
                  <button type="button" className="axis-btn axis-btn-ghost" onClick={() => void loadReferences()} disabled={e8Loading}>
                    Reload stores
                  </button>
                </div>
              </section>
            ) : null}
            {referencesError ? <div className="axis-alert axis-alert-danger">Reference loading failed: {referencesError}</div> : null}
            {templates && !e8Loading && !sourceEntries.some((entry) => !isBuiltinSource(entry)) ? (
              <p className="muted">No template stores yet. Add a GitHub pack or a local folder.</p>
            ) : null}
            {checkedCatalog.length > 0 ? (
              <BulkAssignBar
                count={checkedCatalog.length}
                editLabel="Import to Intune"
                editHint={
                  signedIn
                    ? "Create Settings Catalog policies from the selected exports"
                    : "Sign in to import policies"
                }
                editDisabled={!signedIn}
                onEdit={() => {
                  setBulkImportTargets(checkedCatalog);
                  setBulkImportOpen(true);
                }}
                onClear={selection.clear}
                extra={
                  <button
                    type="button"
                    className="axis-btn"
                    disabled={!signedIn || checkedCatalog.length < 2}
                    title={
                      !signedIn
                        ? "Sign in to merge policies"
                        : checkedCatalog.length < 2
                          ? "Select at least two Settings Catalog policies to combine"
                          : "Merge selected Settings Catalog exports into one policy"
                    }
                    onClick={() => {
                      setBulkMergeTargets(checkedCatalog);
                      setBulkMergeOpen(true);
                    }}
                  >
                    Combine and merge
                  </button>
                }
              />
            ) : null}
            {packs.map((pack) => {
              const expanded = packExpanded(pack.id);
              return (
              <section key={pack.id} className="axis-panel baseline-pack">
                <div className={`baseline-pack-head${expanded ? "" : " is-collapsed"}`}>
                  <button
                    type="button"
                    className="baseline-pack-toggle"
                    aria-expanded={expanded}
                    onClick={() => togglePackExpanded(pack.id)}
                  >
                    <span className={`baseline-pack-chevron${expanded ? " is-open" : ""}`} aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                        <path d="M6 3.5 10.5 8 6 12.5" />
                      </svg>
                    </span>
                    <div className="baseline-pack-toggle-copy">
                      <p className="baseline-pack-kicker">{pack.kind}</p>
                      <h2>{pack.title}</h2>
                      <p className="baseline-pack-meta">
                        {pack.local
                          ? pack.directoryUrl || "This machine"
                          : pack.owner && pack.repo
                            ? `${pack.owner}/${pack.repo}`
                            : "Repository"}
                      </p>
                    </div>
                    <span className="baseline-pack-count">
                      {pack.references.length} {pack.references.length === 1 ? "item" : "items"}
                    </span>
                  </button>
                  <div className="baseline-pack-actions">
                    <button
                      type="button"
                      className="axis-btn axis-btn-ghost axis-btn-icon baseline-pack-refresh"
                      title="Reload this store"
                      aria-label={`Reload ${pack.title}`}
                      disabled={refreshingSourceIds.has(pack.id)}
                      onClick={() => void refreshSource(pack.entry)}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className={refreshingSourceIds.has(pack.id) ? "baseline-spin" : undefined}
                      >
                        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                        <path d="M21 3v6h-6" />
                      </svg>
                    </button>
                    <button type="button" className="axis-btn axis-btn-ghost baseline-pack-open" onClick={() => void openExternalUrl(pack.directoryUrl)}>
                      {pack.local ? "Open folder" : "Open repository"}
                    </button>
                    {templates ? (
                      <button
                        type="button"
                        className="axis-btn axis-btn-ghost axis-btn-icon baseline-pack-delete"
                        title="Remove this store"
                        aria-label={`Remove ${pack.title}`}
                        onClick={() => setDeletingSourceKey(pack.id)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                </div>
                {expanded ? (
                <>
                {pack.error ? (
                  <div className="axis-alert axis-alert-danger baseline-pack-alert">
                    {pack.error}
                  </div>
                ) : null}
                {pack.warning ? (
                  <div className="axis-alert axis-alert-warning baseline-pack-alert">
                    {pack.warning}
                  </div>
                ) : null}
                {groupPackArtifacts(pack.references).map((section) => {
                  const sectionCatalog = isCatalogPackArtifact(section.kind);
                  const sectionIds = sectionCatalog
                    ? section.items.map((reference) => `ref:${reference.sourceId}:${reference.id}`)
                    : [];
                  const sectionSelected = sectionIds.filter((id) => selection.checkedIds.has(id)).length;
                  const sectionAllSelected =
                    sectionIds.length > 0 && sectionSelected === sectionIds.length;
                  return (
                  <div key={section.kind} className="baseline-pack-section">
                    <p className="baseline-pack-kicker baseline-pack-section-label">
                      {section.label}
                    </p>
                    <table className="axis-table">
                      <thead>
                        <tr>
                          {sectionCatalog ? (
                            <th className="axis-table-check">
                              <SelectCheckbox
                                checked={sectionAllSelected}
                                indeterminate={sectionSelected > 0 && !sectionAllSelected}
                                label={`Select all ${section.label}`}
                                onChange={() => selection.setMany(sectionIds, !sectionAllSelected)}
                              />
                            </th>
                          ) : null}
                          <th>Name</th>
                          <th>Version</th>
                          <th>Modified</th>
                        </tr>
                      </thead>
                      <tbody>
                        {section.items.map((reference) => {
                          const rowId = `ref:${reference.sourceId}:${reference.id}`;
                          return (
                          <tr
                            key={`${reference.sourceId}:${reference.id}`}
                            className="row-link"
                            onClick={() => onSelect(rowId)}
                          >
                            {sectionCatalog ? (
                              <td className="axis-table-check">
                                <SelectCheckbox
                                  checked={selection.checkedIds.has(rowId)}
                                  label={`Select ${reference.name}`}
                                  onChange={() => selection.toggle(rowId)}
                                />
                              </td>
                            ) : null}
                            <td>{reference.name}</td>
                            <td className="muted">{reference.version ?? "—"}</td>
                            <td className="muted">
                              {reference.repositoryLastModifiedDateTime
                                ? formatRelative(reference.repositoryLastModifiedDateTime)
                                : reference.policyExportedDateTime
                                  ? formatRelative(reference.policyExportedDateTime)
                                  : "—"}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  );
                })}
                {!e8Loading && !pack.error && pack.references.length === 0 ? (
                  <p className="muted baseline-pack-empty">
                    {templates ? "No items were returned from this template store." : "No baselines were returned from ASD Blueprint."}
                  </p>
                ) : null}
                </>
                ) : null}
              </section>
              );
            })}
            </div>
          </div>
        )
      }
      inspector={
        selectedReference ? (
          <div className="stack">
            <PageHeader
              eyebrow={selectedReference.sourceName}
              title={exportResolved?.name ?? selectedReference.name}
              actions={
                <div className="device-actions">
                  {isCatalogPackArtifact(selectedReference.artifactKind) ? (
                    <button
                      type="button"
                      className="axis-btn axis-btn-primary"
                      onClick={() => setImportOpen(true)}
                    >
                      Import to Intune
                    </button>
                  ) : null}
                  <button type="button" className="axis-btn" onClick={() => onSelect("")}>
                    Close
                  </button>
                </div>
              }
            />
            {selectedIsPolicyExport ? (
              <PolicyExportInspect
                reference={selectedReference}
                sources={sourceEntries}
                storeLabel={templates ? "Store" : "Baseline"}
                formatRelative={formatRelative}
                openExternalUrl={openExternalUrl}
                onResolved={onExportResolved}
                banner={
                  isCatalogPackArtifact(selectedReference.artifactKind) ? (
                    <IncompleteBanner>
                      Import creates a new Settings Catalog policy. Review its settings and assignments
                      before deployment.
                    </IncompleteBanner>
                  ) : (
                    <IncompleteBanner>
                      {templates
                        ? "This item is listed from a template store. Axis does not import it as a Settings Catalog policy."
                        : "This ASD baseline is listed for compare and one-policy import."}
                    </IncompleteBanner>
                  )
                }
              />
            ) : (
              <>
                <section className="axis-panel baseline-inspect-meta">
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
                      <dt>Category</dt>
                      <dd>{packArtifactKindLabel(selectedReference.artifactKind)}</dd>
                    </div>
                    <div>
                      <dt>{templates ? "Store" : "Baseline"}</dt>
                      <dd>{selectedReference.sourceName}</dd>
                    </div>
                  </dl>
                  <div className="baseline-inspect-actions">
                    <button type="button" className="axis-btn" onClick={() => void openExternalUrl(selectedReference.sourceUrl)}>
                      {selectedReference.downloadUrl.startsWith("https://") ? "Open source entry" : "Open file"}
                    </button>
                    <button type="button" className="axis-btn" onClick={() => void openExternalUrl(selectedReference.downloadUrl)}>
                      {selectedReference.downloadUrl.startsWith("https://") ? "Open raw export" : "Open export file"}
                    </button>
                  </div>
                </section>
                <IncompleteBanner>
                  {templates
                    ? "This item is listed from a template store. Axis does not import it as a Settings Catalog policy."
                    : "This ASD baseline is listed for compare and one-policy import."}
                </IncompleteBanner>
              </>
            )}
            {importOpen && isCatalogPackArtifact(selectedReference.artifactKind) ? (
              <BaselineImportDialog
                reference={selectedReference}
                sources={sourceEntries}
                kicker={templates ? "Template import" : "Baseline import"}
                onClose={() => setImportOpen(false)}
              />
            ) : null}
          </div>
        ) : (
          <InspectorEmpty
            label={
              templates
                ? "Select an item under a template store to inspect it here."
                : "Select a baseline to inspect it here."
            }
          />
        )
      }
    />
    {bulkImportOpen && bulkImportTargets.length > 0 ? (
      <BaselineBulkImportDialog
        references={bulkImportTargets}
        sources={sourceEntries}
        kicker={templates ? "Template bulk import" : "Baseline bulk import"}
        onClose={() => {
          setBulkImportOpen(false);
          setBulkImportTargets([]);
        }}
        onDone={() => {
          setBulkImportOpen(false);
          setBulkImportTargets([]);
          selection.clear();
        }}
      />
    ) : null}
    {bulkMergeOpen && bulkMergeTargets.length > 1 ? (
      <BaselineMergeDialog
        references={bulkMergeTargets}
        sources={sourceEntries}
        kicker={templates ? "Template combine and merge" : "Baseline combine and merge"}
        onClose={() => {
          setBulkMergeOpen(false);
          setBulkMergeTargets([]);
        }}
        onDone={() => {
          setBulkMergeOpen(false);
          setBulkMergeTargets([]);
          selection.clear();
        }}
      />
    ) : null}
    {editingSourceKey != null ? (
      <TemplateSourceDialog
        sourceKey={editingSourceKey}
        sourceEntries={sourceEntries}
        onChange={setSourceEntries}
        onClose={() => setEditingSourceKey(null)}
      />
    ) : null}
    {deletingSourceKey != null ? (
      <ConfirmRemoveSourceDialog
        sourceKey={deletingSourceKey}
        sourceEntries={sourceEntries}
        onConfirm={() => {
          removeSource(deletingSourceKey);
          setDeletingSourceKey(null);
        }}
        onCancel={() => setDeletingSourceKey(null)}
      />
    ) : null}
    </>
  );
}

function ConfirmRemoveSourceDialog({
  sourceKey,
  sourceEntries,
  onConfirm,
  onCancel,
}: {
  sourceKey: string;
  sourceEntries: BaselineReferenceSourceInput[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const entry = sourceEntries.find(
    (row, rowIndex) => (row.id ?? `source-${rowIndex}`) === sourceKey,
  );
  if (!entry) return null;
  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="axis-modal" role="alertdialog" aria-modal="true" aria-labelledby="remove-source-title">
        <h2 id="remove-source-title">Remove {packTitle(entry)}?</h2>
        <p className="muted">
          This store is removed from Axis only. {" "}
          {isLocalSource(entry)
            ? "The folder on this machine is not touched."
            : "The repository is not touched."}
        </p>
        <div className="axis-modal-actions">
          <button type="button" className="axis-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="axis-btn axis-btn-danger" onClick={onConfirm}>
            Remove store
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateSourceDialog({
  sourceKey,
  sourceEntries,
  onChange,
  onClose,
}: {
  sourceKey: string;
  sourceEntries: BaselineReferenceSourceInput[];
  onChange: (next: BaselineReferenceSourceInput[]) => void;
  onClose: () => void;
}) {
  const index = sourceEntries.findIndex(
    (entry, rowIndex) => (entry.id ?? `source-${rowIndex}`) === sourceKey,
  );
  const entry = index >= 0 ? sourceEntries[index] : null;

  if (!entry) return null;

  const storeKind = resolveStoreKind(entry) ?? "axisTemplated";
  const patch = (partial: Partial<BaselineReferenceSourceInput>) => {
    onChange(
      sourceEntries.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...partial } : row,
      ),
    );
  };
  const setStoreKind = (kind: TemplateStoreKind) => {
    onChange(
      sourceEntries.map((row, rowIndex) =>
        rowIndex === index
          ? sanitizeSource({ ...row, storeKind: kind, path: kind === "axisTemplated" ? "" : row.path })
          : row,
      ),
    );
  };

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="axis-modal" role="dialog" aria-modal="true" aria-labelledby="template-source-title">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Template store</p>
            <h2 id="template-source-title">{packTitle(entry)}</h2>
          </div>
        </div>

        <div className="baseline-source-dialog-kind">
          <div className="axis-seg" role="group" aria-label="Store kind">
            <button
              type="button"
              className={`axis-seg-btn${storeKind === "axisTemplated" ? " is-active" : ""}`}
              onClick={() => setStoreKind("axisTemplated")}
            >
              Axis Templated
            </button>
            <button
              type="button"
              className={`axis-seg-btn${storeKind === "flatJson" ? " is-active" : ""}`}
              onClick={() => setStoreKind("flatJson")}
            >
              Flat JSON
            </button>
          </div>
          <p className="muted baseline-source-kind-hint">
            {storeKind === "axisTemplated"
              ? "Store root containing axis-pack.json. Policy sets select files; they are not baselines."
              : "Folder of policy JSON files. A GitHub tree path or local subfolder is the catalog dump."}
          </p>
        </div>

        <div className="baseline-source-fields">
          {isLocalSource(entry) ? (
            <>
              <label className="device-field">
                Name
                <input
                  className="axis-input"
                  value={entry.name ?? ""}
                  placeholder="Template name (optional)"
                  onChange={(event) => patch({ name: event.target.value })}
                />
              </label>
              <label className="device-field">
                Folder
                <span className="baseline-source-path">
                  <input
                    className="axis-input"
                    value={entry.localPath ?? ""}
                    placeholder="Folder path"
                    onChange={(event) =>
                      patch({ kind: "local", localPath: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="axis-btn"
                    onClick={() => {
                      void pickLocalPackFolder().then((folder) => {
                        if (!folder) return;
                        patch({ kind: "local", localPath: folder });
                      });
                    }}
                  >
                    Browse
                  </button>
                </span>
              </label>
              {storeKind === "flatJson" ? (
                <label className="device-field">
                  Subfolder
                  <input
                    className="axis-input"
                    value={entry.path}
                    placeholder="Optional subfolder (empty scans this folder)"
                    onChange={(event) => patch({ path: event.target.value, storeKind: "flatJson" })}
                  />
                </label>
              ) : null}
            </>
          ) : (
            <>
              <label className="device-field">
                Repository
                <input
                  className="axis-input"
                  value={entry.url ?? ""}
                  placeholder="https://github.com/owner/repo"
                  onChange={(event) => {
                    const value = event.target.value;
                    onChange(
                      sourceEntries.map((row, rowIndex) =>
                        rowIndex === index ? applyGitHubRepoInput(row, value) : row,
                      ),
                    );
                  }}
                />
              </label>
              {storeKind === "flatJson" ? (
                <label className="device-field">
                  Folder path
                  <input
                    className="axis-input"
                    value={entry.path}
                    placeholder="Folder path in the repository"
                    onChange={(event) => patch({ path: event.target.value, storeKind: "flatJson" })}
                  />
                </label>
              ) : null}
              <label className="axis-check baseline-source-private">
                <input
                  type="checkbox"
                  checked={Boolean(entry.private)}
                  onChange={(event) => {
                    const isPrivate = event.target.checked;
                    patch({ private: isPrivate, token: isPrivate ? entry.token : undefined });
                  }}
                />
                Private repository
              </label>
              {entry.private ? (
                <>
                  <input
                    className="axis-input"
                    type="password"
                    autoComplete="off"
                    value={entry.token ?? ""}
                    placeholder="Fine-grained PAT for this repository"
                    onChange={(event) => patch({ token: event.target.value })}
                  />
                  <GitHubLeastPrivilegePatHelp />
                </>
              ) : null}
            </>
          )}
        </div>

        <div className="axis-modal-actions">
          <button
            type="button"
            className="axis-link"
            disabled={!isSourceReady(entry)}
            onClick={() => void openExternalUrl(sourceOpenUrl(entry))}
            style={{ marginRight: "auto" }}
          >
            {isLocalSource(entry) ? "Open folder" : "Open repository"}
          </button>
          <button type="button" className="axis-btn axis-btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function BaselineImportDialog({
  reference,
  sources,
  kicker,
  onClose,
}: {
  reference: E8BaselineReference & { sourceId: string; sourceName: string };
  sources: BaselineReferenceSourceInput[];
  kicker: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(reference.name);
  const [description, setDescription] = useState("");
  const [platform, setPlatform] = useState<"windows" | "macos">("windows");
  const [settings, setSettings] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCatalogImportDraft(reference, sources)
      .then((draft) => {
        if (cancelled) return;
        setName(draft.name);
        setDescription(draft.description);
        setPlatform(draft.platform);
        setSettings(draft.settings);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load the baseline export.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reference.downloadUrl, reference.name, reference.sourceId, sources]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function importPolicy() {
    setSaving(true);
    setError(null);
    try {
      const response = await createSettingsCatalogPolicy({
        name: name.trim(),
        description,
        platform,
        settings,
      });
      if (response.error || !response.policy) {
        setError(response.error ?? "Import failed.");
        return;
      }
      navigate(
        `/intune/policies/settings-catalog?platform=${platform}&policy=${encodeURIComponent(
          response.policy.id,
        )}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="axis-modal object-action-pane" role="dialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">{kicker}</p>
            <h2>{reference.name}</h2>
          </div>
          <button type="button" className="axis-btn" disabled={saving} onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {loading ? <p className="muted">Downloading and validating template…</p> : null}
        <div className="object-action-fields">
          <label className="device-field">
            Policy name
            <input
              className="axis-input"
              value={name}
              disabled={loading || saving}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="device-field">
            Description
            <textarea
              className="axis-input object-action-description"
              value={description}
              rows={4}
              disabled={loading || saving}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="device-field">
            Platform
            <select
              className="axis-input"
              value={platform}
              disabled={loading || saving}
              onChange={(event) => setPlatform(event.target.value as "windows" | "macos")}
            >
              <option value="windows">Windows</option>
              <option value="macos">macOS</option>
            </select>
          </label>
          <p className="muted" style={{ margin: 0 }}>
            {settings.length} setting{settings.length === 1 ? "" : "s"} will be imported.
          </p>
        </div>
        <div className="object-action-footer">
          <p className="muted">The imported policy is created unassigned.</p>
          <div className="device-actions">
            <button type="button" className="axis-btn" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={loading || saving || !name.trim() || settings.length === 0}
              onClick={() => void importPolicy()}
            >
              {saving ? "Importing…" : "Import policy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type CatalogImportDraft = {
  name: string;
  description: string;
  platform: "windows" | "macos";
  settings: Record<string, unknown>[];
};

async function loadCatalogImportDraft(
  reference: E8BaselineReference & { sourceId: string },
  sources: BaselineReferenceSourceInput[],
): Promise<CatalogImportDraft> {
  const response = await fetchBaselineExport(
    reference.downloadUrl,
    tokenForSource(sources, reference.sourceId),
  );
  if (response.error || response.document == null) {
    throw new Error(response.error ?? "The baseline export was empty.");
  }
  const fileName = reference.downloadUrl.split(/[\\/]/).pop() ?? `${reference.name}.json`;
  const policy = normalizeIntunePolicyExport(response.document, fileName);
  const settings = catalogSettingsFromPolicy(policy);
  if (settings.length === 0) {
    throw new Error("No Settings Catalog instances in this file.");
  }
  const importedName =
    (typeof policy.name === "string" && policy.name.trim()) ||
    (typeof policy.displayName === "string" && policy.displayName.trim()) ||
    reference.name;
  return {
    name: importedName,
    description: catalogDescriptionFromPolicy(policy),
    platform: catalogPlatformFromPolicy(policy),
    settings,
  };
}

type BulkImportRow = {
  key: string;
  referenceName: string;
  include: boolean;
  name: string;
  platform: "windows" | "macos";
  settings: Record<string, unknown>[];
  description: string;
  error: string | null;
  status: "loading" | "ready" | "error";
};

function BaselineBulkImportDialog({
  references,
  sources,
  kicker,
  onClose,
  onDone,
}: {
  references: Array<E8BaselineReference & { sourceId: string; sourceName: string }>;
  sources: BaselineReferenceSourceInput[];
  kicker: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const referenceKey = references.map((reference) => `${reference.sourceId}:${reference.id}`).join("\0");
  const [rows, setRows] = useState<BulkImportRow[]>(() =>
    references.map((reference) => ({
      key: `ref:${reference.sourceId}:${reference.id}`,
      referenceName: reference.name,
      include: true,
      name: reference.name,
      platform: "windows" as const,
      settings: [],
      description: "",
      error: null,
      status: "loading" as const,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(
      references.map((reference) => ({
        key: `ref:${reference.sourceId}:${reference.id}`,
        referenceName: reference.name,
        include: true,
        name: reference.name,
        platform: "windows" as const,
        settings: [],
        description: "",
        error: null,
        status: "loading" as const,
      })),
    );
    void (async () => {
      for (const reference of references) {
        if (cancelled) return;
        const key = `ref:${reference.sourceId}:${reference.id}`;
        try {
          const draft = await loadCatalogImportDraft(reference, sources);
          if (cancelled) return;
          setRows((current) =>
            current.map((row) =>
              row.key === key
                ? {
                    ...row,
                    name: draft.name,
                    description: draft.description,
                    platform: draft.platform,
                    settings: draft.settings,
                    include: true,
                    error: null,
                    status: "ready",
                  }
                : row,
            ),
          );
        } catch (err) {
          if (cancelled) return;
          setRows((current) =>
            current.map((row) =>
              row.key === key
                ? {
                    ...row,
                    include: false,
                    error: err instanceof Error ? err.message : String(err),
                    status: "error",
                  }
                : row,
            ),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [referenceKey, sources]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const ready = rows.filter(
    (row) => row.include && row.status === "ready" && row.name.trim() && row.settings.length > 0,
  );
  const stillLoading = rows.some((row) => row.status === "loading");

  function patchRow(key: string, patch: Partial<BulkImportRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function importPolicies() {
    if (ready.length === 0) return;
    setSaving(true);
    setError(null);
    const created: Array<{ id: string; name: string }> = [];
    const failures: string[] = [];
    try {
      for (const [index, row] of ready.entries()) {
        setProgress(`Creating ${index + 1} of ${ready.length}…`);
        const response = await createSettingsCatalogPolicy({
          name: row.name.trim(),
          description: row.description,
          platform: row.platform,
          settings: row.settings,
        });
        if (response.error || !response.policy) {
          failures.push(`${row.name}: ${response.error ?? "Create failed."}`);
          continue;
        }
        created.push(response.policy);
      }
      if (created.length === 0) {
        setError(failures[0] ?? "Import failed.");
        return;
      }
      if (failures.length > 0) {
        setError(
          `Imported ${created.length}. ${failures.length} issue${failures.length === 1 ? "" : "s"}: ${failures.slice(0, 4).join(" ")}`,
        );
        return;
      }
      onDone();
      if (created.length === 1) {
        navigate(
          `/intune/policies/settings-catalog?platform=${ready[0]?.platform ?? "windows"}&policy=${encodeURIComponent(
            created[0].id,
          )}`,
        );
      } else {
        navigate("/intune/policies/settings-catalog");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="axis-modal axis-modal-wide" role="dialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">{kicker}</p>
            <h2>
              {references.length} polic{references.length === 1 ? "y" : "ies"}
            </h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              Each selected Settings Catalog export is normalized and created unassigned, same as a
              single import.
            </p>
          </div>
          <button type="button" className="axis-btn" disabled={saving} onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {progress ? <p className="muted">{progress}</p> : null}
        {stillLoading ? <p className="muted">Downloading and validating exports…</p> : null}
        <div className="object-action-fields" style={{ maxHeight: "40vh", overflow: "auto" }}>
          <table className="axis-table">
            <thead>
              <tr>
                <th>Import</th>
                <th>Policy name</th>
                <th>Platform</th>
                <th>Settings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.include && row.status === "ready"}
                      disabled={saving || row.status !== "ready"}
                      onChange={(event) => patchRow(row.key, { include: event.target.checked })}
                      aria-label={`Import ${row.referenceName}`}
                    />
                  </td>
                  <td>
                    {row.status === "error" ? (
                      <div>
                        <div>{row.referenceName}</div>
                        <p className="muted" style={{ margin: "0.2rem 0 0", color: "var(--axis-danger, #b42318)" }}>
                          {row.error}
                        </p>
                      </div>
                    ) : (
                      <input
                        className="axis-input"
                        value={row.name}
                        disabled={saving || row.status !== "ready"}
                        onChange={(event) => patchRow(row.key, { name: event.target.value })}
                      />
                    )}
                  </td>
                  <td>
                    <select
                      className="axis-input"
                      value={row.platform}
                      disabled={saving || row.status !== "ready"}
                      onChange={(event) =>
                        patchRow(row.key, { platform: event.target.value as "windows" | "macos" })
                      }
                    >
                      <option value="windows">Windows</option>
                      <option value="macos">macOS</option>
                    </select>
                  </td>
                  <td className="muted">
                    {row.status === "loading"
                      ? "…"
                      : row.status === "error"
                        ? "—"
                        : String(row.settings.length)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="object-action-footer">
          <p className="muted">
            {ready.length} ready · created policies stay unassigned until you edit assignments.
          </p>
          <div className="device-actions">
            <button type="button" className="axis-btn" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={saving || stillLoading || ready.length === 0}
              onClick={() => void importPolicies()}
            >
              {saving
                ? "Importing…"
                : `Import ${ready.length} polic${ready.length === 1 ? "y" : "ies"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
