#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI_DIR="$ROOT/crates/axis-tauri/ui"
MIN_RUST="1.77.2"

usage() {
  cat <<'EOF'
Usage: ./scripts/setup.sh [options]

Install Axis development dependencies:
  - Rust (rustup) with stable as the default toolchain
  - Tauri CLI 2 (cargo install tauri-cli)
  - npm packages for crates/axis-tauri/ui

Options:
  --skip-rust        Skip rustup / default stable (assume Rust is already configured)
  --skip-tauri-cli   Skip cargo install tauri-cli
  --skip-npm         Skip npm install in the UI package
  -h, --help         Show this help
EOF
}

skip_rust=false
skip_tauri_cli=false
skip_npm=false

while (($#)); do
  case "$1" in
    --skip-rust)
      skip_rust=true
      ;;
    --skip-tauri-cli)
      skip_tauri_cli=true
      ;;
    --skip-npm)
      skip_npm=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
    *)
      printf 'Unexpected argument: %s\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

ensure_cargo_env() {
  if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env"
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

version_at_least() {
  local current="$1"
  local required="$2"
  if [[ "$current" == "$required" ]] || [[ "$(printf '%s\n%s\n' "$required" "$current" | sort -V | head -n1)" == "$required" ]]; then
    return 0
  fi
  return 1
}

step() {
  printf '\n==> %s\n' "$1"
}

if [[ "$skip_rust" == false ]]; then
  step "Rust (stable default toolchain, ${MIN_RUST}+)"

  if ! command -v rustup >/dev/null 2>&1; then
    require_command curl
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
    ensure_cargo_env
  fi

  ensure_cargo_env
  require_command rustup
  require_command cargo

  rustup default stable
  rustup update stable

  rustc_version="$(rustc --version | awk '{print $2}')"
  if ! version_at_least "$rustc_version" "$MIN_RUST"; then
    printf 'Rust %s is below the required %s (see rust-version in src-tauri/Cargo.toml).\n' \
      "$rustc_version" "$MIN_RUST" >&2
    exit 1
  fi

  printf 'Using %s\n' "$(rustc --version)"
  printf 'Using %s\n' "$(cargo --version)"
fi

if [[ "$skip_tauri_cli" == false ]]; then
  step "Tauri CLI 2"

  ensure_cargo_env
  require_command cargo

  if cargo tauri --version >/dev/null 2>&1; then
    printf 'Already installed: %s\n' "$(cargo tauri --version)"
  else
    cargo install tauri-cli --locked --version "^2"
    printf 'Installed: %s\n' "$(cargo tauri --version)"
  fi
fi

if [[ "$skip_npm" == false ]]; then
  step "npm dependencies (crates/axis-tauri/ui)"

  require_command npm

  if [[ -f "$ROOT/.nvmrc" ]] && command -v node >/dev/null 2>&1; then
    expected_node="$(tr -d '[:space:]' < "$ROOT/.nvmrc")"
    actual_node="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "$actual_node" != "$expected_node" ]]; then
      printf 'Warning: Node major version is %s; this repo expects %s (.nvmrc).\n' \
        "$actual_node" "$expected_node" >&2
    fi
  fi

  npm install --prefix "$UI_DIR"
fi

step "Done"
cat <<EOF

Next: run the desktop app in development mode from crates/axis-tauri:

  cd crates/axis-tauri
  cargo tauri dev

See README.md for Windows-specific notes (WebView2, release builds).
EOF
