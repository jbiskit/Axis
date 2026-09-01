# Axis pack template

Starting layout for an **Axis** pack. Axis is a desktop Intune console that lists files from a GitHub repository (Contents API) or a folder on this machine.

Treat the pack as an **external source**. This template is **Windows-only** for now. Folders are grouped by platform, then by Intune object type. Only Settings Catalog exports under `windows/policies/` can be imported into Intune or used for device compare. Other folders are listings you can open; Axis does not push them to Graph in this version.

A **baseline** is a JSON file that **selects** pack paths. It does not duplicate policy JSON.

Use this repository as a GitHub template, or copy the folders onto disk and add them in Axis under **Baselines → Manage sources**. Axis can also **export a tenant** into this layout (**Baselines → Export tenant pack**). Packs are **read-only** in Axis today. Import Settings Catalog JSON from Policies, and import scripts from the Scripts lists.

## Examples

Two real Windows objects from **[OpenIntuneBaseline](https://github.com/SkipToTheEndpoint/OpenIntuneBaseline)** (James Robinson / SkipToTheEndpoint) are included as samples, not a full suite:

| Pack path | What it is |
| --- | --- |
| `windows/policies/Win - OIB - ES - Encryption - D - BitLocker (OS Disk) - v3.7.json` | Settings Catalog BitLocker (OS disk) |
| `windows/scripts/platform/Enable-AutoTimezone.ps1` | Intune platform script (auto timezone) |

They are GPL-3.0. See `NOTICE.md` and `third-party/OpenIntuneBaseline/LICENSE`. For the rest of OIB, use that repo. Review before production.

`baselines/standard-intune-configuration.json` selects those two files.

## Layout

```
axis-pack.json
NOTICE.md
third-party/OpenIntuneBaseline/LICENSE
windows/
  policies/                 Settings Catalog (import + device compare)
  scripts/platform/         Platform scripts
  scripts/remediation/
  scripts/compliance/
  compliance/
  endpoint-security/
  windows-update/
  enrollment/autopilot/     Autopilot only for now
  group-policy/             ADMX / Group Policy (Windows)
baselines/                  Named selections (`includes`), not copies of policies
```

Axis ignores `.git`, `.github`, `.vscode`, `node_modules`, and `third-party` when walking catalog folders. Built-in ASD E8 uses an explicit GitHub path and does not scan this layout.

## Baselines

```json
{
  "id": "standard-intune-configuration",
  "name": "Standard Intune configuration",
  "includes": [
    "windows/policies/Win - OIB - ES - Encryption - D - BitLocker (OS Disk) - v3.7.json",
    "windows/scripts/platform/Enable-AutoTimezone.ps1"
  ]
}
```

Device compare expands `includes` under `policies/`. The script path is membership of the standard only until Axis grades scripts.

## `axis-pack.json`

| Field | Purpose |
| --- | --- |
| `id` | Stable pack id |
| `name` | Title shown in Axis |
| `version` | Optional pack version |
| `sourceLabel` | Label stored on listed items |
| `paths.platforms` | Top-level OS folders to scan (this template: `windows`) |
| `paths.baselines` | Baseline selection files (default `baselines`) |

## Add in Axis

**GitHub**

1. Create a repository from this template (or fork it).
2. Add your Windows exports next to the samples.
3. In Axis: **Baselines → Manage sources → Add GitHub pack**.
4. Paste the repo URL or `owner/repo`.
5. For a private repo, mark the source private and paste a fine-grained PAT (Contents: Read).

Axis uses the GitHub Contents API. It does not clone the repo. Pack listings use the filename (without extension).

**Local folder**

1. Copy this layout onto disk.
2. **Baselines → Manage sources → Add local folder → Browse** at the folder that contains `axis-pack.json`.

## Mirroring to this GitHub template

[jbiskit/axis-pack-template](https://github.com/jbiskit/axis-pack-template) copies this folder from `jbiskit/Axis` on a daily schedule (and on a manual workflow run). It uses the default `GITHUB_TOKEN` only. Forks of the template skip that job so cron cannot overwrite a fork.

