import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  applyDraftToCatalogConfig,
  catalogArchitectureReady,
  catalogMinimumOsReady,
  catalogRuleReady,
  draftFromCatalogConfig,
  type CatalogDependency,
  type CatalogPackageDraft,
} from "../../lib/catalogPackage";
import {
  attachCatalogIcon,
  attachCatalogIntuneWin,
  catalogDependencyChain,
  fetchCatalogIcon,
  findCatalogUploadMatches,
  linkCatalogDependency,
  pickAppIcon,
  pickIntuneWinFile,
  readCatalogAppConfig,
  saveCatalogAppConfig,
  uploadCatalogIntuneWin,
  type CatalogAppIcon,
  type CatalogAppSummary,
  type CatalogDependencyChain,
  type Win32AppMatch,
  type Win32UploadProgress,
  type Win32UploadResult,
} from "../../lib/tauri";
import {
  WIN32_ARCHITECTURES,
  WIN32_MIN_WINDOWS_RELEASES,
  emptyDetectionRule,
  summarizeDetectionRule,
  type Win32DetectionRule,
} from "../../lib/win32App";
import { ScriptCodeEditor } from "../ui/ScriptCodeEditor";
import { MarkdownField } from "./MarkdownField";
import { finishUpload, trackUpload } from "../../lib/uploadTasks";
import { BooleanToggle } from "./BooleanToggle";
import { DetectionRuleFields, Field, Pane, SelectOptions, ToggleRow } from "./Win32AppEditor";

export function CatalogAppBuilder({
  app,
  sourceRoot,
  catalogApps,
  onSaved,
}: {
  app: CatalogAppSummary;
  sourceRoot: string;
  catalogApps: CatalogAppSummary[];
  onSaved: () => void;
}) {
  const [baseline, setBaseline] = useState<CatalogPackageDraft | null>(null);
  const [original, setOriginal] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<CatalogPackageDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [packageFile, setPackageFile] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [iconUrlInput, setIconUrlInput] = useState("");
  const [matches, setMatches] = useState<Win32AppMatch[] | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [dependencyChain, setDependencyChain] = useState<CatalogDependencyChain | null>(null);
  const [addDependencyPath, setAddDependencyPath] = useState("");
  const [selectedDependencies, setSelectedDependencies] = useState<string[]>([]);
  const [uploadLabel, setUploadLabel] = useState(app.name);
  const uploadTargetRef = useRef<UploadTarget>({
    appPath: app.localPath,
    label: app.name,
    relativePath: app.relativePath,
  });
  const planRef = useRef<DependencyUploadPlan | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);
    setProgress(null);
    void readCatalogAppConfig(app.localPath, sourceRoot)
      .then((document) => {
        if (cancelled) return;
        const next = draftFromCatalogConfig(document.config);
        if (!next.iconValue && document.iconPreview?.value) {
          next.iconValue = document.iconPreview.value;
          next.iconType = document.iconPreview.type || next.iconType;
        }
        setOriginal(document.config);
        setBaseline(next);
        setDraft(next);
        setIconUrlInput(next.iconUrl);
        setPackageFile(document.intuneWinFile ?? null);
        setProgress(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setOriginal(null);
        setBaseline(null);
        setDraft(null);
        setPackageFile(null);
        setIconUrlInput("");
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [app.localPath, sourceRoot]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<Win32UploadProgress>("axis-intunewin-upload-progress", (event) => {
      setProgress(event.payload.message);
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const dirty = useMemo(
    () => Boolean(draft && baseline && JSON.stringify(draft) !== JSON.stringify(baseline)),
    [baseline, draft],
  );

  function patch(next: Partial<CatalogPackageDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function updateRule(index: number, next: Win32DetectionRule) {
    setDraft((current) =>
      current
        ? {
            ...current,
            detectionRules: current.detectionRules.map((rule, ruleIndex) =>
              ruleIndex === index ? next : rule,
            ),
          }
        : current,
    );
  }

  async function save() {
    if (!draft || !original || !dirty) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveCatalogAppConfig({
        appPath: app.localPath,
        sourceRoot,
        config: applyDraftToCatalogConfig(original, draft),
      });
      const next = draftFromCatalogConfig(saved.config);
      setOriginal(saved.config);
      setBaseline(next);
      setDraft(next);
      setMessage("Saved PackageInformation/config.json.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function attachPackage() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const picked = await pickIntuneWinFile();
      if (!picked) return;
      const attached = await attachCatalogIntuneWin({
        appPath: app.localPath,
        sourceRoot,
        filePath: picked,
      });
      setPackageFile(attached.fileName);
      setMessage(`Attached ${attached.fileName}.`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function applyIcon(icon: CatalogAppIcon) {
    setDraft((current) =>
      current
        ? {
            ...current,
            iconFile: icon.file,
            iconType: icon.type || "image/png",
            iconValue: icon.value,
            iconUrl: icon.url ?? "",
          }
        : current,
    );
    setIconUrlInput(icon.url ?? "");
    setMessage(`Icon set from ${icon.url ?? icon.file}. Save config to keep it.`);
  }

  async function chooseIconFile() {
    setIconBusy(true);
    setError(null);
    try {
      const picked = await pickAppIcon();
      if (!picked) return;
      applyIcon(
        await attachCatalogIcon({
          appPath: app.localPath,
          sourceRoot,
          filePath: picked,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIconBusy(false);
    }
  }

  async function fetchIcon() {
    const url = iconUrlInput.trim();
    if (!url) {
      setError("Enter an icon image URL first.");
      return;
    }
    setIconBusy(true);
    setError(null);
    try {
      applyIcon(
        await fetchCatalogIcon({
          appPath: app.localPath,
          sourceRoot,
          url,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIconBusy(false);
    }
  }

  function clearIcon() {
    setDraft((current) =>
      current
        ? { ...current, iconFile: "", iconType: "image/png", iconValue: "", iconUrl: "" }
        : current,
    );
    setIconUrlInput("");
  }

  function rootTarget(): UploadTarget {
    return {
      appPath: app.localPath,
      label: draft?.displayName || app.name,
      relativePath: app.relativePath,
    };
  }

  async function applyDependencyLinks(plan: DependencyUploadPlan): Promise<string[]> {
    const notes: string[] = [];
    const links = [...plan.links].sort((left, right) => right.depth - left.depth);
    for (const link of links) {
      const parentId = plan.ids[pathKey(link.parentPath)];
      const targetId = plan.ids[pathKey(link.targetPath)];
      if (!parentId) {
        notes.push(
          `Could not mark ${link.targetLabel} as a dependency of ${link.parentLabel} because ${link.parentLabel} is not in Intune.`,
        );
        continue;
      }
      if (!targetId) {
        notes.push(`Could not mark ${link.targetLabel} as a dependency because it is not in Intune.`);
        continue;
      }
      setProgress(`Marking ${link.targetLabel} as a dependency of ${link.parentLabel}…`);
      try {
        await linkCatalogDependency({
          parentAppId: parentId,
          targetAppId: targetId,
          autoInstall: link.autoInstall,
        });
        notes.push(
          link.autoInstall
            ? `Marked ${link.targetLabel} as a dependency of ${link.parentLabel}. Intune will install it automatically.`
            : `Marked ${link.targetLabel} as a dependency of ${link.parentLabel}. Intune will require it to be installed already.`,
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        notes.push(`Could not mark ${link.targetLabel} as a dependency of ${link.parentLabel}: ${detail}`);
      }
    }
    setProgress(null);
    return notes;
  }

  async function continuePlan(last: Win32UploadResult, existingAppId: string | null, contentOnly: boolean) {
    const plan = planRef.current;
    if (!plan) return;
    if (last.warning) plan.notes.push(last.warning);
    if (plan.phase === "deps") {
      const step = plan.steps[plan.cursor];
      if (step) plan.ids[pathKey(step.relativePath)] = last.appId;
      plan.notes.push(`Uploaded ${last.displayName}.`);
      plan.cursor += 1;
      if (plan.cursor < plan.steps.length) {
        const next = plan.steps[plan.cursor];
        if (next) await reviewMatchesFor(next);
        return;
      }
      plan.phase = "root";
      await reviewMatchesFor(plan.root);
      return;
    }
    plan.ids[pathKey(plan.root.relativePath)] = last.appId;
    const linkNotes = await applyDependencyLinks(plan);
    const name = last.displayName;
    const summary = existingAppId
      ? contentOnly
        ? `Replaced the package on ${name}. The settings already in Intune were left in place.`
        : `Overwrote ${name} in Intune with this package.`
      : `Created ${name} in Intune.`;
    const notes = plan.notes;
    planRef.current = null;
    setMessage([summary, ...notes, ...linkNotes].filter(Boolean).join(" "));
  }

  async function reviewMatchesFor(target: UploadTarget) {
    uploadTargetRef.current = target;
    setUploadLabel(target.label);
    setDependencyChain(null);
    setMatches(null);
    setBusy(true);
    setUploading(false);
    setError(null);
    setMessage(null);
    setProgress(`Checking Intune for ${target.label}…`);
    let createNew = false;
    try {
      const found = await findCatalogUploadMatches({
        appPath: target.appPath,
        sourceRoot,
      });
      if (found.length > 0) {
        setMatches(found);
        setSelectedMatchId(found.find((match) => match.linked)?.id ?? found[0]?.id ?? null);
        setProgress(null);
        return;
      }
      createNew = true;
    } catch (err) {
      planRef.current = null;
      setProgress(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
    if (createNew) await runUpload(null, false);
  }

  async function runUpload(existingAppId: string | null, contentOnly: boolean) {
    const target = uploadTargetRef.current;
    const plan = planRef.current;
    const total = plan ? plan.steps.length + 1 : 1;
    const step = plan ? (plan.phase === "root" ? plan.steps.length : plan.cursor) : 0;
    const taskId = trackUpload({ label: target.label, step, total });
    setMatches(null);
    setBusy(true);
    setUploading(true);
    setError(null);
    setMessage(null);
    setProgress(`Starting upload of ${target.label}…`);
    let result: Win32UploadResult | null = null;
    try {
      result = await uploadCatalogIntuneWin({
        appPath: target.appPath,
        sourceRoot,
        existingAppId,
        contentOnly,
      });
      finishUpload(taskId, { ok: true, message: result.warning ?? "Upload complete." });
      setProgress(null);
      onSaved();
      if (!planRef.current) {
        const name = result.displayName;
        setMessage(
          result.warning ??
            (existingAppId
              ? contentOnly
                ? `Replaced the package on ${name}. The settings already in Intune were left in place.`
                : `Overwrote ${name} in Intune with this package.`
              : `Created ${name} in Intune.`),
        );
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      finishUpload(taskId, { ok: false, message: detail });
      planRef.current = null;
      setProgress(null);
      setError(detail);
    } finally {
      setBusy(false);
      setUploading(false);
    }
    if (result && planRef.current) await continuePlan(result, existingAppId, contentOnly);
  }

  function beginDependencyPlan(choices: Record<string, DependencyChoice>) {
    if (!dependencyChain) return;
    const root = rootTarget();
    const steps = [...dependencyChain.nodes]
      .filter((node) => {
        const mode = choices[node.relativePath]?.mode ?? "skip";
        return mode !== "skip" && !node.missing && node.hasIntuneWin && Boolean(node.localPath);
      })
      .sort((left, right) => right.depth - left.depth)
      .map((node) => ({
        appPath: node.localPath,
        label: node.version ? `${node.name} ${node.version}` : node.name || node.relativePath,
        relativePath: node.relativePath,
      }));
    const links = dependencyChain.nodes
      .filter((node) => choices[node.relativePath]?.mode === "mark" && !node.missing && node.hasIntuneWin)
      .map((node) => ({
        parentPath: node.requiredByPath,
        parentLabel: node.requiredBy,
        targetPath: node.relativePath,
        targetLabel: node.version ? `${node.name} ${node.version}` : node.name || node.relativePath,
        autoInstall: choices[node.relativePath]?.autoInstall !== false,
        depth: node.depth,
      }));
    const ids: Record<string, string> = {};
    for (const node of dependencyChain.nodes) {
      if (node.intuneAppId) ids[pathKey(node.relativePath)] = node.intuneAppId;
    }
    planRef.current = {
      steps,
      links,
      cursor: 0,
      phase: steps.length > 0 ? "deps" : "root",
      ids,
      notes: [],
      root,
    };
    setDependencyChain(null);
    if (steps.length > 0 && steps[0]) void reviewMatchesFor(steps[0]);
    else void reviewMatchesFor(root);
  }

  async function uploadPackage() {
    if (!draft || !original || !packageFile) return;
    setBusy(true);
    setUploading(false);
    setError(null);
    setMessage(null);
    setProgress("Checking dependencies…");
    try {
      if (dirty) {
        const saved = await saveCatalogAppConfig({
          appPath: app.localPath,
          sourceRoot,
          config: applyDraftToCatalogConfig(original, draft),
        });
        const next = draftFromCatalogConfig(saved.config);
        setOriginal(saved.config);
        setBaseline(next);
        setDraft(next);
      }
      const chain = await catalogDependencyChain({
        appPath: app.localPath,
        sourceRoot,
      });
      if (chain.nodes.length > 0 || chain.cycle) {
        setDependencyChain(chain);
        setProgress(null);
        return;
      }
    } catch (err) {
      setProgress(null);
      setError(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      setBusy(false);
    }
    await reviewMatchesFor(rootTarget());
  }

  function addDependency() {
    if (!draft || !addDependencyPath) return;
    const chosen = catalogApps.find((item) => item.relativePath === addDependencyPath);
    if (!chosen) return;
    if (draft.dependencies.some((item) => item.path.toLowerCase() === chosen.relativePath.toLowerCase())) return;
    const next: CatalogDependency = {
      path: chosen.relativePath,
      vendor: chosen.vendor,
      name: chosen.name,
      version: chosen.version,
    };
    patch({ dependencies: [...draft.dependencies, next] });
    setAddDependencyPath("");
  }

  function removeSelectedDependencies() {
    if (!draft || selectedDependencies.length === 0) return;
    const selected = new Set(selectedDependencies.map((path) => path.toLowerCase()));
    patch({
      dependencies: draft.dependencies.filter((item) => !selected.has(item.path.toLowerCase())),
    });
    setSelectedDependencies([]);
  }

  if (loading || !draft) {
    return (
      <section className="app-house-build">
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : <p className="muted">Loading package…</p>}
      </section>
    );
  }

  const disabled = busy;
  const missingName = draft.displayName.trim() === "";
  const missingFile = !packageFile;
  const missingDescription = draft.description.trim() === "";
  const missingPublisher = draft.publisher.trim() === "";
  const missingInstall = draft.installCommandLine.trim() === "";
  const missingUninstall = draft.uninstallCommandLine.trim() === "";
  const missingArchitecture = !catalogArchitectureReady(draft.allowedArchitectures);
  const missingMinimumOs = !catalogMinimumOsReady(draft.minimumSupportedWindowsRelease);
  const ruleReady = draft.detectionRules.map(catalogRuleReady);
  const missingDetection = ruleReady.length === 0 || ruleReady.some((ready) => !ready);
  const architectures = withCurrent(
    WIN32_ARCHITECTURES.map((value) => ({ value, label: value })),
    draft.allowedArchitectures,
  );
  const releases = withCurrent(WIN32_MIN_WINDOWS_RELEASES, draft.minimumSupportedWindowsRelease);
  const requirementBits = [
    draft.minimumFreeDiskSpaceInMB ? `${draft.minimumFreeDiskSpaceInMB} MB disk` : "",
    draft.minimumMemoryInMB ? `${draft.minimumMemoryInMB} MB memory` : "",
    draft.minimumNumberOfProcessors ? `${draft.minimumNumberOfProcessors} processors` : "",
    draft.minimumCpuSpeedInMHz ? `${draft.minimumCpuSpeedInMHz} MHz` : "",
  ].filter(Boolean);

  return (
    <section className="app-house-build">
      <header className="app-house-build-head">
        <div>
          <p className="axis-kicker">Win32 package</p>
          <h2>{draft.displayName || app.name}</h2>
          <p className="muted">{app.relativePath}</p>
        </div>
        <button type="button" className="axis-btn axis-btn-primary" disabled={!dirty || busy} onClick={() => void save()}>
          {busy && !uploading ? "Saving…" : "Save config"}
        </button>
      </header>
      <div className="app-house-package">
        <div>
          <p className="axis-kicker">
            IntuneWin
            {missingFile ? <span className="win32-pane-missing">Missing</span> : null}
          </p>
          <p className={missingFile ? "app-house-package-file is-incomplete" : "app-house-package-file"}>
            {packageFile ?? "No package file attached"}
          </p>
        </div>
        <div className="app-house-package-actions">
          <button type="button" className="axis-btn" disabled={busy} onClick={() => void attachPackage()}>
            Attach .intunewin
          </button>
          <button
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={busy || !packageFile}
            onClick={() => void uploadPackage()}
          >
            {uploading ? "Uploading…" : "Upload to Intune"}
          </button>
        </div>
      </div>
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      {progress ? <div className="axis-alert axis-alert-info">{progress}</div> : null}
      {message ? <div className="axis-alert axis-alert-info">{message}</div> : null}
      {dependencyChain ? (
        <DependencyChainDialog
          appName={draft.displayName || app.name}
          chain={dependencyChain}
          onCancel={() => setDependencyChain(null)}
          onConfirm={(choices) => beginDependencyPlan(choices)}
        />
      ) : null}
      {matches && matches.length > 0 ? (
        <UploadMatchDialog
          appName={uploadLabel}
          matches={matches}
          selectedId={selectedMatchId}
          onSelect={setSelectedMatchId}
          onCancel={() => {
            const plan = planRef.current;
            const progressed = Boolean(plan && plan.cursor > 0);
            planRef.current = null;
            setMatches(null);
            if (progressed) setMessage("Upload stopped. Packages already uploaded were left in Intune.");
          }}
          onUploadNew={() => void runUpload(null, false)}
          onReplace={() => {
            if (selectedMatchId) void runUpload(selectedMatchId, true);
          }}
          onOverwrite={() => {
            if (selectedMatchId) void runUpload(selectedMatchId, false);
          }}
        />
      ) : null}
      <div className="win32-panes">
        <Pane
          title="Identity"
          hint={draft.displayName || "Untitled"}
          defaultOpen
          invalid={missingName || missingDescription || missingPublisher || missingArchitecture || missingMinimumOs}
        >
          <div className="win32-grid">
            <Field label="Name" invalid={missingName}>
              <input className="axis-input" value={draft.displayName} disabled={disabled} onChange={(event) => patch({ displayName: event.target.value })} />
            </Field>
            <Field label="Vendor">
              <input className="axis-input" value={draft.vendor} disabled={disabled} onChange={(event) => patch({ vendor: event.target.value })} />
            </Field>
            <Field label="Version">
              <input className="axis-input" value={draft.version} disabled={disabled} onChange={(event) => patch({ version: event.target.value })} />
            </Field>
            <Field label="Display version">
              <input className="axis-input" value={draft.displayVersion} disabled={disabled} onChange={(event) => patch({ displayVersion: event.target.value })} />
            </Field>
            <Field label="Publisher" invalid={missingPublisher}>
              <input className="axis-input" value={draft.publisher} disabled={disabled} onChange={(event) => patch({ publisher: event.target.value })} />
            </Field>
            <Field label="Owner">
              <input className="axis-input" value={draft.owner} disabled={disabled} onChange={(event) => patch({ owner: event.target.value })} />
            </Field>
            <Field label="Architecture" invalid={missingArchitecture}>
              <select className="axis-input" value={draft.allowedArchitectures} disabled={disabled} onChange={(event) => patch({ allowedArchitectures: event.target.value })}>
                {missingArchitecture ? <option value="">Required</option> : null}
                {architectures.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Minimum Windows release" invalid={missingMinimumOs}>
              <select className="axis-input" value={draft.minimumSupportedWindowsRelease} disabled={disabled} onChange={(event) => patch({ minimumSupportedWindowsRelease: event.target.value })}>
                {missingMinimumOs ? <option value="">Required</option> : null}
                {releases.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
            <div className="device-field" style={{ gridColumn: "1 / -1" }}>
              <span>Icon</span>
              <CatalogIconFields
                fileName={draft.iconFile}
                mimeType={draft.iconType}
                value={draft.iconValue}
                url={iconUrlInput}
                busy={disabled || iconBusy}
                onUrlChange={setIconUrlInput}
                onChooseFile={() => void chooseIconFile()}
                onFetch={() => void fetchIcon()}
                onClear={clearIcon}
              />
            </div>
            <Field label="Description" wide invalid={missingDescription}>
              <MarkdownField
                value={draft.description}
                disabled={disabled}
                onChange={(description) => patch({ description })}
              />
            </Field>
            <Field label="Notes" wide>
              <textarea className="axis-input" rows={2} value={draft.notes} disabled={disabled} onChange={(event) => patch({ notes: event.target.value })} />
            </Field>
          </div>
        </Pane>

        <Pane title="Install / uninstall" hint={draft.installCommandLine || "No install command"} invalid={missingInstall || missingUninstall}>
          <div className="win32-grid">
            <Field label="Install command line" wide invalid={missingInstall}>
              <input className="axis-input" style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }} value={draft.installCommandLine} disabled={disabled} onChange={(event) => patch({ installCommandLine: event.target.value })} />
            </Field>
            <Field label="Uninstall command line" wide invalid={missingUninstall}>
              <input className="axis-input" style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }} value={draft.uninstallCommandLine} disabled={disabled} onChange={(event) => patch({ uninstallCommandLine: event.target.value })} />
            </Field>
            <Field label="Install as">
              <select className="axis-input" value={draft.runAsAccount} disabled={disabled} onChange={(event) => patch({ runAsAccount: event.target.value })}>
                <SelectOptions current={draft.runAsAccount} options={[{ value: "system", label: "System" }, { value: "user", label: "User" }]} />
              </select>
            </Field>
            <Field label="Restart behavior">
              <select className="axis-input" value={draft.deviceRestartBehavior} disabled={disabled} onChange={(event) => patch({ deviceRestartBehavior: event.target.value })}>
                <SelectOptions
                  current={draft.deviceRestartBehavior}
                  options={[
                    { value: "allow", label: "Allow" },
                    { value: "basedOnReturnCode", label: "Based on return code" },
                    { value: "suppress", label: "Suppress" },
                    { value: "force", label: "Force" },
                  ]}
                />
              </select>
            </Field>
            <Field label="Max run time (minutes)">
              <input className="axis-input" type="number" min={1} max={1440} value={draft.maxRunTimeInMinutes} disabled={disabled} onChange={(event) => patch({ maxRunTimeInMinutes: Number(event.target.value) || 60 })} />
            </Field>
            <ToggleRow label="Allow available uninstall" checked={draft.allowAvailableUninstall} disabled={disabled} onChange={(allowAvailableUninstall) => patch({ allowAvailableUninstall })} />
          </div>
        </Pane>

        <Pane title="Requirements" hint={requirementBits.length ? requirementBits.join(" · ") : "None set"}>
          <div className="win32-grid">
            <Field label="Min free disk (MB)">
              <input className="axis-input" type="number" min={0} value={draft.minimumFreeDiskSpaceInMB} disabled={disabled} onChange={(event) => patch({ minimumFreeDiskSpaceInMB: event.target.value })} />
            </Field>
            <Field label="Min memory (MB)">
              <input className="axis-input" type="number" min={0} value={draft.minimumMemoryInMB} disabled={disabled} onChange={(event) => patch({ minimumMemoryInMB: event.target.value })} />
            </Field>
            <Field label="Min processors">
              <input className="axis-input" type="number" min={0} value={draft.minimumNumberOfProcessors} disabled={disabled} onChange={(event) => patch({ minimumNumberOfProcessors: event.target.value })} />
            </Field>
            <Field label="Min CPU speed (MHz)">
              <input className="axis-input" type="number" min={0} value={draft.minimumCpuSpeedInMHz} disabled={disabled} onChange={(event) => patch({ minimumCpuSpeedInMHz: event.target.value })} />
            </Field>
          </div>
        </Pane>

        <Pane
          title="Dependencies"
          hint={
            draft.dependencies.length === 0
              ? "None"
              : draft.dependencies.length === 1
                ? draft.dependencies[0]?.name || "1 app"
                : `${draft.dependencies.length} apps`
          }
        >
          <div className="catalog-dep">
            <p className="muted">
              Other packages in this catalog that this app needs.
              <MatchHint
                tone="update"
                text="On upload, each required package can be skipped, uploaded, or uploaded and marked as an Intune dependency."
              />
            </p>
            {draft.dependencies.length > 0 ? (
              <div className="catalog-dep-list">
                {draft.dependencies.map((dependency) => {
                  const checked = selectedDependencies.some((path) => path.toLowerCase() === dependency.path.toLowerCase());
                  return (
                    <label key={dependency.path} className="catalog-dep-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={(event) => {
                          setSelectedDependencies((current) =>
                            event.target.checked
                              ? [...current, dependency.path]
                              : current.filter((path) => path.toLowerCase() !== dependency.path.toLowerCase()),
                          );
                        }}
                      />
                      <span>
                        <strong>{dependency.name || dependency.path}</strong>
                        <span className="muted">
                          {" "}
                          {[dependency.vendor, dependency.version].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="muted">No dependencies.</p>
            )}
            <div className="catalog-dep-add">
              <select
                className="axis-input"
                value={addDependencyPath}
                disabled={disabled}
                onChange={(event) => setAddDependencyPath(event.target.value)}
              >
                <option value="">Add a package…</option>
                {catalogApps
                  .filter(
                    (item) =>
                      item.relativePath !== app.relativePath &&
                      !draft.dependencies.some((dependency) => dependency.path.toLowerCase() === item.relativePath.toLowerCase()),
                  )
                  .map((item) => (
                    <option key={item.relativePath} value={item.relativePath}>
                      {[item.vendor, item.name, item.version].filter(Boolean).join(" / ")}
                    </option>
                  ))}
              </select>
              <button type="button" className="axis-btn" disabled={disabled || !addDependencyPath} onClick={addDependency}>
                Add
              </button>
              <button
                type="button"
                className="axis-btn"
                disabled={disabled || selectedDependencies.length === 0}
                onClick={removeSelectedDependencies}
              >
                Remove
              </button>
            </div>
          </div>
        </Pane>

        <Pane
          title="Detection rules"
          hint={
            draft.detectionRules.length === 1
              ? summarizeDetectionRule(draft.detectionRules[0])
              : `${draft.detectionRules.length} rules`
          }
          defaultOpen
          invalid={missingDetection}
        >
          <div className="win32-rule-actions">
            {(
              [
                ["file", "File"],
                ["registry", "Registry"],
                ["msi", "MSI"],
                ["powershell", "PowerShell"],
              ] as const
            ).map(([type, label]) => (
              <button
                key={type}
                type="button"
                className="axis-btn"
                disabled={disabled}
                onClick={() => patch({ detectionRules: [...draft.detectionRules, emptyDetectionRule(type)] })}
              >
                Add {label}
              </button>
            ))}
          </div>
          {draft.detectionRules.length === 0 ? (
            <p className="muted">No detection rules. Add a file, registry, MSI, or PowerShell rule.</p>
          ) : (
            <ul className="win32-rule-list">
              {draft.detectionRules.map((rule, index) => (
                <li key={`${rule.type}-${index}`} className="win32-rule">
                  <div className="win32-rule-head">
                    <span>{summarizeDetectionRule(rule)}</span>
                    <span className="win32-rule-actions">
                      <button type="button" className="axis-btn" disabled={disabled} onClick={() => patch({ detectionRules: draft.detectionRules.filter((_, ruleIndex) => ruleIndex !== index) })}>
                        Remove
                      </button>
                    </span>
                  </div>
                  {rule.type === "powershell" ? (
                    <PowerShellRule rule={rule} disabled={disabled} onChange={(next) => updateRule(index, next)} />
                  ) : (
                    <DetectionRuleFields
                      rule={rule}
                      disabled={disabled}
                      highlightMissing
                      onChange={(next) => updateRule(index, next)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Pane>
      </div>
    </section>
  );
}

function PowerShellRule({
  rule,
  disabled,
  onChange,
}: {
  rule: Extract<Win32DetectionRule, { type: "powershell" }>;
  disabled: boolean;
  onChange: (next: Win32DetectionRule) => void;
}) {
  return (
    <div className="stack" style={{ marginTop: "0.65rem", gap: "0.75rem" }}>
      <div className={rule.scriptContent.trim() === "" ? "catalog-script is-incomplete" : "catalog-script"}>
        <ScriptCodeEditor
          value={rule.scriptContent}
          onChange={(scriptContent) => onChange({ ...rule, scriptContent })}
          language="powershell"
          ariaLabel="Detection script"
          lintRole="detection"
          readOnly={disabled}
        />
      </div>
      <div className="inspector-form-grid">
        <label className="inspector-form-row">
          <span>Enforce script signature check</span>
          <BooleanToggle checked={rule.enforceSignatureCheck} disabled={disabled} ariaLabel="Enforce script signature check" onChange={(enforceSignatureCheck) => onChange({ ...rule, enforceSignatureCheck })} />
        </label>
        <label className="inspector-form-row">
          <span>Run script in 64-bit PowerShell</span>
          <BooleanToggle checked={!rule.runAs32Bit} disabled={disabled} ariaLabel="Run script in 64-bit PowerShell" onChange={(runAs64Bit) => onChange({ ...rule, runAs32Bit: !runAs64Bit })} />
        </label>
      </div>
    </div>
  );
}

function CatalogIconFields({
  fileName,
  mimeType,
  value,
  url,
  busy,
  onUrlChange,
  onChooseFile,
  onFetch,
  onClear,
}: {
  fileName: string;
  mimeType: string;
  value: string;
  url: string;
  busy: boolean;
  onUrlChange: (url: string) => void;
  onChooseFile: () => void;
  onFetch: () => void;
  onClear: () => void;
}) {
  const preview = value.trim()
    ? `data:${mimeType || "image/png"};base64,${value.trim()}`
    : "";
  const hasIcon = Boolean(preview || fileName.trim() || url.trim());
  return (
    <div className="app-icon-row">
      <div className="app-icon-preview">
        {preview ? (
          <img src={preview} alt="" />
        ) : (
          <span className="muted">No icon</span>
        )}
      </div>
      <div className="app-icon-fields">
        <div className="app-icon-url">
          <button type="button" className="axis-btn" disabled={busy} onClick={onChooseFile}>
            Local file
          </button>
          <input
            className="axis-input"
            value={url}
            disabled={busy}
            placeholder="https://example.com/icon.png"
            onChange={(event) => onUrlChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onFetch();
              }
            }}
          />
          <button type="button" className="axis-btn" disabled={busy || !url.trim()} onClick={onFetch}>
            Fetch
          </button>
        </div>
        {fileName.trim() ? <p className="muted">{fileName}</p> : null}
        {hasIcon ? (
          <button type="button" className="axis-btn axis-btn-ghost" disabled={busy} onClick={onClear}>
            Remove icon
          </button>
        ) : null}
      </div>
    </div>
  );
}

function UploadMatchDialog({
  appName,
  matches,
  selectedId,
  onSelect,
  onCancel,
  onUploadNew,
  onReplace,
  onOverwrite,
}: {
  appName: string;
  matches: Win32AppMatch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCancel: () => void;
  onUploadNew: () => void;
  onReplace: () => void;
  onOverwrite: () => void;
}) {
  const chosen = Boolean(selectedId);
  return (
    <div className="axis-modal-backdrop" onClick={onCancel}>
      <div
        className="axis-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Matching Intune app"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Already in Intune</p>
            <h2>{appName}</h2>
          </div>
        </div>
        <div className="create-script-form">
          <p className="muted">
            {matches.length === 1 ? "One Win32 app already uses this name." : `${matches.length} Win32 apps already use this name.`}
          </p>
          <div className="upload-match-list" role="radiogroup" aria-label="Matching apps">
            {matches.map((match) => (
              <label key={match.id} className="upload-match-option">
                <input
                  type="radio"
                  name="upload-match"
                  checked={selectedId === match.id}
                  onChange={() => onSelect(match.id)}
                />
                <span className="upload-match-copy">
                  <strong>{match.displayName || appName}</strong>
                  <span className="muted">
                    {[match.publisher, match.displayVersion].filter(Boolean).join(" · ") || match.id}
                    {match.linked ? " · Uploaded from this package" : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="upload-match-actions">
            <button type="button" className="axis-btn axis-btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <span className="upload-match-action">
              <button type="button" className="axis-btn axis-btn-success" onClick={onUploadNew}>
                Upload as new
              </button>
              <MatchHint
                tone="create"
                text="Create another Win32 app from this package. The apps listed above stay unchanged."
              />
            </span>
            <span className="upload-match-action">
              <button type="button" className="axis-btn axis-btn-warning" disabled={!chosen} onClick={onReplace}>
                Replace content
              </button>
              <MatchHint
                tone="update"
                text="Update the app you choose with this .intunewin. The name, install commands, detection, requirements, icon, and assignments already in Intune stay as they are."
              />
            </span>
            <span className="upload-match-action">
              <button type="button" className="axis-btn axis-btn-warning" disabled={!chosen} onClick={onOverwrite}>
                Overwrite app
              </button>
              <MatchHint
                tone="update"
                text="Update the app you choose with this package and these local settings. Assignments stay."
              />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DependencyChainDialog({
  appName,
  chain,
  onCancel,
  onConfirm,
}: {
  appName: string;
  chain: CatalogDependencyChain;
  onCancel: () => void;
  onConfirm: (choices: Record<string, DependencyChoice>) => void;
}) {
  const [choices, setChoices] = useState<Record<string, DependencyChoice>>(() => {
    const initial: Record<string, DependencyChoice> = {};
    for (const node of chain.nodes) {
      const blocked = node.missing || !node.hasIntuneWin;
      initial[node.relativePath] = { mode: blocked ? "skip" : "mark", autoInstall: true };
    }
    return initial;
  });

  function updateChoice(path: string, patch: Partial<DependencyChoice>) {
    setChoices((current) => {
      const choice = current[path] ?? { mode: "skip", autoInstall: true };
      return { ...current, [path]: { ...choice, ...patch } };
    });
  }

  return (
    <div className="axis-modal-backdrop" onClick={onCancel}>
      <div
        className="axis-modal axis-modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label="Required dependencies"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Dependencies</p>
            <h2>
              {appName} requires other packages
              <MatchHint
                tone="update"
                text="Dependencies are uploaded before this app, starting at the end of the chain. Marking one writes the Intune dependency on the app that requires it."
              />
            </h2>
          </div>
        </div>
        <div className="create-script-form">
          <div className="catalog-dep-list">
            {chain.nodes.map((node) => {
              const choice = choices[node.relativePath] ?? { mode: "skip" as const, autoInstall: true };
              const blocked = node.missing || !node.hasIntuneWin;
              const status = node.missing
                ? "Missing from the catalog"
                : !node.hasIntuneWin
                  ? "No .intunewin attached"
                  : node.inIntune
                    ? "Uploaded"
                    : "Not uploaded";
              return (
                <div key={`${node.depth}-${node.relativePath}`} className="catalog-dep-choice">
                  <div>
                    <strong>{node.name || node.relativePath}</strong>
                    {node.version ? <span className="muted"> {node.version}</span> : null}
                    <span className="muted catalog-dep-why">
                      {node.depth <= 1
                        ? `Required by ${node.requiredBy}`
                        : `Required because ${node.requiredBy} depends on it`}
                      {" · "}
                      {status}
                    </span>
                  </div>
                  <select
                    className="axis-input"
                    value={choice.mode}
                    disabled={blocked}
                    onChange={(event) => updateChoice(node.relativePath, { mode: event.target.value as DependencyChoice["mode"] })}
                  >
                    <option value="skip">Skip</option>
                    <option value="upload">Upload</option>
                    <option value="mark">Upload and mark as dependency</option>
                  </select>
                  {choice.mode === "mark" ? (
                    <label className="catalog-dep-auto">
                      <BooleanToggle
                        checked={choice.autoInstall}
                        ariaLabel={`Automatically install ${node.name || "dependency"}`}
                        onChange={(autoInstall) => updateChoice(node.relativePath, { autoInstall })}
                      />
                      <span>Automatically install</span>
                      <MatchHint
                        tone="update"
                        text="On: Intune installs this dependency before the app. Off: Intune requires the dependency to be installed already."
                      />
                    </label>
                  ) : null}
                </div>
              );
            })}
          </div>
          {chain.cycle ? <p className="axis-alert axis-alert-danger">{chain.cycle}</p> : null}
          <div className="upload-match-actions">
            <button type="button" className="axis-btn axis-btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="axis-btn axis-btn-primary" onClick={() => onConfirm(choices)}>
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type DependencyChoice = {
  mode: "skip" | "upload" | "mark";
  autoInstall: boolean;
};

type UploadTarget = {
  appPath: string;
  label: string;
  relativePath: string;
};

type DependencyUploadPlan = {
  steps: UploadTarget[];
  links: Array<{
    parentPath: string;
    parentLabel: string;
    targetPath: string;
    targetLabel: string;
    autoInstall: boolean;
    depth: number;
  }>;
  cursor: number;
  phase: "deps" | "root";
  ids: Record<string, string>;
  notes: string[];
  root: UploadTarget;
};

function pathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/^Applications\//i, "").toLowerCase();
}

function MatchHint({ tone, text }: { tone: "create" | "update"; text: string }) {
  return (
    <span className={`upload-match-hint is-${tone}`} tabIndex={0} aria-label={text}>
      <span className="upload-match-hint-mark" aria-hidden="true">
        i
      </span>
      <span className="upload-match-hint-pop" role="tooltip">
        {text}
      </span>
    </span>
  );
}

function withCurrent(options: Array<{ value: string; label: string }>, current: string) {
  if (!current || options.some((option) => option.value === current)) return options;
  return [{ value: current, label: current }, ...options];
}
