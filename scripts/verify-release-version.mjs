import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/verify-release-version.mjs <version>");
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const failures = [];

function expect(label, actual) {
  if (actual !== version) {
    failures.push(`${label}: expected ${version}, found ${actual ?? "no version"}`);
  }
}

const cargoManifest = read("Cargo.toml");
const workspaceSection = cargoManifest.match(
  /\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/,
);
expect(
  "Cargo workspace",
  workspaceSection?.[1].match(/^version\s*=\s*"([^"]+)"/m)?.[1],
);

const cargoLock = read("Cargo.lock");
for (const packageName of ["axis", "axis-sdk"]) {
  const packageBlock = cargoLock.match(
    new RegExp(
      `\\[\\[package\\]\\]\\s+name = "${packageName}"\\s+version = "([^"]+)"`,
    ),
  );
  expect(`Cargo.lock ${packageName}`, packageBlock?.[1]);
}

const tauriConfig = JSON.parse(
  read("crates/axis-tauri/src-tauri/tauri.conf.json"),
);
expect("Tauri config", tauriConfig.version);

const uiPackage = JSON.parse(read("crates/axis-tauri/ui/package.json"));
expect("UI package", uiPackage.version);

const uiLock = JSON.parse(read("crates/axis-tauri/ui/package-lock.json"));
expect("UI package lock", uiLock.version);
expect("UI package lock root", uiLock.packages?.[""]?.version);

const changelog = read("CHANGELOG.md");
if (!new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\]\\s+-\\s+\\d{4}-\\d{2}-\\d{2}$`, "m").test(changelog)) {
  failures.push(`CHANGELOG.md: missing dated ${version} section`);
}

if (failures.length > 0) {
  console.error("Release version mismatch:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`All release version sources match ${version}.`);
