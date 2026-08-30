#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: npm run release -- <version> [options]

Arguments:
  version          Next release version, for example 0.1.4 or v0.1.4

Options:
  --version-only   Update versions and lockfiles without testing or building
  --allow-dirty    Allow an intentionally dirty working tree
  --publish        Commit and push; GitHub Actions creates the tag and release
  -h, --help       Show this help
EOF
}

version=""
version_only=false
allow_dirty=false
publish=false

while (($#)); do
  case "$1" in
    --version-only)
      version_only=true
      ;;
    --allow-dirty)
      allow_dirty=true
      ;;
    --publish)
      publish=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$version" ]]; then
        printf 'Only one version may be supplied.\n\n' >&2
        usage >&2
        exit 2
      fi
      version="${1#v}"
      ;;
  esac
  shift
done

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'A semantic version such as 0.1.4 is required.\n\n' >&2
  usage >&2
  exit 2
fi

if [[ "$publish" == true && "$version_only" == true ]]; then
  printf '%s\n' '--publish cannot be combined with --version-only.' >&2
  exit 2
fi

if [[ "$publish" == true && "$allow_dirty" == true ]]; then
  printf '%s\n' '--publish requires a clean working tree and cannot use --allow-dirty.' >&2
  exit 2
fi

for command in git node npm npx cargo; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf "Required command '%s' was not found in PATH.\n" "$command" >&2
    exit 1
  fi
done

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if ((node_major != 24)); then
  printf 'Node.js 24 is required; found %s.\n' "$(node --version)" >&2
  exit 1
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ui_directory="$repository_root/crates/axis-tauri/ui"
tauri_directory="$repository_root/crates/axis-tauri"
cd "$repository_root"

if [[ "$allow_dirty" == false ]]; then
  status="$(git status --porcelain)"
  if [[ -n "$status" ]]; then
    changelog_only=true
    while IFS= read -r status_line; do
      [[ "${status_line:3}" == "CHANGELOG.md" ]] || changelog_only=false
    done <<< "$status"
    if [[ "$publish" == false || "$changelog_only" == false ]]; then
      printf '%s\n' \
        'The working tree contains changes other than release notes.' \
        'Commit or stash intended work, or rerun with --allow-dirty after reviewing git status.' >&2
      exit 1
    fi
  fi
fi

current_version="$(
  node -e '
    const fs = require("fs");
    const text = fs.readFileSync("Cargo.toml", "utf8");
    const section = text.match(/\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/);
    const version = section && section[1].match(/^version\s*=\s*"(\d+\.\d+\.\d+)"/m);
    if (!version) process.exit(1);
    process.stdout.write(version[1]);
  '
)"

if ! node -e '
  const current = process.argv[1].split(".").map(Number);
  const next = process.argv[2].split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (next[index] > current[index]) process.exit(0);
    if (next[index] < current[index]) process.exit(1);
  }
  process.exit(1);
' "$current_version" "$version"; then
  printf 'New version %s must be greater than current version %s.\n' \
    "$version" "$current_version" >&2
  exit 1
fi

if [[ "$publish" == true ]]; then
  branch="$(git symbolic-ref --quiet --short HEAD)" || {
    printf '%s\n' 'Publishing requires a checked-out branch, not detached HEAD.' >&2
    exit 1
  }
  git remote get-url origin >/dev/null
  if git rev-parse --quiet --verify "refs/tags/v$version" >/dev/null; then
    printf 'Local tag v%s already exists.\n' "$version" >&2
    exit 1
  fi
  if git ls-remote --exit-code --tags origin "refs/tags/v$version" >/dev/null 2>&1; then
    printf 'Remote tag v%s already exists.\n' "$version" >&2
    exit 1
  fi
fi

version_files=(
  "CHANGELOG.md"
  "Cargo.toml"
  "Cargo.lock"
  "crates/axis-tauri/src-tauri/tauri.conf.json"
  "crates/axis-tauri/ui/package.json"
  "crates/axis-tauri/ui/package-lock.json"
)
backup_directory="$(mktemp -d)"

for file in "${version_files[@]}"; do
  mkdir -p "$backup_directory/$(dirname "$file")"
  cp "$file" "$backup_directory/$file"
done

rollback() {
  printf '\nVersion preparation failed; restoring version files.\n' >&2
  for file in "${version_files[@]}"; do
    cp "$backup_directory/$file" "$file"
  done
  rm -rf "$backup_directory"
}
trap rollback ERR

printf 'Bumping Axis %s -> %s\n' "$current_version" "$version"

node - "$version" <<'NODE'
const fs = require("fs");
const version = process.argv[2];

function replaceOne(path, pattern, replacement) {
  const current = fs.readFileSync(path, "utf8");
  const matches = current.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
  if (!matches || matches.length !== 1) {
    throw new Error(`Expected one version field in ${path}; found ${matches?.length ?? 0}`);
  }
  fs.writeFileSync(path, current.replace(pattern, replacement));
}

replaceOne(
  "Cargo.toml",
  /(\[workspace\.package\][\s\S]*?^version\s*=\s*)"\d+\.\d+\.\d+"/m,
  `$1"${version}"`,
);
replaceOne(
  "crates/axis-tauri/src-tauri/tauri.conf.json",
  /^(\s*"version"\s*:\s*)"\d+\.\d+\.\d+"/m,
  `$1"${version}"`,
);

for (const path of [
  "crates/axis-tauri/ui/package.json",
  "crates/axis-tauri/ui/package-lock.json",
]) {
  const document = JSON.parse(fs.readFileSync(path, "utf8"));
  document.version = version;
  if (document.packages?.[""]) document.packages[""].version = version;
  fs.writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}
NODE

node scripts/finalize-changelog.mjs "$version"
cargo check --workspace

if [[ "$version_only" == false ]]; then
  printf '\nRunning release checks...\n'
  cargo test --workspace
  (
    cd "$ui_directory"
    npx tsc --noEmit --pretty false
  )

  printf '\nBuilding portable Axis executable...\n'
  (
    cd "$tauri_directory"
    cargo tauri build
  )

  executable="$repository_root/target/release/axis.exe"
  if [[ ! -f "$executable" ]]; then
    printf "Build completed but '%s' was not found.\n" "$executable" >&2
    false
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    checksum="$(sha256sum "$executable" | awk '{print $1}')"
  else
    checksum="$(shasum -a 256 "$executable" | awk '{print $1}')"
  fi

  printf '\nRelease artifact: %s\nSHA-256: %s\n' "$executable" "$checksum"
fi

git diff --check
trap - ERR
rm -rf "$backup_directory"

if [[ "$publish" == true ]]; then
  printf '\nCommitting release %s...\n' "$version"
  git add -- "${version_files[@]}"
  if git diff --cached --quiet; then
    printf '%s\n' 'No version changes were staged.' >&2
    exit 1
  fi
  git commit -m "release: $version"
  git push origin "$branch"
  printf '\nPushed release: %s. GitHub Actions will create v%s and publish it.\n' \
    "$version" "$version"
  exit 0
fi

printf '\nVersion %s is prepared.\n' "$version"
printf '%s\n' \
  'Review with: git diff -- Cargo.toml Cargo.lock crates/axis-tauri' \
  'This script does not commit, tag, push, or publish the release.'
