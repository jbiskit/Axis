#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/crates/axis-tauri"

# Linux: axis ships tauri-plugin-wayland-nvidia-quirk for Wayland + NVIDIA (Error 71)
# without disabling WebKit DMA-BUF. Do not set WEBKIT_DISABLE_DMABUF_RENDERER here — it
# overrides the plugin and causes panel banding.
#
# Fallbacks if the window still fails (try in order):
#   GDK_GL=always cargo tauri dev
#   __NV_DISABLE_EXPLICIT_SYNC=1 cargo tauri dev
#   GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 cargo tauri dev
#
# Verbose quirk logging: TAURI_WAYLAND_NVIDIA_QUIRK_VERBOSE=1 ./scripts/dev.sh

exec cargo tauri dev "$@"
