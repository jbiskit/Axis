import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2]?.replace(/^v/, "");
const outputPath = process.argv[3];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(
    "Usage: node scripts/extract-release-notes.mjs <version> [output-file]",
  );
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const escapedVersion = version.replaceAll(".", "\\.");
const heading = new RegExp(
  `^## \\[${escapedVersion}\\](?:\\s+-\\s+[^\\r\\n]+)?\\s*$`,
  "m",
).exec(changelog);
const sectionStart = heading ? heading.index + heading[0].length : -1;
const remainder = sectionStart >= 0 ? changelog.slice(sectionStart) : "";
const nextHeading = remainder.search(/^## \[/m);
const notes = (
  nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder
).trim();
if (!notes) {
  console.error(`CHANGELOG.md has no release notes for ${version}.`);
  process.exit(1);
}

const rendered = `${notes}\n`;
if (outputPath) {
  writeFileSync(outputPath, rendered);
  console.log(`Wrote release notes for ${version} to ${outputPath}.`);
} else {
  process.stdout.write(rendered);
}
