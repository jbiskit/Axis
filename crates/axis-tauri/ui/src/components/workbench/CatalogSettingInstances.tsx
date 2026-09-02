import {
  formatAdmxDefinitionValues,
  formatCatalogSettingRows,
  looksLikeAdmxDefinitionValues,
  looksLikeSettingsCatalogRows,
  type FormattedAdmxRow,
  type FormattedSettingChild,
  type FormattedSettingRow,
} from "../../lib/catalogSettingDisplay";
import { SettingDescription } from "./SettingDescription";

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

function fromControl(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, a, input, textarea, select, label"));
}

function SettingInstanceRow({
  row,
  unsupportedEditor = false,
  onActivate,
}: {
  row: FormattedSettingRow | FormattedAdmxRow;
  unsupportedEditor?: boolean;
  onActivate?: () => void;
}) {
  const activatable = Boolean(onActivate) && !unsupportedEditor;
  return (
    <li
      className={`setting-instance-row${activatable ? " is-activatable" : ""}`}
      title={activatable ? "Double-click to edit" : undefined}
      onMouseDown={(event) => {
        if (activatable && event.detail > 1) event.preventDefault();
      }}
      onDoubleClick={(event) => {
        if (!activatable || fromControl(event.target)) return;
        onActivate?.();
      }}
    >
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

export function CatalogSettingInstances({
  settings,
  onActivateSetting,
}: {
  settings: Record<string, unknown>[];
  onActivateSetting?: (definitionId: string) => void;
}) {
  if (looksLikeSettingsCatalogRows(settings)) {
    const rows = formatCatalogSettingRows(settings);
    if (rows.length === 0) {
      return <p className="muted">No setting instances on this policy.</p>;
    }
    return (
      <ul className="setting-instance-list">
        {rows.map((row) => (
          <SettingInstanceRow
            key={row.key}
            row={row}
            unsupportedEditor={row.unsupportedEditor}
            onActivate={
              onActivateSetting && !row.unsupportedEditor
                ? () => onActivateSetting(row.definitionId)
                : undefined
            }
          />
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
