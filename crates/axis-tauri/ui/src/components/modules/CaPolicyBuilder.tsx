import { useEffect, useState, type ReactNode } from "react";
import { useInventory } from "../../hooks/useInventory";
import { searchDirectoryGroups } from "../../lib/tauri";
import { BooleanToggle } from "../workbench/BooleanToggle";
import { gateLabels, KNOWN_APPS, Picker, plainSummary, searchApps, searchUsers, useAppOptions, type PickOption } from "./CaViewer";
import { resolvePolicyNames } from "./EntraWorkspace";
import { asRecord, humanize, loaderFor, rowTitle, type ReviewNames } from "./ReviewWorkbench";

type Policy = Record<string, unknown>;

/** Built-in role template ids (the same in every tenant), from Microsoft's "admins" templates. */
const ROLES: PickOption[] = [
  ["62e90394-69f5-4237-9190-012177145e10", "Global Administrator"],
  ["e8611ab8-c189-46e8-94e1-60213ab1f814", "Privileged Role Administrator"],
  ["7be44c8a-adaf-4e2a-84d6-ab2649e08a13", "Privileged Authentication Administrator"],
  ["194ae4cb-b126-40b2-bd5b-6091b380977d", "Security Administrator"],
  ["b1be1c3e-b65d-4f19-8427-f6fa0d97feb9", "Conditional Access Administrator"],
  ["29232cdf-9323-42fd-ade2-1d097af3e4de", "Exchange Administrator"],
  ["f28a1f50-f6e7-4571-818b-6a12f2af6b6c", "SharePoint Administrator"],
  ["fe930be7-5e62-47db-91af-98c3a49a38b1", "User Administrator"],
  ["729827e3-9c14-49f7-bb1b-9608f156bbb8", "Helpdesk Administrator"],
  ["c4e39bd9-1100-46d3-8c65-fb160da0071f", "Authentication Administrator"],
  ["9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3", "Application Administrator"],
  ["158c047a-c907-4556-b7ef-446551a6b5f7", "Cloud Application Administrator"],
  ["b0f54661-2d74-4c50-afa3-1ec803f12efe", "Billing Administrator"],
  ["3a2c62db-5318-420d-8d74-23affee5d9d5", "Intune Administrator"],
  ["f2ef992c-3afb-46b9-b7cf-a126ee74c451", "Global Reader"],
].map(([id, label]) => ({ id, label }));
const APPS: PickOption[] = KNOWN_APPS.map(([id, label]) => ({ id, label }));
const USER_ACTIONS: Array<[string, string]> = [
  ["urn:user:registersecurityinfo", "Register security information"],
  ["urn:user:registerdevice", "Register or join devices"],
];
const PLATFORMS = ["android", "iOS", "windows", "macOS", "linux", "windowsPhone"];
const CLIENT_TYPES = ["browser", "mobileAppsAndDesktopClients", "exchangeActiveSync", "other"];
const RISK = ["low", "medium", "high"];
const GRANTS: Array<[string, string]> = [
  ["mfa", "Require multifactor authentication"],
  ["compliantDevice", "Require device to be marked as compliant"],
  ["domainJoinedDevice", "Require Microsoft Entra hybrid joined device"],
  ["approvedApplication", "Require approved client app"],
  ["compliantApplication", "Require app protection policy"],
  ["passwordChange", "Require password change"],
];

const searchGroups = (query: string) =>
  searchDirectoryGroups(query).then(({ groups }) => groups.map((group) => ({ id: group.id, label: group.displayName })));

const ids = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
const at = (policy: Policy, ...path: string[]) => path.reduce<unknown>((value, key) => asRecord(value)[key], policy);
function setIn(value: Policy, [head, ...rest]: string[], next: unknown): Policy {
  return { ...value, [head]: rest.length ? setIn(asRecord(value[head]), rest, next) : next };
}
const orNull = (record: Record<string, unknown>) => (Object.values(record).some((value) => value !== null && value !== undefined) ? record : null);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="ca-builder-section">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function Chips({ options, selected, onChange }: { options: Array<[string, string]>; selected: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="ca-chips">
      {options.map(([value, label]) => (
        <label key={value} className="ca-chip">
          <input
            type="checkbox"
            checked={selected.includes(value)}
            onChange={(event) => onChange(event.target.checked ? [...selected, value] : selected.filter((item) => item !== value))}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

/** Picker that adds to an id list, with removable chips for what's already in it. */
function Targets({
  label,
  value,
  names,
  local,
  search,
  onChange,
  onName,
}: {
  label: string;
  value: string[];
  names: ReviewNames;
  local?: PickOption[];
  search: (query: string) => Promise<PickOption[]>;
  onChange: (next: string[]) => void;
  onName: (option: PickOption) => void;
}) {
  return (
    <div className="ca-targets">
      <Picker
        label={label}
        text=""
        placeholder="Search to add"
        local={local}
        search={search}
        onPick={(option) => {
          onName(option);
          if (!value.includes(option.id)) onChange([...value, option.id]);
        }}
      />
      {value.length ? (
        <div className="ca-chips">
          {value.map((id) => (
            <button key={id} type="button" className="ca-chip ca-chip-remove" title="Remove" onClick={() => onChange(value.filter((item) => item !== id))}>
              {names[id] ?? id} ×
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Form editor for one conditionalAccessPolicy body; mirrors the portal's sections. */
export function CaPolicyBuilder({ policy, onChange }: { policy: Policy; onChange: (policy: Policy) => void }) {
  const locations = useInventory(loaderFor("namedLocation"), true, true);
  const strengths = useInventory(loaderFor("authStrength"), true, true);
  const appList = useAppOptions(APPS);
  const [names, setNames] = useState<ReviewNames>(() => Object.fromEntries([...ROLES, ...APPS].map((option) => [option.id, option.label])));
  const remember = (option: PickOption) => setNames((current) => ({ ...current, [option.id]: option.detail ? `${option.label} (${option.detail})` : option.label }));
  useEffect(() => {
    let cancelled = false;
    resolvePolicyNames([policy])
      .then((resolved) => !cancelled && setNames((current) => ({ ...resolved, ...current })))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [String(policy.id ?? policy.displayName)]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (path: string[], next: unknown) => onChange(setIn(policy, path, next));
  const users = asRecord(at(policy, "conditions", "users"));
  const apps = asRecord(at(policy, "conditions", "applications"));
  const conditions = asRecord(policy.conditions);
  const grant = asRecord(policy.grantControls);
  const session = asRecord(policy.sessionControls);
  const locationOptions: Array<[string, string]> = locations.items.map((row) => [String(row.id), rowTitle(row)]);
  useEffect(() => {
    if (locationOptions.length) setNames((current) => ({ ...Object.fromEntries(locationOptions), ...current }));
  }, [locations.items]); // eslint-disable-line react-hooks/exhaustive-deps

  const includeUsers = ids(users.includeUsers);
  const userMode = includeUsers.includes("All") ? "All" : includeUsers.includes("None") && !ids(users.includeGroups).length && !ids(users.includeRoles).length ? "None" : "Select";
  const includeApps = ids(apps.includeApplications);
  const actions = ids(apps.includeUserActions);
  const appMode = actions.length ? "actions" : includeApps.includes("All") ? "All" : includeApps.includes("Office365") ? "Office365" : includeApps.includes("None") ? "None" : "Select";
  const platforms = asRecord(conditions.platforms);
  const includePlatforms = ids(platforms.includePlatforms).filter((value) => value !== "all");
  const loc = asRecord(conditions.locations);
  const includeLocations = ids(loc.includeLocations);
  const locationMode = !conditions.locations ? "any" : includeLocations.includes("All") ? "All" : includeLocations.includes("AllTrusted") ? "AllTrusted" : "Select";
  const clientTypes = ids(conditions.clientAppTypes).filter((value) => value !== "all");
  const block = ids(grant.builtInControls).includes("block");
  const controls = ids(grant.builtInControls).filter((value) => value !== "block");
  const strengthId = String(asRecord(grant.authenticationStrength).id ?? "");
  const frequency = asRecord(session.signInFrequency);
  const persistent = asRecord(session.persistentBrowser);

  const setGrant = (next: { block?: boolean; controls?: string[]; strength?: string; operator?: string }) => {
    const isBlock = next.block ?? block;
    const strength = next.strength ?? strengthId;
    // Graph rejects MFA together with an authentication strength; the strength replaces it.
    const list = (next.controls ?? controls).filter((value) => !(strength && value === "mfa"));
    if (isBlock) return set(["grantControls"], { operator: "OR", builtInControls: ["block"] });
    if (!list.length && !strength) return set(["grantControls"], null);
    set(["grantControls"], {
      operator: next.operator ?? (grant.operator === "AND" ? "AND" : "OR"),
      builtInControls: list,
      ...(strength ? { authenticationStrength: { id: strength } } : {}),
    });
  };
  const setSession = (key: string, value: unknown) => set(["sessionControls"], orNull({ ...session, [key]: value }));

  const issues = [
    userMode === "Select" && !includeUsers.filter((id) => id !== "None").length && !ids(users.includeGroups).length && !ids(users.includeRoles).length
      ? "Pick at least one user, group or role to include."
      : "",
    userMode === "None" ? "Targets no users, so it will never apply." : "",
    appMode === "None" ? "Targets no resources, so it will never apply." : "",
    appMode === "Select" && !includeApps.length ? "Pick at least one app." : "",
    !policy.grantControls && !orNull(session) ? "Has no grant or session controls." : "",
    userMode === "All" && block ? "Blocks all users. Exclude an emergency access account before turning it On." : "",
  ].filter(Boolean);

  return (
    <div className="ca-builder">
      <label className="ca-builder-name">
        Name
        <input className="axis-input" value={String(policy.displayName ?? "")} onChange={(event) => set(["displayName"], event.target.value)} />
      </label>

      <div className="ca-builder-summary">
        <strong>In plain English</strong>
        <span>{plainSummary(policy, names, gateLabels(policy, names))}</span>
        {issues.map((issue) => (
          <span key={issue} className="ca-warn">
            {issue}
          </span>
        ))}
      </div>

      <Section title="Users">
        <label>
          Include
          <select
            className="axis-input"
            value={userMode}
            onChange={(event) =>
              set(["conditions", "users"], {
                ...users,
                includeUsers: event.target.value === "Select" ? [] : [event.target.value],
                includeGroups: [],
                includeRoles: [],
              })
            }
          >
            <option value="None">None</option>
            <option value="All">All users</option>
            <option value="Select">Select users, groups and roles</option>
          </select>
        </label>
        {userMode === "Select" ? (
          <div className="ca-form">
            <Targets label="Users" value={includeUsers.filter((id) => id !== "None")} names={names} search={searchUsers} onName={remember} onChange={(next) => set(["conditions", "users", "includeUsers"], next)} />
            <Targets label="Groups" value={ids(users.includeGroups)} names={names} search={searchGroups} onName={remember} onChange={(next) => set(["conditions", "users", "includeGroups"], next)} />
            <Targets label="Directory roles" value={ids(users.includeRoles)} names={names} local={ROLES} search={async () => []} onName={remember} onChange={(next) => set(["conditions", "users", "includeRoles"], next)} />
          </div>
        ) : null}
        <div className="ca-form">
          <Targets label="Exclude users" value={ids(users.excludeUsers)} names={names} search={searchUsers} onName={remember} onChange={(next) => set(["conditions", "users", "excludeUsers"], next)} />
          <Targets label="Exclude groups" value={ids(users.excludeGroups)} names={names} search={searchGroups} onName={remember} onChange={(next) => set(["conditions", "users", "excludeGroups"], next)} />
          <Targets label="Exclude roles" value={ids(users.excludeRoles)} names={names} local={ROLES} search={async () => []} onName={remember} onChange={(next) => set(["conditions", "users", "excludeRoles"], next)} />
        </div>
      </Section>

      <Section title="Target resources">
        <label>
          Include
          <select
            className="axis-input"
            value={appMode}
            onChange={(event) => {
              const mode = event.target.value;
              set(["conditions", "applications"], {
                ...apps,
                includeApplications: mode === "Select" || mode === "actions" ? [] : [mode],
                includeUserActions: mode === "actions" ? [USER_ACTIONS[0][0]] : [],
                excludeApplications: mode === "actions" ? [] : ids(apps.excludeApplications),
              });
            }}
          >
            <option value="None">None</option>
            <option value="All">All resources</option>
            <option value="Office365">Office 365</option>
            <option value="Select">Select apps</option>
            <option value="actions">User action</option>
          </select>
        </label>
        {appMode === "Select" ? (
          <Targets label="Apps" value={includeApps.filter((id) => id !== "None")} names={names} local={appList} search={searchApps} onName={remember} onChange={(next) => set(["conditions", "applications", "includeApplications"], next)} />
        ) : null}
        {appMode === "actions" ? (
          <Chips options={USER_ACTIONS} selected={actions} onChange={(next) => next.length && set(["conditions", "applications", "includeUserActions"], next)} />
        ) : null}
        {appMode === "All" || appMode === "Office365" ? (
          <Targets label="Exclude apps" value={ids(apps.excludeApplications)} names={names} local={appList} search={searchApps} onName={remember} onChange={(next) => set(["conditions", "applications", "excludeApplications"], next)} />
        ) : null}
      </Section>

      <Section title="Conditions">
        <div className="ca-builder-field">
          <span>Device platforms (none ticked = any)</span>
          <Chips
            options={PLATFORMS.map((value) => [value, humanize(value)])}
            selected={includePlatforms}
            onChange={(next) => set(["conditions", "platforms"], next.length ? { includePlatforms: next, excludePlatforms: [] } : null)}
          />
        </div>
        <div className="ca-builder-field">
          <span>Client apps (none ticked = any)</span>
          <Chips options={CLIENT_TYPES.map((value) => [value, humanize(value)])} selected={clientTypes} onChange={(next) => set(["conditions", "clientAppTypes"], next.length ? next : ["all"])} />
        </div>
        <label>
          Locations
          <select
            className="axis-input"
            value={locationMode}
            onChange={(event) => {
              const mode = event.target.value;
              set(["conditions", "locations"], mode === "any" ? null : { includeLocations: mode === "Select" ? [] : [mode], excludeLocations: ids(loc.excludeLocations) });
            }}
          >
            <option value="any">Not configured</option>
            <option value="All">Any location</option>
            <option value="AllTrusted">All trusted locations</option>
            <option value="Select">Selected locations</option>
          </select>
        </label>
        {locationMode === "Select" ? (
          <Chips options={locationOptions} selected={includeLocations} onChange={(next) => set(["conditions", "locations", "includeLocations"], next)} />
        ) : null}
        {locationMode !== "any" ? (
          <div className="ca-builder-field">
            <span>Exclude locations</span>
            <Chips
              options={[["AllTrusted", "All trusted locations"], ...locationOptions]}
              selected={ids(loc.excludeLocations)}
              onChange={(next) => set(["conditions", "locations", "excludeLocations"], next)}
            />
          </div>
        ) : null}
        <div className="ca-builder-field">
          <span>Sign-in risk</span>
          <Chips options={RISK.map((value) => [value, humanize(value)])} selected={ids(conditions.signInRiskLevels)} onChange={(next) => set(["conditions", "signInRiskLevels"], next)} />
        </div>
        <div className="ca-builder-field">
          <span>User risk</span>
          <Chips options={RISK.map((value) => [value, humanize(value)])} selected={ids(conditions.userRiskLevels)} onChange={(next) => set(["conditions", "userRiskLevels"], next)} />
        </div>
      </Section>

      <Section title="Grant">
        <label className="ca-toggle">
          <BooleanToggle checked={block} onChange={(next) => setGrant({ block: next })} ariaLabel="Block access" />
          Block access
        </label>
        {!block ? (
          <>
            <Chips options={GRANTS.filter(([value]) => !(strengthId && value === "mfa"))} selected={controls} onChange={(next) => setGrant({ controls: next })} />
            <div className="ca-form">
              <label>
                Authentication strength
                <select className="axis-input" value={strengthId} onChange={(event) => setGrant({ strength: event.target.value })}>
                  <option value="">None</option>
                  {strengths.items.map((row) => (
                    <option key={String(row.id)} value={String(row.id)}>
                      {rowTitle(row)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                For multiple controls
                <select className="axis-input" value={grant.operator === "AND" ? "AND" : "OR"} onChange={(event) => setGrant({ operator: event.target.value })}>
                  <option value="AND">Require all the selected controls</option>
                  <option value="OR">Require one of the selected controls</option>
                </select>
              </label>
            </div>
          </>
        ) : null}
      </Section>

      <Section title="Session">
        <label className="ca-toggle">
          <BooleanToggle
            checked={frequency.isEnabled === true}
            onChange={(next) =>
              setSession(
                "signInFrequency",
                next ? { isEnabled: true, type: "hours", value: 12, frequencyInterval: "timeBased", authenticationType: "primaryAndSecondaryAuthentication" } : null,
              )
            }
            ariaLabel="Sign-in frequency"
          />
          Sign-in frequency
        </label>
        {frequency.isEnabled === true ? (
          <div className="ca-form">
            <label>
              Every
              <select
                className="axis-input"
                value={frequency.frequencyInterval === "everyTime" ? "everyTime" : String(frequency.type ?? "hours")}
                onChange={(event) =>
                  setSession(
                    "signInFrequency",
                    event.target.value === "everyTime"
                      ? { isEnabled: true, type: null, value: null, frequencyInterval: "everyTime", authenticationType: "primaryAndSecondaryAuthentication" }
                      : { ...frequency, type: event.target.value, value: Number(frequency.value) || 1, frequencyInterval: "timeBased" },
                  )
                }
              >
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="everyTime">Every time</option>
              </select>
            </label>
            {frequency.frequencyInterval !== "everyTime" ? (
              <label>
                Value
                <input
                  className="axis-input"
                  type="number"
                  min={1}
                  max={frequency.type === "days" ? 365 : 23}
                  value={Number(frequency.value) || 1}
                  onChange={(event) => setSession("signInFrequency", { ...frequency, value: Math.max(1, Number(event.target.value) || 1) })}
                />
              </label>
            ) : null}
          </div>
        ) : null}
        <label>
          Persistent browser session
          <select
            className="axis-input"
            value={persistent.isEnabled ? String(persistent.mode) : ""}
            onChange={(event) => setSession("persistentBrowser", event.target.value ? { isEnabled: true, mode: event.target.value } : null)}
          >
            <option value="">Not configured</option>
            <option value="always">Always persistent</option>
            <option value="never">Never persistent</option>
          </select>
        </label>
        <label className="ca-toggle">
          <BooleanToggle
            checked={asRecord(session.applicationEnforcedRestrictions).isEnabled === true}
            onChange={(next) => setSession("applicationEnforcedRestrictions", next ? { isEnabled: true } : null)}
            ariaLabel="Use app enforced restrictions"
          />
          Use app enforced restrictions
        </label>
      </Section>
    </div>
  );
}
