import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { loader, type BeforeMount, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import {
  defineAxisMonacoTheme,
  AXIS_MONACO_THEME,
} from "../../lib/monacoTheme";
import { registerAxisScriptCompletions } from "../../lib/monacoScriptSupport";
import {
  intuneHeuristicDiagnostics,
  markersFromLint,
  type ScriptLintRole,
} from "../../lib/monacoScriptLint";
import { lintScript } from "../../lib/tauri";

export type ScriptCodeLanguage = "powershell" | "bash";
export type { ScriptLintRole };

loader.config({ monaco });

function monacoLanguageId(language: ScriptCodeLanguage): string {
  return language === "bash" ? "shell" : "powershell";
}

export function ScriptCodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  ariaLabel,
  height = "22rem",
  lintRole = "platform",
}: {
  value: string;
  onChange?: (next: string) => void;
  language: ScriptCodeLanguage;
  readOnly?: boolean;
  ariaLabel?: string;
  height?: string;
  lintRole?: ScriptLintRole;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const ownerRef = useRef(`axis-lint-${Math.random().toString(36).slice(2)}`);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const languageId = monacoLanguageId(language);

  const handleBeforeMount = useCallback<BeforeMount>((instance) => {
    defineAxisMonacoTheme(instance);
    registerAxisScriptCompletions(instance);
  }, []);

  const handleMount = useCallback<OnMount>(
    (editor) => {
      editorRef.current = editor;
      editor.updateOptions({
        ariaLabel: ariaLabel ?? `${language} script editor`,
      });
      editor.layout();
      setEditorGeneration((n) => n + 1);
    },
    [ariaLabel, language],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        editorRef.current?.layout();
      });
    });
    observer.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const owner = ownerRef.current;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const model = editorRef.current?.getModel();
        if (!model) return;
        try {
          const result = await lintScript(language, value);
          if (cancelled) return;
          const extras = intuneHeuristicDiagnostics(value, lintRole, language);
          monaco.editor.setModelMarkers(
            model,
            owner,
            markersFromLint(model, result, extras),
          );
        } catch (error) {
          if (cancelled) return;
          monaco.editor.setModelMarkers(model, owner, [
            {
              message:
                error instanceof Error
                  ? `Syntax checker unavailable: ${error.message}`
                  : "Syntax checker unavailable.",
              severity: monaco.MarkerSeverity.Info,
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 2,
              source: "axis-lint",
            },
          ]);
        }
      })();
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, language, lintRole, editorGeneration]);

  useEffect(() => {
    const owner = ownerRef.current;
    return () => {
      const model = editorRef.current?.getModel();
      if (model) monaco.editor.setModelMarkers(model, owner, []);
    };
  }, []);

  const options = useMemo(
    () => ({
      readOnly,
      minimap: { enabled: false },
      fontSize: 13,
      lineHeight: 20,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      wordWrap: "on" as const,
      automaticLayout: false,
      scrollBeyondLastLine: false,
      tabSize: 2,
      renderLineHighlight: "line" as const,
      folding: true,
      foldingStrategy: "indentation" as const,
      showFoldingControls: "mouseover" as const,
      find: {
        addExtraSpaceOnTop: false,
        autoFindInSelection: "never" as const,
        seedSearchStringFromSelection: "always" as const,
      },
      lineNumbers: "on" as const,
      glyphMargin: true,
      padding: { top: 8, bottom: 8 },
      suggestOnTriggerCharacters: true,
      wordBasedSuggestions: "currentDocument" as const,
      wordSeparators: "`~!@#%^&*()-=+[{]}\\|;:'\",.<>/?",
      quickSuggestions: {
        other: true,
        comments: false,
        strings: true,
      },
      acceptSuggestionOnCommitCharacter: true,
      tabCompletion: "on" as const,
      snippetSuggestions: "inline" as const,
      overviewRulerLanes: 2,
      hideCursorInOverviewRuler: false,
      overviewRulerBorder: false,
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
    }),
    [readOnly],
  );

  return (
    <div ref={hostRef} className="monaco-script-host" style={{ height }}>
      <Editor
        height="100%"
        language={languageId}
        theme={AXIS_MONACO_THEME}
        value={value}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        onChange={(next) => {
          if (readOnly) return;
          onChange?.(next ?? "");
        }}
        options={options}
        loading={<div className="monaco-loading">Loading editor…</div>}
      />
    </div>
  );
}
