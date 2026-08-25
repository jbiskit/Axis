import { useState } from "react";
import {
  formatAdmxDefinitionValues,
  formatCatalogSettingRows,
  looksLikeAdmxDefinitionValues,
  looksLikeSettingsCatalogRows,
  type FormattedAdmxRow,
  type FormattedSettingChild,
  type FormattedSettingRow,
} from "../../lib/catalogSettingDisplay";

function ChildTree({ children }: { children: FormattedSettingChild[] }) {
  if (children.length === 0) return null;
  return (
    <ul className="setting-instance-children">
      {children.map((child, index) => (
        <li key={`${child.label}-${index}`}>
          <span className="setting-instance-child-label">{child.label}</span>
          <span className="setting-instance-child-value">{child.value}</span>
          {child.children?.length ? <ChildTree children={child.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

function SettingDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      className={`setting-instance-desc ${expanded ? "is-expanded" : "is-collapsed"}`}
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

function SettingInstanceRow({
  row,
  unsupportedEditor = false,
}: {
  row: FormattedSettingRow | FormattedAdmxRow;
  unsupportedEditor?: boolean;
}) {
  return (
    <li className="setting-instance-row">
      <div className="setting-instance-head">
        <div className="setting-instance-title-block">
          <p className="setting-instance-name">{row.displayName}</p>
          {row.description ? <SettingDescription text={row.description} /> : null}
        </div>
        <p className="setting-instance-value">{row.valueSummary}</p>
      </div>
      {unsupportedEditor ? (
        <p className="setting-instance-note">
          Unsupported editor — values are shown as a structured summary.
        </p>
      ) : null}
      <ChildTree children={row.children} />
    </li>
  );
}

export function CatalogSettingInstances({ settings }: { settings: Record<string, unknown>[] }) {
  if (looksLikeSettingsCatalogRows(settings)) {
    const rows = formatCatalogSettingRows(settings);
    if (rows.length === 0) {
      return <p className="muted">No setting instances on this policy.</p>;
    }
    return (
      <ul className="setting-instance-list">
        {rows.map((row) => (
          <SettingInstanceRow key={row.key} row={row} unsupportedEditor={row.unsupportedEditor} />
        ))}
      </ul>
    );
  }

  if (looksLikeAdmxDefinitionValues(settings)) {
    const rows = formatAdmxDefinitionValues(settings);
    return (
      <ul className="setting-instance-list">
        {rows.map((row) => (
          <SettingInstanceRow key={row.key} row={row} />
        ))}
      </ul>
    );
  }

  return (
    <p className="muted">
      These settings are not Settings Catalog instances. Use Export for the Graph payload.
    </p>
  );
}
