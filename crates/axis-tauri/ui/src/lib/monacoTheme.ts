import type { Monaco } from "@monaco-editor/react";

export const AXIS_MONACO_THEME = "axis-mocha";

/** Editor chrome follows tokens.css (graphite + cyan); syntax colours are unchanged. */
export function defineAxisMonacoTheme(monaco: Monaco): void {
  monaco.editor.defineTheme(AXIS_MONACO_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6c7086", fontStyle: "italic" },
      { token: "string", foreground: "a6e3a1" },
      { token: "number", foreground: "fab387" },
      { token: "keyword", foreground: "cba6f7" },
      { token: "operator", foreground: "89dceb" },
      { token: "variable", foreground: "cdd6f4" },
      { token: "type", foreground: "f9e2af" },
      { token: "delimiter", foreground: "bac2de" },
      { token: "tag", foreground: "89b4fa" },
      { token: "metatag", foreground: "a6adc8" },
      { token: "invalid", foreground: "f38ba8" },
    ],
    colors: {
      "editor.background": "#1a1f26",
      "editor.foreground": "#e4e8ee",
      "editorLineNumber.foreground": "#8a95a5",
      "editorLineNumber.activeForeground": "#e4e8ee",
      "editorCursor.foreground": "#3cc4d3",
      "editor.selectionBackground": "#3cc4d32e",
      "editor.inactiveSelectionBackground": "#3cc4d31a",
      "editor.lineHighlightBackground": "#3cc4d314",
      "editorIndentGuide.background1": "#2e3641",
      "editorIndentGuide.activeBackground1": "#3a4350",
      "editorWidget.background": "#161a20",
      "editorWidget.border": "#2e3641",
      "editorSuggestWidget.background": "#161a20",
      "editorSuggestWidget.border": "#2e3641",
      "editorSuggestWidget.selectedBackground": "#3cc4d32e",
      "editorSuggestWidget.foreground": "#e4e8ee",
      "editorSuggestWidget.highlightForeground": "#3cc4d3",
      "list.hoverBackground": "#1a1f26",
      "input.background": "#161a20",
      "input.foreground": "#e4e8ee",
      "input.border": "#2e3641",
      focusBorder: "#3cc4d3",
      "scrollbarSlider.background": "#2e364166",
      "scrollbarSlider.hoverBackground": "#3a4350aa",
    },
  });
}
