import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PageHeader } from "../ui/PageChrome";
import { BooleanToggle } from "../workbench/BooleanToggle";
import { navigate } from "../../lib/route";
import {
  createLocalPack,
  exportTenantPack,
  openPackWorkspace,
  pickLocalPackFolder,
  planPackCompare,
} from "../../lib/tauri";
import type { BaselineReferenceSourceInput } from "../../types/inventory";
import {
  applyGitHubRepoInput,
  GITHUB_FINE_GRAINED_TOKEN_URL,
  isKitPackSource,
  isLegacyBuiltinSource,
  isLocalSource,
  isSourceReady,
  loadStoredSources,
  newCustomSource,
  newLocalSource,
  packTitle,
  sanitizeSource,
  saveStoredSources,
} from "../../lib/baselines/sources";
import {
  cachedCompare,
  canCompareSource,
  compareCacheKey,
  localPackRoot,
  rememberCompare,
  sameLocalPath,
} from "./packCompare";

const CREATE_PLATFORMS = [
  ["windows", "Windows"],
  ["macos", "macOS"],
  ["android", "Android"],
] as const;

const GITHUB_ICON =
  "M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5a3 3 0 0 0-.9-2.4c3-.3 6-1.5 6-6.6a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.1-.3-3.7 1.4a12.6 12.6 0 0 0-6.6 0C5.7 1.1 4.6 1.4 4.6 1.4a4.8 4.8 0 0 0-.1 3.6A5.2 5.2 0 0 0 3 8.6c0 5.1 3 6.3 6 6.6a3 3 0 0 0-.9 2.4V21";
const FOLDER_ICON = "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";
const EXPORT_ICON = "M12 3v12M8 11l4 4 4-4M5 19h14";

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function packHref(sourceId: string): string {
  return `/intune/packs?pack=${encodeURIComponent(sourceId)}`;
}

/** Library › Policy Packs landing: every pack as a card with its last tenant comparison. */
export function PacksLibrary({
  signedIn,
  organizationName,
}: {
  signedIn: boolean;
  organizationName: string | null;
}) {
  const [sources, setSources] = useState<BaselineReferenceSourceInput[]>(() =>
    loadStoredSources().filter((source) => !isLegacyBuiltinSource(source)),
  );
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<"github" | "create" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [comparingIds, setComparingIds] = useState<ReadonlySet<string>>(new Set());
  const [compareErrors, setCompareErrors] = useState<Record<string, string>>({});

  /** Compare one pack from its card; the result is cached for the card and the pack view. */
  async function compareCard(source: BaselineReferenceSourceInput) {
    const id = source.id;
    if (!id || !canCompareSource(source)) return;
    setComparingIds((current) => new Set(current).add(id));
    setCompareErrors(({ [id]: _cleared, ...rest }) => rest);
    try {
      const plan = await planPackCompare({ packRoot: localPackRoot(source) });
      rememberCompare(compareCacheKey(id), plan.items);
    } catch (err) {
      setCompareErrors((current) => ({ ...current, [id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setComparingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  function persist(next: BaselineReferenceSourceInput[]) {
    const legacy = loadStoredSources().filter(isLegacyBuiltinSource);
    saveStoredSources([...legacy, ...next]);
    setSources(next);
  }

  async function addLocal(path: string, name?: string): Promise<BaselineReferenceSourceInput> {
    const existing = sources.find((row) => isLocalSource(row) && sameLocalPath(row.localPath ?? "", path));
    if (existing) return existing;
    // Kit packs have axis-pack.json at the root; any other folder of exports is a flat pack.
    const kit = await openPackWorkspace(path).then(
      () => true,
      () => false,
    );
    const entry = sanitizeSource({
      ...newLocalSource(),
      kind: "local",
      localPath: path,
      name: name ?? path.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? "Local pack",
      storeKind: kit ? "axisTemplated" : "flatJson",
    } as BaselineReferenceSourceInput);
    persist([...sources, entry]);
    return entry;
  }

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const openLocalFolder = () =>
    run(async () => {
      const folder = await pickLocalPackFolder("Open a policy pack folder");
      if (!folder) return;
      const entry = await addLocal(folder);
      if (entry.id) navigate(packHref(entry.id));
    });

  const exportTenant = () =>
    run(async () => {
      const packName = organizationName ? `${organizationName} Intune export` : "Tenant Intune export";
      const result = await exportTenantPack({ packName });
      if (!result) return;
      const entry = await addLocal(result.root, packName);
      if (entry.id) navigate(packHref(entry.id));
    });

  function removeSource(source: BaselineReferenceSourceInput) {
    if (!window.confirm(`Remove “${packTitle(source)}” from Axis? Files on disk and on GitHub are not touched.`)) return;
    persist(sources.filter((row) => row !== source));
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter((source) =>
      [packTitle(source), source.localPath, source.owner, source.repo]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [query, sources]);

  const menuItems: Array<{ title: string; sub: string; onPick: () => void; disabled?: boolean }> = [
    { title: "GitHub repository", sub: "Public or private, read-only in Axis", onPick: () => setDialog("github") },
    { title: "Local folder", sub: "Open a pack that is already on disk", onPick: () => void openLocalFolder() },
    { title: "New local pack", sub: "Create an empty pack with kits", onPick: () => setDialog("create") },
    {
      title: `Export ${organizationName ?? "this tenant"} as a pack`,
      sub: signedIn ? "Snapshot the tenant into a folder" : "Sign in to export",
      onPick: () => void exportTenant(),
      disabled: !signedIn,
    },
  ];

  return (
    <div className="stack packs-library">
      <PageHeader
        eyebrow="Library"
        title="Policy Packs"
        description="Reusable sets of policies. Open a pack to compare it with this tenant and apply what is missing."
        actions={
          <div className="packs-library-actions">
            <label className="packs-search">
              <Icon d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" size={13} />
              <input
                type="search"
                aria-label="Search packs"
                placeholder="Search packs"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="button" className="axis-btn" onClick={() => navigate("/intune/packs?view=items")}>
              Browse all items
            </button>
            <div className="packs-add" ref={menuRef}>
              <button
                type="button"
                className="axis-btn axis-btn-primary"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={busy}
                onClick={() => setMenuOpen((open) => !open)}
              >
                {busy ? "Working…" : "+ Add pack"}
              </button>
              {menuOpen ? (
                <div className="packs-add-menu" role="menu">
                  {menuItems.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      onClick={() => {
                        setMenuOpen(false);
                        item.onPick();
                      }}
                    >
                      <span className="packs-add-title">{item.title}</span>
                      <span className="packs-add-sub">{item.sub}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        }
      />

      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}

      {sources.length === 0 ? (
        <section className="axis-panel axis-panel-padded packs-empty">
          <p className="packs-empty-title">No policy packs yet</p>
          <p className="muted">Add a GitHub repository, open a local folder, or export this tenant as your first pack.</p>
        </section>
      ) : null}

      <div className="packs-grid">
        {shown.map((source, index) => {
          const local = isLocalSource(source);
          const kit = isKitPackSource(source);
          const cached = source.id ? cachedCompare(compareCacheKey(source.id)) : null;
          const total = cached
            ? cached.counts.match + cached.counts.differs + cached.counts.missing
            : 0;
          return (
            <article key={source.id ?? `source-${index}`} className="axis-panel packs-card">
              <div className="packs-card-top">
                <span className={`packs-card-icon${local ? " is-local" : ""}`}>
                  <Icon d={local ? FOLDER_ICON : GITHUB_ICON} />
                </span>
                <span className="packs-card-source">{local ? "Local folder" : "GitHub"}</span>
                <span className="axis-pill">{kit ? "Kit pack" : "Flat pack"}</span>
                {!local ? <span className="axis-pill">Read-only</span> : null}
              </div>
              <div>
                <h2 className="packs-card-title">{packTitle(source)}</h2>
                <p className="packs-card-path" title={local ? source.localPath : source.url}>
                  {local ? source.localPath : `${source.owner}/${source.repo}`}
                </p>
              </div>
              {cached && total > 0 ? (
                <div className="packs-coverage">
                  <div className="packs-coverage-bar" aria-hidden="true">
                    <span className="is-match" style={{ flex: cached.counts.match }} />
                    <span className="is-differs" style={{ flex: cached.counts.differs }} />
                    <span className="is-missing" style={{ flex: cached.counts.missing }} />
                  </div>
                  <div className="packs-coverage-legend">
                    <span className="is-match">{cached.counts.match} match</span>
                    <span className="is-differs">{cached.counts.differs} differ</span>
                    <span className="is-missing">{cached.counts.missing} not in tenant</span>
                  </div>
                </div>
              ) : (
                <p className="packs-coverage-none">
                  {source.id && comparingIds.has(source.id)
                    ? "Comparing with this tenant…"
                    : canCompareSource(source)
                      ? "Not compared with this tenant yet"
                      : "Clone locally to compare with this tenant"}
                </p>
              )}
              {source.id && compareErrors[source.id] ? (
                <p className="packs-card-error">{compareErrors[source.id]}</p>
              ) : null}
              <div className="packs-card-actions">
                <button
                  type="button"
                  className="axis-btn axis-btn-primary"
                  disabled={!source.id}
                  onClick={() => source.id && navigate(packHref(source.id))}
                >
                  Open
                </button>
                {canCompareSource(source) ? (
                  <button
                    type="button"
                    className="axis-btn"
                    disabled={!signedIn || (source.id ? comparingIds.has(source.id) : true)}
                    title={signedIn ? "Compare this pack with the signed-in tenant" : "Sign in to compare"}
                    onClick={() => void compareCard(source)}
                  >
                    {source.id && comparingIds.has(source.id) ? "Comparing…" : cached ? "Compare again" : "Compare"}
                  </button>
                ) : null}
                {kit && source.id && local ? (
                  <button
                    type="button"
                    className="axis-btn"
                    onClick={() => navigate(`/intune/packs?kits=${encodeURIComponent(source.id!)}`)}
                  >
                    Edit kits
                  </button>
                ) : null}
                <button
                  type="button"
                  className="axis-btn axis-btn-ghost axis-btn-icon packs-card-remove"
                  aria-label={`Remove ${packTitle(source)}`}
                  title="Remove from Axis"
                  onClick={() => removeSource(source)}
                >
                  <Icon d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" size={14} />
                </button>
              </div>
            </article>
          );
        })}
        <button
          type="button"
          className="packs-card packs-card-export"
          disabled={!signedIn || busy}
          onClick={() => void exportTenant()}
        >
          <Icon d={EXPORT_ICON} />
          <span>Export {organizationName ?? "this tenant"} as a pack</span>
        </button>
      </div>

      {dialog === "github" ? (
        <GitHubPackDialog
          onClose={() => setDialog(null)}
          onAdd={(source) => {
            persist([...sources.filter((row) => !(row.owner === source.owner && row.repo === source.repo)), source]);
            setDialog(null);
            if (source.id) navigate(packHref(source.id));
          }}
        />
      ) : null}

      {dialog === "create" ? (
        <CreatePackDialog
          onClose={() => setDialog(null)}
          onCreated={(root, name) => {
            setDialog(null);
            void addLocal(root, name).then((entry) => {
              if (entry.id) navigate(packHref(entry.id));
            });
          }}
        />
      ) : null}
    </div>
  );
}

function DialogShell({
  kicker,
  title,
  onClose,
  children,
}: {
  kicker: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="axis-modal packs-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">{kicker}</p>
            <h2>{title}</h2>
          </div>
          <button type="button" className="axis-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function GitHubPackDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (source: BaselineReferenceSourceInput) => void;
}) {
  const [draft, setDraft] = useState<BaselineReferenceSourceInput>(() => newCustomSource());
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const source = sanitizeSource(applyGitHubRepoInput(draft, draft.url ?? ""));
    if (!isSourceReady(source)) {
      setError("Enter a GitHub repo URL or owner/repo.");
      return;
    }
    onAdd(source);
  }

  return (
    <DialogShell kicker="Add pack" title="GitHub repository" onClose={onClose}>
      <label className="packs-field">
        <span>Repository URL or owner/repo</span>
        <input
          className="axis-input"
          autoFocus
          value={draft.url ?? ""}
          placeholder="https://github.com/org/axis-pack"
          onChange={(event) => setDraft((current) => applyGitHubRepoInput(current, event.target.value))}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </label>
      <label className="packs-field">
        <span>Display name (optional)</span>
        <input
          className="axis-input"
          value={draft.name ?? ""}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
      </label>
      <label className="packs-toggle-row">
        <BooleanToggle
          checked={draft.private === true}
          ariaLabel="Private repository"
          onChange={(isPrivate) =>
            setDraft((current) => ({ ...current, private: isPrivate, token: isPrivate ? current.token : undefined }))
          }
        />
        <span>Private repository (fine-grained token, Contents: Read)</span>
      </label>
      {draft.private ? (
        <label className="packs-field">
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
            value={draft.token ?? ""}
            onChange={(event) => setDraft((current) => ({ ...current, token: event.target.value }))}
          />
        </label>
      ) : null}
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      <div className="packs-dialog-foot">
        <button type="button" className="axis-btn axis-btn-primary" onClick={submit}>
          Add pack
        </button>
      </div>
    </DialogShell>
  );
}

function CreatePackDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (root: string, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["windows"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim() || platforms.length === 0) return;
    const parentDir = await pickLocalPackFolder("Choose a parent folder for the new pack");
    if (!parentDir) return;
    setBusy(true);
    setError(null);
    try {
      const workspace = await createLocalPack({ parentDir, name: name.trim(), platforms });
      onCreated(workspace.pack.root, workspace.pack.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell kicker="Add pack" title="New local pack" onClose={onClose}>
      <p className="muted packs-dialog-copy">
        Axis creates a folder under the parent you choose, with <code className="mono-code">axis-pack.json</code>,{" "}
        <code className="mono-code">kits/</code> and a folder per platform.
      </p>
      <label className="packs-field">
        <span>Pack name</span>
        <input
          className="axis-input"
          autoFocus
          value={name}
          disabled={busy}
          placeholder="Contoso Windows pack"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void create();
          }}
        />
      </label>
      <fieldset className="packs-field packs-platforms">
        <legend>Platforms</legend>
        {CREATE_PLATFORMS.map(([value, label]) => (
          <label key={value} className="packs-check">
            <input
              type="checkbox"
              checked={platforms.includes(value)}
              disabled={busy}
              onChange={(event) =>
                setPlatforms((current) =>
                  event.target.checked ? [...current, value] : current.filter((row) => row !== value),
                )
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      <div className="packs-dialog-foot">
        <button
          type="button"
          className="axis-btn axis-btn-primary"
          disabled={busy || !name.trim() || platforms.length === 0}
          onClick={() => void create()}
        >
          {busy ? "Creating…" : "Choose folder & create"}
        </button>
      </div>
    </DialogShell>
  );
}
