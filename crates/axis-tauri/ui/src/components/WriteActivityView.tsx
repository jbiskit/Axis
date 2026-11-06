import { useCallback, useEffect, useMemo, useState } from "react";
import type { IntuneAuditEvent, UndoOutcome, WriteLogEntry } from "../types/glance";
import { hrefWithParam, navigate } from "../lib/route";
import { listIntuneAuditEvents, listWriteLog, saveTextFile, undoWrite } from "../lib/tauri";
import { READ_ONLY_WRITE_HINT, useReadOnly } from "../lib/readOnly";
import { SettingValueDiff } from "./workbench/SettingValueDiff";
import {
  CompactObjectList,
  InspectorEmpty,
  WorkspaceSplit,
  formatRelative,
  useListSearchState,
} from "./workbench/shared";

type ActivitySource = "axis" | "intune";

const RESULT_OPTIONS = [
  { value: "all", label: "All results" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Not success" },
];

function sourceFilter(pathname: string, search: URLSearchParams, value: ActivitySource) {
  return {
    label: "Source",
    value,
    onChange: (next: string) =>
      navigate(hrefWithParam(pathname, search, "source", next === "axis" ? null : next)),
    options: [
      { value: "axis", label: "Axis writes (this device)" },
      { value: "intune", label: "Intune audit log" },
    ],
  };
}

async function saveJson(name: string, title: string, body: Record<string, unknown>) {
  await saveTextFile({
    contents: JSON.stringify({ generatedAt: new Date().toISOString(), ...body }, null, 2),
    suggestedName: name,
    title,
  });
}

export function WriteActivityView({
  pathname,
  search,
}: {
  pathname: string;
  search: URLSearchParams;
}) {
  const source: ActivitySource = search.get("source") === "intune" ? "intune" : "axis";
  return source === "intune" ? (
    <IntuneAuditActivity pathname={pathname} search={search} />
  ) : (
    <AxisWriteActivity pathname={pathname} search={search} />
  );
}

/* ── Axis local write log ─────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectName(entry: WriteLogEntry): string | null {
  for (const source of [entry.before, entry.requestBody]) {
    if (isRecord(source)) {
      const name = source.displayName ?? source.name;
      if (typeof name === "string" && name.trim()) return name;
    }
  }
  return null;
}

const looksLikeId = (value: string) => /^[0-9a-f-]{20,}$/i.test(value) || value.includes("'");

/** "Update configurationPolicies", "Delete mobileApps", "wipe managedDevices" … from method + path. */
function entryTitle(entry: WriteLogEntry): string {
  if (entry.path === "/$batch") return "Batch request";
  const segments = entry.path.split("?")[0].split("/").filter(Boolean);
  const named = segments.filter((segment) => !looksLikeId(segment) && segment !== "$ref");
  const last = named[named.length - 1] ?? entry.path;
  if (entry.method === "DELETE") return `Delete ${last}`;
  if (entry.method === "PATCH" || entry.method === "PUT") return `Update ${last}`;
  // POST to a path ending in an object id plus a verb is an action on that object.
  const parentIsId = segments.length >= 2 && looksLikeId(segments[segments.length - 2]);
  if (parentIsId && named.length >= 2) return `${last} · ${named[named.length - 2]}`;
  return `Create ${last}`;
}

function entryHaystack(entry: WriteLogEntry): string {
  return [entryTitle(entry), objectName(entry), entry.path, entry.method, entry.actor, entry.operation, entry.error]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function display(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value.trim() || "—";
  return JSON.stringify(value);
}

/** Top-level fields a PATCH or PUT sent, against what the object held before. */
function fieldDiff(entry: WriteLogEntry) {
  if (entry.method !== "PATCH" && entry.method !== "PUT") return [];
  if (!isRecord(entry.requestBody) || !isRecord(entry.before)) return [];
  const before = entry.before;
  return Object.entries(entry.requestBody)
    .filter(([key]) => !key.startsWith("@odata"))
    .filter(([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value))
    .map(([key, value]) => ({ label: key, before: display(before[key]), after: display(value) }));
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <details>
      <summary style={{ cursor: "pointer", fontSize: "0.8rem" }}>{title}</summary>
      <pre className="inspector-code" style={{ maxHeight: "22rem", overflow: "auto" }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

const LINK_BUTTON = { background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" } as const;

/** What undo will write, in plain words. */
function undoSummary(entry: WriteLogEntry): string {
  if (entry.createdId) return "Undo deletes the object this write created.";
  if (entry.path.split("?")[0].endsWith("/assign")) {
    const previous = isRecord(entry.before) && Array.isArray(entry.before.value) ? entry.before.value.length : 0;
    return previous
      ? `Undo puts back the ${previous} assignment${previous === 1 ? "" : "s"} the object had before.`
      : "Undo puts back the object’s previous assignments, which were none.";
  }
  const fields = isRecord(entry.requestBody)
    ? Object.keys(entry.requestBody).filter((key) => !key.startsWith("@odata")).length
    : 0;
  return `Undo puts back the previous value of ${fields} field${fields === 1 ? "" : "s"}.`;
}

function UndoPanel({
  entry,
  onSelect,
  onUndone,
}: {
  entry: WriteLogEntry;
  onSelect: (id: string) => void;
  onUndone: () => void;
}) {
  const readOnly = useReadOnly();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<UndoOutcome | null>(null);
  const [done, setDone] = useState(false);

  async function run(force: boolean) {
    setBusy(true);
    try {
      const result = await undoWrite(entry.id, force);
      setOutcome(result);
      if (result.ok) {
        setDone(true);
        onUndone();
      }
    } catch (error) {
      setOutcome({
        ok: false,
        conflicts: [],
        unverified: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }

  const links = (
    <>
      {entry.undoes ? (
        <p className="muted" style={{ margin: 0, fontSize: "0.8125rem" }}>
          This write undid{" "}
          <button type="button" className="axis-link" style={LINK_BUTTON} onClick={() => onSelect(entry.undoes!)}>
            an earlier write
          </button>
          .
        </p>
      ) : null}
      {entry.undoneBy ? (
        <p className="muted" style={{ margin: 0, fontSize: "0.8125rem" }}>
          Undone by{" "}
          <button type="button" className="axis-link" style={LINK_BUTTON} onClick={() => onSelect(entry.undoneBy!)}>
            a later write
          </button>
          .
        </p>
      ) : null}
    </>
  );

  if (done) {
    return (
      <div className="axis-alert axis-alert-info">
        Undone. The reverse write is at the top of the list.
      </div>
    );
  }
  if (entry.undoBlocked) {
    return (
      <section className="stack">
        {links}
        {!entry.undoneBy ? (
          <p className="muted" style={{ margin: 0, fontSize: "0.8125rem" }}>
            {entry.undoBlocked}
          </p>
        ) : null}
      </section>
    );
  }

  const needsForce = outcome && !outcome.ok && (outcome.conflicts.length > 0 || outcome.unverified);
  return (
    <section className="stack">
      {links}
      <p style={{ margin: 0, fontSize: "0.8125rem" }}>{undoSummary(entry)}</p>
      {needsForce ? (
        <div className="axis-alert axis-alert-warning">
          {outcome?.unverified
            ? "Axis could not read the object after this write, so it cannot confirm nothing changed it since."
            : `Changed since this write: ${outcome?.conflicts.join(", ")}. Undo would overwrite those changes.`}
        </div>
      ) : null}
      {outcome?.error ? <p className="setting-field-error" style={{ margin: 0 }}>{outcome.error}</p> : null}
      <div className="device-actions">
        {needsForce ? (
          <>
            <button type="button" className="axis-btn" disabled={busy} onClick={() => setOutcome(null)}>
              Keep current
            </button>
            <button
              type="button"
              className="axis-btn axis-btn-danger"
              disabled={busy || readOnly}
              title={readOnly ? READ_ONLY_WRITE_HINT : undefined}
              onClick={() => void run(true)}
            >
              {busy ? "Undoing…" : "Undo anyway"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="axis-btn"
            disabled={busy || readOnly}
            title={readOnly ? READ_ONLY_WRITE_HINT : "Checks the object has not changed since, then reverses this write."}
            onClick={() => void run(false)}
          >
            {busy ? "Checking…" : "Undo this write"}
          </button>
        )}
      </div>
    </section>
  );
}

function AxisWriteActivity({ pathname, search }: { pathname: string; search: URLSearchParams }) {
  const { query, setQuery } = useListSearchState();
  const [entries, setEntries] = useState<WriteLogEntry[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [resultFilter, setResultFilter] = useState("all");
  const selectedId = search.get("event");

  const reload = useCallback(() => {
    setLoading(true);
    void listWriteLog()
      .then((response) => {
        setEntries(response.entries ?? []);
        setFolder(response.folder);
        setSignedIn(Boolean(response.tenantId));
        setTruncated(response.truncated);
        setError(null);
      })
      .catch((err) => {
        setEntries([]);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (resultFilter === "success" && !entry.ok) return false;
      if (resultFilter === "failed" && entry.ok) return false;
      if (needle && !entryHaystack(entry).includes(needle)) return false;
      return true;
    });
  }, [entries, query, resultFilter]);

  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const diff = selected ? fieldDiff(selected) : [];

  return (
    <WorkspaceSplit
      master={
        <CompactObjectList
          title="Write activity"
          description={
            signedIn
              ? `Every create, update, delete, and action Axis sent to Graph for this tenant, recorded on this device as it happened.${
                  folder ? ` Stored in ${folder}.` : ""
                }`
              : "Sign in to see the writes Axis made against a tenant."
          }
          items={filtered.map((entry) => ({
            id: entry.id,
            title: `${entry.ok ? "" : "Failed · "}${entry.undoneBy ? "Undone · " : ""}${entry.undoes ? "Undo · " : ""}${entryTitle(entry)}`,
            meta: [formatRelative(entry.at), objectName(entry), entry.operation, entry.actor]
              .filter(Boolean)
              .join(" · "),
            group: entry.at.slice(0, 10),
          }))}
          selectedId={selected?.id ?? null}
          onSelect={(id) => navigate(hrefWithParam(pathname, search, "event", id || null))}
          onRefresh={reload}
          loading={loading}
          error={error}
          query={query}
          onQueryChange={setQuery}
          countLabel={
            truncated
              ? `${filtered.length} shown · newest ${entries.length}`
              : `${filtered.length} write${filtered.length === 1 ? "" : "s"}`
          }
          searchPlaceholder="Search object, path, actor, or error…"
          filters={[
            sourceFilter(pathname, search, "axis"),
            { label: "Result", value: resultFilter, onChange: setResultFilter, options: RESULT_OPTIONS },
          ]}
          actions={
            <button
              type="button"
              className="axis-btn"
              onClick={() => void saveJson("axis-write-log.json", "Save write log", { entries: filtered })}
              disabled={filtered.length === 0}
            >
              Save JSON
            </button>
          }
        />
      }
      inspector={
        selected ? (
          <div className="inspector-scroll" style={{ padding: "1rem" }}>
            <div className="stack">
              <div>
                <p className="axis-kicker">{selected.ok ? "Succeeded" : "Failed"}</p>
                <h2 style={{ margin: "0.15rem 0 0", fontSize: "1.05rem" }}>
                  {objectName(selected) ?? entryTitle(selected)}
                </h2>
                <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
                  {entryTitle(selected)} · {formatRelative(selected.at)} · {new Date(selected.at).toLocaleString()}
                </p>
              </div>
              <dl className="stat-rows">
                <div>
                  <dt className="muted">Request</dt>
                  <dd style={{ margin: 0, wordBreak: "break-all" }}>
                    <code>
                      {selected.method} /{selected.version}
                      {selected.path}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt className="muted">Signed in as</dt>
                  <dd style={{ margin: 0 }}>{selected.actor || "—"}</dd>
                </div>
                {selected.operation ? (
                  <div>
                    <dt className="muted">Started from</dt>
                    <dd style={{ margin: 0 }}>{selected.operation}</dd>
                  </div>
                ) : null}
                {selected.status ? (
                  <div>
                    <dt className="muted">HTTP status</dt>
                    <dd style={{ margin: 0 }}>{selected.status}</dd>
                  </div>
                ) : null}
              </dl>
              {selected.error ? (
                <p className="setting-field-error" style={{ margin: 0, fontSize: "0.8125rem", wordBreak: "break-word" }}>
                  {selected.error}
                </p>
              ) : null}
              {diff.length > 0 ? (
                <section>
                  <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.8rem" }}>Changed fields</h3>
                  <SettingValueDiff lines={diff} />
                </section>
              ) : null}
              <UndoPanel
                key={selected.id}
                entry={selected}
                onSelect={(id) => navigate(hrefWithParam(pathname, search, "event", id))}
                onUndone={reload}
              />
              <JsonBlock title="Sent to Graph" value={selected.requestBody} />
              <JsonBlock title="Before this write" value={selected.before} />
              <JsonBlock title="After this write" value={selected.after} />
              <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
                Secrets such as passwords and pre-shared keys are redacted before the entry is saved.
              </p>
            </div>
          </div>
        ) : (
          <InspectorEmpty label="Select a write to see the request Axis sent, the object as it was before, and any error Graph returned." />
        )
      }
    />
  );
}

/* ── Intune audit log ─────────────────────────────────────────────── */

function actorLabel(event: IntuneAuditEvent): string {
  return (
    event.actor.displayName ||
    event.actor.userPrincipalName ||
    event.actor.appDisplayName ||
    "Unknown actor"
  );
}

function eventHaystack(event: IntuneAuditEvent): string {
  return [
    event.activityDisplayName,
    event.category,
    event.result,
    event.operationType,
    actorLabel(event),
    ...(event.targetResources ?? []),
    ...(event.changes ?? []).map((change) => change.displayName),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function IntuneAuditActivity({ pathname, search }: { pathname: string; search: URLSearchParams }) {
  const { query, setQuery } = useListSearchState();
  const [events, setEvents] = useState<IntuneAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [resultFilter, setResultFilter] = useState("all");
  const selectedId = search.get("event");

  const reload = useCallback(() => {
    setLoading(true);
    void listIntuneAuditEvents()
      .then((response) => {
        setEvents(response.events ?? []);
        setTruncated(Boolean(response.truncated));
        setError(response.error);
      })
      .catch((err) => {
        setEvents([]);
        setError(err instanceof Error ? err.message : "Failed to load Intune audit events.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (resultFilter === "success" && event.result !== "Success") return false;
      if (resultFilter === "failed" && event.result === "Success") return false;
      if (needle && !eventHaystack(event).includes(needle)) return false;
      return true;
    });
  }, [events, query, resultFilter]);

  const selected = filtered.find((event) => event.id === selectedId) ?? events.find((event) => event.id === selectedId) ?? null;

  return (
    <WorkspaceSplit
      master={
        <CompactObjectList
          title="Write activity"
          description="Intune audit log for this tenant. Each row is a create, update, or delete Graph recorded against Intune objects, from any tool or person."
          items={filtered.map((event) => ({
            id: event.id,
            title: event.activityDisplayName,
            meta: [formatRelative(event.activityDateTime), event.targetResources?.[0], actorLabel(event)]
              .filter(Boolean)
              .join(" · "),
            group: event.category ?? undefined,
          }))}
          selectedId={selected?.id ?? null}
          onSelect={(id) => navigate(hrefWithParam(pathname, search, "event", id || null))}
          onRefresh={reload}
          loading={loading}
          error={error}
          query={query}
          onQueryChange={setQuery}
          countLabel={
            truncated
              ? `${filtered.length} shown · first 250 from last 30 days`
              : `${filtered.length} event${filtered.length === 1 ? "" : "s"}`
          }
          searchPlaceholder="Search activity, actor, or object…"
          filters={[
            sourceFilter(pathname, search, "intune"),
            { label: "Result", value: resultFilter, onChange: setResultFilter, options: RESULT_OPTIONS },
          ]}
          actions={
            <button
              type="button"
              className="axis-btn"
              onClick={() => void saveJson("axis-write-activity.json", "Save write activity", { events: filtered })}
              disabled={filtered.length === 0}
            >
              Save JSON
            </button>
          }
        />
      }
      inspector={
        selected ? (
          <div className="inspector-scroll" style={{ padding: "1rem" }}>
            <div className="stack">
              <div>
                <p className="axis-kicker">{selected.category || selected.operationType || "Intune"}</p>
                <h2 style={{ margin: "0.15rem 0 0", fontSize: "1.05rem" }}>{selected.activityDisplayName}</h2>
                <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.75rem" }}>
                  {formatRelative(selected.activityDateTime)}
                  {selected.activityDateTime
                    ? ` · ${new Date(selected.activityDateTime).toLocaleString()}`
                    : ""}
                </p>
              </div>
              <dl className="stat-rows">
                <div>
                  <dt className="muted">Actor</dt>
                  <dd style={{ margin: 0 }}>{actorLabel(selected)}</dd>
                </div>
                <div>
                  <dt className="muted">Result</dt>
                  <dd style={{ margin: 0 }}>{selected.result || "—"}</dd>
                </div>
                {selected.operationType ? (
                  <div>
                    <dt className="muted">Operation</dt>
                    <dd style={{ margin: 0 }}>{selected.operationType}</dd>
                  </div>
                ) : null}
                {selected.targetResources?.length ? (
                  <div>
                    <dt className="muted">Objects</dt>
                    <dd style={{ margin: 0 }}>{selected.targetResources.join(", ")}</dd>
                  </div>
                ) : null}
              </dl>
              {selected.changes && selected.changes.length > 0 ? (
                <section>
                  <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.8rem" }}>Property changes</h3>
                  <SettingValueDiff
                    lines={selected.changes.map((change) => ({
                      label: change.displayName,
                      before: change.oldValue?.trim() || "—",
                      after: change.newValue?.trim() || "—",
                    }))}
                  />
                </section>
              ) : (
                <p className="muted" style={{ margin: 0, fontSize: "0.8125rem" }}>
                  Intune did not return property diffs for this event. The action itself is still recorded.
                </p>
              )}
            </div>
          </div>
        ) : (
          <InspectorEmpty label="Select an audit event to see who changed what, and the property diffs Intune stored." />
        )
      }
    />
  );
}
