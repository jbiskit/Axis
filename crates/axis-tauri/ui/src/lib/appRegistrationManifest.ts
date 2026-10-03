import type { SessionMode } from "../types/glance";

/**
 * Delegated Microsoft Graph permission ids (type Scope).
 * Keep the names in step with `base_scopes` / `write_scopes` in auth.rs.
 * Ids are the delegated column from Microsoft's Graph permissions reference.
 */
const GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";

const READ_SCOPE_IDS = [
  "e1fe6dd8-ba31-4d61-89e7-88639da4683d", // User.Read
  "4908d5b9-3fb2-4b1e-9336-1888b7937185", // Organization.Read.All
  "951183d1-1a61-466f-a6d1-1fde911bfd95", // Device.Read.All
  "a154be20-db9c-4678-8ab7-66f6cc099a59", // User.Read.All
  "bc024368-1153-4739-b217-4326f2e966d0", // GroupMember.Read.All
  "5f8c59db-677d-491f-a6b8-5f174b11ec1d", // Group.Read.All
  "572fea84-0151-49b2-9301-11cb16974376", // Policy.Read.All
  "e4c9e354-4dc5-45b8-9e7c-e1393b0b1a20", // AuditLog.Read.All
  "b27a61ec-b99c-4d6a-b126-c4375d08ae30", // BitlockerKey.Read.All
  "280b3b69-0437-44b1-bc20-3b2fca1ee3e9", // DeviceLocalCredential.Read.All
  "f1493658-876a-4c87-8fa7-edb559b3476a", // DeviceManagementConfiguration.Read.All
  "4edf5f54-4666-44af-9de9-0144fb4b6e8c", // DeviceManagementApps.Read.All
  "49f0cc30-024c-4dfd-ab3e-82e137ee5431", // DeviceManagementRBAC.Read.All
  "8696daa5-bce5-4b2e-83f9-51b6defc4e1e", // DeviceManagementServiceConfig.Read.All
  "d32381d8-ee89-4220-9c83-b672aa68d404", // DeviceManagementScripts.Read.All
  "314874da-47d6-4978-88dc-cf0d37f0bb82", // DeviceManagementManagedDevices.Read.All
] as const;

const WRITE_SCOPE_IDS = [
  "0883f392-0a7a-443d-8c76-16a6d39c7b63", // DeviceManagementConfiguration.ReadWrite.All
  "7b3f05d5-f68c-4b8d-8c59-a2ecd12f24af", // DeviceManagementApps.ReadWrite.All
  "662ed50a-ac44-4eef-ad86-62eed9be2a29", // DeviceManagementServiceConfig.ReadWrite.All
  "8b9d79d0-ad75-4566-8619-f7500ecfcebe", // DeviceManagementScripts.ReadWrite.All
  "44642bfe-8385-4adc-8fc6-fe3cb2c375c3", // DeviceManagementManagedDevices.ReadWrite.All
  "3404d2bf-2b13-457e-a330-c24615765193", // DeviceManagementManagedDevices.PrivilegedOperations.All
  "0c5e8a55-87a6-4556-93ab-adc52c4d862d", // DeviceManagementRBAC.ReadWrite.All
  "4e46008b-f24c-477d-8fff-7bb4ec7aafe0", // Group.ReadWrite.All
] as const;

/** The manifest `requiredResourceAccess` property, ready to replace that block in the editor. */
export function requiredResourceAccessJson(mode: SessionMode): string {
  const scopeIds = mode === "admin" ? [...READ_SCOPE_IDS, ...WRITE_SCOPE_IDS] : [...READ_SCOPE_IDS];
  const value = JSON.stringify(
    [
      {
        resourceAppId: GRAPH_APP_ID,
        resourceAccess: scopeIds.map((id) => ({ id, type: "Scope" })),
      },
    ],
    null,
    "\t",
  );
  return `"requiredResourceAccess": ${value}`;
}
