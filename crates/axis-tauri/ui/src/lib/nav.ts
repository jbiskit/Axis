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

function enrollmentNavChildren(): NavItem[] {
  return [
    {
      href: "/intune/enrollment/windows",
      label: "Windows",
      section: "Platform",
      children: [
        {
          href: "/intune/enrollment/windows/autopilot",
          label: "Autopilot",
          icon: "enrollment",
          section: "Configure",
          children: [
            {
              href: "/intune/enrollment/windows/autopilot/devices",
              label: "Devices",
              icon: "enrollment",
              section: "Configure",
            },
            {
              href: "/intune/enrollment/windows/autopilot/profiles",
              label: "Deployment profiles",
              icon: "enrollment",
              section: "Configure",
            },
          ],
        },
        {
          href: "/intune/enrollment/windows/esp",
          label: "Enrollment Status Page",
          icon: "enrollment",
          section: "Configure",
        },
        {
          href: "/intune/enrollment/windows/windows-hello",
          label: "Windows Hello for Business",
          icon: "enrollment",
          section: "Configure",
        },
        {
          href: "/intune/enrollment/windows/automatic-enrollment",
          label: "Automatic enrollment",
          icon: "enrollment",
          section: "Configure",
        },
      ],
    },
    {
      href: "/intune/enrollment/macos",
      label: "macOS",
      section: "Platform",
      status: "planned",
    },
    {
      href: "/intune/enrollment/ios",
      label: "iOS / iPadOS",
      section: "Platform",
      status: "planned",
    },
    {
      href: "/intune/enrollment/android",
      label: "Android",
      section: "Platform",
      status: "planned",
    },
    {
      href: "/intune/enrollment/restrictions",
      label: "Restrictions",
      section: "Tenant",
      children: [
        {
          href: "/intune/enrollment/restrictions/platform",
          label: "Device platform restrictions",
          icon: "enrollment",
          section: "Configure",
        },
        {
          href: "/intune/enrollment/restrictions/limit",
          label: "Device limit restrictions",
          icon: "enrollment",
          section: "Configure",
        },
      ],
    },
  ];
}

export const INTUNE_NAV: NavItem[] = [
  { href: "/intune", label: "Overview", icon: "overview", section: "Workspace" },
  { href: "/intune/activity", label: "Write activity", icon: "overview", section: "Workspace" },
  { href: "/intune/what-if", label: "What if", icon: "overview", section: "Workspace" },
  { href: "/intune/tools/autopilot-script", label: "Autopilot script", icon: "enrollment", section: "Tools" },
  { href: "/intune/reports", label: "Environment report", icon: "reports", section: "Workspace" },
  { href: "/intune/client", label: "Compare & restore", icon: "baselines", section: "Workspace" },
  {
    href: "/intune/get-started/readiness",
    label: "Readiness",
    icon: "enrollment",
    section: "Get Started",
  },
  {
    href: "/intune/get-started/autopilot",
    label: "Autopilot",
    icon: "enrollment",
    section: "Get Started",
  },
  {
    href: "/intune/get-started/laps",
    label: "Windows LAPS",
    icon: "policies",
    section: "Get Started",
  },
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
    children: enrollmentNavChildren(),
  },
  {
    href: "/intune/groups",
    label: "Groups",
    icon: "devices",
    section: "Manage",
  },
  {
    href: "/intune/policies",
    label: "Policies",
    icon: "policies",
    section: "Manage",
    children: policiesPlatformNavChildren(),
  },
  {
    href: "/intune/policy-sets",
    label: "Policy sets",
    icon: "policies",
    section: "Manage",
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
  {
    href: "/intune/apps",
    label: "Apps",
    icon: "apps",
    section: "Manage",
    children: [
      ...appsPlatformNavChildren(),
      { href: "/intune/apps/tenant", label: "All tenant apps", icon: "apps", section: "Inventory" },
      { href: "/intune/apps/setup", label: "Apps setup", icon: "apps-setup", section: "Tools" },
      { href: "/intune/apps/protection", label: "App protection", icon: "apps", section: "Tools" },
    ],
  },
  { href: "/intune/packs", label: "Policy Packs", icon: "templates", section: "Library" },
  { href: "/intune/apps/catalog", label: "Local application catalog", icon: "apps", section: "Library" },
];

const ENTRA_NAV: NavItem[] = [
  {
    href: "/entra",
    label: "Entra",
    icon: "endpoint-security",
    section: "Entra",
    children: [
      { href: "/entra/conditional-access/overview", label: "Overview", icon: "overview", section: "Conditional Access" },
      { href: "/entra/conditional-access/policies", label: "Policies", icon: "policies", section: "Conditional Access" },
      { href: "/entra/conditional-access/named-locations", label: "Named locations", icon: "policies", section: "Conditional Access" },
    ],
  },
];

const PURVIEW_NAV: NavItem[] = [
  {
    href: "/purview",
    label: "Purview",
    icon: "policies",
    section: "Purview",
    children: [
      { href: "/purview/information-protection/sensitivity-labels", label: "Sensitivity labels", icon: "policies", section: "Information Protection" },
      { href: "/purview/data-lifecycle/retention-labels", label: "Retention labels", icon: "policies", section: "Data lifecycle" },
    ],
  },
];

const DEFENDER_EMAIL = "Email & collaboration";
const DEFENDER_NAV: NavItem[] = [
  {
    href: "/defender",
    label: "Defender",
    icon: "endpoint-security",
    section: "Defender",
    children: [
      { href: "/defender/email/preset-policies", label: "Preset security policies", icon: "policies", section: DEFENDER_EMAIL },
      { href: "/defender/email/anti-phishing", label: "Anti-phishing", icon: "policies", section: DEFENDER_EMAIL },
      { href: "/defender/email/anti-spam", label: "Anti-spam (inbound)", icon: "policies", section: DEFENDER_EMAIL },
      { href: "/defender/email/outbound-spam", label: "Anti-spam (outbound)", icon: "policies", section: DEFENDER_EMAIL },
      { href: "/defender/email/anti-malware", label: "Anti-malware", icon: "policies", section: DEFENDER_EMAIL },
      { href: "/defender/email/safe-links", label: "Safe Links", icon: "policies", section: DEFENDER_EMAIL },
      { href: "/defender/email/safe-attachments", label: "Safe Attachments", icon: "policies", section: DEFENDER_EMAIL },
      { href: "/defender/email/global-settings", label: "Global settings", icon: "policies", section: DEFENDER_EMAIL },
      { href: "/defender/email/quarantine-policies", label: "Quarantine policies", icon: "policies", section: DEFENDER_EMAIL },
      { href: "/defender/email/allow-block-list", label: "Tenant Allow/Block List", icon: "policies", section: DEFENDER_EMAIL },
      { href: "/defender/email/dkim", label: "DKIM", icon: "policies", section: DEFENDER_EMAIL },
      { href: "/defender/posture/secure-score", label: "Secure Score", icon: "overview", section: "Exposure" },
      { href: "/defender/endpoints/devices", label: "Device inventory", icon: "devices", section: "Endpoints" },
      { href: "/defender/endpoints/security-policies", label: "Endpoint security policies", icon: "policies", section: "Endpoints" },
    ],
  },
];

/** Product modules. Each owns a route prefix and a nav tree; non-Intune modules get one rail slot each, in this order. */
export const NAV_MODULES: Array<{ id: string; label: string; nav: NavItem[] }> = [
  { id: "intune", label: "Intune", nav: INTUNE_NAV },
  { id: "entra", label: "Entra", nav: ENTRA_NAV },
  { id: "purview", label: "Purview", nav: PURVIEW_NAV },
  { id: "defender", label: "Defender", nav: DEFENDER_NAV },
];

export const ALL_NAV: NavItem[] = NAV_MODULES.flatMap((module) => module.nav);

export function moduleForPath(pathname: string): string {
  return NAV_MODULES.find((module) => pathname === `/${module.id}` || pathname.startsWith(`/${module.id}/`))?.id ?? "intune";
}

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
  return matchingNavItems(pathname, search, ALL_NAV)[0]?.label ?? "Overview";
}
