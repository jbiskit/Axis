import { useCallback, useEffect, useMemo, useState } from "react";
import type { IntuneAuditEvent } from "../types/glance";
import { hrefWithParam, navigate } from "../lib/route";
import { listIntuneAuditEvents, saveTextFile } from "../lib/tauri";
import { SettingValueDiff } from "./workbench/SettingValueDiff";
import {
  CompactObjectList,
  InspectorEmpty,
  WorkspaceSplit,
  formatRelative,
  useListSearchState,
} from "./workbench/shared";

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

export function WriteActivityView({
  pathname,
  search,
}: {
  pathname: string;
  search: URLSearchParams;
}) {
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

  async function exportLog() {
    const payload = JSON.stringify(
      { generatedAt: new Date().toISOString(), events: filtered },
      null,
      2,
    );
    await saveTextFile({
      contents: payload,
      suggestedName: "axis-write-activity.json",
      title: "Save write activity",
    });
  }

  return (
    <WorkspaceSplit
      inspectorPrimary={Boolean(selected)}
      master={
        <CompactObjectList
          title="Write activity"
          description="Intune audit log for this tenant. Each row is a create, update, or delete Graph recorded against Intune objects."
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
          secondaryFilter={{
            label: "Result",
            value: resultFilter,
            onChange: setResultFilter,
            options: [
              { value: "all", label: "All results" },
              { value: "success", label: "Success" },
              { value: "failed", label: "Not success" },
            ],
          }}
          actions={
            <button type="button" className="axis-btn" onClick={() => void exportLog()} disabled={filtered.length === 0}>
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
