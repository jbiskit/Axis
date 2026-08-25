import type { Monaco } from "@monaco-editor/react";
import type { editor, IPosition, languages } from "monaco-editor";

type Completion = {
  label: string;
  insertText: string;
  detail: string;
  documentation?: string;
  kind?: languages.CompletionItemKind;
  isSnippet?: boolean;
};

const POWERSHELL_ITEMS: Completion[] = [
  {
    label: "exit-ok",
    insertText: "exit 0",
    detail: "Detection: compliant / success",
    documentation: "Exit 0 — detection found the desired state (or remediation succeeded).",
  },
  {
    label: "exit-fail",
    insertText: "exit 1",
    detail: "Detection: noncompliant / needs remediation",
    documentation: "Exit 1 — detection failed; Intune will run the remediation script.",
  },
  {
    label: "Write-Output",
    insertText: "Write-Output \"${1:message}\"",
    detail: "Write to success stream",
    isSnippet: true,
  },
  {
    label: "Write-Error",
    insertText: "Write-Error \"${1:message}\"",
    detail: "Write to error stream",
    isSnippet: true,
  },
  {
    label: "Test-Path",
    insertText: "Test-Path -Path \"${1:path}\"",
    detail: "Test file/registry path exists",
    isSnippet: true,
  },
  {
    label: "Get-ItemProperty",
    insertText:
      "Get-ItemProperty -Path \"${1:HKLM:\\\\Software\\\\...}\" -Name ${2:ValueName} -ErrorAction SilentlyContinue",
    detail: "Read registry value",
    isSnippet: true,
  },
  {
    label: "New-ItemProperty",
    insertText:
      "New-ItemProperty -Path \"${1:HKLM:\\\\Software\\\\...}\" -Name ${2:ValueName} -Value ${3:0} -PropertyType ${4:DWord} -Force",
    detail: "Create/overwrite registry value",
    isSnippet: true,
  },
  {
    label: "Set-ItemProperty",
    insertText:
      "Set-ItemProperty -Path \"${1:HKLM:\\\\Software\\\\...}\" -Name ${2:ValueName} -Value ${3:0} -Force",
    detail: "Set registry value",
    isSnippet: true,
  },
  {
    label: "Get-Service",
    insertText: "Get-Service -Name \"${1:ServiceName}\" -ErrorAction SilentlyContinue",
    detail: "Query Windows service",
    isSnippet: true,
  },
  {
    label: "Stop-Service",
    insertText: "Stop-Service -Name \"${1:ServiceName}\" -Force",
    detail: "Stop Windows service",
    isSnippet: true,
  },
  {
    label: "$env:TEMP",
    insertText: "$env:TEMP",
    detail: "Temp directory",
  },
  {
    label: "$env:ProgramFiles",
    insertText: "$env:ProgramFiles",
    detail: "Program Files",
  },
  {
    label: "$env:ProgramData",
    insertText: "$env:ProgramData",
    detail: "ProgramData",
  },
  {
    label: "$env:COMPUTERNAME",
    insertText: "$env:COMPUTERNAME",
    detail: "Device name",
  },
  {
    label: "snippet-detect-registry",
    insertText: [
      "# Detection — exit 0 if compliant, 1 if remediation needed",
      "$path = '${1:HKLM:\\\\SOFTWARE\\\\Policies\\\\...}'",
      "$name = '${2:ValueName}'",
      "$expected = ${3:0}",
      "",
      "$current = (Get-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue).$name",
      "if ($null -ne $current -and $current -eq $expected) {",
      "  exit 0",
      "} else {",
      "  exit 1",
      "}",
      "",
    ].join("\n"),
    detail: "Snippet: registry detection",
    documentation: "Intune remediation detection pattern for a registry DWORD/string.",
    isSnippet: true,
  },
  {
    label: "snippet-remediate-registry",
    insertText: [
      "# Remediation — set desired registry value",
      "$path = '${1:HKLM:\\\\SOFTWARE\\\\Policies\\\\...}'",
      "$name = '${2:ValueName}'",
      "$value = ${3:0}",
      "",
      "if (-not (Test-Path $path)) {",
      "  New-Item -Path $path -Force | Out-Null",
      "}",
      "New-ItemProperty -Path $path -Name $name -Value $value -PropertyType ${4:DWord} -Force | Out-Null",
      "exit 0",
      "",
    ].join("\n"),
    detail: "Snippet: registry remediation",
    isSnippet: true,
  },
  {
    label: "snippet-detect-file",
    insertText: [
      "# Detection — exit 0 if file exists (or invert as needed)",
      "$path = '${1:C:\\\\Program Files\\\\App\\\\app.exe}'",
      "if (Test-Path -Path $path) {",
      "  exit 0",
      "} else {",
      "  exit 1",
      "}",
      "",
    ].join("\n"),
    detail: "Snippet: file presence detection",
    isSnippet: true,
  },
  {
    label: "snippet-app-detection",
    insertText: [
      "# Win32 app custom detection — exit 0 = installed",
      "$path = '${1:C:\\\\Program Files\\\\Vendor\\\\App\\\\app.exe}'",
      "if (Test-Path -LiteralPath $path) {",
      "  Write-Output \"Detected\"",
      "  exit 0",
      "}",
      "Write-Output \"Not detected\"",
      "exit 1",
      "",
    ].join("\n"),
    detail: "Snippet: Win32 app detection",
    isSnippet: true,
  },
];

const BASH_ITEMS: Completion[] = [
  {
    label: "exit-ok",
    insertText: "exit 0",
    detail: "Success / compliant",
  },
  {
    label: "exit-fail",
    insertText: "exit 1",
    detail: "Failure / needs action",
  },
  {
    label: "echo",
    insertText: "echo \"${1:message}\"",
    detail: "Print message",
    isSnippet: true,
  },
  {
    label: "test-file",
    insertText: "if [[ -f \"${1:/path/to/file}\" ]]; then\n  exit 0\nelse\n  exit 1\nfi",
    detail: "Test file exists",
    isSnippet: true,
  },
  {
    label: "test-dir",
    insertText: "if [[ -d \"${1:/path/to/dir}\" ]]; then\n  exit 0\nelse\n  exit 1\nfi",
    detail: "Test directory exists",
    isSnippet: true,
  },
  {
    label: "defaults-read",
    insertText: "defaults read ${1:com.example.app} ${2:Key}",
    detail: "macOS defaults read",
    isSnippet: true,
  },
  {
    label: "defaults-write",
    insertText: "defaults write ${1:com.example.app} ${2:Key} ${3:-bool true}",
    detail: "macOS defaults write",
    isSnippet: true,
  },
  {
    label: "plutil",
    insertText: "plutil -extract ${1:key} raw -- \"${2:/path/to.plist}\"",
    detail: "Read plist value",
    isSnippet: true,
  },
  {
    label: "snippet-macos-file-detect",
    insertText: [
      "#!/bin/bash",
      "# Exit 0 if present, 1 otherwise",
      "TARGET=\"${1:/Applications/App.app}\"",
      "if [[ -e \"$TARGET\" ]]; then",
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
    detail: "Snippet: macOS path detection",
    isSnippet: true,
  },
];

function getInsertRange(
  model: editor.ITextModel,
  position: IPosition,
): {
  startLineNumber: number;
  endLineNumber: number;
  startColumn: number;
  endColumn: number;
} {
  const line = model.getLineContent(position.lineNumber);
  const before = line.slice(0, position.column - 1);

  const dollarToken =
    before.match(/(\$\{[A-Za-z_][\w]*\}?)$/)?.[1] ??
    before.match(/(\$[A-Za-z_][\w:]*)$/)?.[1] ??
    (before.endsWith("$") ? "$" : null);

  if (dollarToken) {
    return {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: position.column - dollarToken.length,
      endColumn: position.column,
    };
  }

  const word = model.getWordUntilPosition(position);
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
}

const PS_AUTOMATIC = new Set(
  [
    "_",
    "args",
    "error",
    "false",
    "foreach",
    "home",
    "host",
    "input",
    "lastexitcode",
    "matches",
    "myinvocation",
    "null",
    "pid",
    "profile",
    "pscommandpath",
    "psculture",
    "psitem",
    "psscriptroot",
    "psuiculture",
    "psversiontable",
    "pwd",
    "switch",
    "this",
    "true",
  ].map((s) => s.toLowerCase()),
);

function collectPowerShellDocumentSymbols(text: string): {
  variables: string[];
  functions: string[];
  cmdlets: string[];
} {
  const variables = new Set<string>();
  const functions = new Set<string>();
  const cmdlets = new Set<string>();

  for (const match of text.matchAll(/\$((?:script|global|local|private):)?([A-Za-z_][\w]*)/g)) {
    const full = `$${match[1] ?? ""}${match[2]}`;
    const bare = match[2].toLowerCase();
    if (!PS_AUTOMATIC.has(bare)) {
      variables.add(full);
    }
  }

  for (const match of text.matchAll(/\bparam\s*\(([^)]*)\)/gi)) {
    const block = match[1] ?? "";
    for (const param of block.matchAll(/\$([A-Za-z_][\w]*)/g)) {
      variables.add(`$${param[1]}`);
    }
  }

  for (const match of text.matchAll(/\b(?:function|filter|workflow)\s+([A-Za-z_][\w-]*)/gi)) {
    functions.add(match[1]);
  }

  for (const match of text.matchAll(/\b([A-Za-z]+-[A-Za-z][\w]*)\b/g)) {
    cmdlets.add(match[1]);
  }

  return {
    variables: [...variables].sort((a, b) => a.localeCompare(b)),
    functions: [...functions].sort((a, b) => a.localeCompare(b)),
    cmdlets: [...cmdlets].sort((a, b) => a.localeCompare(b)),
  };
}

function collectBashDocumentSymbols(text: string): {
  variables: string[];
  functions: string[];
  cmdlets: string[];
} {
  const variables = new Set<string>();
  const functions = new Set<string>();
  const cmdlets = new Set<string>();

  for (const match of text.matchAll(/^([A-Za-z_][\w]*)=/gm)) {
    variables.add(match[1]);
    variables.add(`$${match[1]}`);
  }

  for (const match of text.matchAll(/\$\{([A-Za-z_][\w]*)\}/g)) {
    variables.add(match[1]);
    variables.add(`\${${match[1]}}`);
    variables.add(`$${match[1]}`);
  }

  for (const match of text.matchAll(/\$([A-Za-z_][\w]*)/g)) {
    variables.add(match[1]);
    variables.add(`$${match[1]}`);
  }

  for (const match of text.matchAll(/^(?:function\s+([A-Za-z_][\w]*)|([A-Za-z_][\w]*)\s*\(\s*\))\s*\{/gm)) {
    functions.add(match[1] || match[2]);
  }

  return {
    variables: [...variables].sort((a, b) => a.localeCompare(b)),
    functions: [...functions].sort((a, b) => a.localeCompare(b)),
    cmdlets: [...cmdlets].sort((a, b) => a.localeCompare(b)),
  };
}

function documentSuggestions(
  monaco: Monaco,
  model: editor.ITextModel,
  range: {
    startLineNumber: number;
    endLineNumber: number;
    startColumn: number;
    endColumn: number;
  },
  language: "powershell" | "shell",
): languages.CompletionItem[] {
  const text = model.getValue();
  const symbols =
    language === "powershell"
      ? collectPowerShellDocumentSymbols(text)
      : collectBashDocumentSymbols(text);

  const items: languages.CompletionItem[] = [];

  for (const name of symbols.variables) {
    items.push({
      label: name,
      kind: monaco.languages.CompletionItemKind.Variable,
      insertText: name,
      detail: "In this script",
      documentation: "Variable found in the current script.",
      sortText: `0_${name.toLowerCase()}`,
      range,
    });
  }

  for (const name of symbols.functions) {
    items.push({
      label: name,
      kind: monaco.languages.CompletionItemKind.Function,
      insertText: name,
      detail: "Function in this script",
      sortText: `0_${name.toLowerCase()}`,
      range,
    });
  }

  const words = new Set<string>();
  for (const match of text.matchAll(/\b([A-Za-z_][\w.-]{2,})\b/g)) {
    const token = match[1];
    if (token.length < 3) continue;
    if (/^\d/.test(token)) continue;
    words.add(token);
  }
  for (const word of [...words].sort((a, b) => a.localeCompare(b)).slice(0, 200)) {
    items.push({
      label: word,
      kind: monaco.languages.CompletionItemKind.Text,
      insertText: word,
      detail: "In this script",
      sortText: `1_${word.toLowerCase()}`,
      range,
    });
  }

  return items;
}

function toSuggestions(
  monaco: Monaco,
  model: editor.ITextModel,
  position: IPosition,
  items: Completion[],
  language: "powershell" | "shell",
): languages.CompletionList {
  const range = getInsertRange(model, position);

  const catalog = items.map((item) => ({
    label: item.label,
    kind: item.isSnippet
      ? monaco.languages.CompletionItemKind.Snippet
      : (item.kind ?? monaco.languages.CompletionItemKind.Function),
    insertText: item.insertText,
    insertTextRules: item.isSnippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    detail: item.detail,
    documentation: item.documentation,
    sortText: `2_${item.label.toLowerCase()}`,
    range,
  }));

  return {
    suggestions: [...documentSuggestions(monaco, model, range, language), ...catalog],
  };
}

let providersRegistered = false;

const EXTRA_MODEL_PREFIX = "inmemory://axis/scripts/";

function disposeStaleWorkspaceModels(monaco: Monaco): void {
  for (const model of monaco.editor.getModels()) {
    if (model.uri.toString().startsWith(EXTRA_MODEL_PREFIX)) {
      model.dispose();
    }
  }
}

/**
 * Completions for Intune scripts:
 * 1) symbols already in the open buffer
 * 2) curated Axis snippets
 *
 * Local only — script bodies are never sent to a cloud LLM.
 */
export function registerAxisScriptCompletions(monaco: Monaco): void {
  disposeStaleWorkspaceModels(monaco);
  if (providersRegistered) return;
  providersRegistered = true;

  monaco.languages.registerCompletionItemProvider("powershell", {
    triggerCharacters: ["$", "-", ".", "{"],
    provideCompletionItems(model: editor.ITextModel, position: IPosition) {
      return toSuggestions(monaco, model, position, POWERSHELL_ITEMS, "powershell");
    },
  });

  monaco.languages.registerCompletionItemProvider("shell", {
    triggerCharacters: ["-", "$", "{"],
    provideCompletionItems(model: editor.ITextModel, position: IPosition) {
      return toSuggestions(monaco, model, position, BASH_ITEMS, "shell");
    },
  });
}
