import type { NavItem } from "../types/inventory";
import {
  INTUNE_PLATFORM_LABELS,
  INTUNE_PLATFORM_SLUGS,
  platformHref,
  type IntunePlatform,
} from "./platforms";
import { appsPlatformNavChildren } from "./appKinds";

function platformNav(pathname: string): NavItem[] {
  return INTUNE_PLATFORM_SLUGS.map((platform) => ({
    href: platformHref(pathname, platform),
    label: INTUNE_PLATFORM_LABELS[platform],
    section: "Platform",
  }));
}

const POLICY_FAMILIES: Array<{
  label: string;
  href: string;
  platforms: IntunePlatform[];
  status?: "planned";
  navSection?: string;
  icon?: NavItem["icon"];
  listInHub?: boolean;
}> = [
  {
    label: "Settings Catalog",
    href: "/intune/policies/settings-catalog",
    platforms: ["windows", "macos"],
    navSection: "Configure",
    icon: "settings-catalog",
  },
  {
    label: "Browse catalog",
    href: "/intune/policies/browse",
    platforms: ["windows", "macos"],
    navSection: "Configure",
    icon: "settings-catalog",
    listInHub: false,
  },
  {
    label: "ADMX Studio",
    href: "/intune/policies/admx-studio",
    platforms: ["windows"],
    navSection: "Configure",
    icon: "policies",
  },
  {
    label: "Custom",
    href: "/intune/policies/custom",
    platforms: ["windows", "macos", "ios", "android"],
    navSection: "Configure",
    icon: "policies",
    status: "planned",
  },
  {
    label: "Domain",
    href: "/intune/policies/domain",
    platforms: ["windows"],
    navSection: "Configure",
    icon: "policies",
    status: "planned",
  },
  {
    label: "Device Configuration",
    href: "/intune/policies/device-configuration",
    platforms: ["windows", "macos", "ios", "android"],
    navSection: "Configure",
    icon: "policies",
    status: "planned",
  },
];

function policiesPlatformNavChildren(): NavItem[] {
  const platforms = INTUNE_PLATFORM_SLUGS.map((platform) => {
    const families = POLICY_FAMILIES.filter((family) => family.platforms.includes(platform));
    return {
      href: platformHref("/intune/policies", platform),
      label: INTUNE_PLATFORM_LABELS[platform],
      section: "Platform",
      children: families.map((family) => ({
        href: `${family.href}?platform=${platform}`,
        label: family.label,
        icon: family.icon,
        section: family.navSection ?? "Configure",
        status: family.status,
      })),
    };
  });
  return [
    ...platforms,
    {
      href: "/intune/settings",
      label: "Settings search",
      icon: "settings",
      section: "Tools",
    },
  ];
}

const ENDPOINT_SECURITY_BLADES: NavItem[] = [
  { href: "/intune/endpoint-security/security-tasks", label: "Security tasks", section: "Overview", status: "planned" },
  { href: "/intune/endpoint-security/antivirus", label: "Antivirus", section: "Manage" },
  { href: "/intune/endpoint-security/disk-encryption", label: "Disk encryption", section: "Manage" },
  { href: "/intune/endpoint-security/firewall", label: "Firewall", section: "Manage" },
  { href: "/intune/endpoint-security/endpoint-privilege-management", label: "Endpoint Privilege Management", section: "Manage" },
  { href: "/intune/endpoint-security/endpoint-detection-and-response", label: "Endpoint detection and response", section: "Manage" },
  { href: "/intune/endpoint-security/app-control", label: "App Control for Business", section: "Manage" },
  { href: "/intune/endpoint-security/attack-surface-reduction", label: "Attack surface reduction", section: "Manage" },
  { href: "/intune/endpoint-security/account-protection", label: "Account protection", section: "Manage" },
  { href: "/intune/policies/compliance", label: "Device compliance", section: "Manage" },
  { href: "/intune/endpoint-security/conditional-access", label: "Conditional access", section: "Manage", status: "planned" },
  { href: "/intune/endpoint-security/assignment-failures", label: "Assignment failures", section: "Monitor", status: "planned" },
  { href: "/intune/endpoint-security/microsoft-defender-for-endpoint", label: "Microsoft Defender for Endpoint", section: "Setup", status: "planned" },
];

const WINDOWS_UPDATE_BLADES: NavItem[] = [
  { href: "/intune/windows-update/update-rings", label: "Update rings", section: "Manage" },
  { href: "/intune/windows-update/feature-updates", label: "Feature updates", section: "Manage" },
  { href: "/intune/windows-update/quality-updates", label: "Quality updates", section: "Manage" },
  { href: "/intune/windows-update/driver-updates", label: "Driver updates", section: "Manage" },
  { href: "/intune/windows-update/deployment-status", label: "Deployment status", section: "Monitor", status: "planned" },
];

export const INTUNE_NAV: NavItem[] = [
  { href: "/intune", label: "Overview", icon: "overview", section: "Workspace" },
  { href: "/intune/activity", label: "Write activity", icon: "overview", section: "Workspace", status: "planned" },
  { href: "/intune/reports", label: "Environment report", icon: "reports", section: "Workspace", status: "planned" },
  {
    href: "/intune/devices",
    label: "Devices",
    icon: "devices",
    section: "Manage",
    children: [
      ...platformNav("/intune/devices/all"),
      { href: "/intune/devices/all", label: "All devices", icon: "devices", section: "Inventory" },
      { href: "/intune/devices/scripts", label: "Scripts", icon: "devices", section: "Tools" },
      { href: "/intune/devices/compliance", label: "Compliance scripts", icon: "devices", section: "Tools" },
      { href: "/intune/devices/remediations", label: "Remediations", icon: "devices", section: "Tools" },
    ],
  },
  {
    href: "/intune/enrollment",
    label: "Enrollment",
    icon: "enrollment",
    section: "Manage",
    children: [
      { href: "/intune/enrollment/autopilot", label: "Autopilot", icon: "enrollment" },
      { href: "/intune/enrollment/windows", label: "Windows enrollment", icon: "enrollment" },
    ],
  },
  {
    href: "/intune/policies",
    label: "Policies",
    icon: "policies",
    section: "Manage",
    children: policiesPlatformNavChildren(),
  },
  {
    href: "/intune/policies/compliance",
    label: "Compliance",
    icon: "policies",
    section: "Manage",
    children: [
      ...platformNav("/intune/policies/compliance"),
      { href: "/intune/policies/compliance", label: "All policies", icon: "policies", section: "Inventory" },
    ],
  },
  {
    href: "/intune/endpoint-security",
    label: "Endpoint Security",
    icon: "endpoint-security",
    section: "Manage",
    children: ENDPOINT_SECURITY_BLADES,
  },
  {
    href: "/intune/windows-update",
    label: "Windows Update",
    icon: "windows-update",
    section: "Manage",
    children: WINDOWS_UPDATE_BLADES,
  },
  { href: "/intune/baselines", label: "Baselines", icon: "baselines", section: "Manage" },
  {
    href: "/intune/apps",
    label: "Apps",
    icon: "apps",
    section: "Apps",
    children: [
      ...appsPlatformNavChildren(),
      { href: "/intune/apps/tenant", label: "All tenant apps", icon: "apps", section: "Inventory" },
      { href: "/intune/apps/catalog", label: "All catalog apps", icon: "apps", section: "Inventory" },
      { href: "/intune/apps/uploads", label: "Upload tasks", icon: "apps", section: "Tools" },
      { href: "/intune/apps/setup", label: "Apps setup", icon: "apps-setup", section: "Tools" },
      { href: "/intune/apps/store", label: "Add Store app", icon: "apps", section: "Tools" },
      { href: "/intune/apps/protection", label: "App protection", icon: "apps", section: "Tools" },
    ],
  },
];

export const POLICY_HUB_FAMILIES = POLICY_FAMILIES.filter((family) => family.listInHub !== false);

export function flattenNav(nav: NavItem[]): NavItem[] {
  const out: NavItem[] = [];
  for (const item of nav) {
    out.push(item);
    if (item.children?.length) out.push(...flattenNav(item.children));
  }
  return out;
}

export function matchingNavItems(pathname: string, search: URLSearchParams, nav: NavItem[]): NavItem[] {
  return flattenNav(nav)
    .filter((candidate) => {
      const [candidatePath, candidateQuery = ""] = candidate.href.split("?");
      if (pathname !== candidatePath && !pathname.startsWith(`${candidatePath}/`)) {
        return false;
      }
      const required = new URLSearchParams(candidateQuery);
      if (![...required].every(([key, value]) => search.get(key) === value)) {
        return false;
      }
      if (pathname === candidatePath) {
        const urlPlatform = search.get("platform");
        if (urlPlatform && !required.has("platform")) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const [aPath, aQuery = ""] = a.href.split("?");
      const [bPath, bQuery = ""] = b.href.split("?");
      return (
        new URLSearchParams(bQuery).size - new URLSearchParams(aQuery).size ||
        bPath.length - aPath.length
      );
    });
}

export function breadcrumbLabel(pathname: string, search: URLSearchParams): string {
  return matchingNavItems(pathname, search, INTUNE_NAV)[0]?.label ?? "Overview";
}
