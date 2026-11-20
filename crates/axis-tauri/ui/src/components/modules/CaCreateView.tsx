import { useEffect, useMemo, useState } from "react";
import { useInventory } from "../../hooks/useInventory";
import { navigate } from "../../lib/route";
import { createConditionalAccessPolicy, fetchSignedInUser, saveTextFile } from "../../lib/tauri";
import { PageHeader, Panel, PanelHead } from "../ui/PageChrome";
import { SelectCheckbox, useCheckedIds } from "../workbench/PolicyBulkAssign";
import { CaPolicyBuilder } from "./CaPolicyBuilder";
import { policyLink } from "./EntraWorkspace";
import { asRecord, loaderFor, rowTitle, type ReviewRow } from "./ReviewWorkbench";
import "../../styles/ca-viewer.css";

type Policy = Record<string, unknown>;
type Draft = { key: string; source: string; policy: Policy; status?: "creating" | "created" | "error"; message?: string; created?: Policy };
type StateMode = "enabledForReportingButNotEnforced" | "disabled" | "source";

const READ_ONLY = ["id", "createdDateTime", "modifiedDateTime", "deletedDateTime", "templateId", "partialEnablementStrategy"];
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const IS_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BLANK: Policy = {
  displayName: "New policy",
  state: "enabledForReportingButNotEnforced",
  conditions: {
    clientAppTypes: ["all"],
    users: { includeUsers: ["None"] },
    applications: { includeApplications: ["None"] },
  },
  grantControls: { operator: "OR", builtInControls: ["mfa"] },
};

/** Drop Graph annotations (`@odata.context` etc.) and null (unset) properties at every level; `@odata.type` stays. */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => child !== null && (!key.includes("@odata") || key === "@odata.type"))
      .map(([key, child]) => [key, clean(child)]),
  );
}

/** Templates put "Current administrator will be excluded" in excludeUsers; Graph only takes ids there. */
const TEMPLATE_ME = "Current administrator will be excluded";
const USER_KEYWORDS = new Set(["All", "None", "GuestsOrExternalUsers"]);
const USER_LISTS = ["includeUsers", "excludeUsers", "includeGroups", "excludeGroups", "includeRoles", "excludeRoles"];

/** The exact body POSTed for a draft. */
function createBody(policy: Policy, mode: StateMode): Policy {
  const body = clean(policy) as Policy;
  for (const key of READ_ONLY) delete body[key];
  const grant = asRecord(body.grantControls);
  const strength = asRecord(grant.authenticationStrength);
  // Exports carry the whole strength object; create only takes its id.
  if (strength.id) body.grantControls = { ...grant, authenticationStrength: { id: strength.id } };
  const conditions = asRecord(body.conditions);
  const users = asRecord(conditions.users);
  // Drop template placeholders and other text that isn't an object id or keyword.
  for (const key of USER_LISTS) {
    if (Array.isArray(users[key])) users[key] = (users[key] as unknown[]).filter((id) => typeof id === "string" && (USER_KEYWORDS.has(id) || IS_GUID.test(id)));
  }
  if (mode !== "source") body.state = mode;
  return body;
}

/** One policy, an array of policies, or a Graph list response (`{ value: [...] }`). */
function parsePolicies(text: string): Policy[] {
  const parsed: unknown = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : Array.isArray(asRecord(parsed).value) ? (asRecord(parsed).value as unknown[]) : [parsed];
  return list.map(asRecord).filter((policy) => policy.conditions || policy.displayName);
}

const STATE_TEXT: Record<string, string> = { enabled: "On", enabledForReportingButNotEnforced: "Report-only", disabled: "Off" };
let nextKey = 0;
const draftOf = (source: string, policy: Policy): Draft => ({ key: `draft-${nextKey++}`, source, policy });

export function CaCreateView({ signedIn }: { signedIn: boolean }) {
  const policies = useInventory(loaderFor("conditionalAccessPolicy"), signedIn, signedIn);
  const templates = useInventory(loaderFor("caTemplate"), signedIn, signedIn);
  const [tab, setTab] = useState<"import" | "template" | "builder">("builder");
  const [builder, setBuilder] = useState<{ key: string | null; policy: Policy }>(() => ({ key: null, policy: structuredClone(BLANK) }));
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [mode, setMode] = useState<StateMode>("enabledForReportingButNotEnforced");
  const [paste, setPaste] = useState("");
  const [templateQuery, setTemplateQuery] = useState("");
  const [editing, setEditing] = useState<{ key: string; text: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [meId, setMeId] = useState("");
  useEffect(() => {
    fetchSignedInUser()
      .then((me) => setMeId(me.id))
      .catch(() => undefined);
  }, []);
  const [error, setError] = useState<string | null>(null);

  const existingNames = useMemo(() => new Set(policies.items.map((row) => rowTitle(row).trim().toLowerCase())), [policies.items]);
  const templateRows = useMemo(() => {
    const needle = templateQuery.trim().toLowerCase();
    return templates.items
      .filter((row) => typeof row.id === "string")
      .filter((row) => !needle || `${row.name} ${row.description}`.toLowerCase().includes(needle))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [templates.items, templateQuery]);
  const templateSelection = useCheckedIds(templateRows.map((row) => String(row.id)));
  const draftSelection = useCheckedIds(drafts.map((draft) => draft.key));
  const selectedDrafts = drafts.filter((draft) => draftSelection.checkedIds.has(draft.key));

  const add = (next: Draft[]) => {
    setDrafts((current) => [...current, ...next]);
    setError(null);
  };
  const update = (key: string, change: Partial<Draft>) => setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...change } : draft)));

  const addText = (text: string, source: string) => {
    try {
      const found = parsePolicies(text);
      if (!found.length) throw new Error("No Conditional Access policies found in the JSON.");
      add(found.map((policy) => draftOf(source, policy)));
    } catch (reason) {
      setError(`${source}: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };
  const addFiles = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) addText(await file.text(), file.name);
  };
  const addTemplates = () => {
    const picked = templateRows.filter((row) => templateSelection.checkedIds.has(String(row.id)));
    add(
      picked.map((row: ReviewRow) => {
        const details = asRecord(row.details);
        const conditions = asRecord(structuredClone(details.conditions ?? {}));
        const users = asRecord(conditions.users);
        // The template's "exclude current administrator" becomes the signed-in user, like the portal does.
        if (Array.isArray(users.excludeUsers) && users.excludeUsers.includes(TEMPLATE_ME)) {
          users.excludeUsers = [...new Set(users.excludeUsers.map((id) => (id === TEMPLATE_ME ? meId : id)).filter(Boolean))];
        }
        return draftOf(`Template · ${row.name}`, {
          displayName: row.name,
          state: "enabledForReportingButNotEnforced",
          conditions,
          grantControls: details.grantControls ?? null,
          sessionControls: details.sessionControls ?? null,
        });
      }),
    );
  };

  /** Creates each draft in turn; true when all of them were created. */
  const createDrafts = async (list: Draft[]) => {
    setBusy(true);
    let ok = true;
    // One at a time keeps Graph throttling and the per-row status readable.
    for (const draft of list.filter((item) => item.status !== "created")) {
      update(draft.key, { status: "creating", message: undefined });
      try {
        const created = await createConditionalAccessPolicy(createBody(draft.policy, mode));
        update(draft.key, { status: "created", created, message: undefined });
      } catch (reason) {
        ok = false;
        update(draft.key, { status: "error", message: String(reason) });
      }
    }
    setBusy(false);
    policies.reload();
    return ok;
  };
  const createSelected = () => createDrafts(selectedDrafts);
  /** Builder "Create": the policy lands in the drafts list and is created straight away; on failure it stays open to fix. */
  const createFromBuilder = async () => {
    const draft: Draft = builder.key ? { key: builder.key, source: "Builder", policy: builder.policy } : draftOf("Builder", builder.policy);
    if (builder.key) update(draft.key, { policy: builder.policy });
    else add([draft]);
    setBuilder({ key: draft.key, policy: builder.policy });
    if (await createDrafts([draft])) setBuilder({ key: null, policy: structuredClone(BLANK) });
  };
  const builderDraft = drafts.find((draft) => draft.key === builder.key);

  const warnings = (draft: Draft) => {
    const body = createBody(draft.policy, mode);
    const notes: string[] = [];
    if (existingNames.has(String(body.displayName ?? "").trim().toLowerCase())) notes.push("A policy with this name already exists");
    if (body.state === "enabled") notes.push("Will be enforced (On) as soon as it's created");
    const ids = new Set(JSON.stringify(body.conditions ?? {}).match(GUID) ?? []);
    if (ids.size) notes.push(`References ${ids.size} object id${ids.size === 1 ? "" : "s"} that must exist in this tenant`);
    return notes;
  };

  return (
    <div className="ca-viewer">
      <PageHeader
        eyebrow="Entra · Conditional Access"
        title="New Conditional Access policies"
        description="Build a policy with the form, import policies from JSON, or start from Microsoft's templates. Review the drafts, then create them in bulk."
        onRefresh={() => {
          policies.reload();
          templates.reload();
        }}
        refreshing={policies.loading || templates.loading}
        platformChips={false}
      />

      <Panel padded>
        <PanelHead title="Add drafts" hint="Nothing is written to the tenant until you create the drafts below." />
        <div className="tab-row">
          {(
            [
              ["import", "Import JSON"],
              ["template", "From template"],
              ["builder", "Builder"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" className={`tab-btn${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>

        {tab === "import" ? (
          <div className="ca-import">
            <p className="muted">
              Accepts one policy, an array of policies, or a Graph list response: Axis exports, Entra portal downloads, or <code>GET /identity/conditionalAccess/policies</code>.
            </p>
            <input type="file" accept=".json,application/json" multiple onChange={(event) => void addFiles(event.target.files).then(() => (event.target.value = ""))} />
            <textarea className="axis-input ca-json" rows={6} value={paste} placeholder="…or paste JSON here" onChange={(event) => setPaste(event.target.value)} />
            <div className="ca-form-actions">
              <button
                type="button"
                className="axis-btn"
                disabled={!paste.trim()}
                onClick={() => {
                  addText(paste, "Pasted JSON");
                  setPaste("");
                }}
              >
                Add pasted JSON
              </button>
            </div>
          </div>
        ) : tab === "template" ? (
          <>
            <div className="ca-form-actions">
              <input className="axis-input" value={templateQuery} placeholder="Filter templates" onChange={(event) => setTemplateQuery(event.target.value)} />
              <button type="button" className="axis-btn" disabled={templateSelection.checkedIds.size === 0} onClick={addTemplates}>
                Add selected ({templateSelection.checkedIds.size})
              </button>
            </div>
            <div className="axis-table-wrap ca-signins">
              <table className="axis-table">
                <thead>
                  <tr>
                    <th className="axis-table-check">
                      <SelectCheckbox
                        checked={templateSelection.allSelected}
                        indeterminate={templateSelection.checkedIds.size > 0 && !templateSelection.allSelected}
                        disabled={templateRows.length === 0}
                        label="Select all templates"
                        onChange={templateSelection.toggleAll}
                      />
                    </th>
                    <th>Template</th>
                    <th>Description</th>
                    <th>In tenant</th>
                  </tr>
                </thead>
                <tbody>
                  {templateRows.map((row) => {
                    const id = String(row.id);
                    const matched = Array.isArray(row.matchedPolicies) && row.matchedPolicies.length > 0;
                    return (
                      <tr key={id} className="row-link" onClick={() => templateSelection.toggle(id)}>
                        <td className="axis-table-check" onClick={(event) => event.stopPropagation()}>
                          <SelectCheckbox checked={templateSelection.checkedIds.has(id)} label={`Select ${row.name}`} onChange={() => templateSelection.toggle(id)} />
                        </td>
                        <td>{String(row.name ?? id)}</td>
                        <td className="muted">{String(row.description ?? "")}</td>
                        <td className="muted">{matched ? "Has policy" : "—"}</td>
                      </tr>
                    );
                  })}
                  {templateRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        {templates.loading ? "Loading templates…" : "No templates."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {templates.error ? <div className="axis-alert axis-alert-danger">{templates.error}</div> : null}
          </>
        ) : (
          <>
            <CaPolicyBuilder policy={builder.policy} onChange={(policy) => setBuilder({ ...builder, policy })} />
            <div className="ca-form-actions">
              <span className="ca-spacer" />
              {builder.key ? (
                <button type="button" className="axis-btn" onClick={() => setBuilder({ key: null, policy: structuredClone(BLANK) })}>
                  Cancel edit
                </button>
              ) : (
                <button type="button" className="axis-btn" onClick={() => setBuilder({ key: null, policy: structuredClone(BLANK) })}>
                  Start over
                </button>
              )}
              <button
                type="button"
                className="axis-btn"
                disabled={busy}
                onClick={() => {
                  if (builder.key) update(builder.key, { policy: builder.policy, status: undefined, message: undefined });
                  else add([draftOf("Builder", builder.policy)]);
                  setBuilder({ key: null, policy: structuredClone(BLANK) });
                }}
              >
                {builder.key ? "Save to draft" : "Add to drafts"}
              </button>
              <button type="button" className="axis-btn axis-btn-primary" disabled={busy} onClick={() => void createFromBuilder()}>
                {busy ? "Creating…" : `Create as ${mode === "source" ? STATE_TEXT[String(builder.policy.state)] ?? "set in policy" : STATE_TEXT[mode]}`}
              </button>
            </div>
            {builderDraft?.status === "error" ? <div className="axis-alert axis-alert-danger ca-error">{builderDraft.message}</div> : null}
          </>
        )}
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
      </Panel>

      <Panel padded>
        <PanelHead title={`Drafts (${drafts.length})`} hint="Every draft is created with the state you pick here. Report-only logs what it would do without enforcing it." />
        <div className="ca-form-actions">
          <label className="ca-toggle">
            Create as
            <select className="axis-input" value={mode} onChange={(event) => setMode(event.target.value as StateMode)}>
              <option value="enabledForReportingButNotEnforced">Report-only (recommended)</option>
              <option value="disabled">Off</option>
              <option value="source">Keep the state in each draft</option>
            </select>
          </label>
          <span className="ca-spacer" />
          <button
            type="button"
            className="axis-btn"
            disabled={selectedDrafts.length === 0}
            onClick={() =>
              void saveTextFile({
                contents: JSON.stringify(
                  selectedDrafts.map((draft) => createBody(draft.policy, mode)),
                  null,
                  2,
                ),
                suggestedName: "conditional-access-drafts.json",
                title: "Export drafts",
              })
            }
          >
            Export JSON ({selectedDrafts.length})
          </button>
          <button
            type="button"
            className="axis-btn"
            disabled={selectedDrafts.length === 0 || busy}
            onClick={() => setDrafts((current) => current.filter((draft) => !draftSelection.checkedIds.has(draft.key)))}
          >
            Remove ({selectedDrafts.length})
          </button>
          <button type="button" className="axis-btn axis-btn-primary" disabled={selectedDrafts.length === 0 || busy} onClick={() => void createSelected()}>
            {busy ? "Creating…" : `Create selected (${selectedDrafts.length})`}
          </button>
        </div>

        <div className="axis-table-wrap">
          <table className="axis-table">
            <thead>
              <tr>
                <th className="axis-table-check">
                  <SelectCheckbox
                    checked={draftSelection.allSelected}
                    indeterminate={draftSelection.checkedIds.size > 0 && !draftSelection.allSelected}
                    disabled={drafts.length === 0}
                    label="Select all drafts"
                    onChange={draftSelection.toggleAll}
                  />
                </th>
                <th>Name</th>
                <th>Source</th>
                <th>State</th>
                <th>Checks</th>
                <th>Result</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => {
                const body = createBody(draft.policy, mode);
                const open = editing?.key === draft.key;
                return [
                  <tr key={draft.key}>
                    <td className="axis-table-check">
                      <SelectCheckbox checked={draftSelection.checkedIds.has(draft.key)} label={`Select ${body.displayName}`} onChange={() => draftSelection.toggle(draft.key)} />
                    </td>
                    <td>
                      <input
                        className="axis-input"
                        value={String(draft.policy.displayName ?? "")}
                        disabled={draft.status === "created"}
                        onChange={(event) => update(draft.key, { policy: { ...draft.policy, displayName: event.target.value } })}
                      />
                    </td>
                    <td className="muted">{draft.source}</td>
                    <td>{STATE_TEXT[String(body.state)] ?? String(body.state ?? "—")}</td>
                    <td className="ca-reason">
                      {warnings(draft).map((note) => (
                        <div key={note} className="ca-warn">
                          {note}
                        </div>
                      ))}
                    </td>
                    <td>
                      {draft.status === "created" && draft.created ? (
                        <button type="button" className="axis-link" onClick={() => navigate(policyLink(draft.created as ReviewRow).href)}>
                          Created · open
                        </button>
                      ) : draft.status === "creating" ? (
                        <span className="muted">Creating…</span>
                      ) : draft.status === "error" ? (
                        <span className="ca-error">{draft.message}</span>
                      ) : null}
                    </td>
                    <td className="ca-row-actions">
                      <button
                        type="button"
                        className="axis-btn"
                        disabled={draft.status === "created"}
                        onClick={() => {
                          setBuilder({ key: draft.key, policy: draft.policy });
                          setTab("builder");
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="axis-btn"
                        disabled={draft.status === "created"}
                        onClick={() => setEditing(open ? null : { key: draft.key, text: JSON.stringify(draft.policy, null, 2) })}
                      >
                        {open ? "Close JSON" : "Edit JSON"}
                      </button>
                    </td>
                  </tr>,
                  open ? (
                    <tr key={`${draft.key}-json`}>
                      <td colSpan={7}>
                        <textarea
                          className="axis-input ca-json"
                          rows={18}
                          value={editing?.text ?? ""}
                          onChange={(event) => {
                            const text = event.target.value;
                            try {
                              update(draft.key, { policy: asRecord(JSON.parse(text)) });
                              setEditing({ key: draft.key, text });
                            } catch (reason) {
                              setEditing({ key: draft.key, text, error: String(reason) });
                            }
                          }}
                        />
                        {editing?.error ? <div className="ca-error">{editing.error}</div> : null}
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
              {drafts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No drafts yet. Build a policy, import JSON, or pick templates above.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {policies.error ? <div className="axis-alert axis-alert-danger">{policies.error}</div> : null}
      </Panel>
    </div>
  );
}
