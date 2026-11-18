import { useEffect, useMemo, useState } from "react";
import { useInventory } from "../../hooks/useInventory";
import { navigate } from "../../lib/route";
import {
  evaluateConditionalAccess,
  fetchConditionalAccessSignIns,
  saveTextFile,
  searchConditionalAccessApps,
  searchReadinessUsers,
} from "../../lib/tauri";
import { PageHeader, Panel, PanelHead } from "../ui/PageChrome";
import { BooleanToggle } from "../workbench/BooleanToggle";
import { SelectCheckbox, useCheckedIds } from "../workbench/PolicyBulkAssign";
import {
  grantText,
  LOCATION_SPECIAL,
  named,
  policyLink,
  resolvePolicyNames,
  resourceTargets,
  sessionItems,
  userTargets,
  withExcluded,
} from "./EntraWorkspace";
import { asList, asRecord, humanize, loaderFor, rowTitle, type ReviewNames, type ReviewRow } from "./ReviewWorkbench";
import "../../styles/ca-viewer.css";

/** Gates in the order the portal lists a policy's assignments and conditions. */
const GATES = [
  { key: "users", label: "Users" },
  { key: "apps", label: "Apps" },
  { key: "network", label: "Network" },
  { key: "device", label: "Device / client" },
  { key: "risk", label: "Risk" },
] as const;
type Gate = (typeof GATES)[number]["key"];

/** conditionalAccessConditions (sign-in logs) and whatIfAnalysisReasons flags → gate. */
const FLAG_GATE: Record<string, Gate> = {
  users: "users",
  workloadidentities: "users",
  serviceprincipals: "users",
  application: "apps",
  useractions: "apps",
  authenticationcontext: "apps",
  location: "network",
  ipaddressseenbyazuread: "network",
  ipaddressseenbyresourceprovider: "network",
  deviceplatform: "device",
  devices: "device",
  devicestate: "device",
  clientapps: "device",
  clienttype: "device",
  client: "device",
  authenticationflow: "device",
  authenticationflows: "device",
  signinrisk: "risk",
  userrisk: "risk",
  insiderrisk: "risk",
  serviceprincipalrisk: "risk",
  time: "risk",
};

type LaneTrace = { status: "applied" | "stopped" | "off"; stop: number; reason: string; reportOnly: boolean };
type Trace = { label: string; raw: unknown; lanes: Map<string, LaneTrace> };

const flags = (value: unknown) =>
  String(value ?? "")
    .split(",")
    .map((flag) => flag.trim())
    .filter((flag) => flag && flag !== "none");

/** Index of the first gate a flag list fails, or -1 when none map to a gate. */
function stopGate(value: unknown): number {
  const failed = new Set(flags(value).map((flag) => FLAG_GATE[flag.toLowerCase()]));
  return GATES.findIndex((gate) => failed.has(gate.key));
}

function signInTrace(signIn: Record<string, unknown>): Trace {
  const lanes = new Map<string, LaneTrace>();
  const entries = Array.isArray(signIn.appliedConditionalAccessPolicies) ? signIn.appliedConditionalAccessPolicies : [];
  for (const entry of entries.map(asRecord)) {
    const result = String(entry.result ?? "");
    const reportOnly = result.startsWith("reportOnly");
    const applied = !/notApplied|notEnabled/i.test(result);
    lanes.set(String(entry.id), {
      status: result === "notEnabled" ? "off" : applied ? "applied" : "stopped",
      stop: applied ? -1 : stopGate(entry.conditionsNotSatisfied),
      reason: humanize(result),
      reportOnly,
    });
  }
  return { label: `${signIn.userPrincipalName} · ${signIn.appDisplayName} · ${String(signIn.createdDateTime ?? "").replace("T", " ").slice(0, 16)}`, raw: signIn, lanes };
}

function whatIfTrace(label: string, results: Array<Record<string, unknown>>): Trace {
  const lanes = new Map<string, LaneTrace>();
  for (const result of results) {
    const reasons = flags(result.analysisReasons);
    const off = reasons.includes("policyNotEnabled");
    const applied = result.policyApplies === true;
    lanes.set(String(result.id), {
      status: off ? "off" : applied ? "applied" : "stopped",
      stop: applied ? -1 : stopGate(result.analysisReasons),
      reason: applied ? "Applies" : reasons.map(humanize).join(", ") || "Doesn't apply",
      reportOnly: result.state === "enabledForReportingButNotEnforced",
    });
  }
  return { label, raw: results, lanes };
}

const levels = (value: unknown) => asList(value).filter((level) => level !== "all").map(humanize);
const or = (text: string) => text || "any";

/** One short label per gate, from the policy's own conditions. */
function gateLabels(row: ReviewRow, names: ReviewNames): Record<Gate, string> {
  const conditions = asRecord(row.conditions);
  const users = userTargets(row, names);
  const apps = resourceTargets(row, names);
  const locations = asRecord(conditions.locations);
  const platforms = asRecord(conditions.platforms);
  const filter = asRecord(asRecord(conditions.devices).deviceFilter);
  const device = [
    asList(platforms.includePlatforms).length ? withExcluded(asList(platforms.includePlatforms), asList(platforms.excludePlatforms)) : "",
    levels(conditions.clientAppTypes).join(", "),
    filter.rule ? `filter (${humanize(filter.mode)})` : "",
  ].filter(Boolean);
  const risk = [
    levels(conditions.signInRiskLevels).length ? `sign-in ${levels(conditions.signInRiskLevels).join("/")}` : "",
    levels(conditions.userRiskLevels).length ? `user ${levels(conditions.userRiskLevels).join("/")}` : "",
    levels(conditions.insiderRiskLevels).length ? `insider ${levels(conditions.insiderRiskLevels).join("/")}` : "",
  ].filter(Boolean);
  const include = named(locations.includeLocations, names, LOCATION_SPECIAL);
  return {
    users: withExcluded(users.include, users.exclude),
    apps: withExcluded(apps.include, apps.exclude),
    network: include.length ? withExcluded(include, named(locations.excludeLocations, names, LOCATION_SPECIAL)) : "any",
    device: or(device.join(" · ")),
    risk: or(risk.join(" · ")),
  };
}

const isBlock = (row: ReviewRow) => asList(asRecord(row.grantControls).builtInControls).includes("block");
const STATE_RANK: Record<string, number> = { enabled: 0, enabledForReportingButNotEnforced: 1, disabled: 2 };
const stateLabel = (state: unknown) => (state === "enabledForReportingButNotEnforced" ? "Report-only" : state === "enabled" ? "On" : "Off");
const stateTone = (state: unknown) => (state === "enabledForReportingButNotEnforced" ? "report" : state === "enabled" ? "on" : "off");
const outcome = (row: ReviewRow) => [grantText(row), ...sessionItems(row)].filter(Boolean).join(" · ") || "No controls";

const list = (items: string[], max = 3) => (items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", "));

/** "Blocks X signing in to Y, from outside Z." — the lane as one sentence. */
function plainSummary(row: ReviewRow, names: ReviewNames, labels: Record<Gate, string>): string {
  const users = userTargets(row, names);
  const apps = resourceTargets(row, names);
  const locations = asRecord(asRecord(row.conditions).locations);
  const include = named(locations.includeLocations, names, LOCATION_SPECIAL).filter((name) => name !== LOCATION_SPECIAL.All);
  const exclude = named(locations.excludeLocations, names, LOCATION_SPECIAL);
  const except = (items: string[]) => (items.length ? ` (except ${list(items)})` : "");
  const where = [
    include.length ? `from ${list(include)}` : "",
    exclude.length ? `${include.length ? "but not" : "from anywhere except"} ${list(exclude)}` : "",
    labels.device !== "any" ? `on ${labels.device}` : "",
    labels.risk !== "any" ? `when risk is ${labels.risk}` : "",
  ].filter(Boolean);
  const grant = grantText(row).replace(/^Require /, "Requires ");
  const session = sessionItems(row);
  const action = isBlock(row) ? "Blocks" : grant ? `${grant} for` : session.length ? `Applies ${list(session)} to` : "Does nothing for";
  const also = grant && session.length ? ` Also applies ${list(session)}.` : "";
  return `${action} ${list(users.include) || "no one"}${except(users.exclude)} signing in to ${list(apps.include) || "nothing"}${except(apps.exclude)}${where.length ? `, ${where.join(", ")}` : ""}.${also}`;
}

const PLATFORMS = ["", "windows", "macOS", "iOS", "android", "linux", "windowsPhone"];
const CLIENTS = ["browser", "mobileAppsAndDesktopClients", "exchangeActiveSync", "easSupported", "other"];
const RISKS = ["none", "low", "medium", "high"];
/** Well-known first-party app ids; any app id can be typed. */
const KNOWN_APPS: Array<[string, string]> = [
  ["c44b4083-3bb0-49c1-b47d-974e53cbdf3c", "Azure Portal"],
  ["00000002-0000-0ff1-ce00-000000000000", "Exchange Online"],
  ["00000003-0000-0ff1-ce00-000000000000", "SharePoint Online"],
  ["cc15fd57-2c6c-4117-a88c-83b1d56b4bbe", "Microsoft Teams Services"],
  ["00000003-0000-0000-c000-000000000000", "Microsoft Graph"],
  ["0000000a-0000-0000-c000-000000000000", "Microsoft Intune"],
];

type WhatIf = {
  user: string;
  userLabel: string;
  app: string;
  appLabel: string;
  platform: string;
  client: string;
  country: string;
  ip: string;
  signInRisk: string;
  userRisk: string;
};
const EMPTY_WHAT_IF: WhatIf = {
  user: "",
  userLabel: "",
  app: KNOWN_APPS[0][0],
  appLabel: KNOWN_APPS[0][1],
  platform: "windows",
  client: "browser",
  country: "",
  ip: "",
  signInRisk: "none",
  userRisk: "none",
};

type PickOption = { id: string; label: string; detail?: string };
const looksLikeId = (text: string) => text.includes("@") || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(text);

/** Type to filter: local options match on name, `search` adds tenant matches from Graph. */
function Picker({
  label,
  text,
  placeholder,
  local = [],
  search,
  onPick,
}: {
  label: string;
  text: string;
  placeholder: string;
  local?: PickOption[];
  search: (query: string) => Promise<PickOption[]>;
  onPick: (option: PickOption) => void;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [remote, setRemote] = useState<PickOption[]>([]);
  const typed = query ?? "";
  useEffect(() => {
    if (query === null || typed.trim().length < 2) {
      setRemote([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      search(typed.trim())
        .then((found) => !cancelled && setRemote(found))
        .catch(() => !cancelled && setRemote([]));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [typed, query === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const needle = typed.trim().toLowerCase();
  const seen = new Set<string>();
  const options = [...local.filter((option) => !needle || `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(needle)), ...remote]
    .filter((option) => !seen.has(option.id) && Boolean(seen.add(option.id)))
    .slice(0, 12);
  const pick = (option: PickOption) => {
    onPick(option);
    setQuery(null);
  };
  return (
    <div className="ca-picker">
      <span>{label}</span>
      <input
        className="axis-input"
        value={query ?? text}
        placeholder={text || placeholder}
        onFocus={() => setQuery("")}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && options[0]) pick(options[0]);
          if (event.key === "Escape") setQuery(null);
        }}
        onBlur={() => {
          // A typed UPN or id still works without picking from the list.
          if (query && looksLikeId(query.trim())) onPick({ id: query.trim(), label: query.trim() });
          setQuery(null);
        }}
      />
      {query !== null && options.length ? (
        <ul className="ca-picker-list" role="listbox">
          {options.map((option) => (
            <li key={option.id}>
              <button type="button" onMouseDown={(event) => (event.preventDefault(), pick(option))}>
                <span>{option.label}</span>
                {option.detail ? <span className="muted">{option.detail}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const searchUsers = (query: string) =>
  searchReadinessUsers(query).then(({ users }) => users.map((user) => ({ id: user.id, label: user.displayName, detail: user.userPrincipalName })));
const searchApps = (query: string) => searchConditionalAccessApps(query).then((apps) => apps.map((app) => ({ id: app.appId, label: app.displayName })));

function whatIfBody(input: WhatIf) {
  const conditions: Record<string, unknown> = {
    clientAppType: input.client,
    signInRiskLevel: input.signInRisk,
    userRiskLevel: input.userRisk,
  };
  if (input.platform) conditions.devicePlatform = input.platform;
  if (input.country.trim()) conditions.country = input.country.trim().toUpperCase();
  if (input.ip.trim()) conditions.ipAddress = input.ip.trim();
  return {
    signInIdentity: { "@odata.type": "#microsoft.graph.userSignIn", userId: input.user.trim() },
    signInContext: { "@odata.type": "#microsoft.graph.applicationContext", includeApplications: [input.app.trim()] },
    signInConditions: conditions,
    appliedPoliciesOnly: false,
  };
}

/** Prefill the what-if form from a logged sign-in. */
function whatIfFromSignIn(signIn: Record<string, unknown>): WhatIf {
  const os = String(asRecord(signIn.deviceDetail).operatingSystem ?? "").toLowerCase();
  const platform = PLATFORMS.find((value) => value && os.startsWith(value.toLowerCase())) ?? (os.startsWith("mac") ? "macOS" : "");
  const client = String(signIn.clientAppUsed ?? "");
  const risk = String(signIn.riskLevelDuringSignIn ?? "none");
  const upn = String(signIn.userPrincipalName ?? "");
  return {
    user: String(signIn.userId ?? upn),
    userLabel: signIn.userDisplayName ? `${signIn.userDisplayName} (${upn})` : upn,
    app: String(signIn.appId ?? ""),
    appLabel: String(signIn.appDisplayName ?? signIn.appId ?? ""),
    platform,
    client: client === "Browser" ? "browser" : /mobile apps/i.test(client) ? "mobileAppsAndDesktopClients" : /activesync/i.test(client) ? "exchangeActiveSync" : "other",
    country: String(asRecord(signIn.location).countryOrRegion ?? ""),
    ip: String(signIn.ipAddress ?? ""),
    signInRisk: RISKS.includes(risk) ? risk : "none",
    userRisk: "none",
  };
}

const exportJson = (contents: unknown, suggestedName: string, title: string) =>
  void saveTextFile({ contents: JSON.stringify(contents, null, 2), suggestedName, title });

export function CaViewer({ signedIn }: { signedIn: boolean }) {
  const policies = useInventory(loaderFor("conditionalAccessPolicy"), signedIn, signedIn);
  const [names, setNames] = useState<ReviewNames>({});
  const [showOff, setShowOff] = useState(false);
  const [mode, setMode] = useState<"whatif" | "signins">("whatif");
  const [trace, setTrace] = useState<Trace | null>(null);
  const [form, setForm] = useState<WhatIf>(EMPTY_WHAT_IF);
  const [search, setSearch] = useState("");
  const [signIns, setSignIns] = useState<Array<Record<string, unknown>>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      policies.items
        .filter((row) => typeof row.id === "string")
        .sort(
          (a, b) =>
            (STATE_RANK[String(a.state)] ?? 3) - (STATE_RANK[String(b.state)] ?? 3) ||
            Number(isBlock(b)) - Number(isBlock(a)) ||
            rowTitle(a).localeCompare(rowTitle(b)),
        ),
    [policies.items],
  );
  useEffect(() => {
    if (rows.length === 0) return;
    let cancelled = false;
    resolvePolicyNames(rows)
      .then((resolved) => !cancelled && setNames(resolved))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rows]);

  // Picker shortlist: well-known apps plus every named app the policies target.
  const appOptions = useMemo(() => {
    const ids = rows.flatMap((row) => asList(asRecord(asRecord(row.conditions).applications).includeApplications));
    return [
      ...KNOWN_APPS.map(([id, label]) => ({ id, label })),
      ...ids.filter((id) => looksLikeId(id) && names[id]).map((id) => ({ id, label: names[id] })),
    ];
  }, [rows, names]);

  const lanes = rows.filter((row) => showOff || row.state !== "disabled");
  const laneIds = lanes.map((row) => String(row.id));
  const selection = useCheckedIds(laneIds);
  const signInIds = signIns.map((row) => String(row.id));
  const signInSelection = useCheckedIds(signInIds);

  const run = (work: Promise<void>) => {
    setBusy(true);
    setError(null);
    work.catch((reason) => setError(String(reason))).finally(() => setBusy(false));
  };
  const evaluate = () => {
    if (!form.user.trim() || !form.app.trim()) {
      setError("Pick a user and an app first.");
      return;
    }
    const label = `What-if · ${form.userLabel || form.user} · ${form.appLabel || form.app}`;
    run(evaluateConditionalAccess(whatIfBody(form)).then((results) => setTrace(whatIfTrace(label, results))));
  };
  const loadSignIns = () => run(fetchConditionalAccessSignIns(search).then(setSignIns));
  const refresh = () => {
    policies.reload();
    if (mode === "signins" && signIns.length) loadSignIns();
  };

  // Combine: block wins, grants stack across policies, session controls all apply (strictest wins).
  const enforced = trace ? lanes.filter((row) => trace.lanes.get(String(row.id))?.status === "applied" && row.state === "enabled") : [];
  const logged = trace ? lanes.filter((row) => trace.lanes.get(String(row.id))?.status === "applied" && row.state === "enabledForReportingButNotEnforced") : [];
  const blocks = enforced.filter(isBlock);
  const grants = enforced.filter((row) => !isBlock(row)).map(grantText).filter(Boolean);
  const sessions = enforced.flatMap(sessionItems);
  const result = blocks.length ? "Blocked" : grants.length ? `Allowed after: ${grants.join(" and ")}` : "Allowed";

  return (
    <div className="ca-viewer">
      <PageHeader
        eyebrow="Entra · Conditional Access"
        title="Conditional Access viewer"
        description="How a sign-in flows through every policy: each lane's gates, where it stops, and what the matching policies combine to."
        onRefresh={refresh}
        refreshing={policies.loading || busy}
        platformChips={false}
      />

      <Panel padded>
        <PanelHead title="Trace a sign-in" hint="Run Microsoft's what-if evaluator, or pick a real sign-in to replay its logged evaluation on the map." />
        <div className="tab-row">
          <button type="button" className={`tab-btn${mode === "whatif" ? " active" : ""}`} onClick={() => setMode("whatif")}>
            What-if
          </button>
          <button
            type="button"
            className={`tab-btn${mode === "signins" ? " active" : ""}`}
            onClick={() => {
              setMode("signins");
              if (!signIns.length) loadSignIns();
            }}
          >
            Sign-in logs
          </button>
        </div>

        {mode === "whatif" ? (
          <div className="ca-form">
            <Picker
              label="User"
              text={form.userLabel}
              placeholder="Search by name or UPN"
              search={searchUsers}
              onPick={(user) => setForm({ ...form, user: user.id, userLabel: user.detail ? `${user.label} (${user.detail})` : user.label })}
            />
            <Picker
              label="App"
              text={form.appLabel}
              placeholder="Search apps"
              local={appOptions}
              search={searchApps}
              onPick={(app) => setForm({ ...form, app: app.id, appLabel: app.label })}
            />
            <label>
              Platform
              <select className="axis-input" value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })}>
                {PLATFORMS.map((value) => (
                  <option key={value} value={value}>
                    {value ? humanize(value) : "Not set"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Client app
              <select className="axis-input" value={form.client} onChange={(event) => setForm({ ...form, client: event.target.value })}>
                {CLIENTS.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Country
              <input className="axis-input" value={form.country} placeholder="AU" maxLength={2} onChange={(event) => setForm({ ...form, country: event.target.value })} />
            </label>
            <label>
              IP address
              <input className="axis-input" value={form.ip} placeholder="203.0.113.10" onChange={(event) => setForm({ ...form, ip: event.target.value })} />
            </label>
            <label>
              Sign-in risk
              <select className="axis-input" value={form.signInRisk} onChange={(event) => setForm({ ...form, signInRisk: event.target.value })}>
                {RISKS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              User risk
              <select className="axis-input" value={form.userRisk} onChange={(event) => setForm({ ...form, userRisk: event.target.value })}>
                {RISKS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <div className="ca-form-actions">
              <button type="button" className="axis-btn axis-btn-primary" onClick={evaluate} disabled={busy}>
                {busy ? "Evaluating…" : "Evaluate"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="ca-form-actions">
              <input
                className="axis-input"
                value={search}
                placeholder="UPN starts with…"
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && loadSignIns()}
              />
              <button type="button" className="axis-btn" onClick={loadSignIns} disabled={busy}>
                {busy ? "Loading…" : "Load sign-ins"}
              </button>
              <button
                type="button"
                className="axis-btn"
                disabled={signInSelection.checkedIds.size === 0}
                onClick={() => exportJson(signIns.filter((row) => signInSelection.checkedIds.has(String(row.id))), "sign-ins.json", "Export sign-ins")}
              >
                Export JSON ({signInSelection.checkedIds.size})
              </button>
            </div>
            <div className="axis-table-wrap ca-signins">
              <table className="axis-table">
                <thead>
                  <tr>
                    <th className="axis-table-check">
                      <SelectCheckbox
                        checked={signInSelection.allSelected}
                        indeterminate={signInSelection.checkedIds.size > 0 && !signInSelection.allSelected}
                        disabled={signIns.length === 0}
                        label="Select all sign-ins"
                        onChange={signInSelection.toggleAll}
                      />
                    </th>
                    <th>Time</th>
                    <th>User</th>
                    <th>App</th>
                    <th>Client</th>
                    <th>Location</th>
                    <th>CA status</th>
                  </tr>
                </thead>
                <tbody>
                  {signIns.map((row) => {
                    const id = String(row.id);
                    const location = asRecord(row.location);
                    return (
                      <tr key={id} className={`row-link${trace?.raw === row ? " selected" : ""}`} onClick={() => setTrace(signInTrace(row))}>
                        <td className="axis-table-check" onClick={(event) => event.stopPropagation()}>
                          <SelectCheckbox checked={signInSelection.checkedIds.has(id)} label={`Select sign-in ${id}`} onChange={() => signInSelection.toggle(id)} />
                        </td>
                        <td className="tabular">{String(row.createdDateTime ?? "").replace("T", " ").slice(0, 16)}</td>
                        <td>{String(row.userPrincipalName ?? "")}</td>
                        <td>{String(row.appDisplayName ?? "")}</td>
                        <td className="muted">{String(row.clientAppUsed ?? "")}</td>
                        <td className="muted">{[location.city, location.countryOrRegion].filter(Boolean).join(", ")}</td>
                        <td className="muted">{humanize(row.conditionalAccessStatus)}</td>
                      </tr>
                    );
                  })}
                  {signIns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="muted">
                        {busy ? "Loading…" : "No sign-ins loaded."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        )}
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {policies.error ? <div className="axis-alert axis-alert-danger">{policies.error}</div> : null}
      </Panel>

      <Panel padded>
        <PanelHead
          title="Policy map"
          hint={trace ? `Tracing ${trace.label}` : "No order: every policy whose gates all pass applies. Block wins, grants stack (each policy must pass), and the strictest session control wins."}
        />
        <details className="ca-howto">
          <summary>ⓘ How to interpret</summary>
          <ul>
            <li>
              Each row is one policy. Read it left to right as a sentence: if the user, app, network, device and risk all match, the outcome on the
              right happens. A gate showing <em>any</em> means the policy doesn't check that condition.
            </li>
            <li>
              Trace a sign-in above to mark each gate: <strong>✓</strong> means the sign-in meets that condition, <strong>✗</strong> means it doesn't
              match. A ✗ ends that branch: the policy doesn't apply to this sign-in, and the gates after it show as not reached (hollow). Entra checks
              every condition; the ✗ shown is the first one that failed.
            </li>
            <li>
              A lane that makes it all the way to its outcome is a complete match. If the policy is <span className="ca-state-on">On</span>, its control is
              enforced. If it's <span className="ca-state-report">Report-only</span> (amber, dashed), the result is only logged. Off policies are never
              evaluated.
            </li>
            <li>
              There's no order between policies: every complete match applies at once. Any Block wins; otherwise the user must satisfy every matching
              policy's grant, and the strictest session control applies. The row under the map adds them up into the final result.
            </li>
            <li>With nothing traced, the lanes have no marks and the map shows how your policies are laid out.</li>
          </ul>
        </details>
        <div className="ca-form-actions">
          <label className="ca-toggle">
            <BooleanToggle checked={showOff} onChange={setShowOff} ariaLabel="Show disabled policies" />
            Show disabled policies
          </label>
          <span className="ca-spacer" />
          {trace ? (
            <>
              {trace.raw && !Array.isArray(trace.raw) ? (
                <button
                  type="button"
                  className="axis-btn"
                  onClick={() => {
                    setForm(whatIfFromSignIn(trace.raw as Record<string, unknown>));
                    setMode("whatif");
                  }}
                >
                  Re-run as what-if
                </button>
              ) : null}
              <button type="button" className="axis-btn" onClick={() => exportJson(trace.raw, "ca-trace.json", "Export trace")}>
                Export trace JSON
              </button>
              <button type="button" className="axis-btn" onClick={() => setTrace(null)}>
                Clear trace
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="axis-btn"
            disabled={selection.checkedIds.size === 0}
            onClick={() => exportJson(lanes.filter((row) => selection.checkedIds.has(String(row.id))), "conditional-access-policies.json", "Export policies")}
          >
            Export JSON ({selection.checkedIds.size})
          </button>
        </div>

        <div className="ca-map" role="table" aria-label="Conditional Access policy map">
          <div className="ca-lane ca-head" role="row">
            <span className="ca-check">
              <SelectCheckbox
                checked={selection.allSelected}
                indeterminate={selection.checkedIds.size > 0 && !selection.allSelected}
                disabled={lanes.length === 0}
                label="Select all policies"
                onChange={selection.toggleAll}
              />
            </span>
            <span>Policy</span>
            {GATES.map((gate) => (
              <span key={gate.key} className="ca-gate-head">
                {gate.label}
              </span>
            ))}
            <span>Outcome</span>
          </div>
          {lanes.map((row) => {
            const id = String(row.id);
            const labels = gateLabels(row, names);
            const lane = trace?.lanes.get(id);
            const tone = stateTone(row.state);
            return (
              <div key={id} className={`ca-lane ca-${tone}${lane ? ` ca-${lane.status}` : ""}`} role="row">
                <span className="ca-check">
                  <SelectCheckbox checked={selection.checkedIds.has(id)} label={`Select ${rowTitle(row)}`} onChange={() => selection.toggle(id)} />
                </span>
                <button type="button" className="ca-name" onClick={() => navigate(policyLink(row).href)} title="Open policy">
                  <strong>{rowTitle(row)}</strong>
                  <span className={`ca-state ca-state-${tone}`}>{stateLabel(row.state)}</span>
                  <span className="ca-summary">{plainSummary(row, names, labels)}</span>
                </button>
                {GATES.map((gate, index) => {
                  const mark = !lane
                    ? "idle"
                    : lane.status === "applied"
                      ? "pass"
                      : lane.status === "off" || lane.stop < 0
                        ? "unknown"
                        : index < lane.stop
                          ? "pass"
                          : index === lane.stop
                            ? "fail"
                            : "skip";
                  return (
                    <span key={gate.key} className={`ca-gate ca-gate-${mark}`} title={`${gate.label}: ${labels[gate.key]}`}>
                      <span className="ca-node">{mark === "pass" ? "✓" : mark === "fail" ? "✗" : ""}</span>
                      <span className="ca-gate-label">{labels[gate.key]}</span>
                    </span>
                  );
                })}
                <span className={`ca-outcome${isBlock(row) ? " ca-outcome-block" : ""}`} title={outcome(row)}>
                  <span>{outcome(row)}</span>
                  {lane ? <span className="ca-reason">{lane.status === "applied" ? (lane.reportOnly ? "Logged only" : "Applies") : lane.reason}</span> : null}
                </span>
              </div>
            );
          })}
          {lanes.length === 0 ? <div className="muted ca-empty">{policies.loading ? "Loading policies…" : "No Conditional Access policies."}</div> : null}
        </div>

        {trace ? (
          <div className="ca-combine">
            <div className="ca-step">
              <strong>1 · Block</strong>
              <span>{blocks.length ? blocks.map(rowTitle).join(", ") : "None enforced"}</span>
              {logged.some(isBlock) ? <span className="ca-warn">Report-only would block: {logged.filter(isBlock).map(rowTitle).join(", ")}</span> : null}
            </div>
            <div className="ca-step">
              <strong>2 · Grants (all must pass)</strong>
              <span>{blocks.length ? "Not reached" : grants.length ? grants.join(" and ") : "None"}</span>
            </div>
            <div className="ca-step">
              <strong>3 · Session (strictest wins)</strong>
              <span>{blocks.length ? "Not reached" : sessions.length ? sessions.join(" · ") : "None"}</span>
            </div>
            <div className={`ca-step ca-result${blocks.length ? " ca-result-block" : ""}`}>
              <strong>Result</strong>
              <span>{result}</span>
              <span className="muted">
                {enforced.length} enforced · {logged.length} report-only
              </span>
            </div>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
