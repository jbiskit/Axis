import {
  INTUNE_PLATFORM_LABELS,
  INTUNE_PLATFORM_SLUGS,
  type IntunePlatform,
} from "./platforms";

export const APP_KIND_SLUGS = ["lob", "msi", "store"] as const;
export type AppKind = (typeof APP_KIND_SLUGS)[number];

export const APP_KIND_LABELS: Record<AppKind, string> = {
  lob: "LOB",
  msi: "MSI",
  store: "Store",
};

type GraphAppType = {
  odataType: string;
  platform: IntunePlatform;
  kind: AppKind;
  label: string;
};

const GRAPH_APP_TYPES: GraphAppType[] = [
  { odataType: "microsoft.graph.win32LobApp", platform: "windows", kind: "lob", label: "Win32" },
  { odataType: "microsoft.graph.windowsUniversalAppX", platform: "windows", kind: "lob", label: "AppX" },
  { odataType: "microsoft.graph.windowsAppX", platform: "windows", kind: "lob", label: "AppX" },
  { odataType: "microsoft.graph.windowsMobileMSI", platform: "windows", kind: "msi", label: "MSI" },
  { odataType: "microsoft.graph.winGetApp", platform: "windows", kind: "store", label: "WinGet" },
  { odataType: "microsoft.graph.microsoftStoreForBusinessApp", platform: "windows", kind: "store", label: "Store for Business" },
  { odataType: "microsoft.graph.windowsStoreApp", platform: "windows", kind: "store", label: "Microsoft Store" },
  { odataType: "microsoft.graph.win32CatalogApp", platform: "windows", kind: "store", label: "Enterprise catalog" },
  { odataType: "microsoft.graph.macOSDmgApp", platform: "macos", kind: "lob", label: "macOS DMG" },
  { odataType: "microsoft.graph.macOSPkgApp", platform: "macos", kind: "lob", label: "macOS PKG" },
  { odataType: "microsoft.graph.macOSLobApp", platform: "macos", kind: "lob", label: "macOS LOB" },
  { odataType: "microsoft.graph.macOSMicrosoftEdgeApp", platform: "macos", kind: "store", label: "Edge" },
  { odataType: "microsoft.graph.macOSOfficeSuiteApp", platform: "macos", kind: "store", label: "Microsoft 365" },
  { odataType: "microsoft.graph.iosLobApp", platform: "ios", kind: "lob", label: "iOS LOB" },
  { odataType: "microsoft.graph.managedIOSLobApp", platform: "ios", kind: "lob", label: "iOS LOB (managed)" },
  { odataType: "microsoft.graph.iosStoreApp", platform: "ios", kind: "store", label: "App Store" },
  { odataType: "microsoft.graph.iosVppApp", platform: "ios", kind: "store", label: "VPP" },
  { odataType: "microsoft.graph.androidLobApp", platform: "android", kind: "lob", label: "Android LOB" },
  { odataType: "microsoft.graph.managedAndroidLobApp", platform: "android", kind: "lob", label: "Android LOB (managed)" },
  { odataType: "microsoft.graph.androidStoreApp", platform: "android", kind: "store", label: "Play Store" },
  { odataType: "microsoft.graph.androidManagedStoreApp", platform: "android", kind: "store", label: "Managed Google Play" },
  { odataType: "microsoft.graph.androidForWorkApp", platform: "android", kind: "store", label: "Android for Work" },
];

function normalizeOdataType(value?: string | null): string {
  return (value ?? "").replace(/^#/, "").trim().toLowerCase();
}

export function classifyMobileApp(odataType?: string | null): GraphAppType | null {
  const needle = normalizeOdataType(odataType);
  if (!needle) return null;
  return GRAPH_APP_TYPES.find((entry) => entry.odataType.toLowerCase() === needle) ?? null;
}

export function isAppKind(value: string | null): value is AppKind {
  return APP_KIND_SLUGS.includes(value as AppKind);
}

export function appKindFromSearchParam(value: string | null): AppKind | null {
  return isAppKind(value) ? value : null;
}

export function kindsForPlatform(platform: IntunePlatform): AppKind[] {
  const kinds = new Set<AppKind>();
  for (const entry of GRAPH_APP_TYPES) {
    if (entry.platform === platform) kinds.add(entry.kind);
  }
  return APP_KIND_SLUGS.filter((kind) => kinds.has(kind));
}

export function appTypeNavForPlatform(
  platform: IntunePlatform,
): Array<{ kind: AppKind; label: string }> {
  switch (platform) {
    case "windows":
      return [
        { kind: "lob", label: "Win32" },
        { kind: "msi", label: "MSI" },
        { kind: "store", label: "Store" },
      ];
    case "macos":
      return [
        { kind: "lob", label: "PKG / DMG" },
        { kind: "store", label: "Store" },
      ];
    case "ios":
      return [
        { kind: "lob", label: "Line-of-business" },
        { kind: "store", label: "App Store / VPP" },
      ];
    case "android":
      return [
        { kind: "lob", label: "Line-of-business" },
        { kind: "store", label: "Managed Google Play" },
      ];
  }
}

export function appsInventoryHref(opts: {
  tab?: "tenant" | "catalog";
  platform?: IntunePlatform | null;
  type?: AppKind | null;
} = {}): string {
  const tab = opts.tab ?? "tenant";
  const params = new URLSearchParams();
  if (opts.platform) params.set("platform", opts.platform);
  if (opts.type) params.set("type", opts.type);
  const query = params.toString();
  return query ? `/intune/apps/${tab}?${query}` : `/intune/apps/${tab}`;
}

export function appsPlatformNavChildren() {
  return INTUNE_PLATFORM_SLUGS.map((platform) => ({
    href: appsInventoryHref({ platform }),
    label: INTUNE_PLATFORM_LABELS[platform],
    section: "Platform",
    children: appTypeNavForPlatform(platform).map((entry) => ({
      href: appsInventoryHref({ platform, type: entry.kind }),
      label: entry.label,
      icon: "apps" as const,
    })),
  }));
}
