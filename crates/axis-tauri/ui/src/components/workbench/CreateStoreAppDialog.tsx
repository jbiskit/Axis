import { useEffect, useState } from "react";
import {
  createWinGetApp,
  fetchStoreCatalogManifest,
  searchStoreCatalog,
  type StoreCatalogHit,
} from "../../lib/tauri";
import type { MobileAppSummary } from "../../types/inventory";
import { InstallBehaviorToggle } from "./StoreAppEditor";

export function CreateStoreAppDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (app: MobileAppSummary) => void;
}) {
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<StoreCatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [publisher, setPublisher] = useState("");
  const [description, setDescription] = useState("");
  const [developer, setDeveloper] = useState("");
  const [owner, setOwner] = useState("");
  const [notes, setNotes] = useState("");
  const [informationUrl, setInformationUrl] = useState("");
  const [privacyUrl, setPrivacyUrl] = useState("");
  const [runAsAccount, setRunAsAccount] = useState("system");
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setHits([]);
    setSearchError(null);
    setSelectedId("");
    setDisplayName("");
    setPublisher("");
    setDescription("");
    setDeveloper("");
    setOwner("");
    setNotes("");
    setInformationUrl("");
    setPrivacyUrl("");
    setRunAsAccount("system");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const needle = search.trim();
    if (needle.length < 2) {
      setHits([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      void searchStoreCatalog(needle)
        .then((response) => {
          if (cancelled) return;
          setHits(response.hits ?? []);
          setSearchError(response.error);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setHits([]);
          setSearchError(err instanceof Error ? err.message : "Search failed.");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, search]);

  if (!open) return null;

  async function selectHit(hit: StoreCatalogHit) {
    setSelectedId(hit.packageIdentifier);
    setDisplayName(hit.packageName);
    setPublisher(hit.publisher);
    setDeveloper(hit.publisher);
    setOwner("");
    setNotes("");
    setDescription("");
    setInformationUrl("");
    setPrivacyUrl("");
    setRunAsAccount("system");
    setError(null);
    setLoadingManifest(true);
    try {
      const response = await fetchStoreCatalogManifest(hit.packageIdentifier);
      if (response.manifest) {
        setDisplayName(response.manifest.packageName);
        setPublisher(response.manifest.publisher);
        setDeveloper(response.manifest.publisher);
        setDescription(response.manifest.description ?? "");
        setInformationUrl(response.manifest.informationUrl ?? "");
        setPrivacyUrl(response.manifest.privacyInformationUrl ?? "");
        setRunAsAccount(response.manifest.runAsAccount === "user" ? "user" : "system");
      } else if (response.error) {
        setError(response.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load package details.");
    } finally {
      setLoadingManifest(false);
    }
  }

  async function create() {
    if (!selectedId || !displayName.trim() || !publisher.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await createWinGetApp({
        displayName: displayName.trim(),
        packageIdentifier: selectedId,
        publisher: publisher.trim(),
        description: description.trim() || null,
        developer: developer.trim() || null,
        owner: owner.trim() || null,
        notes: notes.trim() || null,
        informationUrl: informationUrl.trim() || null,
        privacyInformationUrl: privacyUrl.trim() || null,
        runAsAccount,
      });
      if (!response.app) {
        setError(response.error ?? "Could not add the Store app.");
        return;
      }
      onCreated(response.app);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the Store app.");
    } finally {
      setBusy(false);
    }
  }

  const canCreate = Boolean(selectedId && displayName.trim() && publisher.trim()) && !busy && !loadingManifest;

  return (
    <div
      className="axis-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="axis-modal axis-modal-wide create-script-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-store-app-title"
      >
        <div className="assignment-dialog-head">
          <div>
            <p className="axis-kicker">Microsoft Store</p>
            <h2 id="create-store-app-title">Add Store app</h2>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
              Search the Microsoft Store catalog, pick a package, then add it to Intune as a WinGet
              app. It is created unassigned.
            </p>
          </div>
        </div>

        <div className="create-script-form">
          <label className="device-field">
            Search Store catalog
            <input
              className="axis-input"
              value={search}
              disabled={busy}
              placeholder="Name or package id, for example Company Portal"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {searching ? <p className="muted">Searching…</p> : null}
          {!searching && search.trim().length < 2 ? (
            <p className="muted">Type at least 2 characters to search.</p>
          ) : null}
          {!searching && search.trim().length >= 2 && hits.length === 0 && !searchError ? (
            <p className="muted">No Store packages matched.</p>
          ) : null}
          {hits.length > 0 ? (
            <ul className="store-catalog-results">
              {hits.map((hit) => (
                <li key={hit.packageIdentifier}>
                  <button
                    type="button"
                    className={`store-catalog-hit${selectedId === hit.packageIdentifier ? " is-selected" : ""}`}
                    disabled={busy}
                    onClick={() => void selectHit(hit)}
                  >
                    <span>{hit.packageName}</span>
                    <span className="muted">
                      {hit.packageIdentifier} · {hit.publisher}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {selectedId ? (
            <div className="win32-grid" style={{ marginTop: "0.75rem" }}>
              <p className="muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
                {loadingManifest ? "Loading package details…" : `Package ${selectedId}`}
              </p>
              <label className="device-field">
                Display name
                <input
                  className="axis-input"
                  value={displayName}
                  disabled={busy || loadingManifest}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label className="device-field">
                Publisher
                <input
                  className="axis-input"
                  value={publisher}
                  disabled={busy || loadingManifest}
                  onChange={(event) => setPublisher(event.target.value)}
                />
              </label>
              <label className="device-field">
                Developer
                <input
                  className="axis-input"
                  value={developer}
                  disabled={busy || loadingManifest}
                  onChange={(event) => setDeveloper(event.target.value)}
                />
              </label>
              <label className="device-field">
                Owner
                <input
                  className="axis-input"
                  value={owner}
                  disabled={busy || loadingManifest}
                  onChange={(event) => setOwner(event.target.value)}
                />
              </label>
              <label className="device-field" style={{ gridColumn: "1 / -1" }}>
                Install behavior
                <span className="muted" style={{ display: "block", fontSize: "0.7rem", marginBottom: "0.25rem" }}>
                  System installs for the device. User installs for the signed-in user.
                </span>
                <InstallBehaviorToggle
                  runAsAccount={runAsAccount}
                  disabled={busy || loadingManifest}
                  onChange={setRunAsAccount}
                />
              </label>
              <label className="device-field">
                Information URL
                <input
                  className="axis-input"
                  value={informationUrl}
                  disabled={busy || loadingManifest}
                  onChange={(event) => setInformationUrl(event.target.value)}
                />
              </label>
              <label className="device-field">
                Privacy URL
                <input
                  className="axis-input"
                  value={privacyUrl}
                  disabled={busy || loadingManifest}
                  onChange={(event) => setPrivacyUrl(event.target.value)}
                />
              </label>
              <label className="device-field" style={{ gridColumn: "1 / -1" }}>
                Description
                <textarea
                  className="axis-input"
                  rows={3}
                  value={description}
                  disabled={busy || loadingManifest}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label className="device-field" style={{ gridColumn: "1 / -1" }}>
                Notes
                <textarea
                  className="axis-input"
                  rows={2}
                  value={notes}
                  disabled={busy || loadingManifest}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </div>

        {searchError || error ? (
          <div className="axis-alert axis-alert-danger">{searchError || error}</div>
        ) : null}
        <div className="axis-modal-actions">
          <button type="button" className="axis-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="axis-btn axis-btn-primary"
            disabled={!canCreate}
            onClick={() => void create()}
          >
            {busy ? "Adding…" : "Add app"}
          </button>
        </div>
      </div>
    </div>
  );
}
