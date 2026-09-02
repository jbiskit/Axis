# Changelog

Notable user-facing changes to Axis are recorded here.

## [Unreleased]

Add release notes here before preparing the next version.

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
