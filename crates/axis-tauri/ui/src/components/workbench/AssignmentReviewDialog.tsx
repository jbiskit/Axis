import { useEffect, useState } from "react";
import { assignmentFingerprint, summarizeAssignmentDraft } from "../../lib/assignmentSummary";
import { fetchGraphObjectDetail, loadAssignmentWorkspace } from "../../lib/tauri";
import type { AssignmentDraft } from "../../types/inventory";
import { CloseButton } from "../ui/CloseButton";

/** Saving assignments replaces the whole list, so review what each object loses. */
export type AssignmentDiff = {
  added: AssignmentDraft[];
  removed: AssignmentDraft[];
  changed: Array<{ before: AssignmentDraft; after: AssignmentDraft }>;
  kept: number;
};

function identity(draft: AssignmentDraft): string {
  return `${draft.intent ?? ""}:${draft.targetKind}:${draft.groupId ?? ""}`;
}

export function diffAssignments(before: AssignmentDraft[], after: AssignmentDraft[]): AssignmentDiff {
  const beforeById = new Map(before.map((draft) => [identity(draft), draft]));
  const afterIds = new Set(after.map(identity));
  const diff: AssignmentDiff = { added: [], removed: [], changed: [], kept: 0 };
  for (const draft of after) {
    const previous = beforeById.get(identity(draft));
    if (!previous) diff.added.push(draft);
    else if (assignmentFingerprint([previous]) !== assignmentFingerprint([draft]))
      diff.changed.push({ before: previous, after: draft });
    else diff.kept += 1;
  }
  diff.removed = before.filter((draft) => !afterIds.has(identity(draft)));
  return diff;
}

const isBroad = (draft: AssignmentDraft) =>
  draft.targetKind === "allUsers" || draft.targetKind === "allDevices";

/** Adding groups to one object saves straight away. Anything that removes, rewrites, or broadens is reviewed. */
export function assignmentChangeNeedsReview(diff: AssignmentDiff): boolean {
  return diff.removed.length > 0 || diff.changed.length > 0 || diff.added.some(isBroad);
}

type TargetReview = {
  id: string;
  title: string;
  diff: AssignmentDiff | null;
  error: string | null;
};

export function AssignmentReviewDialog({
  kind,
  objectOdataType,
  targets,
  drafts,
  baseline,
  supportsIntent,
  supportsSchedule,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: string;
  objectOdataType?: string | null;
  targets: Array<{ id: string; title: string }>;
  drafts: AssignmentDraft[];
  /** Current assignments when there is one target; bulk saves read each object's own. */
  baseline: AssignmentDraft[] | null;
  supportsIntent: boolean;
  supportsSchedule: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [reviews, setReviews] = useState<TargetReview[] | null>(
    baseline
      ? targets.map((target) => ({ ...target, diff: diffAssignments(baseline, drafts), error: null }))
      : null,
  );

  useEffect(() => {
    if (baseline) return;
    let cancelled = false;
    void (async () => {
      const results: TargetReview[] = [];
      // Small batches keep a large selection from tripping Graph throttling.
      for (let index = 0; index < targets.length; index += 4) {
        const chunk = targets.slice(index, index + 4);
        results.push(
          ...(await Promise.all(
            chunk.map(async (target): Promise<TargetReview> => {
              try {
                const detail = await fetchGraphObjectDetail(kind, target.id);
                if (!detail.detail) {
                  return { ...target, diff: null, error: detail.error ?? "Could not read current assignments." };
                }
                const workspace = await loadAssignmentWorkspace(
                  kind,
                  detail.detail.assignments ?? [],
                  objectOdataType,
                );
                return { ...target, diff: diffAssignments(workspace.drafts, drafts), error: null };
              } catch (error) {
                return {
                  ...target,
                  diff: null,
                  error: error instanceof Error ? error.message : "Could not read current assignments.",
                };
              }
            }),
          )),
        );
        if (cancelled) return;
      }
      if (!cancelled) setReviews(results);
    })();
    return () => {
      cancelled = true;
    };
  }, [baseline, drafts, kind, objectOdataType, targets]);

  const summary = (draft: AssignmentDraft) => summarizeAssignmentDraft(draft, { supportsIntent, supportsSchedule });
  const totals = (reviews ?? []).reduce(
    (sum, review) => ({
      removed: sum.removed + (review.diff?.removed.length ?? 0),
      added: sum.added + (review.diff?.added.length ?? 0),
      changed: sum.changed + (review.diff?.changed.length ?? 0),
      unknown: sum.unknown + (review.diff ? 0 : 1),
    }),
    { removed: 0, added: 0, changed: 0, unknown: 0 },
  );
  const broad = drafts.filter(isBroad);
  const clearing = drafts.length === 0;

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="axis-modal axis-modal-wide object-action-pane" role="alertdialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Review assignments</p>
            <h2>
              {clearing ? "Clear all assignments" : "Replace assignments"} on {targets.length}{" "}
              {targets.length === 1 ? "object" : "objects"}?
            </h2>
          </div>
          <CloseButton onClick={onCancel} disabled={busy} />
        </div>
        <p style={{ margin: 0 }}>
          Saving replaces each object’s assignment list with the {drafts.length} target
          {drafts.length === 1 ? "" : "s"} below. Anything an object has that is not in the list is removed.
        </p>
        {broad.length > 0 ? (
          <div className="axis-alert axis-alert-warning">
            {broad.map((draft) => summary(draft)).join(" and ")} reaches every{" "}
            {broad.some((draft) => draft.targetKind === "allDevices") ? "device" : "user"} in the tenant.
          </div>
        ) : null}
        {reviews === null ? (
          <p className="muted">Reading current assignments for {targets.length} objects…</p>
        ) : (
          <>
            <p className="muted" style={{ margin: 0, fontSize: "0.8125rem" }}>
              {totals.removed} removed · {totals.added} added · {totals.changed} changed
              {totals.unknown ? ` · ${totals.unknown} could not be read` : ""}
            </p>
            <div style={{ maxHeight: "50vh", overflow: "auto" }} className="stack">
              {reviews.map((review) => (
                <section key={review.id}>
                  <h3 style={{ margin: "0 0 0.3rem", fontSize: "0.85rem" }}>{review.title}</h3>
                  {review.error ? (
                    <p className="setting-field-error" style={{ margin: 0 }}>
                      {review.error} Its current assignments will still be replaced.
                    </p>
                  ) : review.diff &&
                    review.diff.removed.length + review.diff.added.length + review.diff.changed.length === 0 ? (
                    <p className="muted" style={{ margin: 0, fontSize: "0.8125rem" }}>No change.</p>
                  ) : review.diff ? (
                    <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8125rem" }}>
                      {review.diff.removed.map((draft) => (
                        <li key={`r-${summary(draft)}`} className="setting-field-error">
                          Remove · {summary(draft)}
                        </li>
                      ))}
                      {review.diff.changed.map(({ before, after }) => (
                        <li key={`c-${summary(after)}`}>
                          Change · {summary(before)} → {summary(after)}
                        </li>
                      ))}
                      {review.diff.added.map((draft) => (
                        <li key={`a-${summary(draft)}`}>Add · {summary(draft)}</li>
                      ))}
                      {review.diff.kept ? (
                        <li className="muted">{review.diff.kept} unchanged</li>
                      ) : null}
                    </ul>
                  ) : null}
                </section>
              ))}
            </div>
          </>
        )}
        <div className="object-action-footer">
          <span className="muted" style={{ fontSize: "0.75rem" }}>
            This save is recorded in Write activity, where it can be undone while undo is on in Settings.
          </span>
          <div className="device-actions">
            <button type="button" className="axis-btn" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className={totals.removed > 0 || clearing ? "axis-btn axis-btn-danger" : "axis-btn axis-btn-primary"}
              disabled={busy || reviews === null}
              onClick={onConfirm}
            >
              {busy ? "Saving…" : clearing ? "Clear assignments" : "Save assignments"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
