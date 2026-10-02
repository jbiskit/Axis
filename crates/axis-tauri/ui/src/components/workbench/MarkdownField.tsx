import { useMemo, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

export function MarkdownField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const html = useMemo(() => renderMarkdown(value), [value]);

  function stopPreviewLinks(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest("a")) event.preventDefault();
  }

  return (
    <div className="catalog-md">
      <textarea
        className="axis-input"
        rows={6}
        value={value}
        disabled={disabled}
        aria-label="Description markdown"
        onChange={(event) => onChange(event.target.value)}
      />
      <div
        className="catalog-md-preview"
        aria-label="Description preview"
        onClick={stopPreviewLinks}
      >
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="muted">Preview</p>
        )}
      </div>
    </div>
  );
}

function renderMarkdown(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "";
  const parsed = marked.parse(trimmed, { async: false, gfm: true, breaks: true });
  if (typeof parsed !== "string") return "";
  return DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "del",
      "code",
      "pre",
      "ul",
      "ol",
      "li",
      "a",
      "h1",
      "h2",
      "h3",
      "blockquote",
      "hr",
    ],
    ALLOWED_ATTR: ["href", "title"],
  });
}
