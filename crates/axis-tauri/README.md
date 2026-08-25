# Axis Desktop (Tauri)

Native Windows shell for **Axis**. Graph calls run in Rust (`axis-sdk` crate). Access Axis by running the **`.exe`** or `cargo tauri dev` — not a localhost website.

## Prerequisites

- **Rust** 1.77.2+ (`rust-version` in `src-tauri/Cargo.toml`) and **cargo**
- **Node.js** 20+ and **npm** (no `engines` field; Vite 7 expects Node 20)
- **WebView2** — included on Windows 11; on Windows 10 install the [Evergreen WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
- **Tauri CLI 2** — `cargo install tauri-cli --version "^2"` (matches `tauri` 2 in this crate)

## Project layout

```
Cargo.toml                          # workspace root (repo)
crates/
  axis-sdk/                         # Rust SDK: device-code auth + Graph
  axis-tauri/
    src-tauri/                      # Tauri backend + tauri.conf.json
    ui/                             # Vite + React + TypeScript frontend
```

## Install (UI)

```powershell
cd crates/axis-tauri/ui
npm install
```

That path is `crates/axis-tauri/ui` relative to the repo root. `cargo tauri` does not substitute for this install.

## Run (development)

Run **`cargo tauri` from this crate folder (`crates\axis-tauri`)**. Do **not** `cd` into `src-tauri`. Do **not** run from the repo root.

```powershell
cd crates/axis-tauri
cargo tauri dev
```

`tauri.conf.json` lives under **`src-tauri/`**. Tauri 2 finds it from this folder: it looks for `tauri.conf.json` in the current directory, then in **`src-tauri/`**. You invoke the CLI here; internally it uses `src-tauri` as the Rust app directory.

This will:

1. Run `beforeDevCommand` from `tauri.conf.json`: `npm run dev --prefix ../ui`, which starts the desktop frontend in `crates/axis-tauri/ui`.
2. Compile the Rust workspace (`axis-sdk` + `axis`).
3. Open the Axis desktop window. Vite listens on port 5173 for that WebView during development only.

First run may take several minutes while Cargo downloads and compiles dependencies.

## Build (release)

Same cwd as dev — **`crates\axis-tauri`**, not `src-tauri`:

```powershell
cd crates/axis-tauri
cargo tauri build
```

This produces a **portable executable you run**, not an installer. `tauri.conf.json` has `"bundle": { "active": false }`, so `cargo tauri build` does not emit NSIS/MSI.

This crate is a workspace member of the **repo-root** `Cargo.toml`, so the binary lands under the workspace `target/` directory, **not** `src-tauri/target/`:

`target/release/axis.exe` (repo root)

The desktop window is titled **Axis** (`productName` in `tauri.conf.json`). The Cargo package name — and therefore the `.exe` filename — is `axis`. Run that file directly; do not look for a setup wizard.

**WebView2** is still required on the machine that runs the exe (included on Windows 11; install the [Evergreen WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) on Windows 10).

`beforeBuildCommand` is `npm run build --prefix ../ui` (UI at `crates/axis-tauri/ui`).

To build Windows installers instead, set `"bundle": { "active": true, "targets": "all" }` in `src-tauri/tauri.conf.json` and run `cargo tauri build` again (artifacts then appear under `target/release/bundle/` at the repo root).

## Updates

Release `axis.exe` checks GitHub Releases for `jbiskit/policy-axis` on launch (`cargo tauri dev` does not). If a newer tag is published with an `axis.exe` asset, Axis prompts to download, then to quit and relaunch into that file. Sign-in stays in Windows Credential Manager.

Publish a release whose tag is newer than `version` in `src-tauri/tauri.conf.json` (that value is the Windows file version and what the updater compares). Attach the portable `axis.exe` from `target/release/axis.exe`. Optional: `sha256:` digest on the GitHub asset is verified when present.

| Variable | Purpose |
|----------|---------|
| `AXIS_UPDATER` | `0` disables checks. `1` enables them in debug builds. |
| `AXIS_UPDATE_FEED_URL` | HTTPS JSON feed (`version`, `url` or `platforms.windows-x86_64.url`, optional `notes` / `sha256`) instead of GitHub. |
| `AXIS_UPDATE_GITHUB_REPO` | `owner/repo` if the default repository is wrong. |

The folder that contains `axis.exe` must be writable. Axis cannot overwrite a running `.exe` in place: it stages `axis.exe.new`, swaps on relaunch, and removes `axis.exe.bak` on the next start.

## Auth

Device-code sign-in uses a **single** public client (default: Microsoft Graph Command Line Tools `14d82eec-204b-4c2f-b7e8-296a70dab67e`). Axis always requests the write-capable delegated scope set. Entra still returns the union of permissions already granted for that client; Graph 403s are the write gate, not a Read-only product mode.

| Variable | Purpose |
|----------|---------|
| `AXIS_DEVICE_CODE_CLIENT_ID` | Public client for device-code. If unset, Graph CLI. |
| `AXIS_AZURE_TENANT_ID` | Limit sign-in to a tenant (default: `organizations`) |

The **refresh token** is persisted in the OS credential store (`com.axis.desktop` / `entra-device-code` — Windows Credential Manager via keyring). It is **not** stored in this git repo. The access token stays in process memory and is refreshed as needed. Granted scopes are not stored separately; they are read from the access token `scp` claim (shown on Overview). LAPS/BitLocker *reveal* still uses Read scopes (`DeviceLocalCredential.Read.All`, `BitlockerKey.Read.All`).

On startup and sign-out, Axis also deletes leftover Credential Manager entries under `dev.policyforge.desktop` and `com.policyforge.desktop`.

## What is live on desktop

Nav items marked **planned** in `ui/src/lib/nav.ts` are not implemented yet. Inventory and overview load from live Graph (or show empty/error) — there is no demo tenant.

| Area | Status |
|------|--------|
| Device-code auth, token refresh, session restore via keyring | Live |
| Overview (glance: org, devices, inventory families, conflicts, audit) | Live Graph |
| Devices list + detail, remote actions, LAPS / BitLocker | Live |
| Scripts / compliance scripts / remediations | Live (Graph list + inspector; editors limited) |
| Settings Catalog workbench, settings search, ADMX Studio | Live (create/edit coverage varies by surface) |
| Compliance, Endpoint Security, Windows Update, Autopilot / enrollment | Live list + Graph inspector |
| Tenant / store apps, app protection | Live list + inspector |
| Baselines (including ASD Blueprint / E8 GitHub references) | Live |
| Write activity, environment report, local app catalog / IntuneWin packaging | Not in this desktop pass |
