import type { TenantGlance } from "../types/glance";
import { navigate } from "../lib/route";
import { Panel, PanelHead } from "./ui/PageChrome";

type InventoryRow = TenantGlance["inventory"][number];

/** Areas in the order an admin works through them. */
const AREAS: Array<{ category: string; label: string }> = [
  { category: "configuration", label: "Configuration" },
  { category: "compliance", label: "Compliance" },
  { category: "endpointSecurity", label: "Endpoint security" },
  { category: "updates", label: "Windows Update" },
  { category: "apps", label: "Apps" },
  { category: "enrollment", label: "Enrollment" },
  { category: "scripts", label: "Scripts & remediations" },
  { category: "tenant", label: "Tenant" },
  { category: "identity", label: "Identity" },
];

/** Where each family is managed in Axis. Families without a page are not links. */
const FAMILY_HREF: Record<string, string> = {
  SettingsCatalog: "/intune/policies/settings-catalog",
  AdministrativeTemplates: "/intune/policies/admx-studio",
  CompliancePolicies: "/intune/policies/compliance",
  CompliancePoliciesV2: "/intune/policies/compliance",
  EndpointSecurity: "/intune/endpoint-security",
  FeatureUpdates: "/intune/windows-update/feature-updates",
  QualityUpdates: "/intune/windows-update/quality-updates",
  DriverUpdates: "/intune/windows-update/driver-updates",
  Apps: "/intune/apps/tenant",
  AppProtection: "/intune/apps/protection",
  Autopilot: "/intune/enrollment/windows/autopilot/profiles",
  EnrollmentStatusPage: "/intune/enrollment",
  PowerShellScripts: "/intune/devices/scripts",
  ShellScripts: "/intune/devices/scripts",
  DeviceHealthScripts: "/intune/devices/remediations",
  PolicySets: "/intune/policy-sets",
  ConditionalAccess: "/entra/conditional-access/policies",
};

function FamilyRow({ row }: { row: InventoryRow }) {
  const href = FAMILY_HREF[row.id];
  const failed = Boolean(row.error);
  const value = failed ? "—" : row.count.toLocaleString();
  const valueClass = `configured-count tabular${failed || row.count === 0 ? " muted" : ""}`;
  const reason = failed
    ? `${row.permissionRelated ? "Permission denied" : "Could not be read"}${row.status ? ` (HTTP ${row.status})` : ""}`
    : undefined;
  return (
    <li title={reason}>
      {href && !failed ? (
        <button type="button" className="configured-row is-link" onClick={() => navigate(href)}>
          <span>{row.title}</span>
          <span className={valueClass}>{value}</span>
        </button>
      ) : (
        <div className="configured-row">
          <span className={failed ? "muted" : undefined}>{row.title}</span>
          <span className={valueClass}>{value}</span>
        </div>
      )}
    </li>
  );
}

/**
 * What is configured in the tenant, by area. Each count opens its list where
 * Axis has one. Families that could not be read are summarised once at the
 * bottom, with the Graph detail behind a disclosure.
 */
export function ConfiguredObjectsPanel({ inventory }: { inventory: InventoryRow[] }) {
  const failed = inventory.filter((row) => row.error);
  const permissionDenied = failed.filter((row) => row.permissionRelated).length;
  const total = inventory.filter((row) => !row.error).reduce((sum, row) => sum + row.count, 0);
  const known = new Set(AREAS.map((area) => area.category));
  const areas = [
    ...AREAS,
    // An area added on the Rust side before this list knows it still shows.
    ...[...new Set(inventory.map((row) => row.category))]
      .filter((category) => !known.has(category))
      .map((category) => ({ category, label: category })),
  ]
    .map((area) => ({ ...area, rows: inventory.filter((row) => row.category === area.category) }))
    .filter((area) => area.rows.length > 0);

  return (
    <Panel padded>
      <PanelHead
        title="Configured objects"
        hint={`${total.toLocaleString()} objects across ${areas.length} areas. Select a count to open its list.`}
      />
      <div className="configured-grid">
        {areas.map((area) => {
          const areaTotal = area.rows.filter((row) => !row.error).reduce((sum, row) => sum + row.count, 0);
          return (
            <section key={area.category} className="configured-area">
              <header>
                <h4>{area.label}</h4>
                <span className="tabular">{areaTotal.toLocaleString()}</span>
              </header>
              <ul>
                {area.rows.map((row) => (
                  <FamilyRow key={row.id} row={row} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {failed.length > 0 ? (
        <details className="configured-failures">
          <summary>
            {failed.length} {failed.length === 1 ? "area" : "areas"} could not be read
            {permissionDenied > 0 ? `, ${permissionDenied} for missing permissions` : ""}
          </summary>
          <ul>
            {failed.map((row) => (
              <li key={row.id}>
                <strong>{row.title}</strong>
                <span className="muted">
                  {row.permissionRelated ? " · Permission denied" : " · Query failed"}
                  {row.status ? ` · HTTP ${row.status}` : ""}
                  {row.code ? ` · ${row.code}` : ""}
                  {` · GET ${row.api}`}
                </span>
                {row.error ? <span className="muted configured-error">{row.error}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}
