import type { CatalogSettingDetail } from "../../types/inventory";
import { draftWithChoiceOption, type SettingValueDraft } from "../../lib/catalog";

export function SettingDraftEditor({
  detail,
  draft,
  dependents,
  onChange,
}: {
  detail: CatalogSettingDetail;
  draft: SettingValueDraft;
  dependents: Record<string, CatalogSettingDetail>;
  onChange: (draft: SettingValueDraft) => void;
}) {
  if (draft.kind === "unsupported") {
    return <p className="axis-alert axis-alert-warning">{draft.reason}</p>;
  }
  if (draft.kind === "choice") {
    return (
      <div className="stack" style={{ gap: "0.65rem" }}>
        <label className="device-field">
          Value
          <select
            className="axis-input"
            value={draft.optionItemId}
            onChange={(event) =>
              onChange(draftWithChoiceOption(detail, dependents, event.target.value, draft))
            }
          >
            {detail.options.map((option) => (
              <option key={option.itemId} value={option.itemId}>
                {option.displayName}
              </option>
            ))}
          </select>
        </label>
        {Object.entries(draft.children).map(([id, childDraft]) => {
          const child = dependents[id];
          if (!child) return null;
          return (
            <div key={id} className="catalog-nested">
              <p className="muted" style={{ margin: "0 0 0.35rem", fontSize: "0.75rem" }}>
                {child.displayName}
              </p>
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
        })}
      </div>
    );
  }
  if (draft.kind === "simpleCollection") {
    return (
      <div className="stack" style={{ gap: "0.4rem" }}>
        {draft.values.map((value, index) => (
          <input
            key={index}
            className="axis-input"
            value={value}
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
  return (
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
