import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "./ui/PageChrome";
import { ApplyKitDialog } from "./ApplyKitDialog";
import {
  createLocalPack,
  createPackKit,
  openPackWorkspace,
  openPackWorkspaceFromSource,
  pickLocalPackFolder,
  writePackKit,
} from "../lib/tauri";
import type { PackArtifactRow, PackKitSummary, PackWorkspace } from "../types/packs";
import type { BaselineReferenceSourceInput } from "../types/inventory";
import { WriteActionButton } from "../lib/readOnly";
import {
  applyGitHubRepoInput,
  GITHUB_FINE_GRAINED_TOKEN_URL,
  isKitPackSource,
  isLocalSource,
  isSourceReady,
  loadStoredSources,
  newCustomSource,
  newLocalSource,
  packTitle,
  sanitizeSource,
  saveStoredSources,
} from "../lib/baselines/sources";

const PLATFORM_LABELS: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  android: "Android",
};

const CREATE_PLATFORM_OPTIONS = ["windows", "macos", "android"] as const;

type GroupedArtifacts = {
  platform: string;
  platformLabel: string;
  categories: Array<{
    category: string;
    label: string;
    rows: PackArtifactRow[];
  }>;
};

const CORE_CATEGORIES: Array<{ category: string; label: string }> = [
  { category: "enrollment", label: "Enrolment" },
  { category: "policies", label: "Policies" },
  { category: "compliance", label: "Compliance" },
  { category: "endpoint-security", label: "Endpoint security" },
  { category: "script-platform", label: "Scripts · Platform" },
  { category: "script-remediation", label: "Scripts · Remediation" },
  { category: "script-compliance", label: "Scripts · Compliance" },
  { category: "applications", label: "Applications" },
];

const ACTIVE_PACK_KEY = "axis-packs-active-source-id";

function packSourcesOnly(sources: BaselineReferenceSourceInput[]): BaselineReferenceSourceInput[] {
  return sources
    .map(sanitizeSource)
    .filter((source) => isSourceReady(source) && isKitPackSource(source));
}

function groupArtifacts(
  artifacts: PackArtifactRow[],
  platforms: string[],
): GroupedArtifacts[] {
  const byPlatform = new Map<string, Map<string, PackArtifactRow[]>>();
  for (const platform of platforms) {
    byPlatform.set(platform, new Map());
  }
  for (const row of artifacts) {
    let cats = byPlatform.get(row.platform);
    if (!cats) {
      cats = new Map();
      byPlatform.set(row.platform, cats);
    }
    const list = cats.get(row.category) ?? [];
    list.push(row);
    cats.set(row.category, list);
  }
  const orderedPlatforms = [
    ...platforms,
    ...[...byPlatform.keys()].filter((p) => !platforms.includes(p)),
  ];
  return orderedPlatforms.map((platform) => {
    const cats = byPlatform.get(platform) ?? new Map();
    const categories = [
      ...CORE_CATEGORIES.map(({ category, label }) => ({
        category,
        label,
        rows: cats.get(category) ?? [],
      })),
      ...[...cats.entries()]
        .filter(([category]) => !CORE_CATEGORIES.some((row) => row.category === category))
        .map(([category, rows]) => ({
          category,
          label: rows[0]?.categoryLabel ?? category,
          rows,
        })),
    ];
    return {
      platform,
      platformLabel: PLATFORM_LABELS[platform] ?? platform,
      categories,
    };
  });
}

function draftFromKit(kit: PackKitSummary) {
  return {
    id: kit.id,
    name: kit.name,
    description: kit.description ?? "",
    version: kit.version ?? "0.1.0",
    includes: new Set(kit.includes),
    relPath: kit.relPath,
  };
}

function sourceLabel(source: BaselineReferenceSourceInput): string {
  const title = packTitle(source);
  return isLocalSource(source) ? `${title} (local)` : `${title} (GitHub)`;
}

export function PacksKitsView({
  preferredSourceId = null,
  onBack,
}: {
  preferredSourceId?: string | null;
  onBack?: () => void;
} = {}) {
  const [sources, setSources] = useState<BaselineReferenceSourceInput[]>(() =>
    packSourcesOnly(loadStoredSources()),
  );
  const [activeSourceId, setActiveSourceId] = useState<string | null>(() => {
    if (preferredSourceId?.trim()) return preferredSourceId.trim();
    try {
      return window.localStorage.getItem(ACTIVE_PACK_KEY);
    } catch {
      return null;
    }
  });
  const [workspace, setWorkspace] = useState<PackWorkspace | null>(null);
  const [selectedRel, setSelectedRel] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof draftFromKit> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubDraft, setGithubDraft] = useState<BaselineReferenceSourceInput>(() => newCustomSource());
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPlatforms, setCreatePlatforms] = useState<string[]>(["windows"]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);

  const writable = workspace?.writable === true;

  const selectedKit = useMemo(
    () => workspace?.kits.find((kit) => kit.relPath === selectedRel) ?? null,
    [workspace, selectedRel],
  );

  const groups = useMemo(
    () =>
      workspace
        ? groupArtifacts(workspace.artifacts, workspace.pack.platforms)
        : [],
    [workspace],
  );

  const dirty = useMemo(() => {
    if (!writable || !draft || !selectedKit) return false;
    const includes = [...draft.includes].sort().join("\n");
    const original = [...selectedKit.includes].sort().join("\n");
    return (
      draft.name !== selectedKit.name ||
      draft.id !== selectedKit.id ||
      (draft.description || "") !== (selectedKit.description ?? "") ||
      (draft.version || "") !== (selectedKit.version ?? "0.1.0") ||
      includes !== original
    );
  }, [draft, selectedKit, writable]);

  function persistSources(next: BaselineReferenceSourceInput[]) {
    const all = loadStoredSources();
    const kits = next.map(sanitizeSource);
    const others = all.filter((row) => !isKitPackSource(row));
    const merged = [...others, ...kits];
    saveStoredSources(merged);
    setSources(packSourcesOnly(merged));
  }

  function applyWorkspace(next: PackWorkspace) {
    setWorkspace(next);
    const first = next.kits[0] ?? null;
    setSelectedRel(first?.relPath ?? null);
    setDraft(first ? draftFromKit(first) : null);
    setSavedAt(null);
    const expand: Record<string, boolean> = {};
    for (const group of groupArtifacts(next.artifacts, next.pack.platforms)) {
      expand[group.platform] = true;
      for (const cat of group.categories) {
        if (cat.category === "policies" || cat.category === "enrollment") {
          expand[`${group.platform}:${cat.category}`] = true;
        }
      }
    }
    setExpanded(expand);
  }

  async function loadSource(source: BaselineReferenceSourceInput) {
    setBusy(true);
    setError(null);
    try {
      const next = await openPackWorkspaceFromSource(sanitizeSource(source));
      applyWorkspace(next);
      const id = source.id?.trim() || null;
      setActiveSourceId(id);
      if (id) {
        try {
          window.localStorage.setItem(ACTIVE_PACK_KEY, id);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setWorkspace(null);
      setDraft(null);
      setSelectedRel(null);
    } finally {
      setBusy(false);
    }
  }

  async function refreshActive() {
    const source = sources.find((row) => row.id === activeSourceId);
    if (source) {
      await loadSource(source);
      return;
    }
    if (workspace?.writable && workspace.pack.root && !workspace.pack.root.startsWith("github://")) {
      setBusy(true);
      setError(null);
      try {
        applyWorkspace(await openPackWorkspace(workspace.pack.root));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    }
  }

  async function openLocal() {
    const root = await pickLocalPackFolder("Open Axis pack folder");
    if (!root) return;
    const source = sanitizeSource({
      ...newLocalSource(),
      localPath: root,
      name: root.split(/[\\/]/).filter(Boolean).slice(-1)[0] || "Local pack",
      storeKind: "axisTemplated",
    });
    const next = [source, ...sources.filter((row) => row.localPath !== root)];
    persistSources(next);
    await loadSource(source);
  }

  async function createPack() {
    const name = createName.trim();
    if (!name) {
      setCreateError("Pack name is required.");
      return;
    }
    const platforms = createPlatforms.filter(Boolean);
    if (platforms.length === 0) {
      setCreateError("Select at least one platform.");
      return;
    }
    const parentDir = await pickLocalPackFolder("Choose parent folder for the new pack");
    if (!parentDir) return;
    setBusy(true);
    setCreateError(null);
    setError(null);
    try {
      const workspaceNext = await createLocalPack({
        parentDir,
        name,
        platforms,
      });
      const root = workspaceNext.pack.root;
      const source = sanitizeSource({
        ...newLocalSource(),
        localPath: root,
        name: workspaceNext.pack.name,
        storeKind: "axisTemplated",
      });
      const next = [source, ...sources.filter((row) => row.localPath !== root)];
      persistSources(next);
      applyWorkspace({
        ...workspaceNext,
        writable: true,
        sourceKind: "local",
        sourceId: source.id,
      });
      setActiveSourceId(source.id ?? null);
      if (source.id) {
        try {
          window.localStorage.setItem(ACTIVE_PACK_KEY, source.id);
        } catch {
          /* ignore */
        }
      }
      setCreateOpen(false);
      setCreateName("");
      setCreatePlatforms(["windows"]);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addGithub() {
    const source = sanitizeSource(applyGitHubRepoInput(githubDraft, githubDraft.url ?? ""));
    if (!isSourceReady(source)) {
      setError("Enter a GitHub repo URL or owner/repo.");
      return;
    }
    const next = [
      source,
      ...sources.filter((row) => row.id !== source.id && !(row.owner === source.owner && row.repo === source.repo)),
    ];
    persistSources(next);
    setGithubOpen(false);
    setGithubDraft(newCustomSource());
    await loadSource(source);
  }

  function selectKit(kit: PackKitSummary) {
    if (dirty && !window.confirm("Discard unsaved kit changes?")) return;
    setSelectedRel(kit.relPath);
    setDraft(draftFromKit(kit));
    setSavedAt(null);
    setError(null);
  }

  async function onNewKit() {
    if (!workspace?.writable) return;
    if (dirty && !window.confirm("Discard unsaved kit changes?")) return;
    setBusy(true);
    setError(null);
    try {
      const kit = await createPackKit(workspace.pack.root, "New kit");
      const next = await openPackWorkspace(workspace.pack.root);
      applyWorkspace({ ...next, writable: true, sourceKind: "local", sourceId: workspace.sourceId });
      setSelectedRel(kit.relPath);
      setDraft(draftFromKit(kit));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (!workspace?.writable || !draft) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await writePackKit({
        packRoot: workspace.pack.root,
        relPath: draft.relPath,
        id: draft.id.trim(),
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        version: draft.version.trim() || "0.1.0",
        includes: [...draft.includes],
      });
      const next = await openPackWorkspace(workspace.pack.root);
      applyWorkspace({ ...next, writable: true, sourceKind: "local", sourceId: workspace.sourceId });
      setSelectedRel(saved.relPath);
      setDraft(draftFromKit(saved));
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleInclude(relPath: string) {
    if (!writable) return;
    setDraft((current) => {
      if (!current) return current;
      const includes = new Set(current.includes);
      if (includes.has(relPath)) includes.delete(relPath);
      else includes.add(relPath);
      return { ...current, includes };
    });
  }

  function toggleExpanded(key: string) {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
  }

  useEffect(() => {
    const preferred =
      sources.find((row) => row.id === (preferredSourceId?.trim() || activeSourceId)) ??
      sources[0] ??
      null;
    if (preferred && !workspace) {
      void loadSource(preferred);
    }
    // Intentional: open once when sources exist and nothing loaded yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stack packs-kits">
      <PageHeader
        title={workspace?.pack.name ?? "Manage kits"}
        description={
          workspace
            ? workspace.writable
              ? "Kits are named selections of paths inside this policy pack. Saving updates kit membership only — files stay where they are."
              : "GitHub kit packs are read-only in Axis. Browse kits and membership here; edit kits on a local clone."
            : "Open a kit-shaped policy pack (axis-pack.json at the root). Flat JSON packs stay on the Policy Packs list."
        }
        actions={
          <div className="axis-btn-row packs-kits-toolbar">
            {onBack ? (
              <button type="button" className="axis-btn axis-btn-ghost" onClick={onBack} disabled={busy}>
                Back to packs
              </button>
            ) : null}
            {sources.length > 0 ? (
              <label className="packs-kits-source-select">
                <span className="visually-hidden">Pack source</span>
                <select
                  className="axis-select"
                  value={activeSourceId ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    const source = sources.find((row) => row.id === event.target.value);
                    if (source) void loadSource(source);
                  }}
                >
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {sourceLabel(source)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              className="axis-btn axis-btn-primary"
              onClick={() => {
                setCreateError(null);
                setCreateOpen(true);
              }}
              disabled={busy}
            >
              Create pack…
            </button>
            <button type="button" className="axis-btn" onClick={() => void openLocal()} disabled={busy}>
              Open local…
            </button>
            <button
              type="button"
              className="axis-btn"
              onClick={() => {
                setGithubDraft(newCustomSource());
                setGithubOpen(true);
              }}
              disabled={busy}
            >
              Add GitHub…
            </button>
            {workspace ? (
              <button
                type="button"
                className="axis-btn axis-btn-ghost"
                disabled={busy}
                onClick={() => void refreshActive()}
              >
                Refresh
              </button>
            ) : null}
          </div>
        }
      />

      {applyOpen && workspace?.writable && selectedKit && !workspace.pack.root.startsWith("github://") ? (
        <ApplyKitDialog
          packRoot={workspace.pack.root}
          kitRelPath={selectedKit.relPath}
          kitName={draft?.name.trim() || selectedKit.name}
          onClose={() => setApplyOpen(false)}
        />
      ) : null}

      {createOpen ? (
        <div
          className="axis-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setCreateOpen(false);
          }}
        >
          <div className="axis-modal" role="dialog" aria-modal="true" aria-labelledby="create-pack-title">
            <div className="assignment-dialog-head">
              <div>
                <p className="axis-kicker">Local pack</p>
                <h2 id="create-pack-title">Create pack</h2>
              </div>
              <button type="button" className="axis-btn" onClick={() => setCreateOpen(false)} disabled={busy}>
                Cancel
              </button>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Axis creates a folder under the parent you choose, with{" "}
              <code className="mono-code">axis-pack.json</code>, <code className="mono-code">kits/</code>, and
              platform category trees.
            </p>
            <label className="device-field" style={{ marginTop: "0.85rem" }}>
              Pack name
              <input
                className="axis-input"
                value={createName}
                autoFocus
                disabled={busy}
                placeholder="Contoso Windows pack"
                onChange={(event) => setCreateName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && createName.trim()) void createPack();
                }}
              />
            </label>
            <fieldset className="device-field" style={{ marginTop: "0.65rem", border: 0, padding: 0 }}>
              <legend style={{ marginBottom: "0.35rem" }}>Platforms</legend>
              <div className="axis-btn-row" style={{ flexWrap: "wrap", gap: "0.65rem" }}>
                {CREATE_PLATFORM_OPTIONS.map((platform) => (
                  <label key={platform} className="packs-kits-check" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={createPlatforms.includes(platform)}
                      disabled={busy}
                      onChange={(event) => {
                        setCreatePlatforms((current) => {
                          if (event.target.checked) {
                            return [...current, platform];
                          }
                          return current.filter((row) => row !== platform);
                        });
                      }}
                    />
                    <span>{PLATFORM_LABELS[platform]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {createError ? (
              <p className="axis-alert axis-alert-danger" style={{ marginTop: "0.85rem" }}>
                {createError}
              </p>
            ) : null}
            <div className="page-header-actions" style={{ marginTop: "1rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="axis-btn axis-btn-primary"
                disabled={busy || !createName.trim() || createPlatforms.length === 0}
                onClick={() => void createPack()}
              >
                {busy ? "Creating…" : "Choose folder & create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {githubOpen ? (
        <section className="axis-panel axis-panel-padded packs-kits-github">
          <h2 className="packs-kits-github-title">Add GitHub pack</h2>
          <label className="packs-kits-field">
            <span>Repository URL or owner/repo</span>
            <input
              className="axis-input"
              value={githubDraft.url ?? ""}
              placeholder="https://github.com/org/axis-pack"
              onChange={(event) =>
                setGithubDraft((current) => applyGitHubRepoInput(current, event.target.value))
              }
            />
          </label>
          <label className="packs-kits-field">
            <span>Display name (optional)</span>
            <input
              className="axis-input"
              value={githubDraft.name ?? ""}
              onChange={(event) =>
                setGithubDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <label className="packs-kits-check">
            <input
              type="checkbox"
              checked={githubDraft.private === true}
              onChange={(event) =>
                setGithubDraft((current) => ({
                  ...current,
                  private: event.target.checked,
                  token: event.target.checked ? current.token : undefined,
                }))
              }
            />
            <span>Private repository (fine-grained PAT, Contents: Read)</span>
          </label>
          {githubDraft.private ? (
            <label className="packs-kits-field">
              <span>
                Token ·{" "}
                <a href={GITHUB_FINE_GRAINED_TOKEN_URL} target="_blank" rel="noreferrer">
                  create on GitHub
                </a>
              </span>
              <input
                className="axis-input"
                type="password"
                autoComplete="off"
                value={githubDraft.token ?? ""}
                onChange={(event) =>
                  setGithubDraft((current) => ({ ...current, token: event.target.value }))
                }
              />
            </label>
          ) : null}
          <div className="axis-btn-row">
            <button type="button" className="axis-btn axis-btn-primary" disabled={busy} onClick={() => void addGithub()}>
              Add pack
            </button>
            <button type="button" className="axis-btn axis-btn-ghost" onClick={() => setGithubOpen(false)}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {error ? <p className="axis-banner axis-banner-danger">{error}</p> : null}
      {workspace?.warnings.length ? (
        <p className="muted packs-kits-warnings">{workspace.warnings.join(" · ")}</p>
      ) : null}

      {!workspace ? (
        <section className="axis-panel axis-panel-padded packs-kits-empty">
          <p style={{ margin: 0, fontWeight: 500 }}>No pack open</p>
          <p className="muted" style={{ margin: "0.35rem 0 0" }}>
            Create a new local pack, open a folder with <code>axis-pack.json</code>, or add a GitHub repo that uses the
            same layout.
          </p>
        </section>
      ) : (
        <div className="packs-kits-layout">
          <aside className="packs-kits-sidebar axis-panel">
            <div className="packs-kits-sidebar-head">
              <h2>Kits</h2>
              {writable ? (
                <WriteActionButton
                  type="button"
                  className="axis-btn axis-btn-ghost packs-kits-new"
                  disabled={busy}
                  onClick={() => void onNewKit()}
                >
                  New kit
                </WriteActionButton>
              ) : (
                <span className="axis-pill">Read-only</span>
              )}
            </div>
            <ul className="packs-kits-list">
              {workspace.kits.length === 0 ? (
                <li className="muted packs-kits-list-empty">
                  {writable
                    ? "No kits yet. Create one to select pack paths."
                    : "No kits found under kits/."}
                </li>
              ) : (
                workspace.kits.map((kit) => (
                  <li key={kit.relPath}>
                    <button
                      type="button"
                      className={`packs-kits-list-item${selectedRel === kit.relPath ? " is-active" : ""}`}
                      onClick={() => selectKit(kit)}
                    >
                      <span className="packs-kits-list-name">{kit.name}</span>
                      <span className="muted packs-kits-list-meta">
                        {kit.includeCount} object{kit.includeCount === 1 ? "" : "s"}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="packs-kits-pack-meta muted">
              <div>
                <strong>{workspace.pack.name}</strong>
              </div>
              <div>
                {workspace.sourceKind === "github" ? "GitHub" : "Local"}
                {" · "}
                {workspace.pack.version ? `v${workspace.pack.version}` : "no version"}
                {" · "}
                {workspace.pack.platforms
                  .map((p) => PLATFORM_LABELS[p] ?? p)
                  .join(", ")}
              </div>
            </div>
          </aside>

          <section className="packs-kits-editor axis-panel">
            {!draft || !selectedKit ? (
              <div className="packs-kits-editor-empty muted">
                Select a kit{writable ? " or create one" : ""} to inspect includes.
              </div>
            ) : (
              <>
                <div className="packs-kits-editor-head">
                  <div className="packs-kits-fields">
                    <label className="packs-kits-field">
                      <span>Name</span>
                      <input
                        className="axis-input"
                        value={draft.name}
                        disabled={!writable}
                        onChange={(event) =>
                          setDraft((current) =>
                            current ? { ...current, name: event.target.value } : current,
                          )
                        }
                      />
                    </label>
                    <label className="packs-kits-field">
                      <span>Description</span>
                      <input
                        className="axis-input"
                        value={draft.description}
                        disabled={!writable}
                        onChange={(event) =>
                          setDraft((current) =>
                            current ? { ...current, description: event.target.value } : current,
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className="packs-kits-editor-actions">
                    {writable && savedAt && !dirty ? (
                      <span className="muted">Saved {savedAt}</span>
                    ) : null}
                    {writable && dirty ? <span className="muted">Unsaved changes</span> : null}
                    {writable ? (
                      <WriteActionButton
                        type="button"
                        className="axis-btn axis-btn-success"
                        disabled={busy || dirty || draft.includes.size === 0}
                        title={
                          dirty
                            ? "Save the kit before applying."
                            : draft.includes.size === 0
                              ? "Add includes before applying."
                              : "Apply this kit to the signed-in tenant"
                        }
                        onClick={() => setApplyOpen(true)}
                      >
                        Apply kit…
                      </WriteActionButton>
                    ) : (
                      <span className="muted" title="Clone or open a local pack to apply kits.">
                        Apply requires a local pack
                      </span>
                    )}
                    {writable ? (
                      <WriteActionButton
                        type="button"
                        className="axis-btn axis-btn-primary"
                        disabled={busy || !dirty || !draft.name.trim()}
                        onClick={() => void onSave()}
                      >
                        {busy ? "Saving…" : "Save"}
                      </WriteActionButton>
                    ) : null}
                  </div>
                </div>

                <div className="packs-kits-includes">
                  <div className="packs-kits-includes-head">
                    <h3>Include from pack</h3>
                    <span className="muted">{draft.includes.size} selected</span>
                  </div>
                  <div className="packs-kits-tree">
                    {groups.length === 0 ? (
                      <p className="muted">This pack has no artifacts under platform folders yet.</p>
                    ) : (
                      groups.map((group) => (
                        <div key={group.platform} className="packs-kits-platform">
                          <button
                            type="button"
                            className="packs-kits-platform-toggle"
                            onClick={() => toggleExpanded(group.platform)}
                          >
                            <span aria-hidden>{expanded[group.platform] ? "▾" : "▸"}</span>
                            {group.platformLabel}
                          </button>
                          {expanded[group.platform] ? (
                            <div className="packs-kits-categories">
                              {group.categories.map((cat) => {
                                const key = `${group.platform}:${cat.category}`;
                                const open = expanded[key] ?? false;
                                const selectedCount = cat.rows.filter((row) =>
                                  draft.includes.has(row.relPath),
                                ).length;
                                return (
                                  <div key={key} className="packs-kits-category">
                                    <button
                                      type="button"
                                      className="packs-kits-category-toggle"
                                      onClick={() => toggleExpanded(key)}
                                    >
                                      <span aria-hidden>{open ? "▾" : "▸"}</span>
                                      <span>
                                        {cat.label}{" "}
                                        <span className="muted">
                                          ({selectedCount}/{cat.rows.length})
                                        </span>
                                      </span>
                                    </button>
                                    {open ? (
                                      <ul className="packs-kits-artifact-list">
                                        {cat.rows.length === 0 ? (
                                          <li className="muted packs-kits-placeholder">
                                            {cat.category === "applications"
                                              ? "Coming later"
                                              : "Empty"}
                                          </li>
                                        ) : (
                                          cat.rows.map((row) => (
                                            <li key={row.relPath}>
                                              <label className="packs-kits-artifact">
                                                <input
                                                  type="checkbox"
                                                  checked={draft.includes.has(row.relPath)}
                                                  disabled={!writable}
                                                  onChange={() => toggleInclude(row.relPath)}
                                                />
                                                <span title={row.relPath}>{row.name}</span>
                                              </label>
                                            </li>
                                          ))
                                        )}
                                      </ul>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                  <p className="muted packs-kits-hint">
                    {writable
                      ? "Kit saves path membership only. Apply kit… pushes supported includes into the signed-in tenant (unassigned)."
                      : "Browse-only on GitHub. Clone locally to edit or apply kits."}
                  </p>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
