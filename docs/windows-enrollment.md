# Windows enrolment (Axis)

Windows-first reference for how devices join Intune, what Intune objects are involved, and how Axis / packs treat each piece today.

Graph and portal APIs use US spelling (`enrollment`). Axis UI labels mix **Enrollment** (nav) and **Enrolment** (packs). This doc uses **enrolment** for product language and Graph path names where precision matters.

---

## 1. What “enrolment” covers

Enrolment is everything required to bring a Windows device under Intune management **before** (and during) the first user session settles — identity, profiles, status UX, and related tenant connectors.

It is **not** the same as:

| Area | Role |
| --- | --- |
| Settings Catalog / policies | Configuration after the device is managed |
| Compliance | Post-enrolment posture |
| Apps / scripts | Often assigned during Autopilot ESP, but authored as apps/scripts |
| Endpoint security | Separate policy family |

A **pack kit** that aims at “basic configuration” will often **include** enrolment objects plus policies, groups, and apps. Enrolment objects are the onboarding path; the rest is the payload that ESP and Autopilot wait on.

---

## 2. Windows enrolment journeys

### 2.1 User-driven (Company Portal / Add work or school account)

1. User signs in with a work account on an existing Windows device (or installs Company Portal).
2. Device registers with Entra ID and enrols into Intune MDM.
3. Intune applies assigned policies, apps, and scripts.
4. No Autopilot hardware hash is required.

**Typical Intune objects**

- Enrolment restrictions (`deviceEnrollmentConfigurations`)
- Optional Windows Hello for Business enrolment config
- Company Portal branding / terms (tenant-level; not pack-exported today)

### 2.2 Windows Autopilot — user-driven

1. Device hardware identity is registered in Autopilot (OEM, partner, or CSV).
2. Device boots OOBE → contacts Autopilot service → receives deployment profile.
3. User authenticates (Entra join or Hybrid Azure AD Join, depending on profile).
4. **Enrollment Status Page (ESP)** can block until device/user apps and policies reach required state.
5. Desktop is released when ESP (and profile settings) allow.

**Typical Intune objects**

- Autopilot **deployment profiles**
- Autopilot **devices** (hardware identities + group tags)
- ESP profile(s) under `deviceEnrollmentConfigurations`
- Dynamic / assigned Entra groups (often keyed by group tag)
- Apps and policies assigned to those groups (consumed during ESP)

### 2.3 Windows Autopilot — pre-provisioning (white glove)

Technician-driven pre-provisioning before the end user. Same Autopilot profile family with white-glove / pre-provision settings on the profile and ESP. Axis does not special-case white glove today; it appears only as fields on the Graph Autopilot profile object.

### 2.4 Hybrid Azure AD Join / ODJ

Hybrid join Autopilot profiles rely on **domain join** configuration (offline domain join / Intune Connector for Active Directory). Axis does not have a first-class ODJ connector UI; connector health may appear only in environment-report extras or portal. Pack apply does not create connectors.

---

## 3. Building blocks (Windows)

### 3.1 Autopilot devices

| | |
| --- | --- |
| **Graph** | `GET /deviceManagement/windowsAutopilotDeviceIdentities` |
| **Axis kind** | `autopilotDevice` |
| **Contains** | Serial / hardware hash metadata, group tag, assigned profile status, enrolment state |
| **Axis UI** | `/intune/enrollment/windows/autopilot/devices` — list + inspect |
| **Writes today** | No group-tag update, no profile assignment write |
| **Duplicate** | No |
| **Pack export** | No (device inventory, not a reusable pack artifact) |
| **Kit apply** | N/A |

Devices are **tenant inventory**, not something a kit should recreate by default. Kits care about **profiles**, ESP, and group tags as a *process*; device registration stays operational.

### 3.2 Autopilot deployment profiles

| | |
| --- | --- |
| **Graph** | `/deviceManagement/windowsAutopilotDeploymentProfiles` |
| **Axis kind** | `autopilotProfile` |
| **Contains** | Join type, OOBE settings, language, white glove / pre-provision flags, out-of-box experience options |
| **Axis UI** | `/intune/enrollment/windows/autopilot/profiles` — list + inspect |
| **Writes today** | Duplicate yes; create/edit UI and assignment drafts **not** ported. Overview surfaces join type, OOBE, pre-provisioning, language, hardware hash, and any profile-embedded ESP settings (read-only). |
| **Pack export** | Yes → `windows/enrollment/autopilot/{name}.json` (`axisExport.kind`: `enrollment-autopilot`) |
| **Kit apply** | Not supported yet (listed as unsupported) |

### 3.3 Device enrolment configurations (ESP, restrictions, WHfB, …)

| | |
| --- | --- |
| **Graph** | `/deviceManagement/deviceEnrollmentConfigurations` |
| **Axis kind** | `enrollmentConfiguration` |
| **Contains** | Discriminated `@odata.type` values, including Enrollment Status Page, Windows enrolment restrictions, Windows Hello for Business enrolment, and other platform configs Graph returns on the same collection |
| **Axis UI** | `/intune/enrollment/windows` — list + inspect |
| **Writes today** | Duplicate yes; ESP / profile **authoring not ported** (object, assignments, JSON only) |
| **Pack export** | **Not** exported today |
| **Kit apply** | Not supported yet |

ESP is the critical Autopilot UX: which device/user apps and policies must install before the desktop, blocking behaviour, timeouts, and custom error options. Restrictions gate who can enrol which platforms/ownership types. WHfB enrolment config influences Hello provisioning during join.

### 3.4 Groups, filters, and assignments

Enrolment objects are usually assigned to Entra groups (often Autopilot-generated or dynamic by group tag).

| Capability in Axis | Enrolment / Autopilot |
| --- | --- |
| Read assignments | Yes (inspector) |
| Write assignments | Yes for enrollment restrictions (users & groups; no All devices) and device limits (groups only) |
| Create groups from pack | Not yet (future kit surface) |

A complete “basic enrolment” kit will eventually need **group definitions / queries** alongside ESP and Autopilot profiles — that sits next to enrolment, not only under `windows/enrollment/`.

### 3.5 Tenant enrolment extras (report / portal)

Environment report (full enrolment selection) also loads tenant-level connectors and settings (Apple APNs/ADE, Android enterprise, Company Portal branding, terms, device categories, Autopilot device summary). Most of these are **not Windows-pack artifacts**; they are tenant context for reports.

---

## 4. Recommended process order (Windows Autopilot kit)

When designing a kit such as “Basic configuration” or “Hardened device”, enrolment usually comes **first** in the story (even if Graph create order can vary):

1. **Entra groups** — dynamic Autopilot group / static pilot group (group tag strategy).
2. **Autopilot deployment profile** — join type + OOBE.
3. **ESP** — block until required apps/policies.
4. **Enrolment restrictions** — optional hardening of who can enrol.
5. **Windows Hello for Business** enrolment config — if used.
6. **Assignments** — profile + ESP → groups.
7. **Downstream kit members** — Settings Catalog, compliance, apps, scripts that ESP will wait on.

Axis does **not** automate that order today. Packs can **hold** Autopilot profile JSON; kits can **select** paths; apply only pushes catalog + scripts.

---

## 5. Axis surfaces (current)

### 5.1 Console

| Route | Purpose |
| --- | --- |
| `/intune/enrollment/windows/autopilot/devices` | Autopilot device identities |
| `/intune/enrollment/windows/autopilot/profiles` | Autopilot deployment profiles |
| `/intune/enrollment/windows/esp` | Enrollment Status Page configs |
| `/intune/enrollment/windows/windows-hello` | Windows Hello for Business enrolment configs |
| `/intune/enrollment/restrictions/platform` | Device platform restrictions (tenant-wide) |
| `/intune/enrollment/restrictions/limit` | Device limit restrictions (tenant-wide) |
| `/intune/reports` | Environment report — Enrolment chapter |
| `/intune/packs` | Pack library — **Enrolment** category in the include tree |

Nav is **platform-driven** under Enrollment (Windows first; macOS / iOS / Android planned). **Restrictions** sit outside platforms because platform and device-limit rules are tenant-wide.

Auth: enrolment / Autopilot listing typically needs `DeviceManagementServiceConfig.Read` / `ReadWrite` (see Axis auth scopes).

### 5.1.1 Graph list queries

Enrollment config blades call:

`GET /beta/deviceManagement/deviceEnrollmentConfigurations?$expand=assignments&$orderby=priority&$filter=…`

| Blade | `$filter` |
| --- | --- |
| Device platform restrictions | `deviceEnrollmentConfigurationType eq 'SinglePlatformRestriction'` |
| Device limit restrictions | `deviceEnrollmentConfigurationType eq 'Limit' or … eq 'DefaultLimit'` |
| Enrollment Status Page | `… eq 'Windows10EnrollmentCompletionPageConfiguration' or … eq 'DefaultWindows10EnrollmentCompletionPageConfiguration'` |
| Windows Hello for Business | `… eq 'WindowsHelloForBusiness' or … eq 'DefaultWindowsHelloForBusiness'` |

Platform restrictions use the Intune portal filter. That returns both the default multi-platform row (`deviceEnrollmentPlatformRestrictionsConfiguration`) and per-platform rows (`deviceEnrollmentPlatformRestrictionConfiguration` with `platformType`).

**Filter casing:** the `$filter` value is PascalCase (`SinglePlatformRestriction`), even though the property on each object is camelCase (`"deviceEnrollmentConfigurationType": "singlePlatformRestriction"`).

Example shapes under that filter:

| `@odata.type` | Role | Key fields |
| --- | --- | --- |
| `…PlatformRestrictionsConfiguration` (plural) | Default, usually priority `0` | Per-OS blobs: `windowsRestriction`, `iosRestriction`, … |
| `…PlatformRestrictionConfiguration` (singular) | Per-platform override | `platformType` + `platformRestriction` |

### 5.1.2 Device limit restrictions

List filter: `Limit` or `DefaultLimit`.

| `@odata.type` | Role | Key field |
| --- | --- | --- |
| `…deviceEnrollmentLimitConfiguration` | Default (`DefaultLimit`) or custom (`limit`) | `limit` (1–15 devices per user) |

Create: `POST …/deviceEnrollmentConfigurations` with `@odata.type` `#microsoft.graph.deviceEnrollmentLimitConfiguration`, `deviceEnrollmentConfigurationType: "limit"`, and `limit`.

Update: `PATCH …/deviceEnrollmentConfigurations/{id}` with `@odata.type` + `limit`.

Assignments are group-scoped only (include/exclude Entra groups). Do not use All users or All devices.

### 5.1.3 Graph detail query

Inspector loads:

`GET /beta/deviceManagement/deviceEnrollmentConfigurations/{id}?$expand=assignments`

On the default multi-platform object, detail may report `deviceEnrollmentConfigurationType: "platformRestrictions"` even when the list filter used `SinglePlatformRestriction`. Axis shows per-platform Allow/Block rows from the `*Restriction` blobs (or `platformType` + `platformRestriction` for single-platform rows).

### 5.1.4 Update (PATCH)

`PATCH /beta/deviceManagement/deviceEnrollmentConfigurations/{id}`

Body includes `@odata.type` plus either the multi-platform `*Restriction` properties or `platformRestriction` (+ optional `platformType`). Axis Overview edits MDM / personally owned Allow|Block, OS min/max, and blocked manufacturer/SKU lists for **portal platforms** (Android DA, Android Enterprise, iOS/iPadOS, macOS, Windows, visionOS, tvOS). Graph also returns `windowsHomeSkuRestriction`, `windowsMobileRestriction`, and legacy `macRestriction` on the default object — Axis tucks those under **Additional Graph platforms** so saves do not drop them. Windows Home blocking in the portal is usually done with assignment filters on `operatingSystemSKU`, not a separate platform row.

### 5.2 Pack layout (Windows)

```text
windows/
  enrollment/
    autopilot/          # Autopilot deployment profiles (exported today)
    esp/                # ESP profiles (planned pack home; not exported yet)
    restrictions/       # Enrolment restrictions (planned)
    windows-hello/      # WHfB enrolment configs (planned)
```

**Today**

- Template ships `windows/enrollment/autopilot/.gitkeep`.
- Tenant pack export writes Autopilot profiles only under `windows/enrollment/autopilot/`.
- Kit apply skips anything under `/enrollment/` or `/autopilot/` with an explicit unsupported reason.

**Artifact kind (exported)**

```json
"axisExport": {
  "kind": "enrollment-autopilot"
}
```

### 5.3 Capability matrix (Windows enrolment)

| Object | List | Inspect | Duplicate | Assign write | Pack export | Kit apply |
| --- | --- | --- | --- | --- | --- | --- |
| Autopilot device | Yes | Yes | No | No | No | — |
| Autopilot profile | Yes | Yes | Yes | No | Yes | No |
| ESP / enrolment config | Yes | Yes | Yes | No | No | No |
| Groups (for Autopilot) | Via assignments / Entra | — | Create group exists elsewhere | — | Not as enrolment files | No |

---

## 6. Gaps (Windows-first backlog)

Ordered for pack / kit usefulness:

1. **Export ESP + other `deviceEnrollmentConfigurations`** into typed folders under `windows/enrollment/`.
2. **Kit apply** for Autopilot profiles + ESP (create/update in place, same identity rules as catalog: id then name, then content compare).
3. **Assignment apply** for enrolment objects (or documented manual step until group packs exist).
4. **Group tag / dynamic group** artifacts in the pack (shared with other kit categories).
5. Authoring UX for ESP / Autopilot (beyond duplicate + raw JSON).
6. ODJ / connector status as first-class health (optional; often portal-owned).

---

## 7. Related code

| Area | Path |
| --- | --- |
| Nav | `crates/axis-tauri/ui/src/lib/nav.ts` |
| UI routes | `crates/axis-tauri/ui/src/components/IntuneWorkspace.tsx` |
| Inventory | `crates/axis-sdk/src/inventory.rs` |
| Detail / duplicate | `crates/axis-sdk/src/object_detail.rs`, `object_duplicate.rs` |
| Pack export | `crates/axis-sdk/src/pack_export.rs` (`ExportJob::Autopilot`) |
| Kit apply skip | `crates/axis-sdk/src/pack_restore.rs` |
| Pack category | `crates/axis-sdk/src/pack_kits.rs` |
| Environment report | `crates/axis-sdk/src/environment_report.rs` |
| Template stub | `pack-template/windows/enrollment/autopilot/` |

---

## 8. Short glossary

| Term | Meaning |
| --- | --- |
| **OOBE** | Out-of-box experience — first boot setup |
| **ESP** | Enrollment Status Page — progress/blocking UI during Autopilot |
| **Group tag** | String on Autopilot device used for dynamic group membership / targeting |
| **White glove / pre-provision** | Technician pre-enrolment before end-user sign-in |
| **ODJ** | Offline domain join — Hybrid join path via Intune Connector |
| **Kit** | Named selection of pack paths applied as a posture |
| **Pack** | Shared library of artefacts on disk or GitHub |
