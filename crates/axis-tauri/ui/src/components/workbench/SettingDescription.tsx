import { useState } from "react";

export function SettingDescription({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      className={`setting-instance-desc ${expanded ? "is-expanded" : "is-collapsed"}${className ? ` ${className}` : ""}`}
      aria-expanded={expanded}
      title={expanded ? "Hide description" : "Show description"}
      onClick={() => setExpanded((open) => !open)}
    >
      <span className="setting-instance-desc-chevron" aria-hidden>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      </span>
      <span className="setting-instance-desc-text">{text}</span>
    </button>
  );
}
