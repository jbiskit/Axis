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

export function canEditGraphMetadata(kind: string): boolean {
  return canDuplicateGraphKind(kind);
}

export function canDeleteGraphKind(kind: string): boolean {
  return (
    kind.startsWith("script:") ||
    kind.startsWith("windowsUpdate:") ||
    kind === "configurationPolicy" ||
    kind === "compliancePolicy" ||
    kind === "groupPolicyConfiguration" ||
    kind === "deviceConfiguration" ||
    kind === "appProtection"
  );
}

export function canCopyGraphAssignments(kind: string): boolean {
  return (
    kind === "configurationPolicy" ||
    kind === "compliancePolicy" ||
    kind === "groupPolicyConfiguration" ||
    kind === "deviceConfiguration" ||
    kind === "windowsUpdate:rings" ||
    kind === "script:platform-powershell" ||
    kind === "script:platform-shell" ||
    kind === "script:remediation"
  );
}

export function copyDisplayName(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "Copy";
  const numbered = trimmed.match(/^(.*) \(copy (\d+)\)$/);
  if (numbered) return `${numbered[1]} (copy ${Number(numbered[2]) + 1})`;
  if (trimmed.endsWith(" (copy)")) return `${trimmed.slice(0, -7)} (copy 2)`;
  return `${trimmed} (copy)`;
}

export function withTransientItem<T extends { id: string }>(items: T[], extra: T | null): T[] {
  if (!extra) return items;
  if (items.some((item) => item.id === extra.id)) return items;
  return [extra, ...items];
}
