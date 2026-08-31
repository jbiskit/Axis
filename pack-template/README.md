# Axis pack template

Starting layout for an **Axis** baseline pack. Axis is a desktop Intune console that can import Settings Catalog exports from a GitHub repository (Contents API) or a folder on this machine.

Use this repository as a GitHub template, or copy the folders onto disk and add them in Axis under **Baselines → Manage sources**.

Packs are **read-only** in Axis today: Axis lists and imports policies; it does not write files back into the pack.

## Layout

```
axis-pack.json     Pack id, display name, and folder paths
policies/          Intune Settings Catalog exports (.json or .txt)
baselines/         Reserved for Axis checks[] files (not imported as catalog policies)
```

Axis ignores `.git`, `.github`, and `node_modules`.

If `axis-pack.json` is missing, Axis scans the configured path (or the folder / repo root) for `.json` / `.txt` files and still skips a `baselines/` directory.

## `axis-pack.json`

| Field | Purpose |
| --- | --- |
| `id` | Stable pack id |
| `name` | Title shown in Axis |
| `version` | Optional pack version |
| `sourceLabel` | Label stored on each listed policy |
| `paths.policies` | Folder of catalog exports (default `policies`) |
| `paths.baselines` | Folder Axis does **not** treat as catalog exports |

## Add in Axis

**GitHub**

1. Create a repository from this template (or fork it).
2. Put Intune exports in `policies/`.
3. In Axis: **Baselines → Manage sources → Add GitHub pack**.
4. Paste `https://github.com/<you>/axis-pack-template` or `owner/repo`.
5. For a private repo, check **Private repository** and paste a fine-grained PAT limited to that repo (Contents: Read). Create one at [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new).

Axis uses the GitHub Contents API. It does not clone the repo.

**Local folder**

1. Copy this layout onto disk.
2. In Axis: **Baselines → Manage sources → Add local folder → Browse**.
3. Point at the folder that contains `axis-pack.json`.

The path stays on this machine only. There is no git remotes or PAT for local packs.

## What to put in `policies/`

Export a Settings Catalog policy from Intune (or Axis) as JSON. One policy per file. Axis uses the same normalizers as file import and device compare.

Leave `baselines/` empty until Axis ships checks-based baseline files.
