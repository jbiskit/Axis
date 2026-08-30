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
