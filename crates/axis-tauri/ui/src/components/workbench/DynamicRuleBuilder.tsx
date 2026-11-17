import { useEffect, useMemo, useState } from "react";
import {
  createDirectoryGroup,
  fetchGraphObjectDetail,
  fetchReviewObjects,
  searchReadinessUsers,
} from "../../lib/tauri";
import { hrefWithParam, navigate } from "../../lib/route";
import { WriteActionButton } from "../../lib/readOnly";
import { BooleanToggle } from "./BooleanToggle";

/**
 * Builds a dynamic membership rule from one user's or one device's attributes and creates the group.
 * Only properties the Entra rule language supports are offered; values unique to one object
 * (UPN, mail, employee id, device name, hardware ids) are left out because the group would hold
 * just that object. Devices are Entra device objects, which is what device rules evaluate.
 */

type Mode = "user" | "device";
type Operator = "-eq" | "-ne" | "-startsWith" | "-contains";
const OPERATORS: Array<{ value: Operator; label: string }> = [
  { value: "-eq", label: "equals" },
  { value: "-ne", label: "not equals" },
  { value: "-startsWith", label: "starts with" },
  { value: "-contains", label: "contains" },
];

type Row = Record<string, unknown>;
type Attribute = {
  property: string;
  label: string;
  read: (object: Row) => unknown;
  /** Autopilot id ("[OrderID]", "[PurchaseOrderId]"): matched inside device.devicePhysicalIds, not as a property. */
  physicalPrefix?: string;
};

const extensions = (container: string): Attribute[] =>
  Array.from({ length: 15 }, (_, index) => ({
    property: `extensionAttribute${index + 1}`,
    label: `Extension attribute ${index + 1}`,
    read: (object: Row) => (object[container] as Row | undefined)?.[`extensionAttribute${index + 1}`],
  }));

// Graph property → rule property (officeLocation is physicalDeliveryOfficeName in rules).
const USER_ATTRIBUTES: Attribute[] = [
  { property: "userType", label: "User type", read: (user) => user.userType },
  { property: "accountEnabled", label: "Account enabled", read: (user) => user.accountEnabled },
  { property: "department", label: "Department", read: (user) => user.department },
  { property: "jobTitle", label: "Job title", read: (user) => user.jobTitle },
  { property: "companyName", label: "Company", read: (user) => user.companyName },
  { property: "physicalDeliveryOfficeName", label: "Office", read: (user) => user.officeLocation },
  { property: "city", label: "City", read: (user) => user.city },
  { property: "state", label: "State", read: (user) => user.state },
  { property: "country", label: "Country", read: (user) => user.country },
  { property: "postalCode", label: "Postal code", read: (user) => user.postalCode },
  { property: "usageLocation", label: "Usage location", read: (user) => user.usageLocation },
  { property: "preferredLanguage", label: "Preferred language", read: (user) => user.preferredLanguage },
  // Only offered for synced users: cloud-only users have no value, which `-eq false` would not match.
  { property: "dirSyncEnabled", label: "Synced from on-premises", read: (user) => (user.onPremisesSyncEnabled === true ? true : null) },
  { property: "passwordPolicies", label: "Password policies", read: (user) => user.passwordPolicies },
  ...extensions("onPremisesExtensionAttributes"),
];

/** The value after "[Prefix]:" in a device's physicalIds, e.g. the Autopilot group tag for "[OrderID]". */
const physicalId = (device: Row, prefix: string) =>
  (Array.isArray(device.physicalIds) ? device.physicalIds.map(String) : [])
    .find((id) => id.toLowerCase().startsWith(`${prefix.toLowerCase()}:`))
    ?.slice(prefix.length + 1);
const orderId = (device: Row) => physicalId(device, "[OrderID]");

// Graph reports trustType as AzureAd / ServerAd / Workplace; rules spell them AzureAD / ServerAD / Workplace.
const TRUST_TYPES: Record<string, string> = { azuread: "AzureAD", serverad: "ServerAD", workplace: "Workplace" };

// Graph device property → rule property (operatingSystem is deviceOSType in rules, and so on).
const DEVICE_ATTRIBUTES: Attribute[] = [
  { property: "deviceOSType", label: "Operating system", read: (device) => device.operatingSystem },
  { property: "deviceOSVersion", label: "OS version", read: (device) => device.operatingSystemVersion },
  { property: "deviceManufacturer", label: "Manufacturer", read: (device) => device.manufacturer },
  { property: "deviceModel", label: "Model", read: (device) => device.model },
  { property: "deviceOwnership", label: "Ownership", read: (device) => device.deviceOwnership },
  { property: "deviceCategory", label: "Device category", read: (device) => device.deviceCategory },
  { property: "enrollmentProfileName", label: "Enrollment profile", read: (device) => device.enrollmentProfileName },
  { property: "managementType", label: "Management type", read: (device) => device.managementType },
  { property: "profileType", label: "Profile type", read: (device) => device.profileType },
  { property: "accountEnabled", label: "Account enabled", read: (device) => device.accountEnabled },
  { property: "isRooted", label: "Rooted or jailbroken", read: (device) => device.isRooted },
  {
    property: "deviceTrustType",
    label: "Join type",
    read: (device) => (typeof device.trustType === "string" ? TRUST_TYPES[device.trustType.toLowerCase()] ?? device.trustType : null),
  },
  { property: "systemLabels", label: "System label", read: (device) => (Array.isArray(device.systemLabels) ? device.systemLabels[0] : null) },
  { property: "devicePhysicalIds", label: "Autopilot group tag", read: orderId, physicalPrefix: "[OrderID]" },
  {
    property: "devicePhysicalIds",
    label: "Autopilot purchase order",
    read: (device) => physicalId(device, "[PurchaseOrderId]"),
    physicalPrefix: "[PurchaseOrderId]",
  },
  ...extensions("extensionAttributes"),
];

type Clause = {
  property: string;
  label: string;
  enabled: boolean;
  operator: Operator;
  value: string;
  boolean: boolean;
  physicalPrefix?: string;
};

/** A licence feature (service plan id) the user holds, matched through user.assignedPlans. */
type Plan = { id: string; enabled: boolean };

const planText = (plan: Plan) =>
  `(user.assignedPlans -any (assignedPlan.servicePlanId -eq ${quote(plan.id)} -and assignedPlan.capabilityStatus -eq "Enabled"))`;

/** Rule strings are double-quoted; a double quote inside is escaped with a backtick. */
const quote = (value: string) => `"${value.replace(/"/g, '`"')}"`;

function clauseText(mode: Mode, clause: Clause): string {
  if (clause.physicalPrefix) {
    return `(device.devicePhysicalIds -any (_ ${clause.operator} ${quote(`${clause.physicalPrefix}:${clause.value}`)}))`;
  }
  const value = clause.boolean ? (clause.value === "true" ? "true" : "false") : quote(clause.value);
  return `(${mode}.${clause.property} ${clause.operator} ${value})`;
}

function operatorsFor(clause: Clause) {
  if (clause.boolean) return OPERATORS.filter((option) => option.value === "-eq" || option.value === "-ne");
  // Inside -any only a match makes sense: "has a tag equal to / starting with".
  if (clause.physicalPrefix) return OPERATORS.filter((option) => option.value === "-eq" || option.value === "-startsWith");
  return OPERATORS;
}

type Hit = { id: string; label: string; meta: string };

export function DynamicRuleBuilder({ route }: { route: { pathname: string; search: URLSearchParams } }) {
  const mode: Mode = route.search.get("mode") === "device" ? "device" : "user";
  const selectedId = route.search.get(mode);
  const [query, setQuery] = useState("");
  const [userHits, setUserHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [devices, setDevices] = useState<Row[] | null>(null);
  const [subject, setSubject] = useState<Row | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planQuery, setPlanQuery] = useState("");
  const [planNames, setPlanNames] = useState<Map<string, { name: string; code: string; skus: string }>>(new Map());

  // Service plan id → name and the licences that include it, for the Licences and features card.
  useEffect(() => {
    if (mode !== "user" || planNames.size) return;
    fetchReviewObjects("servicePlan")
      .then((response) =>
        setPlanNames(
          new Map(
            response.list.items.map((plan) => [
              String(plan.id).toLowerCase(),
              {
                // Friendly name from Microsoft's licensing CSV; the Graph code when it's missing.
                name: String(plan.friendlyName ?? plan.servicePlanName ?? plan.id),
                code: String(plan.servicePlanName ?? ""),
                skus: (Array.isArray(plan.skus) ? plan.skus : []).join(", "),
              },
            ]),
          ),
        ),
      )
      .catch(() => undefined);
  }, [mode, planNames.size]);
  const [matchAll, setMatchAll] = useState(true);
  const [manualRule, setManualRule] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  // Users: debounced server search. Devices: the Entra device list, filtered locally.
  useEffect(() => {
    if (mode !== "user") return;
    const needle = query.trim();
    if (needle.length < 2) {
      setUserHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchReadinessUsers(needle)
        .then((response) => setUserHits(response.users.map((user) => ({ id: user.id, label: user.displayName, meta: user.userPrincipalName }))))
        .catch(() => setUserHits([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [mode, query]);

  useEffect(() => {
    if (mode !== "device" || devices) return;
    fetchReviewObjects("entraDevice")
      .then((response) => {
        setDevices(response.list.items);
        if (response.error) setLoadError(response.error);
      })
      .catch((reason: unknown) => setLoadError(reason instanceof Error ? reason.message : String(reason)));
  }, [devices, mode]);

  const hits: Hit[] = useMemo(() => {
    if (mode === "user") return userHits;
    const needle = query.trim().toLowerCase();
    if (!needle || !devices) return [];
    return devices
      .filter((device) => String(device.displayName ?? "").toLowerCase().includes(needle))
      .slice(0, 12)
      .map((device) => ({
        id: String(device.id),
        label: String(device.displayName ?? device.id),
        meta: [device.operatingSystem, device.model].filter(Boolean).join(" · "),
      }));
  }, [devices, mode, query, userHits]);

  const seed = (object: Row) => {
    const attributes = mode === "user" ? USER_ATTRIBUTES : DEVICE_ATTRIBUTES;
    setClauses(
      attributes.flatMap((attribute) => {
        const raw = attribute.read(object);
        if (raw === null || raw === undefined || raw === "") return [];
        return [{
          property: attribute.property,
          label: attribute.label,
          enabled: false,
          operator: "-eq" as Operator,
          value: String(raw),
          boolean: typeof raw === "boolean",
          physicalPrefix: attribute.physicalPrefix,
        }];
      }),
    );
    if (mode === "user") {
      const held = new Set(
        (Array.isArray(object.assignedPlans) ? object.assignedPlans : [])
          .map((plan) => plan as Row)
          .filter((plan) => plan.capabilityStatus === "Enabled" && typeof plan.servicePlanId === "string")
          .map((plan) => String(plan.servicePlanId).toLowerCase()),
      );
      setPlans([...held].map((id) => ({ id, enabled: false })));
    } else {
      setPlans([]);
    }
    const display = String(object.displayName ?? (mode === "user" ? "users" : "devices"));
    if (mode === "user") {
      const department = typeof object.department === "string" ? object.department : null;
      setName(`Dynamic - ${department ?? display}`);
      setDescription(`Dynamic user group built in Axis from ${String(object.userPrincipalName ?? display)}.`);
    } else {
      const tag = orderId(object);
      setName(`Dynamic - ${tag || [object.operatingSystem, object.model].filter(Boolean).join(" ") || display}`);
      setDescription(`Dynamic device group built in Axis from ${display}.`);
    }
  };

  // Load the chosen user (?user=) or device (?device=) and seed one clause per attribute it has.
  useEffect(() => {
    setSubject(null);
    setClauses([]);
    setPlans([]);
    setPlanQuery("");
    setCreated(null);
    setManualRule(null);
    setCreateError(null);
    if (!selectedId) return;
    if (mode === "device") {
      const device = devices?.find((candidate) => candidate.id === selectedId);
      if (device) {
        setSubject(device);
        seed(device);
      }
      return;
    }
    let cancelled = false;
    setLoadError(null);
    fetchGraphObjectDetail("user", selectedId)
      .then((response) => {
        if (cancelled) return;
        const object = response.detail?.object ?? null;
        setSubject(object);
        setLoadError(response.error);
        if (object) seed(object);
      })
      .catch((reason: unknown) => !cancelled && setLoadError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      cancelled = true;
    };
    // `seed` reads `mode`, which is in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedId, devices]);

  const generated = useMemo(
    () =>
      [
        ...clauses.filter((clause) => clause.enabled).map((clause) => clauseText(mode, clause)),
        ...plans.filter((plan) => plan.enabled).map(planText),
      ].join(matchAll ? " -and " : " -or "),
    [clauses, matchAll, mode, plans],
  );
  const planLabel = (id: string) => planNames.get(id)?.name ?? id;
  const shownPlans = useMemo(() => {
    const needle = planQuery.trim().toLowerCase();
    return [...plans]
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || planLabel(a.id).localeCompare(planLabel(b.id)))
      .filter((plan) => {
        const known = planNames.get(plan.id);
        return !needle || `${planLabel(plan.id)} ${known?.code ?? ""} ${known?.skus ?? ""}`.toLowerCase().includes(needle);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, planQuery, planNames]);
  const togglePlan = (id: string) =>
    setPlans((current) => current.map((plan) => (plan.id === id ? { ...plan, enabled: !plan.enabled } : plan)));
  const rule = manualRule ?? generated;
  const update = (index: number, patch: Partial<Clause>) =>
    setClauses((current) => current.map((clause, at) => (at === index ? { ...clause, ...patch } : clause)));
  const pick = (id: string) => {
    setQuery("");
    setUserHits([]);
    navigate(hrefWithParam(route.pathname, route.search, mode, id));
  };
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    const search = new URLSearchParams();
    if (next === "device") search.set("mode", "device");
    setQuery("");
    navigate(search.toString() ? `${route.pathname}?${search}` : route.pathname);
  };

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const response = await createDirectoryGroup({
        displayName: name.trim(),
        description: description.trim() || null,
        membership: mode === "user" ? "dynamicUser" : "dynamicDevice",
        membershipRule: rule,
      });
      if (response.group) setCreated({ id: response.group.id, name: response.group.displayName });
      else setCreateError(response.error ?? "Graph did not return the new group.");
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  };

  const subjectLabel = mode === "user" ? "User" : "Device";

  return (
    <div className="stack">
      <section className="axis-panel axis-panel-padded">
        <div className="platform-chips" role="group" aria-label="Build from" style={{ marginBottom: "0.75rem" }}>
          {(["user", "device"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`platform-chip${mode === option ? " is-active" : ""}`}
              aria-pressed={mode === option}
              onClick={() => switchMode(option)}
            >
              {option === "user" ? "User" : "Device"}
            </button>
          ))}
        </div>
        <label className="device-field">
          {subjectLabel}
          <input
            className="axis-input"
            value={query}
            placeholder={mode === "user" ? "Search by name or UPN…" : devices ? "Search by device name…" : "Loading devices…"}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {searching ? <p className="ov-empty">Searching…</p> : null}
        {hits.length ? (
          <ul className="rule-hits" aria-label={`Matching ${mode}s`}>
            {hits.map((hit) => (
              <li key={hit.id}>
                <button type="button" className="rule-hit" onClick={() => pick(hit.id)}>
                  <span className="rule-hit-name">{hit.label}</span>
                  <span className="rule-hit-meta">{hit.meta}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {subject ? (
          <p style={{ margin: "0.6rem 0 0" }}>
            <strong>{String(subject.displayName ?? "")}</strong>{" "}
            <span className="ov-muted">
              {mode === "user"
                ? String(subject.userPrincipalName ?? "")
                : [subject.operatingSystem, subject.model].filter(Boolean).join(" · ")}
            </span>
          </p>
        ) : null}
      </section>

      {loadError ? <div className="axis-alert axis-alert-danger">{loadError}</div> : null}

      {subject ? (
        <>
          <section className="ov-card">
            <div className="ov-card-head">
              <h2>Attributes</h2>
              <span>Tick the ones the group should match</span>
            </div>
            {clauses.length === 0 ? <p className="ov-empty">This {mode} has no attributes a dynamic rule can use.</p> : null}
            <div className="ov-table-scroll">
              <table className="ov-table rule-table">
                <tbody>
                  {clauses.map((clause, index) => (
                    <tr key={`${clause.property}:${clause.physicalPrefix ?? ""}`}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Use ${clause.label}`}
                          checked={clause.enabled}
                          onChange={(event) => update(index, { enabled: event.target.checked })}
                        />
                      </td>
                      <td>
                        {clause.label} <span className="ov-muted mono-code">{mode}.{clause.property}</span>
                      </td>
                      <td>
                        <select
                          className="axis-input"
                          value={clause.operator}
                          disabled={!clause.enabled}
                          aria-label={`${clause.label} operator`}
                          onChange={(event) => update(index, { operator: event.target.value as Operator })}
                        >
                          {operatorsFor(clause).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {clause.boolean ? (
                          <BooleanToggle
                            checked={clause.value === "true"}
                            disabled={!clause.enabled}
                            ariaLabel={clause.label}
                            onChange={(value) => update(index, { value: String(value) })}
                          />
                        ) : (
                          <input
                            className="axis-input"
                            value={clause.value}
                            disabled={!clause.enabled}
                            aria-label={`${clause.label} value`}
                            onChange={(event) => update(index, { value: event.target.value })}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {mode === "user" && plans.length ? (
            <section className="ov-card">
              <div className="ov-card-head">
                <h2>Licences and features</h2>
                <span>
                  {plans.filter((plan) => plan.enabled).length} of {plans.length} ticked · matched through user.assignedPlans
                </span>
              </div>
              <input
                className="axis-input"
                value={planQuery}
                placeholder="Filter by feature or licence…"
                spellCheck={false}
                aria-label="Filter licence features"
                onChange={(event) => setPlanQuery(event.target.value)}
              />
              <ul className="rule-plans">
                {shownPlans.map((plan) => (
                  <li key={plan.id}>
                    <label title={[planNames.get(plan.id)?.code, plan.id].filter(Boolean).join(" · ")}>
                      <input type="checkbox" checked={plan.enabled} onChange={() => togglePlan(plan.id)} />
                      <span className="rule-hit-name">{planLabel(plan.id)}</span>
                      <span className="rule-hit-meta">{planNames.get(plan.id)?.skus}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="axis-panel axis-panel-padded stack">
            <div className="ov-row-line">
              <label style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
                <BooleanToggle checked={matchAll} ariaLabel="Match all ticked attributes" onChange={setMatchAll} />
                <span>{matchAll ? "Match all ticked attributes (-and)" : "Match any ticked attribute (-or)"}</span>
              </label>
              {manualRule !== null ? (
                <button type="button" className="ov-link" onClick={() => setManualRule(null)}>
                  Reset to generated rule
                </button>
              ) : null}
            </div>
            <label className="device-field">
              Membership rule
              <textarea
                className="axis-input mono-code"
                rows={4}
                value={rule}
                placeholder="Tick at least one attribute"
                onChange={(event) => setManualRule(event.target.value)}
              />
            </label>
            <div className="inspector-form-grid">
              <label className="device-field">
                Group name
                <input className="axis-input" value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="device-field">
                Description
                <input className="axis-input" value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
            </div>
            {createError ? <div className="axis-alert axis-alert-danger">{createError}</div> : null}
            {created ? (
              <div className="axis-alert axis-alert-info">
                Created {created.name}. Entra evaluates the rule in the background, so members appear over the next few minutes.{" "}
                <button type="button" className="axis-link" onClick={() => navigate("/intune/groups")}>
                  Open groups
                </button>
              </div>
            ) : null}
            <div>
              <WriteActionButton
                type="button"
                className="axis-btn axis-btn-primary"
                disabled={creating || !rule.trim() || !name.trim()}
                onClick={() => void create()}
              >
                {creating ? "Creating…" : `Create dynamic ${mode} group`}
              </WriteActionButton>
              <span className="ov-muted" style={{ marginLeft: "0.75rem", fontSize: "var(--axis-text-xs)" }}>
                Dynamic groups need Entra ID P1 or higher.
              </span>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
