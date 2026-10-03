# Axis

This repository is a **desktop** Tauri app (`crates/axis-tauri`). There is no Next.js website.

- Run the product as `target/release/axis.exe`, or `cargo tauri dev` from `crates/axis-tauri`.
- Frontend lives in `crates/axis-tauri/ui` (Vite + React). Graph runs in Rust (`crates/axis-sdk`).

## Setting labels

Resolve display names and help text in this order. Do not invent labels when an official source exists.

1. **Graph definitions** — `displayName`, `description`, `helpText`, option labels on `configurationSettings`, `$expand=settingDefinitions`, or ADMX `definition` / `presentation`.
2. **Intune portal TOC** — only when Graph has values but no copy (classic compliance properties). Resolve the hashed `*Resources` bundle from the live `intunedevicesettings` table of contents. Skip the AMD alias (`"*ClientResources":["ClientResources"]`); use the later array that contains `Content/Dynamic/{hash}`.
3. **Inference** — `titleCaseKey` / `humanizeSettingToken` only if both sources are missing or return unusable text (`l_*` keys).

Keep local catalogs for structure (Graph keys, control types, `dependsOn`, option *values*). Do not treat hand-written labels as the source of truth when step 1 or 2 returns copy.

## Inspector chrome

For every Graph object workbench / inspector / list reveal:

1. **Raw JSON** — Export (or equivalent) must expose the loaded Graph JSON; when debugging, include request path + raw error/body.
2. **Delete** — Trash control on list + inspector for every kind with a Graph DELETE path (`canDeleteGraphKind` / `object_metadata`). Clear assignment / policy-set blockers before delete when Graph requires it.
3. **Refresh** — List `onRefresh` and inspector/`requestObjectRefresh` on every Graph object surface.

Local-only surfaces (baselines, template files) are exempt.

## Navigation

Place a surface by what it is, then by platform.

- **Manage** is for objects that exist in the signed-in tenant and are managed there: devices, apps, enrollment, policies, policy sets, compliance, endpoint security, and update profiles.
- **Get Started** is for wizards and starter kits. Those runs create tenant objects, and the objects they create stay under Manage.
- Anything that exists beyond one tenant goes under **Library**. That includes local packs, catalogs, template files, and other generalized libraries.
- Creating a client container adds a subfolder named for that client under the folder you pick. The open container is that subfolder. The local app catalog shows that tenant catalog and the Global Folder side by side. Packages live at `Applications/{Vendor}/{App}/{Version}` in the catalog they belong to. Closing a container does not keep writing into that folder.
- A platform-specific entry nests under that platform. Windows Store apps live under Apps → Windows, not in a cross-platform Tools list.

## Lists and controls

New features and suites are built for bulk editing.

- Every policy or settings list has a multi-select control, such as a row checkbox, plus a way to act on the selection. Do not ship a list that can only be edited one row at a time.
- A true/false choice uses a pill slider (`BooleanToggle`), including two-option choices that are really on/off. Row selection stays a checkbox.

## Development

- Do not add or run unit tests during feature work. They are a waste of time at this stage.
- Do not compile, typecheck, or otherwise test for build failures unless the user says there is a problem.
