import type { SettingDraftDiffLine } from "../../lib/catalog";
import { isAdmxPlaceholderName, isLocalizationKey } from "../../lib/catalogSettingDisplay";

function showDiffLabel(label: string): boolean {
  if (label === "Value" || !label.trim()) return false;
  if (isLocalizationKey(label) || isAdmxPlaceholderName(label)) return false;
  return true;
}

export function SettingValueDiff({
  lines,
  removed = false,
  added = false,
}: {
  lines: SettingDraftDiffLine[];
  removed?: boolean;
  added?: boolean;
}) {
  if (lines.length === 0) return null;
  return (
    <p
      className={`setting-value-diff${removed ? " is-removed" : ""}${added ? " is-added" : ""}`}
      aria-label="Before and after"
    >
      {lines.map((line, index) => (
        <span key={`${line.label}:${line.before}:${line.after}`} className="setting-value-diff-line">
          {index > 0 ? <span className="setting-value-diff-sep"> · </span> : null}
          {showDiffLabel(line.label) ? <span className="setting-value-diff-label">{line.label} </span> : null}
          <span className="setting-value-diff-before">{line.before}</span>
          <span className="setting-value-diff-arrow" aria-hidden="true">
            {" "}
            &gt;{" "}
          </span>
          <span className="setting-value-diff-after">{line.after}</span>
        </span>
      ))}
    </p>
  );
}
