/** Graph `deviceEnrollmentConfigurationType` query kinds used by Enrollment lists. */
export type EnrollmentConfigQueryKind =
  | "platformRestrictions"
  | "limitRestrictions"
  | "esp"
  | "windowsHello";

export const ENROLLMENT_AUTOPILOT_PATH = "/intune/enrollment/windows/autopilot";
export const ENROLLMENT_AUTOPILOT_DEVICES_PATH =
  "/intune/enrollment/windows/autopilot/devices";
export const ENROLLMENT_AUTOPILOT_PROFILES_PATH =
  "/intune/enrollment/windows/autopilot/profiles";
export const GET_STARTED_AUTOPILOT_PATH = "/intune/get-started/autopilot";
export const GET_STARTED_LAPS_PATH = "/intune/get-started/laps";
export const GET_STARTED_READINESS_PATH = "/intune/get-started/readiness";
export const ENROLLMENT_ESP_PATH = "/intune/enrollment/windows/esp";
export const ENROLLMENT_WINDOWS_HELLO_PATH = "/intune/enrollment/windows/windows-hello";
export const ENROLLMENT_PLATFORM_RESTRICTIONS_PATH =
  "/intune/enrollment/restrictions/platform";
export const ENROLLMENT_LIMIT_RESTRICTIONS_PATH = "/intune/enrollment/restrictions/limit";

export function enrollmentQueryKindFromPath(
  pathname: string,
): EnrollmentConfigQueryKind | null {
  switch (pathname) {
    case ENROLLMENT_ESP_PATH:
      return "esp";
    case ENROLLMENT_WINDOWS_HELLO_PATH:
      return "windowsHello";
    case ENROLLMENT_PLATFORM_RESTRICTIONS_PATH:
      return "platformRestrictions";
    case ENROLLMENT_LIMIT_RESTRICTIONS_PATH:
      return "limitRestrictions";
    default:
      return null;
  }
}

/**
 * Portal-equivalent Graph filters (applied server-side).
 *
 * Platform restrictions use the Intune portal query:
 * `deviceEnrollmentConfigurationType eq 'SinglePlatformRestriction'`
 * which returns both the default multi-platform row and per-platform restrictions.
 */
export function enrollmentGraphFilter(kind: EnrollmentConfigQueryKind): string {
  switch (kind) {
    case "platformRestrictions":
      return "deviceEnrollmentConfigurationType eq 'SinglePlatformRestriction'";
    case "limitRestrictions":
      return "(deviceEnrollmentConfigurationType eq 'Limit' or deviceEnrollmentConfigurationType eq 'DefaultLimit')";
    case "esp":
      // Not sent to Graph. That service rewrites this comparison into a camelCase
      // enum literal, and the Intune onboarding service returns HTTP 400.
      // The list is the unfiltered enrollment configurations, kept when the row is an ESP page.
      return "";
    case "windowsHello":
      return "(deviceEnrollmentConfigurationType eq 'WindowsHelloForBusiness' or deviceEnrollmentConfigurationType eq 'DefaultWindowsHelloForBusiness')";
  }
}
