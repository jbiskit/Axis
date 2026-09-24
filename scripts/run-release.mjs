import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const releaseScript = join(scriptsDirectory, "release.sh");

function isWslLauncher(shell) {
  const normalized = shell.replaceAll("/", "\\").toLowerCase();
  return (
    normalized.endsWith("\\system32\\bash.exe") ||
    normalized.endsWith("\\sysnative\\bash.exe") ||
    normalized.endsWith("\\windowsapps\\bash.exe") ||
    /(^|[\\])wsl(\.exe)?$/i.test(normalized)
  );
}

function gitBashCandidates() {
  const found = [];
  try {
    const gitExecPath = execFileSync("git", ["--exec-path"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const gitRoot = resolve(gitExecPath, "../../..");
    found.push(join(gitRoot, "bin", "bash.exe"));
    found.push(join(gitRoot, "usr", "bin", "bash.exe"));
  } catch {
    // Fall through to the default Git for Windows locations.
  }
  found.push(
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  );
  return found;
}

const candidates = [];
if (process.platform === "win32") {
  // System32\bash.exe is the WSL stub and is usually ahead of Git Bash on PATH.
  candidates.push(...gitBashCandidates());
}
if (process.env.SHELL && !isWslLauncher(process.env.SHELL)) {
  candidates.push(process.env.SHELL);
}
if (process.platform !== "win32") {
  candidates.push("bash");
}

let lastError;
let tried = false;
for (const shell of [...new Set(candidates)]) {
  if (isWslLauncher(shell)) continue;
  if (shell.includes("\\") || shell.includes("/")) {
    if (!existsSync(shell)) continue;
  }

  tried = true;
  const result = spawnSync(shell, [releaseScript, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (!result.error) process.exit(result.status ?? 1);
  if (result.error.code !== "ENOENT") {
    lastError = result.error;
    break;
  }
  lastError = result.error;
}

if (!tried) {
  console.error(
    "Git Bash was not found. Install Git for Windows, then rerun npm run release.",
  );
  console.error(
    "Windows' bash.exe is the WSL launcher and cannot run scripts/release.sh.",
  );
  process.exit(1);
}

console.error(
  lastError?.message ??
    "A Bash-compatible shell was not found. Install Git for Windows or Bash.",
);
process.exit(1);
