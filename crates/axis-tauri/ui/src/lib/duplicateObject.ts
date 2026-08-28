export function canDuplicateGraphKind(kind: string): boolean {
  if (kind === "mobileApp" || kind === "autopilotDevice") return false;
  if (kind.startsWith("script:") || kind.startsWith("windowsUpdate:")) return true;
  return (
    kind === "configurationPolicy" ||
    kind === "compliancePolicy" ||
    kind === "groupPolicyConfiguration" ||
    kind === "deviceConfiguration" ||
    kind === "enrollmentConfiguration" ||
    kind === "appProtection" ||
    kind === "autopilotProfile"
  );
}

export function withTransientItem<T extends { id: string }>(items: T[], extra: T | null): T[] {
  if (!extra) return items;
  if (items.some((item) => item.id === extra.id)) return items;
  return [extra, ...items];
}
