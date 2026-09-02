import type { CatalogSettingDetail } from "../../types/inventory";
import { draftWithChoiceOption, type SettingValueDraft } from "../../lib/catalog";
import { catalogUiLabel, isAdmxPlaceholderName } from "../../lib/catalogSettingDisplay";

export function settingDraftHasDependents(draft: SettingValueDraft): boolean {
  return draft.kind === "choice" && Object.keys(draft.children).length > 0;
}

export function SettingDraftEditor({
  detail,
  draft,
  dependents,
  onChange,
  compact = false,
  dependentsOnly = false,
}: {
  detail: CatalogSettingDetail;
  draft: SettingValueDraft;
  dependents: Record<string, CatalogSettingDetail>;
  onChange: (draft: SettingValueDraft) => void;
  compact?: boolean;
  dependentsOnly?: boolean;
}) {
  if (draft.kind === "unsupported") {
    return <p className="axis-alert axis-alert-warning">{draft.reason}</p>;
  }
  if (draft.kind === "choice") {
    const select = (
      <select
        className="axis-input"
        value={draft.optionItemId}
        autoFocus={compact && !dependentsOnly}
        aria-label={catalogUiLabel([detail.displayName], detail.id)}
        onChange={(event) =>
          onChange(draftWithChoiceOption(detail, dependents, event.target.value, draft))
        }
      >
        {(detail.options ?? []).map((option) => (
          <option key={option.itemId} value={option.itemId}>
            {catalogUiLabel([option.displayName], option.itemId, detail.id)}
          </option>
        ))}
      </select>
    );
    const children = Object.entries(draft.children).map(([id, childDraft]) => {
      const child = dependents[id];
      if (!child) return null;
      const nestedTitle = isAdmxPlaceholderName(child.displayName)
        ? null
        : catalogUiLabel([child.displayName], child.id);
      return (
        <div key={id} className="catalog-nested">
          {nestedTitle ? (
            <p className="muted" style={{ margin: "0 0 0.35rem", fontSize: "0.75rem" }}>
              {nestedTitle}
            </p>
          ) : null}
          <SettingDraftEditor
            detail={child}
            draft={childDraft}
            dependents={dependents}
            onChange={(next) =>
              onChange({
                ...draft,
                children: { ...draft.children, [id]: next },
              })
            }
          />
        </div>
      );
    });
    if (dependentsOnly) {
      return children.length ? <div className="stack" style={{ gap: "0.65rem" }}>{children}</div> : null;
    }
    if (compact) return select;
    return (
      <div className="stack" style={{ gap: "0.65rem" }}>
        <label className="device-field">
          Value
          {select}
        </label>
        {children}
      </div>
    );
  }
  if (dependentsOnly) return null;
  if (draft.kind === "simpleCollection") {
    return (
      <div className="stack" style={{ gap: "0.4rem" }}>
        {draft.values.map((value, index) => (
          <input
            key={index}
            className="axis-input"
            value={value}
            autoFocus={compact && index === 0}
            onChange={(event) => {
              const values = [...draft.values];
              values[index] = event.target.value;
              onChange({ kind: "simpleCollection", values });
            }}
          />
        ))}
        <button
          type="button"
          className="axis-btn"
          onClick={() => onChange({ kind: "simpleCollection", values: [...draft.values, ""] })}
        >
          Add value
        </button>
      </div>
    );
  }
  if (typeof draft.value === "boolean") {
    if (compact) {
      return (
        <label className="setting-instance-inline-check">
          <input
            type="checkbox"
            checked={draft.value}
            autoFocus
            onChange={(event) => onChange({ kind: "simple", value: event.target.checked })}
          />
          {draft.value ? "Enabled" : "Disabled"}
        </label>
      );
    }
    return (
      <label className="device-field">
        Enabled
        <input
          type="checkbox"
          checked={draft.value}
          onChange={(event) => onChange({ kind: "simple", value: event.target.checked })}
        />
      </label>
    );
  }
  return compact ? (
    <input
      className="axis-input"
      type={typeof draft.value === "number" ? "number" : "text"}
      value={String(draft.value)}
      autoFocus
      aria-label={catalogUiLabel([detail.displayName], detail.id)}
      onChange={(event) =>
        onChange({
          kind: "simple",
          value: typeof draft.value === "number" ? Number(event.target.value) : event.target.value,
        })
      }
    />
  ) : (
    <label className="device-field">
      Value
      <input
        className="axis-input"
        type={typeof draft.value === "number" ? "number" : "text"}
        value={String(draft.value)}
        onChange={(event) =>
          onChange({
            kind: "simple",
            value: typeof draft.value === "number" ? Number(event.target.value) : event.target.value,
          })
        }
      />
    </label>
  );
}
