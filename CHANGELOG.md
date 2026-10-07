# Changelog

Notable user-facing changes to Axis are recorded here.

## [Unreleased]

### Changed

- Sign-in opens the system browser and returns to `http://localhost`. Device-code sign-in is gone. Microsoft Graph and a customer app registration both still work, and the refresh token stays in Credential Manager.
- The sign-in screen lists each app that already has a saved credential, grouped by tenant. Each group is named with the organization and its default domain. A tenant can keep a read-only registration and a read-and-write registration side by side. Sign out keeps the saved credentials.
- Swapping context on an app registration switches to the other saved registration for that tenant. If that registration is not saved, Axis says so and offers Microsoft Graph sign-in or a new registration for the other access mode. Microsoft Graph still requests the new scopes.
- Environment report setup is a short sequence: who the report is for, which chapters, platforms, and areas to include, then generate. An area is either everything in that area or a list you choose.
- An Apps section in the environment report draws the dependency and supersedence graph for the apps in that section. Each app card lists what it requires, which apps it is a dependency for, and any supersedence. Markdown includes the same lines and a Mermaid diagram. Those labels include the app version.
- The dependency viewer shows each app's version on the graph node and in the relationship lines.
- A live tenant app can supersede another Win32 app, or be superseded by one. Uninstall previous turns the link into a replace. Update leaves the older app in place.
- A new local catalog app gets two PowerShell detection scripts. `detection.ps1` checks the uninstall registry for the app name and a version greater than or equal to the catalog version. `detection-name.ps1` checks the name only. Copying a version updates `$version` in `detection.ps1`.
- Checked local catalog versions can be deleted. Axis removes those package folders, removes an empty vendor or application folder left behind, and drops dependency links that pointed at them. Intune is left unchanged.
- A new client container is created as a subfolder named for that client. Snapshots and local applications are stored in that subfolder. The folder you pick stays the parent.
- The local app catalog lists the Global Folder and the open tenant catalog together. New tenant app and New global app sit on those panes. Copies and deletes stay in the catalog the application belongs to.
- Get Started is a nav heading for wizards and starter kits. The Autopilot wizard lives there. It creates the deployment profile, the group assignment, and, for Hybrid, the domain join profile. The Intune Connector for Active Directory stays an advisory to finish on a server.
- Get Started includes a Readiness check for automatic enrollment, CNAME validation, and device platform restrictions. A user check tests the Some groups for automatic enrollment, the device limit that applies, and an Intune license. Results are summary cards, group chips, and short tables.
- Get Started assigns include and exclude groups the same way other objects do. A new dynamic device group can still take an optional Order ID, and the membership rule then also requires `[OrderID]:` to match that value.
- Autopilot profile create checks the name before calling Graph. Intune rejects characters such as a hyphen with an empty DeviceEnrollmentFE 400. Invalid profile names and device name templates are marked on the field.
- Get Started creates an Enrollment Status Page and assigns the same include and exclude groups as the Autopilot deployment profile.

### Fixed

- Contents links in an environment report preview stay inside the document. Following one no longer replaces the preview or leaves the report page.
- The Enrollment Status Page list loads without a type filter. Graph rewrites that filter into an enum literal the Intune onboarding service rejects.
- A readiness user check counts enrolled devices by user principal name. Filtering managed devices by user id is rejected by Intune.
- A readiness user check fails when a device platform restriction that applies to that user blocks MDM enrollment. A higher-priority block wins over the default allow.
- A readiness user check opens with a result: whether that user can enroll, and which checks decided it.
- Creating an Enrollment Status Page keeps block device setup retry off. The portal create that succeeds uses that value, and turning it on is rejected by the onboarding service.
- Enrollment Status Page assignment keeps include groups. Exclude groups are left off that assignment.
- An Enrollment Status Page can block on all assigned apps or on apps you select. The app list uses the Intune portal filter, and Win32 apps show their display version.
- Hybrid Autopilot deployment profiles leave out the device name template and Self-deploying mode. The computer name is set on the domain join profile, and the deployment mode stays user-driven.
- The Hybrid domain join profile asks for a computer name prefix. The rest of the 15-character name is random, matching the Intune portal.

## [0.1.7] - 2026-10-02

### Added

- **Local catalog** for Win32 packages, arranged as vendor / application / version. Create an app with type-ahead from existing vendors and names, edit the Intune package config, and preview the description as Markdown.
- Catalog status is a faint wash: amber when only the source is present, green when the package is ready, and red when required Intune fields are missing. Empty controls in that section are marked the same way.
- Upload a `.intunewin` to a new app, replace content on a match, or overwrite the app. A dependency chain uploads from the end and can be marked so Intune installs each dependency first.
- **Tasks** in the title bar shows upload progress from any page. A dependency chain is one job, with a percent for the whole chain and for each package.
- Tenant **Apps** lists by platform and type, with a Win32 editor (identity, install and uninstall, requirements, detection) and Store / WinGet create and edit, including icons.
- **Dependencies** on a tenant app: add or remove a Win32 dependency, choose whether Intune installs it automatically, and open a graph of the chain. Names include the app version. Deleting a linked app states which dependency or supersedence link will be removed and clears it first.
- Autopilot deployment profiles list **Assigned devices**, with search, filters, and bulk group tag.
- Compare & restore can also write the snapshot’s assignments back onto accepted objects.

### Changed

- App settings stay on Overview. Dependencies is a pane with the other app settings, and apps no longer have a separate Settings tab.
- **Policy Packs** and **Local catalog** live under Library. Windows Store opens the Store app list. Upload progress is the title-bar Tasks control.
- On/off choices use the pill toggle, including automatic update checks and remediation assignment options. Assignment filters are omitted for objects that do not support them.

### Fixed

- Uploading a chain where A depends on B and B depends on C marks both links. The deeper link is written first, and the reverse copy of a link is not written back.
- WinGet apps stay on the Store list. They no longer appear in the Win32 tenant list.
- The delete confirmation names the dependency in the correct direction: the app being deleted is a dependency for the app that requires it.
## [0.1.6] - 2026-09-24

### Added

- **Enrollment** navigation and Windows enrolment work: platform restrictions and device limits (create, edit, assignments), plus Autopilot **Devices** (search/filters, bulk group tag, delete, Sync with 10-minute cooldown) and **Deployment profiles** (structured Overview, create/edit with locked join/mode/device type, Language (Region) search).
- **Packs & kits** workspace to open local packs, manage kits, and apply kit selections.
- **Client containers / workspaces**: scoped client work with snapshots, restore, and pack diff against a snapshot.
- Sign-in modes that support **read-only** Graph scopes alongside write sessions.
- Endpoint Security: Graph template **Create** picker by blade family, **Profile** column on lists, and clearer defaults in settings editors.
- Workspace **Write activity** (Intune audit timeline) and a selectable platform-first **Environment report** (HTML + Markdown), including broader enrollment coverage.
- Templates / Baselines: bulk **Import to Intune**, **Combine and merge** for Settings Catalog exports, collapsible pack panels, and native **Add local folder**.

### Changed

- **Baselines** keep built-in ASD hard baselines; local/GitHub packs live under **Templates**.
- Settings Catalog and Endpoint Security editors: boolean toggles, monospace editors for large/XML payloads, and inspector drafts that survive tab switches (leave prompts when discarding).
- Overview recent activity uses the Intune audit log.
- Linux-oriented release/dev packaging support.

### Fixed

- Endpoint Security Create no longer lists duplicate Graph template versions; required choice dependents are sent correctly on save.
- Double-click to re-edit values on template-backed Endpoint Security policies.
- Templates/Baselines inspect and scroll layout fixes for pack panels and local folder add.
## [0.1.5] - 2026-09-02

### Added

- Custom packs from a local folder or GitHub repo. Layout is platform-first (`windows/` in the public template for now) with policies, scripts, compliance, Endpoint Security, Windows Update, and Autopilot under each OS.
- Pack `baselines/` JSON that **selects** pack files (`includes`) instead of duplicating policies. Device compare expands catalog paths from that list.
- Two Windows samples in the pack template from [OpenIntuneBaseline](https://github.com/SkipToTheEndpoint/OpenIntuneBaseline) (BitLocker catalog policy and Auto Timezone script; GPL-3.0).
- Public pack template at [jbiskit/axis-pack-template](https://github.com/jbiskit/axis-pack-template).
- Tenant pack export from **Baselines → Export tenant pack** (Save As a folder): writes Settings Catalog, scripts, compliance, Endpoint Security, Group Policy, Windows Update, and Autopilot into the pack folder layout, plus baseline JSON that selects those files for later import and device compare.
- Save As on inspector Export (Graph JSON to a file), and bulk export of checked list rows (one Save As JSON, or a folder of JSON files).
- Settings Catalog **Import** from the tenant list: Open one or more JSON files, edit names (default is the file name), and apply one assignment list to every created policy.
- Remove a setting from an existing freeform Settings Catalog policy (Intune still requires at least one setting).
- Scripts, remediations, and compliance scripts **Import** from `.ps1` / `.sh` / JSON (including pack `@axis-pack` headers). Detect/remediate pairs from a tenant pack export are merged.
- Script inspector Basics and Settings match Intune remediations: name, description, publisher, logged-on credentials, signature check, and 64-bit PowerShell (version is read-only). Create uses the same labels.

### Changed

- Newly added Settings Catalog settings are staged with a green row until Save to Graph.
- Policy, script, and device list headers stay pinned while the table or card list scrolls. Inspector titles, Save, and tabs stay pinned the same way.
- Double-click a Settings Catalog value to edit it in that same column. Several values can be changed, then saved together.
- Settings Catalog descriptions stay collapsed in the editor and expand only when you click them.
- Script Basics and Settings use a labeled two-column form instead of a loose field cluster.
- GitHub packs that point at a repo root honor `axis-pack.json` and list each platform folder as its own category. Device compare can use catalog files or a baseline selection. Built-in ASD E8 still uses its explicit Blueprint path.
- The GitHub repository is [jbiskit/Axis](https://github.com/jbiskit/Axis) (formerly `policy-axis`). In-app update checks use that name.
- Inspector, bulk, and tenant pack exports omit Graph assignments.

### Fixed

- Catalog search in a policy inspector no longer clones the full local index on every keystroke, and live Graph search stops after a small page of hits instead of paging the whole catalog.
- Policy inspector Add setting search imports its result row component, so finishing a query no longer shows “SettingSearchHit is not defined”.
- Settings Catalog import no longer loops while loading assignment filters, so group search works and Import does not crash the window.
- After import, Axis no longer opens the new policy and refreshes the list at the same time, which could leave Refresh stuck and crash the window.
## [0.1.4] - 2026-08-30

### Added

- Create classic device compliance policies from the Device compliance list (platform, starter settings, and actions for noncompliance).
- A structured compliance settings editor: portal labels and info bubbles, collapsible groups, parent/child lock (password, passcode, firewall, threat level), and Intune character-set labels for password complexity.
- Device status on a compliance policy: overview counts, per-device and per-user state, and a per-setting breakdown that uses Intune’s Generate report cached report (same as the portal).
- Bulk delete from the selection bar, and a delete control on the open inspector.
- Refresh all from a page or list header (right-click), plus refresh of the active inspector tab.

### Changed

- Open in Intune for classic compliance policies opens the live policy overview blade (platform and policy type included).
- Setting names prefer official Microsoft copy: Graph definitions when present, Intune portal resources when Graph has values but no labels, and inferred titles only as a last resort.

### Fixed

- The Assigned column, Assigned filter, and inspector overview for compliance policies now follow Graph assignments. Classic `deviceCompliancePolicy` has no `isAssigned` property.
- Opening a compliance policy no longer fails on actions for noncompliance. Graph does not support GET `scheduledActionsForRule`; Axis loads them with `$expand` on the policy.
- Expanded compliance settings can be scrolled when they grow past the inspector.
- Right-click delete on policies and scripts works again. Closing or deleting an object also closes its document tab.
- Inspector tab refresh no longer starts a tab drag from a right-click.
## [0.1.3] - 2026-08-29

### Added

- Metadata editing for names and descriptions on supported Graph objects.
- A duplication pane for changing names, descriptions, and assignment choices.
- Managed baseline imports into new Settings Catalog policies.

### Changed

- Script, compliance-script, and remediation tabs now persist independently.
- Policy navigation cards were removed from the overview in favor of sidebar navigation.
- Baseline sources reload automatically after configuration changes.

### Fixed

- Baseline source identifier and private-token matching.
- Group Policy duplication, including definition values.
- Assignment draft update loops and duplicated-object refresh behavior.
