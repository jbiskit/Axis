# Axis

Microsoft cloud posture console. **Axis** is a **Tauri desktop** app — there is no browser website in this repository. **Windows** is the primary release target today; **Linux** and **macOS** can run local dev builds via the same Tauri shell.

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
| **Node.js** + **npm** | **24.x** (see `.nvmrc`). Needed for the desktop UI package and release tooling. |
| **Rust** + **cargo** | **1.77.2+** (`rust-version` on the Tauri crate). Install via [rustup](https://rustup.rs/) and set **stable** as the default toolchain. |
| **Tauri CLI 2** | `cargo install tauri-cli --version "^2"` (matches `tauri` / `tauri-build` `2` in Cargo.toml). |
| **Windows runtime** | **WebView2** — included on Windows 11; on Windows 10 install the [Evergreen runtime](https://developer.microsoft.com/microsoft-edge/webview2/). |
| **Linux dev** | **webkit2gtk-4.1** and related GTK packages — see [Tauri prerequisites (Arch)](https://v2.tauri.app/start/prerequisites/#arch). Wayland + NVIDIA uses `tauri-plugin-wayland-nvidia-quirk` (built into the app). |

Rust workspace members (`Cargo.toml` at the repo root):

- `crates/axis-sdk` — device-code auth + Graph
- `crates/axis-tauri/src-tauri` — Tauri backend (binary name `axis`)

## Setup

On a clean clone you need **Rust (stable)**, **Tauri CLI 2**, and **npm dependencies** for the UI. `cargo tauri dev` starts Vite for you, but it does **not** create `node_modules` in `ui/` — install everything below first.

**Linux, macOS, or WSL** — run the setup script from the repo root:

```bash
./scripts/setup.sh
```

That script:

1. Installs [rustup](https://rustup.rs/) if missing, runs `rustup default stable`, and checks the toolchain is **1.77.2+**
2. Installs **Tauri CLI 2** with `cargo install tauri-cli --version "^2"` (skipped if already present)
3. Runs `npm install` in `crates/axis-tauri/ui`

Use `./scripts/setup.sh --help` for flags to skip individual steps when something is already configured.

**Manual setup** (all platforms):

```bash
# 1. Node.js 24.x (optional: nvm use in repo root reads .nvmrc)

# 2. Rust via rustup — stable must be the default toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable

# 3. Tauri CLI 2
cargo install tauri-cli --version "^2"

# 4. UI npm dependencies
cd crates/axis-tauri/ui
npm install
```

## Run Axis

**Product:** run the executable.

`target/release/axis.exe` (repo root)

**Development:** run `cargo tauri` from `crates/axis-tauri`. Do **not** `cd` into `src-tauri`. Do **not** run from the repo root. Do **not** open a website in a browser to use Axis.

```bash
cd crates/axis-tauri
cargo tauri dev
```

On **Linux**, `./scripts/dev.sh` is a thin wrapper around `cargo tauri dev`. The Tauri shell includes [tauri-plugin-wayland-nvidia-quirk](https://github.com/arsalan-anwari/tauri-plugin-wayland-nvidia-quirk) for **Wayland + NVIDIA** startup (Error 71) without disabling GPU compositing — avoid setting `WEBKIT_DISABLE_DMABUF_RENDERER=1` unless you need the old fallback (it causes panel banding).

If the window still fails, try (in order): `GDK_GL=always`, `__NV_DISABLE_EXPLICIT_SYNC=1`, then `GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1`.

Verbose quirk logging: `TAURI_WAYLAND_NVIDIA_QUIRK_VERBOSE=1 ./scripts/dev.sh`

```bash
./scripts/dev.sh
```

That compiles `axis-sdk` + `axis`, starts the Vite UI for the WebView (developer-only; not a shipped site), and opens the Axis desktop window. First compile can take several minutes.

**Linux system packages** (once, before the first dev run):

```bash
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl \
  appmenu-gtk-module libappindicator-gtk3 librsvg xdotool
```

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
| Tokens | Refresh token in the **OS credential store** via keyring (`com.axis.desktop` / `entra-device-code` — Credential Manager on Windows, Secret Service on Linux, Keychain on macOS). Not in git. Access token in process memory. |
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
- `windows/group-policy/` — ADMX / Group Policy configurations (listed; import later)
- `baselines/` — named selections (`includes` paths). Not a second copy of policies

**Export this tenant** from **Baselines → Export tenant pack** (native Save As). Axis writes the layout above (Settings Catalog JSON that import already understands, scripts with an `@axis-pack` metadata header, plus Graph JSON for the other types). It also writes `baselines/tenant-export.json` (everything) and `baselines/tenant-export-catalog.json` (catalog only). iOS, Linux, apps, and classic device configuration profiles are skipped. The chosen folder is added as a local pack source.

Inspector **Export** still shows Graph JSON; **Save as** writes that file. Checked rows on policy, script, and app lists can **Export** one JSON (Save As) or a folder of JSON files.

The public template ships two Windows samples from [OpenIntuneBaseline](https://github.com/SkipToTheEndpoint/OpenIntuneBaseline) (BitLocker catalog policy and Auto Timezone platform script; GPL-3.0). See `pack-template/NOTICE.md`.

`pack-template/` is the source of truth for that GitHub template: Axis’s Action copies this folder to the template repo root, including `README.md`. `.github/` on the template repo is not overwritten.

If the source path is empty, Axis scans those default folders. Built-in ASD E8 still uses its GitHub path under the ASD Blueprint repo and does not scan the extra folders.

To start a pack, use the public template [jbiskit/axis-pack-template](https://github.com/jbiskit/axis-pack-template) (same files as `pack-template/` in this repo), or export a tenant from Axis. In Axis: **Baselines → Manage sources → Add GitHub pack** and paste the repo URL, or **Add local folder**. Packs are read-only in this version. Import Settings Catalog JSON from the Policies list, and import scripts from Scripts / Remediations / Compliance scripts.
