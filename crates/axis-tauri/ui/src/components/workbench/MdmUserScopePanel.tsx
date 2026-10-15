import { useCallback, useEffect, useMemo, useState } from "react";
import type { DirectoryGroup } from "../../types/inventory";
import {
  fetchMdmUserScope,
  searchDirectoryGroups,
  updateMdmUserScope,
  type MdmUserScope,
  type MdmUserScopePatch,
} from "../../lib/tauri";
import { useWriteGate, WriteActionButton } from "../../lib/readOnly";
import { BooleanToggle } from "./BooleanToggle";

type Scope = "all" | "some" | "none";

const DEFAULT_MDM_URLS = {
  termsOfUseUrl: "https://portal.manage.microsoft.com/TermsofUse.aspx",
  discoveryUrl: "https://enrollment.manage.microsoft.com/enrollmentserver/discovery.svc",
  complianceUrl: "https://portal.manage.microsoft.com/?portalAction=Compliance",
};

function ScopeRadios({
  name,
  value,
  disabled,
  onChange,
}: {
  name: string;
  value: Scope;
  disabled: boolean;
  onChange: (next: Scope) => void;
}) {
  return (
    <div className="mdm-scope-radios">
      {(["none", "some", "all"] as const).map((option) => (
        <label key={option}>
          <input
            type="radio"
            name={name}
            checked={value === option}
            disabled={disabled}
            onChange={() => onChange(option)}
          />
          {option === "none" ? "None" : option === "some" ? "Some" : "All"}
        </label>
      ))}
    </div>
  );
}

/**
 * Tenant-wide automatic enrollment — the Intune `mobileDeviceManagementPolicies`
 * object. Covers the MDM user scope, the service URLs, the Windows
 * work/school-account block, and the Windows Information Protection scope.
 */
export function MdmUserScopePanel() {
  const { writeDisabled, writeHint } = useWriteGate();
  const [scope, setScope] = useState<MdmUserScope | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [draft, setDraft] = useState<MdmUserScopePatch>({});
  const [groups, setGroups] = useState<{ id: string; displayName: string }[]>([]);
  const [groupQuery, setGroupQuery] = useState("");
  const [groupHits, setGroupHits] = useState<DirectoryGroup[]>([]);
  const [groupSearching, setGroupSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetchMdmUserScope();
      if (response.error || !response.scope) {
        setLoadError(response.error ?? "Could not read the automatic enrollment policy.");
        setScope(null);
        return;
      }
      setScope(response.scope);
      setGroups(response.scope.groups);
      setDraft({});
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const query = groupQuery.trim();
    if (query.length < 2) {
      setGroupHits([]);
      setGroupSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setGroupSearching(true);
      void searchDirectoryGroups(query)
        .then((response) => {
          if (!cancelled) setGroupHits(response.groups);
        })
        .catch(() => {
          if (!cancelled) setGroupHits([]);
        })
        .finally(() => {
          if (!cancelled) setGroupSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [groupQuery]);

  // Current values: draft wins, otherwise the loaded policy.
  const current = useMemo(() => {
    if (!scope) return null;
    return {
      appliesTo: (draft.appliesTo ?? scope.appliesTo) as Scope,
      termsOfUseUrl: draft.termsOfUseUrl ?? scope.termsOfUseUrl ?? "",
      discoveryUrl: draft.discoveryUrl ?? scope.discoveryUrl ?? "",
      complianceUrl: draft.complianceUrl ?? scope.complianceUrl ?? "",
      enrollmentDuringRegistrationDisabled:
        draft.enrollmentDuringRegistrationDisabled ??
        scope.enrollmentDuringRegistrationDisabled,
    };
  }, [draft, scope]);

  const dirty = useMemo(() => {
    if (!scope || !current) return false;
    const groupsChanged =
      current.appliesTo === "some" &&
      groups.map((group) => group.id).sort().join(",") !==
        scope.groups.map((group) => group.id).sort().join(",");
    return (
      Object.keys(draft).length > 0 ||
      groupsChanged ||
      current.appliesTo !== scope.appliesTo
    );
  }, [current, draft, groups, scope]);

  function patch(next: MdmUserScopePatch) {
    setDraft((currentDraft) => ({ ...currentDraft, ...next }));
    setMessage(null);
  }

  async function save() {
    if (!current) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload: MdmUserScopePatch = { ...draft };
      if (current.appliesTo === "some") {
        payload.groupIds = groups.map((group) => group.id);
      }
      const response = await updateMdmUserScope(payload);
      if (!response.ok) throw new Error(response.error ?? "Could not save.");
      setMessage("Saved to Graph.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  function addGroup(group: DirectoryGroup) {
    setGroups((currentGroups) =>
      currentGroups.some((row) => row.id === group.id)
        ? currentGroups
        : [...currentGroups, { id: group.id, displayName: group.displayName }],
    );
    setGroupQuery("");
    setGroupHits([]);
    setMessage(null);
  }

  const disabled = writeDisabled || busy;

  if (loading) {
    return (
      <div className="axis-panel axis-panel-padded">
        <p className="muted" style={{ margin: 0 }}>
          Reading the automatic enrollment policy…
        </p>
      </div>
    );
  }

  if (loadError || !current) {
    return (
      <div className="axis-panel axis-panel-padded">
        <p className="axis-alert axis-alert-danger" style={{ margin: 0 }}>
          {loadError ?? "Automatic enrollment policy unavailable."}
        </p>
        <button type="button" className="axis-btn" style={{ marginTop: "0.6rem" }} onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <div className="axis-panel axis-panel-padded">
        <div className="assignment-list-head">
          <p className="axis-kicker">MDM user scope</p>
          <button type="button" className="axis-btn" onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
        </div>
        <ScopeRadios
          name="mdm-scope"
          value={current.appliesTo}
          disabled={disabled}
          onChange={(appliesTo) => patch({ appliesTo })}
        />

        {current.appliesTo === "some" ? (
          <div className="mdm-groups">
            <p className="axis-kicker">
              Groups <span className="muted">{groups.length} selected</span>
            </p>
            {groups.length > 0 ? (
              <ul className="mdm-group-list">
                {groups.map((group) => (
                  <li key={group.id}>
                    <span className="mdm-group-name">{group.displayName}</span>
                    <button
                      type="button"
                      className="axis-btn-ghost"
                      disabled={disabled}
                      onClick={() => {
                        setGroups((rows) => rows.filter((row) => row.id !== group.id));
                        setMessage(null);
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <input
              className="axis-input"
              value={groupQuery}
              placeholder="Add a group — type at least 2 characters…"
              disabled={disabled}
              onChange={(event) => setGroupQuery(event.target.value)}
            />
            {groupSearching ? <p className="muted">Searching…</p> : null}
            {groupHits.length > 0 ? (
              <ul className="assignment-hits">
                {groupHits.map((group) => (
                  <li key={group.id} className="assignment-hit">
                    <button
                      type="button"
                      className="assignment-hit-name assignment-hit-pick"
                      disabled={disabled}
                      onClick={() => addGroup(group)}
                    >
                      <span>{group.displayName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="mdm-field-grid">
          <label className="device-field">
            MDM terms of use URL
            <input
              className="axis-input"
              value={current.termsOfUseUrl}
              disabled={disabled}
              onChange={(event) => patch({ termsOfUseUrl: event.target.value })}
            />
          </label>
          <label className="device-field">
            MDM discovery URL
            <input
              className="axis-input"
              value={current.discoveryUrl}
              disabled={disabled}
              onChange={(event) => patch({ discoveryUrl: event.target.value })}
            />
          </label>
          <label className="device-field">
            MDM compliance URL
            <input
              className="axis-input"
              value={current.complianceUrl}
              disabled={disabled}
              onChange={(event) => patch({ complianceUrl: event.target.value })}
            />
          </label>
        </div>
        <button
          type="button"
          className="axis-link mdm-restore"
          disabled={disabled}
          onClick={() => patch({ ...DEFAULT_MDM_URLS })}
        >
          Restore default MDM URLs
        </button>

        <label
          className="device-field"
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexDirection: "row", marginTop: "0.85rem" }}
        >
          <BooleanToggle
            checked={current.enrollmentDuringRegistrationDisabled}
            ariaLabel="Disable MDM enrollment when adding work or school account on Windows"
            onChange={(enrollmentDuringRegistrationDisabled) =>
              patch({ enrollmentDuringRegistrationDisabled })
            }
          />
          <span>Disable MDM enrollment when adding work or school account on Windows</span>
        </label>
      </div>

      {error ? (
        <p className="axis-alert axis-alert-danger" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="muted" style={{ margin: 0, fontSize: "var(--axis-text-2xs)" }}>
          {message}
        </p>
      ) : null}

      <div className="assignment-actions">
        <WriteActionButton
          type="button"
          className="axis-btn axis-btn-primary"
          disabled={busy || !dirty || (current.appliesTo === "some" && groups.length === 0)}
          title={writeDisabled ? writeHint : undefined}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save"}
        </WriteActionButton>
        <button
          type="button"
          className="axis-btn"
          disabled={busy || !dirty}
          onClick={() => {
            setDraft({});
            setGroups(scope?.groups ?? []);
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
