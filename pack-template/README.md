# Axis pack template

Starting layout for an **Axis** pack. Axis is a desktop Intune console that lists files from a GitHub repository (Contents API) or a folder on this machine.

Treat the pack as an **external source**. Folders are grouped by **platform**, then by Intune object type. Only Settings Catalog exports under `{platform}/policies/` can be imported into Intune or used for device compare. Other folders are listings you can open; Axis does not push them to Graph in this version.

A **baseline** is a JSON file that **selects** pack paths. It does not duplicate policy JSON.

Use this repository as a GitHub template, or copy the folders onto disk and add them in Axis under **Baselines → Manage sources**. Packs are **read-only** in Axis today.

The empty folders are the intended seed. Drop in your own exports. For a full community Windows/macOS suite, see [OpenIntuneBaseline](https://github.com/SkipToTheEndpoint/OpenIntuneBaseline) (James Robinson / SkipToTheEndpoint) — this template only borrows the idea of grouping by platform and policy type.

## Layout

```
axis-pack.json
windows/
  policies/                 Settings Catalog (import + device compare)
  scripts/platform/         Platform scripts
  scripts/remediation/
  scripts/compliance/
  compliance/
  endpoint-security/
  windows-update/
  enrollment/autopilot/     Autopilot only for now
macos/
  policies/
  scripts/…
  compliance/
  endpoint-security/
android/                    Add exports when you have them
baselines/                  Named selections (`includes`), not copies of policies
```

Axis ignores `.git`, `.github`, `.vscode`, and `node_modules`. Built-in ASD E8 uses an explicit GitHub path and does not scan this layout.

## Baselines

`baselines/standard-intune-configuration.json` shows the shape: a name plus pack-relative `includes`. Device compare expands paths under `policies/`. Other includes (scripts, compliance, and so on) describe membership of the standard only.

```json
{
  "id": "standard-intune-configuration",
  "name": "Standard Intune configuration",
  "includes": [
    "windows/policies/sample-windows-catalog.json"
  ]
}
```

Replace the sample files with real Intune exports, then update `includes`.

## `axis-pack.json`

| Field | Purpose |
| --- | --- |
| `id` | Stable pack id |
| `name` | Title shown in Axis |
| `version` | Optional pack version |
| `sourceLabel` | Label stored on listed items |
| `paths.platforms` | Top-level OS folders to scan (default `windows`, `macos`, `android`) |
| `paths.baselines` | Baseline selection files (default `baselines`) |
| `paths.policies` | Optional extra catalog folder (legacy root `policies/`) |

## Add in Axis

**GitHub**

1. Create a repository from this template (or fork it).
2. Put your exports in the folders above.
3. In Axis: **Baselines → Manage sources → Add GitHub pack**.
4. Paste the repo URL or `owner/repo`.
5. For a private repo, mark the source private and paste a fine-grained PAT (Contents: Read).

Axis uses the GitHub Contents API. It does not clone the repo. Pack listings use the filename (without extension).

**Local folder**

1. Copy this layout onto disk.
2. **Baselines → Manage sources → Add local folder → Browse** at the folder that contains `axis-pack.json`.
