import { useCallback, useMemo, useRef } from "react";
import Editor, { loader, type BeforeMount, type Monaco, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import {
  defineAxisMonacoTheme,
  AXIS_MONACO_THEME,
} from "../../lib/monacoTheme";
import { registerAxisScriptCompletions } from "../../lib/monacoScriptSupport";

export type ScriptCodeLanguage = "powershell" | "bash";

// monaco-editor 0.56 ships ESM workers via `new URL(..., import.meta.url)`.
// Do not import `monaco-editor/esm/vs/editor/editor.worker?worker` — package
// exports remap that path and Vite cannot resolve it.
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
}: {
  value: string;
  onChange?: (next: string) => void;
  language: ScriptCodeLanguage;
  readOnly?: boolean;
  ariaLabel?: string;
  height?: string;
}) {
  const languageId = monacoLanguageId(language);
  const monacoRef = useRef<Monaco | null>(null);

  const handleBeforeMount = useCallback<BeforeMount>((instance) => {
    monacoRef.current = instance;
    defineAxisMonacoTheme(instance);
    registerAxisScriptCompletions(instance);
  }, []);

  const handleMount = useCallback<OnMount>(
    (editor, instance) => {
      monacoRef.current = instance;
      editor.updateOptions({
        ariaLabel: ariaLabel ?? `${language} script editor`,
      });
      requestAnimationFrame(() => editor.layout());
    },
    [ariaLabel, language],
  );

  const options = useMemo(
    () => ({
      readOnly,
      minimap: { enabled: false },
      fontSize: 13,
      lineHeight: 20,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      wordWrap: "on" as const,
      automaticLayout: true,
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
      glyphMargin: false,
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
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
    }),
    [readOnly],
  );

  return (
    <div className="monaco-script-host" style={{ height }}>
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
