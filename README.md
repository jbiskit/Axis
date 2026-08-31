# Axis

Microsoft cloud posture console. **Axis** is a **desktop** app (Windows `.exe`). There is no browser website in this repository.

| Product line | Status | Notes |
|--------------|--------|--------|
| **Axis Intune** | Available | Devices, settings, baselines, Graph workbenches |
| Axis Entra | Planned | |
| Axis M365 | Planned | |
| Axis Purview | Planned | |
| Axis Security | Planned | |

After device-code sign-in, the desktop window opens the Intune workspace.

Desktop how-to (auth, env vars, layout): [`crates/axis-tauri/README.md`](crates/axis-tauri/README.md).

## Requirements

There is no `engines` field in `crates/axis-tauri/ui/package.json`. Versions below are inferred from this repo.

| Dependency | Version / notes |
|------------|-----------------|
| **Windows** | Built around WebView2. |
| **Node.js** + **npm** | **24.x**. Needed only for the desktop UI package and release tooling. |
| **Rust** + **cargo** | **1.77.2+** (`rust-version` on the Tauri crate). Edition 2021. |
| **Tauri CLI 2** | `cargo install tauri-cli --version "^2"` (matches `tauri` / `tauri-build` `2` in Cargo.toml). |
| **WebView2** | Included on Windows 11. On Windows 10 install the [Evergreen runtime](https://developer.microsoft.com/microsoft-edge/webview2/). |

Rust workspace members (`Cargo.toml` at the repo root):

- `crates/axis-sdk` — device-code auth + Graph
- `crates/axis-tauri/src-tauri` — Tauri backend (binary name `axis`)

## Install npm dependencies

One Node package: the Tauri UI.

```powershell
cd crates/axis-tauri/ui
npm install
```

`cargo tauri dev` starts Vite for you, but it does **not** create `node_modules` in `/ui` on a clean clone. Install there first.

## Run Axis

**Product:** run the executable.

`target/release/axis.exe` (repo root)

**Development:** `cargo tauri` from `crates\axis-tauri`. Do **not** `cd` into `src-tauri`. Do **not** run from the repo root. Do **not** open a website in a browser to use Axis.

```powershell
cd crates/axis-tauri
cargo tauri dev
```

That compiles `axis-sdk` + `axis`, starts the Vite UI for the WebView (developer-only; not a shipped site), and opens the Axis desktop window. First compile can take several minutes.

`beforeDevCommand` / `beforeBuildCommand` in `tauri.conf.json` are `npm run dev --prefix ../ui` and `npm run build --prefix ../ui`. Those scripts target `crates/axis-tauri/ui`.

Release build (same cwd — **`crates\axis-tauri`**, not `src-tauri`):

```powershell
cd crates/axis-tauri
cargo tauri build
```

This produces a **portable executable you run**, not an NSIS/MSI installer (`bundle.active` is `false` in `tauri.conf.json`). This is a Cargo **workspace**, so the binary is at the **repo-root** `target/` directory:

`target/release/axis.exe` (repo root)

The window title is **Axis** (`productName`); the Cargo package / exe name is `axis`. Double-click or run that `.exe`. The machine still needs **WebView2**. To emit installers later, set `"bundle": { "active": true, "targets": "all" }` (or pass Tauri’s bundle flags).

Release builds check GitHub Releases on launch and can replace `axis.exe` in place. Details: [`crates/axis-tauri/README.md`](crates/axis-tauri/README.md#updates).

## Authentication

Delegated Graph for Intune. No client secrets. Graph permissions are whatever Entra issued for that client — Axis does not offer a Read-only product mode.

| | Desktop |
|---|----------|
| Default | Device code (Microsoft Graph Command Line Tools public client) |
| Tokens | Refresh token in **Windows Credential Manager** via keyring (`com.axis.desktop` / `entra-device-code`). Not in git. Access token in process memory. |
| Optional env | `AXIS_DEVICE_CODE_CLIENT_ID`, `AXIS_AZURE_TENANT_ID` |
| GitHub packs | Per-source PAT (prefer a fine-grained token limited to that repo). Public repos need none. |

Desktop auth details: [`crates/axis-tauri/README.md`](crates/axis-tauri/README.md).

## Project layout

```
Cargo.toml                         # Rust workspace
crates/
  axis-sdk/                        # Rust: device-code + Graph
  axis-tauri/
    src-tauri/                     # Tauri backend + tauri.conf.json (do not run cargo tauri here)
    ui/                            # Vite + React desktop frontend
pack-template/                     # Mirrored to https://github.com/jbiskit/axis-pack-template (including README)
```

## Baseline packs

Axis treats a pack as an **external source** from **GitHub** (Contents API, not git clone) or a **local folder**. Layout is **platform first** (Windows in the public template for now), then object type. Only `{platform}/policies/` is imported as Settings Catalog. Device compare can use those files, or a baseline JSON that **selects** them.

- `axis-pack.json` — pack name and `paths.platforms`
- `{platform}/policies/` — Settings Catalog exports
- `{platform}/scripts/platform|remediation|compliance`
- `{platform}/compliance/`, `endpoint-security/`, `windows-update/` (Windows), `enrollment/autopilot/`
- `baselines/` — named selections (`includes` paths). Not a second copy of policies

The public template ships two Windows samples from [OpenIntuneBaseline](https://github.com/SkipToTheEndpoint/OpenIntuneBaseline) (BitLocker catalog policy and Auto Timezone platform script; GPL-3.0). See `pack-template/NOTICE.md`.

`pack-template/` is the source of truth for that GitHub template: Axis’s Action copies this folder to the template repo root, including `README.md`. `.github/` on the template repo is not overwritten.

If the source path is empty, Axis scans those default folders. Built-in ASD E8 still uses its GitHub path under the ASD Blueprint repo and does not scan the extra folders.

To start a pack, use the public template [jbiskit/axis-pack-template](https://github.com/jbiskit/axis-pack-template) (same files as `pack-template/` in this repo). In Axis: **Baselines → Manage sources → Add GitHub pack** and paste the repo URL, or **Add local folder**. Packs are read-only in this version.
