import { useEffect, useMemo, useState } from "react";
import {
  fetchFeatureUpdateProfile,
  updateFeatureUpdateProfile,
  type FeatureUpdateProfile,
} from "../../lib/tauri";
import { requestObjectRefresh } from "../../lib/inspectorCache";
import { useWriteGate, WriteActionButton } from "../../lib/readOnly";
import {
  FeatureUpdateProfileFields,
  featureUpdateProblem,
  useFeatureUpdateCatalog,
} from "./FeatureUpdateProfileFields";

export function FeatureUpdateProfileEditor({
  profileId,
  onSaved,
}: {
  profileId: string;
  onSaved?: () => void;
}) {
  const { writeDisabled, writeHint } = useWriteGate();
  const [profile, setProfile] = useState<FeatureUpdateProfile | null>(null);
  const [draft, setDraft] = useState<FeatureUpdateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const catalog = useFeatureUpdateCatalog();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);
    void fetchFeatureUpdateProfile(profileId)
      .then((response) => {
        if (cancelled) return;
        if (response.error || !response.profile) {
          setError(response.error ?? "Could not read this deployment.");
          setProfile(null);
          setDraft(null);
          return;
        }
        setProfile(response.profile);
        setDraft(response.profile);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const dirty = useMemo(() => {
    if (!profile || !draft) return false;
    return JSON.stringify(profile) !== JSON.stringify(draft);
  }, [draft, profile]);

  function patch(next: Partial<FeatureUpdateProfile>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
    setMessage(null);
  }

  async function save() {
    if (!draft || !dirty) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await updateFeatureUpdateProfile(draft);
      if (!response.ok) throw new Error(response.error ?? "Could not save the deployment.");
      setMessage("Saved to Graph.");
      requestObjectRefresh(draft.id);
      const refreshed = await fetchFeatureUpdateProfile(draft.id);
      if (refreshed.profile) {
        setProfile(refreshed.profile);
        setDraft(refreshed.profile);
      }
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the deployment.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading deployment…</p>;
  if (error && !draft) {
    return (
      <p className="axis-alert axis-alert-danger" style={{ margin: 0 }}>
        {error}
      </p>
    );
  }
  if (!draft) return null;

  const problem = dirty ? featureUpdateProblem(draft, false, catalog) : null;

  return (
    <div className="stack" style={{ gap: "0.85rem" }}>
      <FeatureUpdateProfileFields
        profile={draft}
        saved={profile}
        catalog={catalog}
        disabled={writeDisabled || busy}
        onChange={patch}
      />

      {error ? (
        <p className="axis-alert axis-alert-danger" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      {problem ? <p className="setting-field-error" style={{ margin: 0 }}>{problem}</p> : null}
      {message ? (
        <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-2xs)" }}>
          {message}
        </p>
      ) : null}

      <div className="assignment-actions">
        <WriteActionButton
          type="button"
          className="axis-btn axis-btn-primary"
          disabled={busy || !dirty || problem != null}
          title={writeDisabled ? writeHint : problem ?? undefined}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save deployment"}
        </WriteActionButton>
        <button
          type="button"
          className="axis-btn"
          disabled={busy || !dirty}
          onClick={() => {
            setDraft(profile);
            setError(null);
            setMessage(null);
          }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
