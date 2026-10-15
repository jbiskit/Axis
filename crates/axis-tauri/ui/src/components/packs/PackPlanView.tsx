import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { applyPackChanges, type PackApplyChangesResult } from "../../lib/tauri";
import { WriteActionButton } from "../../lib/readOnly";
import { BooleanToggle } from "../workbench/BooleanToggle";
import type { RestorePlanItem } from "../../types/clientContainer";
import { driftStatus, type DriftStatus } from "./packCompare";

type Group = {
  status: DriftStatus;
  sign: string;
  title: string;
  hint: string;
  selectable: boolean;
};

const GROUPS: Group[] = [
  { status: "missing", sign: "+", title: "Create", hint: "Not in this tenant yet", selectable: true },
  { status: "differs", sign: "~", title: "Update in place", hint: "Matched to an existing policy with different settings", selectable: true },
  { status: "match", sign: "=", title: "Already match", hint: "No change needed", selectable: false },
  { status: "present", sign: "·", title: "In tenant, not compared", hint: "Exists already; settings were not compared", selectable: false },
  { status: "unsupported", sign: "–", title: "Skipped", hint: "Axis cannot apply this type from a pack yet", selectable: false },
];

/** Review exactly what a pack apply will create and change, then run it. */
export function PackPlanView({
  packName,
  kitName,
  packRoot,
  kitRelPath,
  items,
  initialKeys,
  onCancel,
  onDone,
}: {
  packName: string;
  kitName: string | null;
  packRoot: string;
  kitRelPath: string | null;
  items: RestorePlanItem[];
  initialKeys: string[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const byStatus = useMemo(() => {
    const map = new Map<DriftStatus, RestorePlanItem[]>();
    for (const item of items) {
      const status = driftStatus(item);
      map.set(status, [...(map.get(status) ?? []), item]);
    }
    return map;
  }, [items]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialKeys));
  // Updating live policies is opt-in unless the user started from a differing item.
  const [updateInPlace, setUpdateInPlace] = useState(() =>
    initialKeys.some((key) => (byStatus.get("differs") ?? []).some((item) => item.key === key)),
  );
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<PackApplyChangesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!applying) return;
    let unlisten: (() => void) | undefined;
    void listen<string>("axis-pack-kit-apply-progress", (event) => setProgress(event.payload)).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [applying]);

  const addKeys = (byStatus.get("missing") ?? []).filter((item) => selected.has(item.key)).map((item) => item.key);
  const updateKeys = updateInPlace
    ? (byStatus.get("differs") ?? []).filter((item) => selected.has(item.key)).map((item) => item.key)
    : [];
  const total = addKeys.length + updateKeys.length;

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroup(groupItems: RestorePlanItem[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of groupItems) {
        if (on) next.add(item.key);
        else next.delete(item.key);
      }
      return next;
    });
  }

  async function apply() {
    setApplying(true);
    setError(null);
    setProgress(null);
    try {
      setResult(await applyPackChanges({ packRoot, kitRelPath, addKeys, updateKeys }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  const step = result ? 3 : 2;

  return (
    <div className="stack packs-plan">
      <ol className="packs-steps" aria-label="Steps">
        <li className="is-done">
          <span className="packs-step-num">✓</span>Compare
        </li>
        <li className={step === 2 ? "is-current" : "is-done"} aria-current={step === 2 ? "step" : undefined}>
          <span className="packs-step-num">{step === 2 ? "2" : "✓"}</span>Review the plan
        </li>
        <li className={step === 3 ? "is-current" : ""} aria-current={step === 3 ? "step" : undefined}>
          <span className="packs-step-num">3</span>Apply
        </li>
        <button type="button" className="axis-btn axis-btn-ghost packs-steps-cancel" disabled={applying} onClick={result ? onDone : onCancel}>
          {result ? "Back to pack" : "Cancel"}
        </button>
      </ol>

      <div className="packs-plan-layout">
        <section className="packs-plan-main" aria-label="Plan">
          <div className="packs-plan-title">
            <h1>
              {kitName ? `${kitName} → this tenant` : `${packName} → this tenant`}
            </h1>
            {kitName ? <span className="muted">from {packName}</span> : null}
          </div>

          <div className="packs-plan-totals">
            {GROUPS.filter((group) => group.status !== "present" || (byStatus.get("present")?.length ?? 0) > 0).map((group) => (
              <div key={group.status} className={`axis-panel packs-total is-${group.status}`}>
                <span className="packs-total-n">{byStatus.get(group.status)?.length ?? 0}</span>
                <span className="packs-total-label">{group.title}</span>
              </div>
            ))}
          </div>

          {result ? <ApplyResult result={result} /> : null}

          {!result
            ? GROUPS.map((group) => {
                const groupItems = byStatus.get(group.status) ?? [];
                if (groupItems.length === 0) return null;
                const disabledGroup = group.status === "differs" && !updateInPlace;
                const pickedCount = groupItems.filter((item) => selected.has(item.key)).length;
                return (
                  <section key={group.status} className={`axis-panel packs-plan-group is-${group.status}`}>
                    <header className="packs-plan-group-head">
                      {group.selectable ? (
                        <input
                          type="checkbox"
                          aria-label={`Select every item to ${group.title.toLowerCase()}`}
                          checked={pickedCount === groupItems.length}
                          ref={(node) => {
                            if (node) node.indeterminate = pickedCount > 0 && pickedCount < groupItems.length;
                          }}
                          disabled={disabledGroup || applying}
                          onChange={() => toggleGroup(groupItems, pickedCount !== groupItems.length)}
                        />
                      ) : null}
                      <span className="packs-plan-sign" aria-hidden="true">
                        {group.sign}
                      </span>
                      <b>
                        {group.title} {groupItems.length}
                      </b>
                      <span className="muted packs-plan-hint">
                        {disabledGroup ? "Turn on “Update existing policies in place” to include these" : group.hint}
                      </span>
                    </header>
                    <ul className="packs-plan-rows">
                      {groupItems.map((item) => (
                        <li key={item.key} className={disabledGroup ? "is-disabled" : undefined}>
                          {group.selectable ? (
                            <input
                              type="checkbox"
                              aria-label={`Include ${item.displayName}`}
                              checked={selected.has(item.key)}
                              disabled={disabledGroup || applying}
                              onChange={() => toggle(item.key)}
                            />
                          ) : null}
                          <span className="packs-plan-row-copy">
                            <span className="packs-item-name">{item.displayName}</span>
                            <span className="packs-item-kind">
                              {item.kind}
                              {item.message ? ` · ${item.message}` : ""}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            : null}
        </section>

        {!result ? (
          <aside className="packs-plan-side" aria-label="Apply options">
            <section className="axis-panel axis-panel-padded packs-plan-options">
              <h2>Options</h2>
              <label className="packs-toggle-row">
                <BooleanToggle
                  checked={updateInPlace}
                  ariaLabel="Update existing policies in place"
                  disabled={applying || (byStatus.get("differs")?.length ?? 0) === 0}
                  onChange={setUpdateInPlace}
                />
                <span>
                  Update existing policies in place
                  <span className="muted packs-toggle-hint">Off: policies that differ are left as they are.</span>
                </span>
              </label>
              <p className="muted packs-plan-note">New policies are created without assignments.</p>
            </section>
            <section className="axis-panel axis-panel-padded packs-plan-summary">
              <h2>What will happen</h2>
              <ul>
                <li>{addKeys.length} created</li>
                <li>{updateKeys.length} updated in place</li>
                <li>Nothing in this tenant is deleted</li>
              </ul>
              <p className="muted">Every write is recorded in Write activity.</p>
            </section>
            {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
            {applying && progress ? <p className="muted packs-plan-progress">{progress}</p> : null}
            <WriteActionButton
              type="button"
              className="axis-btn axis-btn-primary packs-plan-apply"
              disabled={applying || total === 0}
              onClick={() => void apply()}
            >
              {applying ? "Applying…" : `Apply ${total} change${total === 1 ? "" : "s"}`}
            </WriteActionButton>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

export function ApplyResult({ result }: { result: PackApplyChangesResult }) {
  const failed = result.items.filter((item) => item.status === "failed");
  return (
    <section className={`axis-panel axis-panel-padded packs-plan-result${result.failed ? " has-failures" : ""}`}>
      <h2>{result.failed ? "Applied with errors" : "Applied"}</h2>
      <p>
        {result.added} created · {result.updated} updated · {result.skipped} skipped · {result.failed} failed
      </p>
      {failed.length ? (
        <ul>
          {failed.map((item) => (
            <li key={item.key}>
              <b>{item.displayName}</b> <span className="muted">{item.message ?? ""}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {result.warnings.length ? <p className="muted">{result.warnings.join(" · ")}</p> : null}
    </section>
  );
}
