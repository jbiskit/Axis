import type { PickedTextFile } from "../../types/inventory";

export type ScriptImportFamily = "platform" | "remediation" | "compliance";

export type ScriptImportKind = "platform-powershell" | "platform-shell" | "remediation" | "compliance";

export type ScriptImportRow = {
  key: string;
  fileName: string;
  include: boolean;
  name: string;
  description: string;
  kind: ScriptImportKind;
  runAsAccount: "system" | "user";
  runAs32Bit: boolean;
  scriptText: string;
  detectionScriptText: string;
  remediationScriptText: string;
  error: string | null;
};

type ParsedPiece = {
  path: string;
  fileName: string;
  kind: ScriptImportKind | null;
  role: "body" | "detect" | "remediate";
  name: string;
  description: string;
  runAsAccount: "system" | "user";
  runAs32Bit: boolean;
  scriptText: string;
  detectionScriptText: string;
  remediationScriptText: string;
  error: string | null;
  pairKey: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function scriptFileStem(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "").trim();
  const stem = base.replace(/\.(json|ps1|sh|zsh|bash|txt)$/i, "").trim();
  return stem.replace(/-(detect|remediate)$/i, "").trim() || stem || base || "Imported script";
}

function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : normalized;
}

function maybeDecodeBase64(value: string): string {
  const compact = value.replace(/\s/g, "");
  if (compact.length < 8 || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(compact)) {
    return value;
  }
  try {
    const decoded = atob(compact);
    if (!decoded || decoded.includes("\u0000")) return value;
    return decoded;
  } catch {
    return value;
  }
}

function stringField(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function boolField(row: Record<string, unknown>, key: string): boolean {
  return row[key] === true;
}

function runAsFrom(value: string | undefined): "system" | "user" {
  return value?.toLowerCase() === "user" ? "user" : "system";
}

function kindFromToken(raw: string | undefined, fileName: string): ScriptImportKind | null {
  const token = (raw ?? "").trim().toLowerCase().replace(/^script:/, "");
  if (token === "platform-powershell" || token === "platformpowershell") return "platform-powershell";
  if (token === "platform-shell" || token === "platformshell" || token === "shell") return "platform-shell";
  if (token === "remediation" || token === "remediation-detect" || token === "remediation-remediate" || token === "health") {
    return "remediation";
  }
  if (token === "compliance") return "compliance";
  const odata = token.replace(/^#microsoft\.graph\./, "");
  if (odata === "devicemanagementscript") return "platform-powershell";
  if (odata === "deviceshellscript") return "platform-shell";
  if (odata === "devicehealthscript") return "remediation";
  if (odata === "devicecompliancescript") return "compliance";
  if (/\.(sh|zsh|bash)$/i.test(fileName)) return "platform-shell";
  if (/\.ps1$/i.test(fileName)) return "platform-powershell";
  return null;
}

function roleFromToken(raw: string | undefined, fileName: string): "body" | "detect" | "remediate" {
  const token = (raw ?? "").trim().toLowerCase();
  if (token.includes("remediation-remediate") || /remediate/i.test(fileName)) return "remediate";
  if (token.includes("remediation-detect") || /detect/i.test(fileName)) return "detect";
  return "body";
}

function familyForKind(kind: ScriptImportKind): ScriptImportFamily {
  if (kind === "remediation") return "remediation";
  if (kind === "compliance") return "compliance";
  return "platform";
}

function familyLabel(family: ScriptImportFamily): string {
  if (family === "remediation") return "Remediations";
  if (family === "compliance") return "Compliance scripts";
  return "Scripts";
}

function parseAxisPackHeader(text: string): { meta: Record<string, unknown>; body: string } | null {
  const trimmed = text.replace(/^\uFEFF/, "");
  const match = trimmed.match(/^#\s*@axis-pack\s+(\{.*\})\s*(?:\r?\n|$)/);
  if (!match) return null;
  try {
    const meta = asRecord(JSON.parse(match[1]));
    if (!meta) return null;
    return { meta, body: trimmed.slice(match[0].length) };
  } catch {
    return null;
  }
}

function parseJsonScript(raw: unknown, fileName: string): Omit<ParsedPiece, "path" | "fileName" | "pairKey"> {
  const root = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
  const row = asRecord(root);
  if (!row) {
    return emptyPiece("Unrecognized JSON: expected one script object.");
  }
  if (Array.isArray(row.settings) || Array.isArray(row.configurationSettings)) {
    return emptyPiece("This looks like a Settings Catalog export. Import it from Policies.");
  }
  const odata = stringField(row, "@odata.type", "odataType");
  const kindToken = stringField(row, "kind") || odata;
  const kind = kindFromToken(kindToken, stringField(row, "fileName") || fileName);
  const name = stringField(row, "displayName", "name") || scriptFileStem(fileName);
  const description = stringField(row, "description");
  const runAsAccount = runAsFrom(stringField(row, "runAsAccount"));
  const runAs32Bit = boolField(row, "runAs32Bit");
  const scriptText =
    stringField(row, "scriptText") ||
    (typeof row.scriptContent === "string" ? maybeDecodeBase64(row.scriptContent) : "");
  const detectionScriptText =
    stringField(row, "detectionScriptText") ||
    (typeof row.detectionScriptContent === "string" ? maybeDecodeBase64(row.detectionScriptContent) : "");
  const remediationScriptText =
    stringField(row, "remediationScriptText") ||
    (typeof row.remediationScriptContent === "string" ? maybeDecodeBase64(row.remediationScriptContent) : "");
  const resolvedKind =
    kind ??
    (detectionScriptText || remediationScriptText ? "remediation" : /\.(sh|zsh|bash)$/i.test(fileName) ? "platform-shell" : "platform-powershell");
  const role: "body" | "detect" | "remediate" =
    resolvedKind === "remediation" && !detectionScriptText && !remediationScriptText && scriptText
      ? "detect"
      : "body";
  if (resolvedKind === "platform-powershell" || resolvedKind === "platform-shell") {
    if (!scriptText.trim()) return emptyPiece("No script text in this JSON.");
  } else if (!detectionScriptText.trim() && !scriptText.trim()) {
    return emptyPiece("No detection script in this JSON.");
  }
  return {
    kind: resolvedKind,
    role,
    name,
    description,
    runAsAccount,
    runAs32Bit,
    scriptText,
    detectionScriptText: detectionScriptText || (resolvedKind !== "platform-powershell" && resolvedKind !== "platform-shell" ? scriptText : ""),
    remediationScriptText,
    error: null,
  };
}

function emptyPiece(error: string): Omit<ParsedPiece, "path" | "fileName" | "pairKey"> {
  return {
    kind: null,
    role: "body",
    name: "",
    description: "",
    runAsAccount: "system",
    runAs32Bit: false,
    scriptText: "",
    detectionScriptText: "",
    remediationScriptText: "",
    error,
  };
}

function parseFile(file: PickedTextFile): ParsedPiece {
  const name = scriptFileStem(file.fileName);
  const pairKey = `${parentDir(file.path)}::${name.toLowerCase()}`;
  if (file.error || file.text == null) {
    return {
      path: file.path,
      fileName: file.fileName,
      kind: null,
      role: "body",
      name,
      description: "",
      runAsAccount: "system",
      runAs32Bit: false,
      scriptText: "",
      detectionScriptText: "",
      remediationScriptText: "",
      error: file.error ?? "The file was empty.",
      pairKey,
    };
  }
  const text = file.text.replace(/^\uFEFF/, "");
  if (/\.json$/i.test(file.fileName) || text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
    try {
      const parsed = parseJsonScript(JSON.parse(text), file.fileName);
      return { ...parsed, path: file.path, fileName: file.fileName, pairKey, name: parsed.name || name };
    } catch (error) {
      return {
        path: file.path,
        fileName: file.fileName,
        kind: null,
        role: "body",
        name,
        description: "",
        runAsAccount: "system",
        runAs32Bit: false,
        scriptText: "",
        detectionScriptText: "",
        remediationScriptText: "",
        error: error instanceof Error ? error.message : "Invalid JSON.",
        pairKey,
      };
    }
  }
  const header = parseAxisPackHeader(text);
  const body = header?.body ?? text;
  const meta = header?.meta ?? {};
  const kindToken = stringField(meta, "kind") || stringField(meta, "@odata.type");
  const kind = kindFromToken(kindToken, stringField(meta, "fileName") || file.fileName);
  const role = roleFromToken(kindToken, file.fileName);
  const resolvedKind =
    kind ??
    (role !== "body" ? "remediation" : /\.(sh|zsh|bash)$/i.test(file.fileName) ? "platform-shell" : "platform-powershell");
  return {
    path: file.path,
    fileName: file.fileName,
    kind: resolvedKind,
    role: resolvedKind === "remediation" && role === "body" ? "detect" : role,
    name: stringField(meta, "displayName", "name") || name,
    description: stringField(meta, "description"),
    runAsAccount: runAsFrom(stringField(meta, "runAsAccount")),
    runAs32Bit: boolField(meta, "runAs32Bit"),
    scriptText: resolvedKind === "platform-powershell" || resolvedKind === "platform-shell" ? body : "",
    detectionScriptText: resolvedKind !== "platform-powershell" && resolvedKind !== "platform-shell" && role !== "remediate" ? body : "",
    remediationScriptText: role === "remediate" ? body : "",
    error: body.trim() ? null : "The script file was empty.",
    pairKey,
  };
}

function rowFromPiece(piece: ParsedPiece, family: ScriptImportFamily, extraFileName?: string): ScriptImportRow {
  const kind = piece.kind ?? (family === "remediation" ? "remediation" : family === "compliance" ? "compliance" : "platform-powershell");
  const mismatch = piece.kind && familyForKind(piece.kind) !== family;
  const detection = piece.detectionScriptText || (kind !== "platform-powershell" && kind !== "platform-shell" ? piece.scriptText : "");
  let error = piece.error;
  if (!error && mismatch) {
    error = `This file is a ${familyLabel(familyForKind(piece.kind!)).toLowerCase()} export. Open ${familyLabel(familyForKind(piece.kind!))} to import it.`;
  }
  if (!error && (kind === "platform-powershell" || kind === "platform-shell") && !piece.scriptText.trim()) {
    error = "No script body in this file.";
  }
  if (!error && kind !== "platform-powershell" && kind !== "platform-shell" && !detection.trim()) {
    error = "A detection script is required.";
  }
  return {
    key: piece.path,
    fileName: extraFileName ? `${piece.fileName} + ${extraFileName}` : piece.fileName,
    include: !error,
    name: piece.name,
    description: piece.description,
    kind,
    runAsAccount: piece.runAsAccount,
    runAs32Bit: piece.runAs32Bit,
    scriptText: piece.scriptText,
    detectionScriptText: detection,
    remediationScriptText: piece.remediationScriptText,
    error,
  };
}

export function rowsFromScriptFiles(files: PickedTextFile[], family: ScriptImportFamily): ScriptImportRow[] {
  const pieces = files.map(parseFile);
  const used = new Set<string>();
  const rows: ScriptImportRow[] = [];
  for (const piece of pieces) {
    if (used.has(piece.path)) continue;
    if (piece.kind === "remediation" || piece.role === "detect" || piece.role === "remediate") {
      const partner = pieces.find(
        (other) =>
          other.path !== piece.path &&
          !used.has(other.path) &&
          other.pairKey === piece.pairKey &&
          (other.role === "detect" || other.role === "remediate" || other.kind === "remediation") &&
          other.role !== piece.role,
      );
      if (partner) {
        used.add(piece.path);
        used.add(partner.path);
        const detect = piece.role === "remediate" ? partner : piece;
        const remediate = piece.role === "remediate" ? piece : partner;
        rows.push(
          rowFromPiece(
            {
              ...detect,
              kind: "remediation",
              detectionScriptText: detect.detectionScriptText || detect.scriptText,
              remediationScriptText: remediate.remediationScriptText || remediate.scriptText || remediate.detectionScriptText,
            },
            family,
            partner.fileName,
          ),
        );
        continue;
      }
    }
    used.add(piece.path);
    rows.push(rowFromPiece(piece, family));
  }
  return rows;
}
