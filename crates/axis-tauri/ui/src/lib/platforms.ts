export const INTUNE_PLATFORM_SLUGS = ["windows", "macos", "ios", "android"] as const;
export type IntunePlatform = (typeof INTUNE_PLATFORM_SLUGS)[number];

export const INTUNE_PLATFORM_LABELS: Record<IntunePlatform, string> = {
  windows: "Windows",
  macos: "macOS",
  ios: "iOS / iPadOS",
  android: "Android",
};

export function isIntunePlatform(value: string | null): value is IntunePlatform {
  return INTUNE_PLATFORM_SLUGS.includes(value as IntunePlatform);
}

export function platformFromSearchParam(
  value: string | null,
): IntunePlatform | null {
  return isIntunePlatform(value) ? value : null;
}

export function matchesIntunePlatform(
  value: string | null | undefined,
  platform: IntunePlatform,
): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  switch (platform) {
    case "windows":
      return normalized.includes("windows");
    case "macos":
      return normalized.includes("macos") || normalized === "mac";
    case "ios":
      return normalized.includes("ios") || normalized.includes("ipados");
    case "android":
      return normalized.includes("android") || normalized.includes("aosp");
  }
}

export function platformHref(pathname: string, platform: IntunePlatform): string {
  return `${pathname}?platform=${platform}`;
}
