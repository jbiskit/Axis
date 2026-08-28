import type { editor } from "monaco-editor";
import type { ScriptDiagnostic, ScriptLintResult } from "../types/inventory";

export type ScriptLintRole = "platform" | "detection" | "remediation" | "none";

const EXIT_CODE = /\bexit\s+(0|1)\b/i;
const INTERACTIVE = /\b(Read-Host|Out-GridView|pause)\b/i;

export function intuneHeuristicDiagnostics(
  source: string,
  role: ScriptLintRole,
  language: "powershell" | "bash",
): ScriptDiagnostic[] {
  if (role === "none") return [];
  const diagnostics: ScriptDiagnostic[] = [];
  const stripped = source
    .split("\n")
    .map((line) => {
      if (language === "powershell") {
        return line.replace(/#.*$/, "");
      }
      return line.replace(/(^|\s)#.*$/, "$1");
    })
    .join("\n")
    .trim();

  if (!stripped) {
    diagnostics.push(
      marker(
        role === "detection"
          ? "Detection script is empty. Intune needs a result (typically exit 0 or exit 1)."
          : role === "remediation"
            ? "Remediation script is empty."
            : "Script body is empty.",
        "warning",
      ),
    );
    return diagnostics;
  }

  if (role === "detection" && !EXIT_CODE.test(stripped)) {
    diagnostics.push(
      marker(
        "Detection scripts should exit 0 (compliant / success) or exit 1 (needs remediation).",
        "warning",
      ),
    );
  }

  if (language === "powershell" && INTERACTIVE.test(source)) {
    diagnostics.push(
      marker(
        "Interactive cmdlets (Read-Host, Out-GridView, pause) block unattended Intune runs.",
        "warning",
      ),
    );
  }

  return diagnostics;
}

export function markersFromLint(
  model: editor.ITextModel,
  result: ScriptLintResult,
  extras: ScriptDiagnostic[],
): editor.IMarkerData[] {
  const rows = [...result.diagnostics, ...extras];
  if (result.engineError) {
    rows.unshift({
      message: `Syntax checker unavailable: ${result.engineError}`,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 2,
      severity: "info",
    });
  }
  const lineCount = Math.max(model.getLineCount(), 1);
  return rows.map((item) => {
    const startLine = clamp(item.startLine, 1, lineCount);
    const endLine = clamp(item.endLine || startLine, startLine, lineCount);
    const startColumn = Math.max(item.startColumn || 1, 1);
    const endColumn = Math.max(item.endColumn || startColumn + 1, startColumn + 1);
    return {
      message: item.message,
      severity: toSeverity(item.severity),
      startLineNumber: startLine,
      startColumn,
      endLineNumber: endLine,
      endColumn,
      source: result.engine,
    };
  });
}

function marker(message: string, severity: string): ScriptDiagnostic {
  return {
    message,
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 2,
    severity,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value || min, min), max);
}

function toSeverity(value: string): editor.MarkerSeverity {
  if (value === "warning") return 4;
  if (value === "info" || value === "hint") return 2;
  return 8;
}
