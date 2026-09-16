import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { applyPackKit, planPackKitApply } from "../lib/tauri";
import { WriteActionButton } from "../lib/readOnly";
import type { KitApplyMode, KitApplyPlan, KitApplyPlanItem, KitApplyResult } from "../types/packs";

function statusLabel(status: KitApplyPlanItem["status"]): string {
  switch (status) {
    case "willAdd":
      return "Will add";
    case "willUpdate":
      return "Will update";
    case "skipExists":
      return "Exists — skip";
    case "skipMissing":
      return "No live match — skip";
    case "identical":
      return "Identical";
    case "settingsDiffer":
      return "Exists — settings differ";
    case "unsupported":
      return "Unsupported";
    case "applied":
      return "Applied";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    default:
      return status;
  }
}

function statusPillClass(status: KitApplyPlanItem["status"]): string {
  switch (status) {
    case "willAdd":
    case "identical":
    case "applied":
      return "axis-pill axis-pill-success packs-kits-apply-status";
    case "willUpdate":
    case "settingsDiffer":
      return "axis-pill axis-pill-warning packs-kits-apply-status";
    case "failed":
      return "axis-pill axis-pill-danger packs-kits-apply-status";
    default:
      return "axis-pill packs-kits-apply-status";
  }
}

function rowClass(status: KitApplyPlanItem["status"]): string {
  switch (status) {
    case "willAdd":
      return "packs-kits-apply-row is-will-add";
    case "willUpdate":
      return "packs-kits-apply-row is-will-update";
    case "identical":
      return "packs-kits-apply-row is-identical";
    case "settingsDiffer":
      return "packs-kits-apply-row is-settings-differ";
    default:
      return "packs-kits-apply-row";
  }
}

function isActionable(status: KitApplyPlanItem["status"]): boolean {
  return status === "willAdd" || status === "willUpdate";
}

export function ApplyKitDialog({
  packRoot,
  kitRelPath,
  kitName,
  onClose,
}: {
  packRoot: string;
  kitRelPath: string;
  kitName: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<KitApplyMode>("add");
  const [plan, setPlan] = useState<KitApplyPlan | null>(null);
  const [result, setResult] = useState<KitApplyResult | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("axis-pack-kit-apply-progress", (event) => {
      setProgress(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(null);
    void planPackKitApply({ packRoot, kitRelPath, mode })
      .then((next) => {
        if (cancelled) return;
        setPlan(next);
        const nextSelected: Record<string, boolean> = {};
        for (const item of next.items) {
          nextSelected[item.key] = isActionable(item.status);
        }
        setSelected(nextSelected);
      })
      .catch((err) => {
        if (cancelled) return;
        setPlan(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [packRoot, kitRelPath, mode]);

  const actionableKeys = useMemo(() => {
    if (!plan) return [];
    return plan.items
      .filter((item) => selected[item.key] && isActionable(item.status))
      .map((item) => item.key);
  }, [plan, selected]);

  async function onApply() {
    if (actionableKeys.length === 0) return;
    setBusy(true);
    setError(null);
    setProgress("Applying kit…");
    try {
      const next = await applyPackKit({
        packRoot,
        kitRelPath,
        mode,
        keys: actionableKeys,
      });
      setResult(next);
      setPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const rows = result?.items ?? plan?.items ?? [];
  const applyButtonClass =
    mode === "update" ? "axis-btn axis-btn-warning" : "axis-btn axis-btn-success";

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="axis-modal axis-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="apply-kit-title"
      >
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Apply kit</p>
            <h2 id="apply-kit-title">{kitName}</h2>
          </div>
          <button type="button" className="axis-btn" onClick={onClose} disabled={busy}>
            {result ? "Close" : "Cancel"}
          </button>
        </div>

        {!result ? (
          <p className="muted" style={{ margin: 0 }}>
            Pushes Settings Catalog policies and scripts from this kit into the signed-in tenant.
            After matching by id/name, Axis compares settings (or script text).{" "}
            <strong>Update</strong> overwrites the existing live object in place — it does not
            delete and recreate. Objects stay unassigned.
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Added {result.added} · updated {result.updated} · skipped {result.skipped} · failed{" "}
            {result.failed}
          </p>
        )}

        {!result ? (
          <fieldset
            className="device-field"
            style={{ marginTop: "0.85rem", border: 0, padding: 0 }}
            disabled={busy}
          >
            <legend style={{ marginBottom: "0.35rem" }}>Mode</legend>
            <div className="packs-kits-mode-options">
              <label
                className={`packs-kits-mode-option is-add${mode === "add" ? " is-selected" : ""}`}
              >
                <input
                  type="radio"
                  name="kit-apply-mode"
                  checked={mode === "add"}
                  onChange={() => setMode("add")}
                />
                <span>
                  <span className="packs-kits-mode-option-title">Add</span>
                  <span className="packs-kits-mode-option-copy">
                    Create missing objects. Skip when a live match already exists (even if settings
                    differ).
                  </span>
                </span>
              </label>
              <label
                className={`packs-kits-mode-option is-update${mode === "update" ? " is-selected" : ""}`}
              >
                <input
                  type="radio"
                  name="kit-apply-mode"
                  checked={mode === "update"}
                  onChange={() => setMode("update")}
                />
                <span>
                  <span className="packs-kits-mode-option-title">Update</span>
                  <span className="packs-kits-mode-option-copy">
                    Align matching live objects to kit settings in place. Skip identical and
                    missing.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        ) : null}

        {progress ? (
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            {progress}
          </p>
        ) : null}

        {error ? (
          <p className="axis-alert axis-alert-danger" style={{ marginTop: "0.85rem" }}>
            {error}
          </p>
        ) : null}

        {(plan?.warnings.length || result?.warnings.length) ? (
          <p className="muted" style={{ marginTop: "0.65rem" }}>
            {(result?.warnings ?? plan?.warnings ?? []).join(" · ")}
          </p>
        ) : null}

        <div
          className="packs-kits-apply-list"
          style={{ marginTop: "0.85rem", maxHeight: "22rem", overflow: "auto" }}
        >
          {busy && !rows.length ? (
            <p className="muted">Planning…</p>
          ) : rows.length === 0 ? (
            <p className="muted">Nothing to apply.</p>
          ) : (
            <ul className="packs-kits-artifact-list">
              {rows.map((item) => {
                const actionable = isActionable(item.status);
                return (
                  <li
                    key={item.key}
                    className={`packs-kits-artifact ${rowClass(item.status)}`}
                    style={{ display: "block" }}
                  >
                    <label
                      className="packs-kits-artifact"
                      style={{
                        opacity: !result && !actionable ? 0.75 : 1,
                      }}
                    >
                      {!result ? (
                        <input
                          type="checkbox"
                          checked={selected[item.key] === true}
                          disabled={busy || !actionable}
                          onChange={(event) =>
                            setSelected((current) => ({
                              ...current,
                              [item.key]: event.target.checked,
                            }))
                          }
                        />
                      ) : null}
                      <span>
                        <strong>{item.displayName}</strong>
                        <span className={statusPillClass(item.status)}>{statusLabel(item.status)}</span>
                        {item.message ? <span className="muted"> — {item.message}</span> : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {!result ? (
          <div className="page-header-actions" style={{ marginTop: "1rem", justifyContent: "flex-end" }}>
            <WriteActionButton
              type="button"
              className={applyButtonClass}
              disabled={busy || actionableKeys.length === 0}
              onClick={() => void onApply()}
            >
              {busy
                ? "Working…"
                : mode === "update"
                  ? `Update ${actionableKeys.length || ""}`.trim()
                  : `Add ${actionableKeys.length || ""}`.trim()}
            </WriteActionButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}
