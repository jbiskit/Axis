import { graphLargeIcon } from "./appIcon";

export type StoreAppDraft = {
  displayName: string;
  description: string;
  publisher: string;
  developer: string;
  owner: string;
  notes: string;
  informationUrl: string;
  privacyInformationUrl: string;
  packageIdentifier: string;
  runAsAccount: string;
  iconType: string;
  iconValue: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function isWinGetApp(object: Record<string, unknown> | null): boolean {
  return text(object?.["@odata.type"]).toLowerCase().includes("wingetapp");
}

export function draftFromStoreObject(object: Record<string, unknown> | null): StoreAppDraft {
  const install =
    object?.installExperience && typeof object.installExperience === "object"
      ? (object.installExperience as Record<string, unknown>)
      : {};
  const publisher = text(object?.publisher);
  const icon = graphLargeIcon(object);
  return {
    displayName: text(object?.displayName),
    description: text(object?.description),
    publisher,
    developer: text(object?.developer) || publisher,
    owner: text(object?.owner),
    notes: text(object?.notes),
    informationUrl: text(object?.informationUrl),
    privacyInformationUrl: text(object?.privacyInformationUrl),
    packageIdentifier: text(object?.packageIdentifier),
    runAsAccount: text(install.runAsAccount) === "user" ? "user" : "system",
    iconType: icon.iconType,
    iconValue: icon.iconValue,
  };
}

export function draftsEqualStore(left: StoreAppDraft, right: StoreAppDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function installBehaviorLabel(runAsAccount: string): string {
  return runAsAccount === "user" ? "User" : "System";
}

export function toUpdateStoreInput(id: string, draft: StoreAppDraft, updateIcon = false) {
  return {
    id,
    displayName: draft.displayName,
    description: draft.description,
    publisher: draft.publisher,
    developer: draft.developer,
    owner: draft.owner,
    notes: draft.notes,
    informationUrl: draft.informationUrl,
    privacyInformationUrl: draft.privacyInformationUrl,
    packageIdentifier: draft.packageIdentifier,
    updateIcon,
    iconValue: draft.iconValue,
  };
}
