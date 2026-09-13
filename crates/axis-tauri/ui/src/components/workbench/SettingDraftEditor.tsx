import type { CatalogSettingDetail } from "../../types/inventory";
import {
  booleanChoicePair,
  dependentsForOption,
  draftMatchesGraphDefault,
  draftWithChoiceOption,
  groupCollectionTypeDetail,
  isSimpleBooleanDraft,
  multilineXmlHint,
  newGroupCollectionRow,
  rowWithTypeOption,
  settingDraftSaveError,
  simpleBooleanValue,
  usesMultilineTextEditor,
  type SettingValueDraft,
} from "../../lib/catalog";
import { catalogUiLabel, isAdmxPlaceholderName } from "../../lib/catalogSettingDisplay";
import { BooleanToggle } from "./BooleanToggle";
import { SettingDefaultCue, SettingValueWithDefaultCue } from "./SettingDefaultCue";

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
  disabled = false,
  rowTemplateRefs,
}: {
  detail: CatalogSettingDetail;
  draft: SettingValueDraft;
  dependents: Record<string, CatalogSettingDetail>;
  onChange: (draft: SettingValueDraft) => void;
  compact?: boolean;
  dependentsOnly?: boolean;
  disabled?: boolean;
  /** Per-row template ids for a group collection, in template row order. */
  rowTemplateRefs?: Array<Record<string, string>>;
}) {
  if (draft.kind === "unsupported") {
    return <p className="axis-alert axis-alert-warning">{draft.reason}</p>;
  }
  if (draft.kind === "groupCollection") {
    if (dependentsOnly) return null;
    const typeDetail = groupCollectionTypeDetail(dependents);
    const typeLabel = typeDetail
      ? catalogUiLabel([typeDetail.displayName], typeDetail.id)
      : "Type";
    const table = (
      <div className="setting-group-collection">
        {draft.rows.length > 0 ? (
          <div className="setting-group-collection-head" aria-hidden="true">
            <span>{typeLabel}</span>
            <span>Additional settings</span>
            <span />
          </div>
        ) : null}
        {draft.rows.length === 0 ? (
          <p className="muted setting-group-collection-empty">
            No rows yet. Add a row to configure an entry.
          </p>
        ) : (
          draft.rows.map((row, index) => {
            const typeDraft = typeDetail ? row.children[typeDetail.id] : undefined;
            const optionItemId =
              typeDraft?.kind === "choice" ? typeDraft.optionItemId : "";
            const rowDeps = typeDetail
              ? dependentsForOption(typeDetail, optionItemId, dependents)
              : [];
            return (
              <div key={index} className="setting-group-collection-row">
                <div className="setting-group-collection-cell">
                  {typeDetail ? (
                    <select
                      className="axis-input"
                      value={optionItemId}
                      disabled={disabled}
                      aria-label={`${typeLabel} (row ${index + 1})`}
                      onChange={(event) =>
                        onChange({
                          kind: "groupCollection",
                          rows: draft.rows.map((candidate, i) =>
                            i === index
                              ? rowWithTypeOption(candidate, dependents, event.target.value)
                              : candidate,
                          ),
                        })
                      }
                    >
                      {(typeDetail.options ?? []).map((option) => (
                        <option key={option.itemId} value={option.itemId}>
                          {catalogUiLabel([option.displayName], option.itemId, typeDetail.id)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                <div className="setting-group-collection-cell is-fields">
                  {rowDeps.map((dep) => {
                    const child = dependents[dep.settingDefinitionId];
                    // Dependents of the row's `$type` choice live under that
                    // choice draft, not directly on the row.
                    const childDraft =
                      typeDraft?.kind === "choice"
                        ? typeDraft.children[dep.settingDefinitionId]
                        : undefined;
                    if (!child || !childDraft) return null;
                    const fieldLabel = catalogUiLabel([child.displayName], child.id);
                    return (
                      <label key={dep.settingDefinitionId} className="setting-group-collection-field">
                        <span className="setting-group-collection-field-label">
                          {fieldLabel}
                          {dep.required ? <span className="setting-required-mark"> *</span> : null}
                        </span>
                        <SettingDraftEditor
                          detail={child}
                          draft={childDraft}
                          dependents={dependents}
                          disabled={disabled}
                          compact
                          onChange={(next) =>
                            onChange({
                              kind: "groupCollection",
                              rows: draft.rows.map((candidate, i) => {
                                if (i !== index || !typeDetail) return candidate;
                                const candidateType = candidate.children[typeDetail.id];
                                if (candidateType?.kind !== "choice") return candidate;
                                return {
                                  ...candidate,
                                  children: {
                                    ...candidate.children,
                                    [typeDetail.id]: {
                                      ...candidateType,
                                      children: {
                                        ...candidateType.children,
                                        [dep.settingDefinitionId]: next,
                                      },
                                    },
                                  },
                                };
                              }),
                            })
                          }
                        />
                      </label>
                    );
                  })}
                </div>
                <div className="setting-group-collection-cell is-actions">
                  <button
                    type="button"
                    className="axis-btn"
                    disabled={disabled}
                    onClick={() =>
                      onChange({
                        kind: "groupCollection",
                        rows: draft.rows.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })
        )}
        <div className="setting-group-collection-foot">
          <button
            type="button"
            className="axis-btn"
            disabled={disabled}
            onClick={() =>
              onChange({
                kind: "groupCollection",
                rows: [
                  ...draft.rows,
                  newGroupCollectionRow(dependents, rowTemplateRefs?.[draft.rows.length]),
                ],
              })
            }
          >
            Add row
          </button>
        </div>
      </div>
    );
    // The row table is wide; never squeeze it into the inline value column.
    if (compact) return table;
    return table;
  }
  if (draft.kind === "choiceCollection") {
    if (dependentsOnly) return null;
    const selected = new Set(draft.optionItemIds);
    const toggle = (itemId: string, next: boolean) => {
      const optionItemIds = next
        ? [...draft.optionItemIds, itemId]
        : draft.optionItemIds.filter((id) => id !== itemId);
      onChange({ kind: "choiceCollection", optionItemIds });
    };
    const list = (
      <div className="setting-choice-collection">
        {(detail.options ?? []).map((option) => {
          const label = catalogUiLabel([option.displayName], option.itemId, detail.id);
          // Graph often repeats the option's displayName verbatim in description;
          // rendering both doubles a long sentence for no added information.
          const description =
            option.description && option.description.trim() !== label.trim()
              ? option.description
              : null;
          return (
            <label key={option.itemId} className="setting-choice-collection-option">
              <input
                type="checkbox"
                checked={selected.has(option.itemId)}
                disabled={disabled}
                onChange={(event) => toggle(option.itemId, event.target.checked)}
              />
              <span className="setting-choice-collection-text">
                <span className="setting-choice-collection-label">{label}</span>
                {description ? (
                  <span className="muted setting-choice-collection-desc">{description}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    );
    const withDefault = (
      <SettingValueWithDefaultCue show={draftMatchesGraphDefault(detail, draft)}>
        {list}
      </SettingValueWithDefaultCue>
    );
    if (compact) return withDefault;
    return (
      <label className="device-field">
        Value
        {withDefault}
      </label>
    );
  }
  if (draft.kind === "choice") {
    const settingLabel = catalogUiLabel([detail.displayName], detail.id);
    const pair = booleanChoicePair(detail);
    const select = pair ? (
      <span className="setting-boolean-toggle">
        <BooleanToggle
          checked={draft.optionItemId === pair.trueItemId}
          disabled={disabled}
          autoFocus={compact && !dependentsOnly}
          ariaLabel={settingLabel}
          onChange={(next) =>
            onChange(
              draftWithChoiceOption(
                detail,
                dependents,
                next ? pair.trueItemId : pair.falseItemId,
                draft,
              ),
            )
          }
        />
        <span className="setting-boolean-toggle-label">
          {catalogUiLabel(
            [(detail.options ?? []).find((option) => option.itemId === draft.optionItemId)?.displayName],
            draft.optionItemId,
            detail.id,
          )}
        </span>
      </span>
    ) : (
      <select
        className="axis-input"
        value={draft.optionItemId}
        disabled={disabled}
        autoFocus={compact && !dependentsOnly}
        aria-label={settingLabel}
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
    const optionDeps = dependentsForOption(detail, draft.optionItemId, dependents);
    const children = Object.entries(draft.children).map(([id, childDraft]) => {
      const child = dependents[id];
      if (!child) return null;
      const nestedTitle = isAdmxPlaceholderName(child.displayName)
        ? null
        : catalogUiLabel([child.displayName], child.id);
      const required = optionDeps.some((dep) => dep.settingDefinitionId === id && dep.required);
      const collectionError =
        required && childDraft.kind === "simpleCollection"
          ? settingDraftSaveError(child, childDraft, dependents, true)
          : null;
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
            disabled={disabled}
            onChange={(next) =>
              onChange({
                ...draft,
                children: { ...draft.children, [id]: next },
              })
            }
          />
          {collectionError ? <p className="axis-alert axis-alert-warning">{collectionError}</p> : null}
        </div>
      );
    });
    const withDefault = (
      <SettingValueWithDefaultCue show={draftMatchesGraphDefault(detail, draft)}>{select}</SettingValueWithDefaultCue>
    );
    if (dependentsOnly) {
      return children.length ? <div className="stack" style={{ gap: "0.65rem" }}>{children}</div> : null;
    }
    if (compact) return withDefault;
    return (
      <div className="stack" style={{ gap: "0.65rem" }}>
        <label className="device-field">
          Value
          {withDefault}
        </label>
        {children}
      </div>
    );
  }
  if (dependentsOnly) return null;
  if (draft.kind === "simpleCollection") {
    return (
      <div className="stack" style={{ gap: "0.4rem" }}>
        <SettingDefaultCue show={draftMatchesGraphDefault(detail, draft)} />
        {draft.values.map((value, index) => (
          <input
            key={index}
            className="axis-input"
            value={value}
            disabled={disabled}
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
          disabled={disabled}
          onClick={() => onChange({ kind: "simpleCollection", values: [...draft.values, ""] })}
        >
          Add value
        </button>
      </div>
    );
  }
  const simpleDefault = draftMatchesGraphDefault(detail, draft);
  if (draft.kind === "simple" && isSimpleBooleanDraft(detail, draft)) {
    const toggle = (
      <BooleanToggle
        checked={simpleBooleanValue(draft)}
        disabled={disabled}
        autoFocus={compact}
        ariaLabel={catalogUiLabel([detail.displayName], detail.id)}
        onChange={(next) => onChange({ kind: "simple", value: next })}
      />
    );
    if (compact) {
      return <SettingValueWithDefaultCue show={simpleDefault}>{toggle}</SettingValueWithDefaultCue>;
    }
    return (
      <label className="device-field">
        Value
        <SettingValueWithDefaultCue show={simpleDefault}>{toggle}</SettingValueWithDefaultCue>
      </label>
    );
  }
  const isNumber = typeof draft.value === "number";
  const multiline = !isNumber && usesMultilineTextEditor(detail);
  const stringValue = String(draft.value);
  const xmlHint = multiline && !isNumber ? multilineXmlHint(detail, stringValue) : null;
  const input = multiline ? (
    <textarea
      className="axis-input axis-input-multiline"
      rows={10}
      spellCheck={false}
      wrap="soft"
      value={stringValue}
      disabled={disabled}
      autoFocus={compact}
      aria-label={catalogUiLabel([detail.displayName], detail.id)}
      onChange={(event) => onChange({ kind: "simple", value: event.target.value })}
    />
  ) : (
    <input
      className="axis-input"
      type={isNumber ? "number" : "text"}
      value={stringValue}
      disabled={disabled}
      autoFocus={compact}
      aria-label={catalogUiLabel([detail.displayName], detail.id)}
      onChange={(event) =>
        onChange({
          kind: "simple",
          value: isNumber ? Number(event.target.value) : event.target.value,
        })
      }
    />
  );
  const withDefault = (
    <SettingValueWithDefaultCue show={simpleDefault}>{input}</SettingValueWithDefaultCue>
  );
  const body = (
    <>
      {withDefault}
      {xmlHint ? <p className="muted setting-multiline-hint">{xmlHint}</p> : null}
    </>
  );
  return compact ? (
    body
  ) : (
    <label className="device-field">
      Value
      {body}
    </label>
  );
}
