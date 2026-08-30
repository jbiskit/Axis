import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/finalize-changelog.mjs <version>");
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = resolve(root, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
const unreleased = changelog.match(
  /^## \[Unreleased\]\s*\r?\n([\s\S]*?)(?=^## \[)/m,
);

if (!unreleased) {
  console.error("CHANGELOG.md must contain an [Unreleased] section.");
  process.exit(1);
}

const notes = unreleased[1].trim();
if (!/^[-*]\s+.+/m.test(notes)) {
  console.error(
    "Add at least one release-note bullet under [Unreleased] before releasing.",
  );
  process.exit(1);
}

if (new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\]`, "m").test(changelog)) {
  console.error(`CHANGELOG.md already contains version ${version}.`);
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const replacement = [
  "## [Unreleased]",
  "",
  "Add release notes here before preparing the next version.",
  "",
  `## [${version}] - ${date}`,
  "",
  notes,
  "",
].join("\n");

const updated =
  changelog.slice(0, unreleased.index) +
  replacement +
  changelog.slice(unreleased.index + unreleased[0].length);
writeFileSync(changelogPath, updated);
console.log(`Finalized CHANGELOG.md for ${version}.`);
