/** Helpers for Graph deviceEnrollmentLimitConfiguration objects. */

export const DEVICE_LIMIT_MIN = 1;
export const DEVICE_LIMIT_MAX = 15;

export function enrollmentOdataType(object: Record<string, unknown> | null | undefined): string {
  const raw = object?.["@odata.type"];
  return typeof raw === "string" ? raw : "";
}

export function isEnrollmentLimitObject(
  object: Record<string, unknown> | null | undefined,
): boolean {
  if (!object) return false;
  const odata = enrollmentOdataType(object).toLowerCase();
  if (odata.includes("deviceenrollmentlimitconfiguration")) return true;
  const configType =
    typeof object.deviceEnrollmentConfigurationType === "string"
      ? object.deviceEnrollmentConfigurationType.toLowerCase()
      : "";
  return configType === "limit" || configType === "defaultlimit";
}

export function clampDeviceLimit(value: number): number {
  if (!Number.isFinite(value)) return DEVICE_LIMIT_MAX;
  return Math.min(DEVICE_LIMIT_MAX, Math.max(DEVICE_LIMIT_MIN, Math.round(value)));
}

export function deviceLimitFromObject(
  object: Record<string, unknown> | null | undefined,
): number {
  const raw = object?.limit;
  if (typeof raw === "number" && Number.isFinite(raw)) return clampDeviceLimit(raw);
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return clampDeviceLimit(parsed);
  }
  return DEVICE_LIMIT_MAX;
}

export const DEVICE_LIMIT_OPTIONS: number[] = Array.from(
  { length: DEVICE_LIMIT_MAX - DEVICE_LIMIT_MIN + 1 },
  (_, index) => DEVICE_LIMIT_MIN + index,
);
