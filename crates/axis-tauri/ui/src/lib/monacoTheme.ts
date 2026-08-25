import type { Monaco } from "@monaco-editor/react";

export const AXIS_MONACO_THEME = "axis-mocha";

/** Catppuccin Mocha aligned with tokens.css. */
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
      "editor.background": "#313244",
      "editor.foreground": "#cdd6f4",
      "editorLineNumber.foreground": "#6c7086",
      "editorLineNumber.activeForeground": "#cdd6f4",
      "editorCursor.foreground": "#cba6f7",
      "editor.selectionBackground": "#cba6f72e",
      "editor.inactiveSelectionBackground": "#cba6f71a",
      "editor.lineHighlightBackground": "#cba6f714",
      "editorIndentGuide.background1": "#45475a",
      "editorIndentGuide.activeBackground1": "#585b70",
      "editorWidget.background": "#181825",
      "editorWidget.border": "#45475a",
      "editorSuggestWidget.background": "#181825",
      "editorSuggestWidget.border": "#45475a",
      "editorSuggestWidget.selectedBackground": "#cba6f72e",
      "editorSuggestWidget.foreground": "#cdd6f4",
      "editorSuggestWidget.highlightForeground": "#89b4fa",
      "list.hoverBackground": "#313244",
      "input.background": "#181825",
      "input.foreground": "#cdd6f4",
      "input.border": "#45475a",
      focusBorder: "#cba6f7",
      "scrollbarSlider.background": "#45475a66",
      "scrollbarSlider.hoverBackground": "#585b70aa",
    },
  });
}
