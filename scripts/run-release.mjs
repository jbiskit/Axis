import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const releaseScript = join(scriptsDirectory, "release.sh");
const candidates = [];

if (process.env.SHELL) candidates.push(process.env.SHELL);
candidates.push("bash");

if (process.platform === "win32") {
  try {
    const gitExecPath = execFileSync("git", ["--exec-path"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const gitRoot = resolve(gitExecPath, "../../..");
    candidates.push(join(gitRoot, "bin", "bash.exe"));
    candidates.push(join(gitRoot, "usr", "bin", "bash.exe"));
  } catch {
    // release.sh will report missing prerequisites once a shell is found.
  }

  candidates.push(
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  );
}

let lastError;
for (const shell of [...new Set(candidates)]) {
  if (shell.includes("\\") || shell.includes("/")) {
    if (!existsSync(shell)) continue;
  }

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

console.error(
  lastError?.message ??
    "A Bash-compatible shell was not found. Install Git for Windows or Bash.",
);
process.exit(1);
