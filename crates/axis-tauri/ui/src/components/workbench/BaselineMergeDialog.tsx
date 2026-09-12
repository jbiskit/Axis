import { useEffect, useMemo, useState } from "react";
import {
  catalogDescriptionFromPolicy,
  catalogPlatformFromPolicy,
  catalogSettingsFromPolicy,
  normalizeIntunePolicyExport,
} from "../../lib/baselines/policyExport";
import {
  allConflictsResolved,
  applyMergeResolutions,
  defaultResolutions,
  planPolicyMerge,
  type MergePlanOk,
  type MergeSourcePolicy,
} from "../../lib/baselines/mergePolicyExports";
import { asRecord } from "../../lib/baselines/settingLeaves";
import { tokenForSource } from "../../lib/baselines/sources";
import { createSettingsCatalogPolicy, fetchBaselineExport } from "../../lib/tauri";
import { navigate } from "../../lib/route";
import type { BaselineReferenceSourceInput, E8BaselineReference } from "../../types/inventory";

type MergeReference = E8BaselineReference & { sourceId: string; sourceName: string };

type LoadRow = {
  key: string;
  referenceName: string;
  status: "loading" | "ready" | "error";
  error: string | null;
  source: MergeSourcePolicy | null;
};

function templateFamilyFromPolicy(policy: Record<string, unknown>): string | undefined {
  const reference = asRecord(policy.templateReference);
  const family = reference?.templateFamily;
  return typeof family === "string" ? family : undefined;
}

function technologiesFromPolicy(policy: Record<string, unknown>): string | undefined {
  return typeof policy.technologies === "string" ? policy.technologies : undefined;
}

async function loadMergeSource(
  reference: MergeReference,
  sources: BaselineReferenceSourceInput[],
): Promise<MergeSourcePolicy> {
  const response = await fetchBaselineExport(
    reference.downloadUrl,
    tokenForSource(sources, reference.sourceId),
  );
  if (response.error || response.document == null) {
    throw new Error(response.error ?? "The baseline export was empty.");
  }
  const fileName = reference.downloadUrl.split(/[\\/]/).pop() ?? `${reference.name}.json`;
  const policy = normalizeIntunePolicyExport(response.document, fileName);
  const settings = catalogSettingsFromPolicy(policy);
  if (settings.length === 0) {
    throw new Error("No Settings Catalog instances in this file.");
  }
  const importedName =
    (typeof policy.name === "string" && policy.name.trim()) ||
    (typeof policy.displayName === "string" && policy.displayName.trim()) ||
    reference.name;
  return {
    key: `ref:${reference.sourceId}:${reference.id}`,
    name: importedName,
    platform: catalogPlatformFromPolicy(policy),
    technologies: technologiesFromPolicy(policy),
    templateFamily: templateFamilyFromPolicy(policy),
    description: catalogDescriptionFromPolicy(policy),
    settings,
  };
}

export function BaselineMergeDialog({
  references,
  sources,
  kicker,
  onClose,
  onDone,
}: {
  references: MergeReference[];
  sources: BaselineReferenceSourceInput[];
  kicker: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const referenceKey = references.map((reference) => `${reference.sourceId}:${reference.id}`).join("\0");
  const [rows, setRows] = useState<LoadRow[]>(() =>
    references.map((reference) => ({
      key: `ref:${reference.sourceId}:${reference.id}`,
      referenceName: reference.name,
      status: "loading" as const,
      error: null,
      source: null,
    })),
  );
  const [plan, setPlan] = useState<MergePlanOk | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [platform, setPlatform] = useState<"windows" | "macos">("windows");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(
      references.map((reference) => ({
        key: `ref:${reference.sourceId}:${reference.id}`,
        referenceName: reference.name,
        status: "loading" as const,
        error: null,
        source: null,
      })),
    );
    setPlan(null);
    setPlanError(null);
    setResolutions({});
    setError(null);

    void (async () => {
      const loaded: MergeSourcePolicy[] = [];
      for (const reference of references) {
        if (cancelled) return;
        const key = `ref:${reference.sourceId}:${reference.id}`;
        try {
          const source = await loadMergeSource(reference, sources);
          if (cancelled) return;
          loaded.push(source);
          setRows((current) =>
            current.map((row) =>
              row.key === key
                ? { ...row, status: "ready", error: null, source }
                : row,
            ),
          );
        } catch (err) {
          if (cancelled) return;
          setRows((current) =>
            current.map((row) =>
              row.key === key
                ? {
                    ...row,
                    status: "error",
                    error: err instanceof Error ? err.message : String(err),
                    source: null,
                  }
                : row,
            ),
          );
        }
      }
      if (cancelled) return;

      const ready = loaded.filter(Boolean);
      if (ready.length < 2) {
        setPlan(null);
        setPlanError(
          ready.length === 0
            ? "Could not load any selected exports."
            : "Need at least two successful Settings Catalog loads to merge.",
        );
        return;
      }

      // Preserve selection order from references.
      const ordered = references
        .map((reference) => ready.find((source) => source.key === `ref:${reference.sourceId}:${reference.id}`))
        .filter((source): source is MergeSourcePolicy => Boolean(source));

      const nextPlan = planPolicyMerge(ordered);
      if (!nextPlan.ok) {
        setPlan(null);
        setPlanError(nextPlan.error);
        return;
      }
      setPlan(nextPlan);
      setPlanError(null);
      setResolutions(defaultResolutions(nextPlan));
      setName(nextPlan.defaultName);
      setDescription(nextPlan.description);
      setPlatform(nextPlan.platform);
    })();

    return () => {
      cancelled = true;
    };
  }, [referenceKey, sources]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const stillLoading = rows.some((row) => row.status === "loading");
  const loadErrors = rows.filter((row) => row.status === "error");
  const canCreate =
    Boolean(plan) &&
    !stillLoading &&
    !planError &&
    name.trim().length > 0 &&
    plan != null &&
    allConflictsResolved(plan, resolutions);

  const previewSettings = useMemo(() => {
    if (!plan) return [];
    return applyMergeResolutions(plan, resolutions);
  }, [plan, resolutions]);

  async function createMergedPolicy() {
    if (!plan || !canCreate) return;
    setSaving(true);
    setError(null);
    try {
      const settings = applyMergeResolutions(plan, resolutions);
      const response = await createSettingsCatalogPolicy({
        name: name.trim(),
        description,
        platform,
        settings,
      });
      if (response.error || !response.policy) {
        setError(response.error ?? "Create failed.");
        return;
      }
      onDone();
      navigate(
        `/intune/policies/settings-catalog?platform=${platform}&policy=${encodeURIComponent(
          response.policy.id,
        )}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className="axis-modal axis-modal-wide" role="dialog" aria-modal="true">
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">{kicker}</p>
            <h2>
              Combine {references.length} polic{references.length === 1 ? "y" : "ies"}
            </h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              Union Settings Catalog settings by definition id. When the same setting differs,
              choose which source value to keep. The result is created unassigned.
            </p>
          </div>
          <button type="button" className="axis-btn" disabled={saving} onClick={onClose}>
            Close
          </button>
        </div>

        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {planError ? <div className="axis-alert axis-alert-danger">{planError}</div> : null}
        {stillLoading ? <p className="muted">Downloading and comparing exports…</p> : null}

        {loadErrors.length > 0 ? (
          <div className="axis-alert axis-alert-warning">
            {loadErrors.length} export{loadErrors.length === 1 ? "" : "s"} failed to load
            {plan ? " and will be omitted from the merge" : ""}.
            <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
              {loadErrors.map((row) => (
                <li key={row.key}>
                  {row.referenceName}: {row.error}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {plan ? (
          <div className="object-action-fields" style={{ maxHeight: "55vh", overflow: "auto" }}>
            {plan.conflicts.length > 0 ? (
              <div className="stack" style={{ gap: "0.85rem", marginBottom: "1rem" }}>
                <p style={{ margin: 0, fontWeight: 600 }}>
                  {plan.conflicts.length} conflict{plan.conflicts.length === 1 ? "" : "s"}
                </p>
                {plan.conflicts.map((conflict) => (
                  <fieldset
                    key={conflict.settingKey}
                    style={{
                      margin: 0,
                      border: "1px solid var(--axis-border, #d0d5dd)",
                      borderRadius: "6px",
                      padding: "0.65rem 0.75rem",
                    }}
                  >
                    <legend style={{ padding: "0 0.25rem", fontWeight: 600 }}>
                      {conflict.displayName}
                    </legend>
                    <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.75rem" }}>
                      {conflict.settingKey}
                    </p>
                    <div className="stack" style={{ gap: "0.45rem" }}>
                      {conflict.sources.map((source) => {
                        const inputId = `merge-${conflict.settingKey}-${source.sourceKey}`;
                        return (
                          <label
                            key={source.sourceKey}
                            htmlFor={inputId}
                            className="axis-check"
                            style={{ alignItems: "flex-start", gap: "0.5rem" }}
                          >
                            <input
                              id={inputId}
                              type="radio"
                              name={`conflict-${conflict.settingKey}`}
                              checked={
                                (resolutions[conflict.settingKey] ?? conflict.defaultSourceKey) ===
                                source.sourceKey
                              }
                              disabled={saving}
                              onChange={() =>
                                setResolutions((current) => ({
                                  ...current,
                                  [conflict.settingKey]: source.sourceKey,
                                }))
                              }
                            />
                            <span>
                              <strong>{source.sourceName}</strong>
                              <span className="muted" style={{ display: "block", marginTop: "0.15rem" }}>
                                {source.valueSummary}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ marginTop: 0 }}>
                No direct setting conflicts. All overlapping settings match.
              </p>
            )}

            <label className="device-field">
              Policy name
              <input
                className="axis-input"
                value={name}
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="device-field">
              Description
              <textarea
                className="axis-input object-action-description"
                value={description}
                rows={3}
                disabled={saving}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className="device-field">
              Platform
              <select
                className="axis-input"
                value={platform}
                disabled={saving}
                onChange={(event) => setPlatform(event.target.value as "windows" | "macos")}
              >
                <option value="windows">Windows</option>
                <option value="macos">macOS</option>
              </select>
            </label>
            <p className="muted" style={{ margin: 0 }}>
              {plan.uniqueSettingCount} unique setting
              {plan.uniqueSettingCount === 1 ? "" : "s"}
              {" · "}
              {plan.conflicts.length} conflict
              {plan.conflicts.length === 1 ? "" : "s"} resolved
              {" · "}
              {previewSettings.length} setting
              {previewSettings.length === 1 ? "" : "s"} in merged policy
              {" · "}
              from {plan.sourceCount} source
              {plan.sourceCount === 1 ? "" : "s"}
            </p>
          </div>
        ) : null}

        <div className="object-action-footer">
          <p className="muted">Assignments are not merged. The created policy stays unassigned.</p>
          <div className="device-actions">
            <button type="button" className="axis-btn" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              disabled={saving || !canCreate}
              onClick={() => void createMergedPolicy()}
            >
              {saving ? "Creating…" : "Create merged policy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
