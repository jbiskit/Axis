# Graph coverage roadmap

What it would take to finish Axis's Graph coverage across Intune, Entra, Purview and Defender, plus the tenant-level pieces around them.

**How this was built.** Every endpoint below was called with `axis-probe` using Axis's own delegated token, against the test tenant (Microsoft 365 E5 developer licence, Entra P2, Defender for Office 365, Defender for Identity licensed but not onboarded, no Defender for Endpoint). Only status, row counts and field names were recorded. The "Probe" column is what actually came back, not what the docs say. Re-run any line with `axis-probe GET /beta/...`. The probe date was 2026-11-06.

Legend for **Probe**:
- **OK** returns data with today's scopes.
- **OK (0)** works, but the test tenant has no objects.
- **Scope** is 403 for a missing delegated scope.
- **Role** is 403 even with the scope (directory or portal role needed).
- **Licence** means not licensed or not onboarded.
- **Not Graph** means only via `adminapi` or the portal.

---

## Ground rules (from AGENTS.md and earlier decisions)

- Read-only reviews first, using the shared `ReviewWorkbench` pattern: filters, then a table with bulk actions, then an inspector only while a row is selected. Every Graph surface keeps the AGENTS.md inspector chrome: raw JSON, Refresh, and Delete where Graph allows it.
- Graph first. Use `adminapi` (Exchange / Security & Compliance) only where Graph has nothing, and only for app-registration sign-ins with fixed `Get-` cmdlets.
- New scopes go in `base_scopes` and `appRegistrationManifest.ts`. **Verify every permission GUID** (graphpermissions.merill.net or the service principal) before adding it; we were bitten by an unverifiable ID once.
- Gate licence-dependent pages on `subscribedSkus` service plans (`has_service_plan` in `review.rs`). Show "not licensed" instead of an error.
- Labels come from Graph `displayName` / `description` or Intune `_loc` report columns before anything is inferred.

---

## Where coverage stands

| Module | Already in Axis |
|---|---|
| Intune | Devices, apps (Win32, store, catalog), Settings Catalog, ADMX, compliance, endpoint security, scripts and remediations, Autopilot, enrollment (ESP, limits, restrictions, domain join), Windows Update rings and feature/quality/driver profiles, policy sets, app protection, scope tags (bulk), LAPS, tenant health (APNs, DEP and VPP expiry), environment report, policy health counts, Intune audit events |
| Entra | Conditional Access policies, named locations, CA coverage, auth methods user registration and methods policy, groups (create, membership) |
| Purview | Sensitivity labels via S&C `Get-Label` (blocked until the Purview role group is added), retention labels |
| Defender | Defender for Office 365 / EOP policies (11 kinds via Exchange), Secure Score, endpoint security policies (console vs Intune), device inventory via hunting (licence-gated) |

Nav items still marked *planned*: Security tasks, Conditional access (Intune), Assignment failures, Microsoft Defender for Endpoint, Update deployment status.

---

## Catalogue by module

Effort: **S** is one review kind and a page; **M** adds joins, decoding or a summary; **L** needs a new pattern or paging/filtering work.

### Intune

| Feature | Endpoint (beta) | Probe | Effort | Notes |
|---|---|---|---|---|
| App configuration policies | `deviceAppManagement/mobileAppConfigurations`, `targetedManagedAppConfigurations` | OK / OK (0) | S | `payloadJson` (base64) needs decoding in the inspector |
| Intune RBAC roles and assignments | `deviceManagement/roleDefinitions`, `roleAssignments` | OK | M | Join members/scope groups to names (`resolve_review_names`) |
| Assignment filters review | `deviceManagement/assignmentFilters` | OK | S | `rule` text plus `platform`; show where each is used later |
| Notification message templates | `notificationMessageTemplates` | OK | S | Localised messages via `$expand=localizedNotificationMessages` (check) |
| Company Portal branding | `intuneBrandingProfiles` | OK | S | Singleton-ish; sections view |
| Device categories, terms and conditions | `deviceCategories`, `termsAndConditions` | OK (0) | S | Cheap; group into "Tenant admin" |
| Partners and connectors | `mobileThreatDefenseConnectors`, `deviceManagementPartners`, `remoteAssistancePartners`, `ndesConnectors` | OK | S | One "Connectors" page with heartbeat/state; expiry is already in tenant health |
| Android Enterprise enrollment profiles | `androidDeviceOwnerEnrollmentProfiles`, `androidForWorkSettings` | OK | S | Token expiry and usage counts; strip `qrCodeImage` from the table |
| Apple user-initiated enrollment profiles | `appleUserInitiatedEnrollmentProfiles` | OK | S | |
| Encryption report | `managedDeviceEncryptionStates` | OK | S | BitLocker / FileVault readiness per device |
| Malware detections | `windowsMalwareInformation` | OK | S | Severity and last detection |
| Discovered apps | `detectedApps` | OK | M | Paged; device counts; drill to devices via `$expand=managedDevices` (check) |
| Assignment failures (planned) | `reports/getConfigurationPolicyNonComplianceSummaryReport` | OK | S | **Data already fetched** by `policy_health.rs`; needs a page |
| Update deployment status (planned) | `reports/getWindowsUpdateAlertSummaryReport`, `getWindowsUpdateAlertsPerPolicyPerDevice` | OK | M | `_loc` columns give official labels |
| Template profile payloads | `deviceConfigurations` (macOS custom, trusted cert) | OK | M | Decode the plist and DER cert in the inspector (subject, issuer, expiry) |
| Windows 365 Cloud PCs | `virtualEndpoint/cloudPCs`, `provisioningPolicies` | Scope / Licence | M | Needs `CloudPC.Read.All`, and only if licensed |
| Windows Update deployment service | `admin/windows/updates/deployments` | Scope | M | Needs `WindowsUpdates.ReadWrite.All` (no read-only scope; check) |
| Endpoint analytics | `userExperienceAnalytics*` | OK (0) | M | Overview segment doesn't exist in beta; use the per-metric collections |

### Entra

| Feature | Endpoint (beta) | Probe | Effort | Notes |
|---|---|---|---|---|
| Authentication strengths | `identity/conditionalAccess/authenticationStrength/policies` | OK | S | **Rejects `$top`** |
| CA templates vs policies | `identity/conditionalAccess/templates` | OK | M | Show which Microsoft templates have no matching policy. **Rejects `$top`** |
| Tenant security settings | `policies/authorizationPolicy`, `identitySecurityDefaultsEnforcementPolicy`, `crossTenantAccessPolicy` (+`/partners`), `deviceRegistrationPolicy`, `adminConsentRequestPolicy`, `authenticationFlowsPolicy`, `externalIdentitiesPolicy` | OK | M | Singletons: needs the **singleton review** pattern (see cross-cutting) |
| Privileged access | `roleManagement/directory/roleAssignments`, `roleEligibilitySchedules`, `roleAssignmentSchedules`, `policies/roleManagementPolicies`, custom `roleDefinitions` | OK | M | Permanent vs eligible, custom roles, PIM activation rules |
| App credential expiry | `applications?$select=passwordCredentials,keyCredentials` | OK | S | Secrets and certs expiring or expired; high value |
| Enterprise apps / service principals | `servicePrincipals` | OK | S | First-party vs third-party, disabled |
| Delegated consent grants | `oauth2PermissionGrants` | Scope | S | Needs `DelegatedPermissionGrant.Read.All`; consent-risk review |
| Stale and guest users | `users?$select=signInActivity,userType,accountEnabled` | OK | M | `signInActivity` needs P1 (present); page through all users |
| Stale Entra devices | `devices?$select=approximateLastSignInDateTime,trustType,isCompliant` | OK | S | Pairs with Intune device inventory |
| Sign-ins (CA results) | `auditLogs/signIns` | OK | L | Needs date-range and server filters; 500-row cap |
| Directory audits | `auditLogs/directoryAudits` | OK | L | Same; complements Axis's own write log |
| Domains | `domains` | OK | S | Verification, default, federation |
| Administrative units | `directory/administrativeUnits` | Scope | S | `AdministrativeUnit.Read.All` |
| Identity Protection | `identityProtection/riskyUsers`, `riskDetections` | Scope | M | P2 is licensed; needs `IdentityRiskyUser.Read.All`, `IdentityRiskEvent.Read.All` |
| Access reviews / entitlement / lifecycle | `identityGovernance/*` | Scope | M | `AccessReview.Read.All`, `EntitlementManagement.Read.All`, `LifecycleWorkflows.Read.All` |
| Terms of use | `identityGovernance/termsOfUse/agreements` | Scope | S | `Agreement.Read.All` |

### Purview

| Feature | Endpoint | Probe | Effort | Notes |
|---|---|---|---|---|
| Sensitivity labels (all) | S&C `Get-Label` | Role | done | Waiting on a Purview role group (Information Protection Readers) |
| Label publishing policies | S&C `Get-LabelPolicy` | Not Graph | S | Same token and pattern as `Get-Label` |
| Auto-labelling policies | S&C `Get-AutoSensitivityLabelPolicy` / `Rule` | Not Graph | S | |
| DLP policies and rules | S&C `Get-DlpCompliancePolicy` / `Get-DlpComplianceRule` | Not Graph | M | Was the top Purview priority; needs Compliance Administrator or DLP role |
| Retention policies | S&C `Get-RetentionCompliancePolicy` / `Rule` | Not Graph | M | Retention *labels* are already done via Graph |
| File plan descriptors | `security/labels/categories`, `departments`, `filePlanReferences` | OK | S | Enriches the retention label inspector |
| eDiscovery cases | `security/cases/ediscoveryCases` | Scope | S | `eDiscovery.Read.All` |
| Subject rights requests | `privacy/subjectRightsRequests` | Licence | n/a | Service not provisioned |
| Org-wide labels (Graph) | `security/informationProtection/sensitivityLabels` | n/a | n/a | Application-only; superseded by `Get-Label` |

### Defender

| Feature | Endpoint | Probe | Effort | Notes |
|---|---|---|---|---|
| Incidents and alerts | `security/incidents`, `security/alerts_v2` | Scope | M | `SecurityIncident.Read.All`, `SecurityAlert.Read.All`; owner rated this low priority |
| Attack simulation | `security/attackSimulation/simulations`, `trainings` | OK (0) / OK | S | Useful only once simulations run |
| Defender for Identity health | `security/identities/healthIssues`, `sensors` | Licence | S | Tenant not onboarded |
| Threat intelligence | `security/threatIntelligence/*` | Licence | n/a | Needs a Defender TI licence |
| Advanced features, Unified RBAC | portal `apiproxy` only | Not Graph | n/a | No supported API |
| Exchange mail flow | Exchange `Get-TransportRule`, `Get-InboundConnector`, `Get-OutboundConnector`, `Get-RemoteDomain` | Not Graph | S | Same Exchange token as Defender for Office 365 |
| Purview audit search | `security/auditLog/queries` | Role | M | Needs an audit role in Purview |

### Tenant / M365 admin

| Feature | Endpoint | Probe | Effort | Notes |
|---|---|---|---|---|
| Licences and subscriptions | `subscribedSkus`, `directory/subscriptions` | OK | S | Seat use, trial and renewal dates; licence gating already uses SKUs |
| Service health and message centre | `admin/serviceAnnouncement/*` | Scope | S | `ServiceHealth.Read.All`, `ServiceMessage.Read.All` |
| Usage reports | `reports/getOffice365ActiveUserCounts` etc. | Scope | M | `Reports.Read.All` |
| SharePoint / M365 Apps / Teams settings | `admin/sharepoint/settings`, `admin/microsoft365Apps/*`, `teamwork/*` | Scope | S | One scope each; low priority |

---

## Graph quirks found by the probes

- `$top` is rejected (400) by `authenticationStrength/policies`, `conditionalAccess/templates` and `security/labels/retentionLabels`. Don't add it to those paths.
- `authenticationMethodsPolicy/authenticationMethodConfigurations` can't be listed; read the policy and use its embedded array.
- `userExperienceAnalyticsOverview` doesn't exist in beta; `windowsAutopatchDeploymentAudiences` and `deviceManagement/cloudPCs` are the wrong segments (use `virtualEndpoint/cloudPCs`).
- `exchangeConnectors` returns 501.
- The label API rejects requests without a `User-Agent` (fixed in `GraphClient`).
- Hunting `DeviceInfo` doesn't exist without Defender for Endpoint (now licence-gated).
- S&C redirects to `:446`; use 443 (fixed in `exchange_admin.rs`).
- Some 403s are role checks, not scopes: Purview audit, S&C cmdlets, admin units, consent grants.

---

## Cross-cutting work (do these first; most features depend on one)

1. **Singleton review pattern.** `ReviewWorkbench` assumes a collection. Tenant policies (authorization policy, security defaults, cross-tenant, device registration, admin consent) are single objects. Add a small "settings sheet" view built from `ReviewSections`, with Raw JSON and Refresh. One component serves about 8 Entra items and Company Portal branding. **M**
2. **Missing-scope and licence messages.** Parse Graph 403 bodies ("required scopes: X", "not onboarded", "valid license") into one notice: what's missing, and how to consent or license. Reuse `has_service_plan` for per-kind licence gates. **S**
3. **Server-side filtering and date ranges** for log-style data (sign-ins, directory audits, discovered apps). The 500-row cap is wrong for these. Add a date-range control and `$filter` passthrough per kind, with paging. **L**
4. **Name resolution** for principals in role assignments, PIM, Intune RBAC and app owners: extend `resolve_review_names` with service principals and directory roles. **S**
5. **Scope batches with verified GUIDs.** Group new scopes into a few consent batches (below) and verify each permission ID before it ships.
6. **Probe first.** Add each feature's endpoints to `docs/graph-probe-findings.md` before building, as done for auth methods.

## Suggested order

**Phase 1: works today, no new scopes**

1. Assignment failures page (data exists) and Update deployment status. Both fill planned nav slots.
2. Entra app credential expiry, then privileged access (assignments, PIM eligibility, role policies, custom roles).
3. Singleton review pattern, then tenant security settings (authorization, security defaults, cross-tenant, device registration, admin consent), authentication strengths, and CA templates gap.
4. Intune RBAC and the connectors page, then app configuration policies, assignment filters, notification templates, branding, Android/Apple enrollment profiles.
5. Encryption report, malware detections, stale Entra devices, stale and guest users.
6. Template profile payload decoding (macOS plist, trusted certificate).

**Phase 2: one admin-consent batch.** Each scope is read-only:

| Batch | Scopes | Unlocks |
|---|---|---|
| Identity | `IdentityRiskyUser.Read.All`, `IdentityRiskEvent.Read.All`, `AdministrativeUnit.Read.All`, `DelegatedPermissionGrant.Read.All`, `Agreement.Read.All` | Identity Protection, admin units, consent grants, terms of use |
| Governance | `AccessReview.Read.All`, `EntitlementManagement.Read.All`, `LifecycleWorkflows.Read.All` | Governance reviews (licence permitting) |
| Security ops | `SecurityIncident.Read.All`, `SecurityAlert.Read.All`, `eDiscovery.Read.All` | Incidents/alerts, eDiscovery cases |
| Tenant | `ServiceHealth.Read.All`, `ServiceMessage.Read.All`, `Reports.Read.All` | Service health, message centre, usage |

Sign-ins and directory audits (cross-cutting item 3) also land here.

**Phase 3: outside Graph, same adminapi pattern**

- Security & Compliance, once the Purview role group is in place: label policies, auto-labelling, **DLP policies and rules**, retention policies.
- Exchange: transport rules, connectors, remote domains.

**Phase 4: writes.** Kept for later per the read-only-first direction. Intune writes already exist; Entra and Purview writes would follow the same `ensure_write_allowed` and write-log path.

## Open questions for the owner

- Phase 2 needs tenant admin consent for about 14 new scopes. Ship them all in `base_scopes` (the current rule), or let some modules ask for them on first use?
- Sign-ins and audits are high-volume. Is a date-bounded viewer in Axis worth it, or should Axis only summarise (failed CA, risky sign-ins) and link to the portal?
- Defender for Endpoint, Windows 365 and Defender TI aren't in the test tenant, so those pages can only be built against documentation. Wait for a licensed tenant to probe, or build them behind licence gates?
