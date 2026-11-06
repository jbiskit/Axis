# Graph probe findings

Checked with `axis-probe` against the contoso tenant, using Axis's own app-registration token.
Licence: DEVELOPERPACK_E5 (Entra P2, MDO, MDI, Intune). No Defender for Endpoint plan. One managed device.

Re-run any check with `target/debug/axis-probe` (`scopes`, `GET /beta/...`, `HUNT "<kql>"`, `REPORT get<Name> '<json>'`).
In Git Bash set `MSYS_NO_PATHCONV=1`, or `/beta/...` is rewritten into a Windows path.

## Authentication methods: ready, no new scopes

- `GET /beta/reports/authenticationMethods/userRegistrationDetails`: per user `isMfaRegistered`, `isMfaCapable`, `isPasswordlessCapable`, `isSsprRegistered`, `isAdmin`, `methodsRegistered[]`, `defaultMfaMethod`, `userType`. Paged with `$skiptoken`; `$top=999` works.
- `GET /beta/reports/authenticationMethods/usersRegisteredByMethod(includedUserTypes='all',includedUserRoles='all')`: counts per method token.
- `GET /beta/policies/authenticationMethodsPolicy`: `authenticationMethodConfigurations[]` with `id` and `state`, plus the registration campaign, system-preferred MFA and report-suspicious-activity settings.
- `.../authenticationMethodsPolicy/authenticationMethodConfigurations` cannot be listed (400 "Resource not found for segment"). `.../authenticationMethodConfigurations/{id}` (e.g. `Fido2`) works. The list comes from the policy's embedded array.
- `GET /beta/reports/authenticationMethods/userRegistrationDetails/{userId}` works for the inspector.
- Tenant today: 25 users, 7 MFA registered, 3 admins, all admins registered. SMS and voice are off.
- Labels: the method tokens (`microsoftAuthenticatorPush`, `softwareOneTimePasscode` …) have no Graph display names, so labels come from inference.

## Template profiles (deviceConfigurations)

- This tenant has no Windows custom OMA-URI, certificate, Wi-Fi or VPN profiles.
- What it has (26 total): 10 `macOSCustomConfiguration`, 5 `windowsUpdateForBusinessConfiguration`, 3 `macOSExtensionsConfiguration`, 1 `macOSTrustedRootCertificate`, 1 `windowsDomainJoinConfiguration`, plus macOS, iOS and Android one-offs.
- `macOSCustomConfiguration`: `payload` is a base64 plist (about 10 KB), plus `payloadName` and `payloadFileName`. To be readable, it has to be decoded and shown as XML.
- `macOSTrustedRootCertificate`: `trustedRootCertificate` is a base64 DER cert, plus `certFileName`. Subject, issuer and expiry need decoding.
- `windowsDomainJoinConfiguration`: `activeDirectoryDomainName`, `organizationalUnit`, `computerNameStaticPrefix`, `computerNameSuffixRandomCharCount`. All plain fields.
- Building the Windows OMA-URI editor first would serve nothing in this tenant. Decoding macOS payloads and certificates is the real gap here.

## Windows Update status and assignment failures

- Ring status: `GET /beta/deviceManagement/deviceConfigurations/{ringId}/deviceStatusOverview` gives counts, and `/deviceStatuses` gives per device. Both are zero today (no devices reporting).
- Intune reports are POST reads that return `Schema` plus `Values`. Call one without a filter to learn its columns:
  - `getWindowsUpdateAlertSummaryReport`: PolicyId, PolicyName, FeatureUpdateVersion, NumberOfDevicesWithErrors
  - `getWindowsUpdateAlertsPerPolicyPerDeviceReport` (`filter: PolicyId eq '…'`): DeviceName, UPN, AlertMessage(_loc), AlertMessageDescription(_loc)
  - `getWindowsQualityUpdateAlertSummaryReport`: expedite alerts
- Assignment failures already exist: `policy_health.rs` calls `getConfigurationPolicyNonComplianceSummaryReport` (error, conflict and non-compliant counts per policy) for the Environment report and the glance tiles. A Monitor page is new UI over `fetch_configuration_policy_health`; no new Graph calls.
- `_loc` columns are Intune's own localised labels. Use them before inferring labels.

## Roles and PIM: ready, no new scopes

- `GET /beta/roleManagement/directory/roleAssignments?$expand=principal(...)`: 9 assignments.
- `roleEligibilitySchedules` (1) and `roleAssignmentSchedules` (7) work, so PIM is visible (P2 is licensed).

## Not available with current scopes or licences

| Endpoint | Result |
|---|---|
| `identityProtection/riskyUsers`, `riskDetections` | 403, missing scope (`IdentityRiskyUser.Read.All`, `IdentityRiskEvent.Read.All`). P2 is licensed, so adding the scopes would work. |
| `security/incidents`, `security/alerts_v2` | 403, needs `SecurityIncident.Read.All` / `SecurityAlert.Read.All` |
| `security/identities/healthIssues` | 403, tenant not onboarded to Defender for Identity |
| `security/attackSimulation/simulations` | 200, no simulations |
| Hunting `DeviceInfo` | 400, table missing (no Defender for Endpoint). **The Defender Device inventory page needs a licence gate:** `WINDEFATP` / `MDE_*` service plan in `subscribedSkus`. |
