# Changelog

Notable user-facing changes to Axis are recorded here.

## [Unreleased]

Add release notes here before preparing the next version.

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
