import { asList, asRecord, humanize, isoDate, ReviewSections, ReviewWorkbench, type ReviewRow } from "./ReviewWorkbench";
import { navigate } from "../../lib/route";

type Route = { pathname: string; search: URLSearchParams };

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const yes = (value: unknown) => (value ? "Yes" : "No");
const DAY_MS = 86_400_000;

// App credentials

const daysLeft = (row: ReviewRow) => {
  const end = Date.parse(text(row.endDateTime));
  return Number.isNaN(end) ? null : Math.floor((end - Date.now()) / DAY_MS);
};

function credentialStatus(row: ReviewRow) {
  const days = daysLeft(row);
  if (days === null) return "No expiry";
  if (days < 0) return "Expired";
  if (days <= 30) return `Expires in ${days} day${days === 1 ? "" : "s"}`;
  return "Valid";
}

function credentialHeadline(rows: ReviewRow[]) {
  const expired = rows.filter((row) => (daysLeft(row) ?? 1) < 0).length;
  const soon = rows.filter((row) => {
    const days = daysLeft(row);
    return days !== null && days >= 0 && days <= 30;
  }).length;
  return (
    <div className="axis-panel axis-panel-padded">
      <p className="axis-kicker">Credentials</p>
      <h2 style={{ margin: 0 }}>
        {expired} expired · {soon} expiring within 30 days
      </h2>
      <p className="muted" style={{ margin: "0.35rem 0 0" }}>
        {rows.length} secrets and certificates across app registrations and SAML enterprise apps
      </p>
    </div>
  );
}

export function AppCredentialsView({ route, signedIn }: { route: Route; signedIn: boolean }) {
  return (
    <ReviewWorkbench
      key="appCredential"
      kind="appCredential"
      eyebrow="Entra · Applications"
      title="App credentials"
      description="Client secrets and certificates on app registrations, and signing certificates on SAML enterprise apps, soonest expiry first."
      headline={credentialHeadline}
      defaultSort="expires"
      columns={[
        { key: "type", label: "Type", value: (row) => text(row.credentialType) },
        { key: "credential", secondary: true, label: "Description", value: (row) => text(row.displayName) },
        { key: "source", secondary: true, label: "Source", value: (row) => text(row.source) },
        { key: "status", label: "Status", value: credentialStatus },
        { key: "expires", label: "Expires", value: (row) => isoDate(row.endDateTime) },
      ]}
      titleOf={(row) => text(row.appName) || text(row.appId) || "Untitled"}
      summary={(row) => (
        <ReviewSections
          sections={[
            {
              title: "Credential",
              fields: [
                { label: "Type", value: text(row.credentialType) },
                { label: "Description", value: text(row.displayName) },
                { label: "Status", value: credentialStatus(row) },
                { label: "Starts", value: isoDate(row.startDateTime) },
                { label: "Expires", value: isoDate(row.endDateTime) },
                { label: "Usage", value: text(row.usage) },
                { label: "Key ID", value: text(row.keyId) },
                { label: "Thumbprint", value: text(row.customKeyIdentifier) },
              ],
            },
            {
              title: "Application",
              fields: [
                { label: "Name", value: text(row.appName) },
                { label: "Source", value: text(row.source) },
                { label: "Application (client) ID", value: text(row.appId) },
                { label: "Object ID", value: text(row.objectId) },
              ],
            },
          ]}
        />
      )}
      pathname={route.pathname}
      search={route.search}
      signedIn={signedIn}
    />
  );
}

// Role assignments

const principal = (row: ReviewRow) => asRecord(row.principal);
const role = (row: ReviewRow) => asRecord(row.roleDefinition);
const expiry = (row: ReviewRow) => asRecord(asRecord(row.scheduleInfo).expiration);
const isPermanent = (row: ReviewRow) => text(expiry(row).type) === "noExpiration";

function assignmentState(row: ReviewRow) {
  if (row.state === "Eligible") return "Eligible";
  if (row.assignmentType === "Activated") return "Active (activated)";
  if (!row.scheduleInfo) return "Active";
  return isPermanent(row) ? "Active (permanent)" : "Active (time-bound)";
}

const scope = (row: ReviewRow) => (text(row.directoryScopeId) === "/" ? "Directory" : text(row.directoryScopeId));

function roleHeadline(rows: ReviewRow[]) {
  const standing = rows.filter((row) => row.state === "Active" && role(row).isPrivileged && isPermanent(row) && row.assignmentType !== "Activated").length;
  const eligible = rows.filter((row) => row.state === "Eligible").length;
  return (
    <div className="axis-panel axis-panel-padded">
      <p className="axis-kicker">Privileged access</p>
      <h2 style={{ margin: 0 }}>
        {standing} permanent assignment{standing === 1 ? "" : "s"} to privileged roles
      </h2>
      <p className="muted" style={{ margin: "0.35rem 0 0" }}>
        {eligible} eligible through PIM · {rows.length} assignments in total
      </p>
    </div>
  );
}

export function RoleAssignmentsView({ route, signedIn }: { route: Route; signedIn: boolean }) {
  return (
    <ReviewWorkbench
      key="roleAssignment"
      kind="roleAssignment"
      eyebrow="Entra · Roles"
      title="Role assignments"
      description="Who holds each directory role, whether it is permanent, time-bound or eligible through PIM, and at what scope."
      note="Eligible and time-bound assignments need Entra ID P2. Without it, only active assignments are listed."
      headline={roleHeadline}
      defaultSort="role"
      groupings={[
        { key: "role", label: "Role", value: (row) => text(role(row).displayName) },
        { key: "user", label: "User", value: (row) => text(principal(row).displayName) || text(row.principalId) },
      ]}
      columns={[
        { key: "role", label: "Role", value: (row) => text(role(row).displayName) },
        { key: "state", label: "State", value: assignmentState },
        { key: "expires", secondary: true, label: "Expires", value: (row) => isoDate(expiry(row).endDateTime) },
        { key: "privileged", label: "Privileged", value: (row) => yes(role(row).isPrivileged) },
        { key: "principalType", secondary: true, label: "Principal type", value: (row) => humanize(principal(row).type) },
        { key: "scope", secondary: true, label: "Scope", value: scope },
      ]}
      titleOf={(row) => text(principal(row).displayName) || text(row.principalId) || "Untitled"}
      summary={(row) => (
        <ReviewSections
          sections={[
            {
              title: "Assignment",
              fields: [
                { label: "Role", value: text(role(row).displayName) },
                { label: "State", value: assignmentState(row) },
                { label: "Member type", value: text(row.memberType) },
                { label: "Starts", value: isoDate(asRecord(row.scheduleInfo).startDateTime) },
                { label: "Expires", value: isoDate(expiry(row).endDateTime) },
                { label: "Scope", value: scope(row) },
                { label: "Created using", value: text(row.createdUsing) },
              ],
            },
            {
              title: "Principal",
              fields: [
                { label: "Name", value: text(principal(row).displayName) },
                { label: "Type", value: humanize(principal(row).type) },
                { label: "Sign-in name", value: text(principal(row).userPrincipalName) },
                { label: "Application ID", value: text(principal(row).appId) },
                { label: "Account enabled", value: principal(row).accountEnabled === undefined || principal(row).accountEnabled === null ? "" : yes(principal(row).accountEnabled) },
              ],
            },
            {
              title: "Role",
              fields: [
                { label: "Built in", value: yes(role(row).isBuiltIn) },
                { label: "Privileged", value: yes(role(row).isPrivileged) },
              ],
            },
          ]}
        />
      )}
      pathname={route.pathname}
      search={route.search}
      signedIn={signedIn}
    />
  );
}

// Custom roles

const allowedActions = (row: ReviewRow) =>
  (Array.isArray(row.rolePermissions) ? row.rolePermissions : []).flatMap((permission) => asList(asRecord(permission).allowedResourceActions));

export function CustomRolesView({ route, signedIn }: { route: Route; signedIn: boolean }) {
  return (
    <ReviewWorkbench
      key="customRole"
      kind="customRole"
      eyebrow="Entra · Roles"
      title="Custom roles"
      description="Directory roles defined in this tenant, with the permissions each one grants."
      columns={[
        { key: "enabled", label: "Enabled", value: (row) => yes(row.isEnabled) },
        { key: "permissions", label: "Permissions", value: (row) => String(allowedActions(row).length) },
        { key: "privileged", secondary: true, label: "Privileged", value: (row) => yes(row.isPrivileged) },
      ]}
      summary={(row) => (
        <ReviewSections
          sections={[
            {
              title: "Role",
              fields: [
                { label: "Description", value: text(row.description) },
                { label: "Enabled", value: yes(row.isEnabled) },
                { label: "Privileged", value: yes(row.isPrivileged) },
                { label: "Template ID", value: text(row.templateId) },
              ],
            },
            { title: "Allowed actions", fields: [{ label: "Actions", value: allowedActions(row) }] },
          ]}
        />
      )}
      pathname={route.pathname}
      search={route.search}
      signedIn={signedIn}
    />
  );
}

// PIM role settings

const rule = (row: ReviewRow, id: string) =>
  asRecord((Array.isArray(row.rules) ? row.rules : []).find((candidate) => asRecord(candidate).id === id));
const enabledRules = (row: ReviewRow, id: string) => asList(rule(row, id).enabledRules);

/** ISO 8601 duration (PT8H, P365D, PT30M) as words. */
function duration(value: unknown) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(text(value));
  if (!match) return text(value);
  const parts: Array<[string | undefined, string]> = [[match[1], "day"], [match[2], "hour"], [match[3], "minute"]];
  return parts
    .filter(([amount]) => amount && amount !== "0")
    .map(([amount, unit]) => `${amount} ${unit}${amount === "1" ? "" : "s"}`)
    .join(" ");
}

const activationMax = (row: ReviewRow) => duration(rule(row, "Expiration_EndUser_Assignment").maximumDuration);
const approval = (row: ReviewRow) => asRecord(rule(row, "Approval_EndUser_Assignment").setting);
const needsOnActivation = (row: ReviewRow, name: string) => yes(enabledRules(row, "Enablement_EndUser_Assignment").includes(name));
const permanentAllowed = (row: ReviewRow, id: string) => (rule(row, id).isExpirationRequired ? "No" : "Yes");
const approvers = (row: ReviewRow) =>
  (Array.isArray(approval(row).approvalStages) ? approval(row).approvalStages as unknown[] : []).flatMap((stage) =>
    (Array.isArray(asRecord(stage).primaryApprovers) ? asRecord(stage).primaryApprovers as unknown[] : []).map(
      (approver) => text(asRecord(approver).description) || text(asRecord(approver).userId) || text(asRecord(approver).groupId),
    ),
  );

export function PimRoleSettingsView({ route, signedIn }: { route: Route; signedIn: boolean }) {
  return (
    <ReviewWorkbench
      key="pimRoleSetting"
      kind="pimRoleSetting"
      eyebrow="Entra · Roles"
      title="PIM role settings"
      description="Privileged Identity Management rules for each directory role: activation length, MFA, justification and approval, and whether permanent assignments are allowed."
      note="Needs Entra ID P2. Default settings are listed for roles nobody has changed."
      defaultSort="privileged"
      columns={[
        { key: "privileged", label: "Privileged", value: (row) => yes(row.isPrivileged) },
        { key: "activation", label: "Max activation", value: activationMax },
        { key: "mfa", label: "MFA on activation", value: (row) => needsOnActivation(row, "MultiFactorAuthentication") },
        { key: "approval", label: "Approval", value: (row) => yes(approval(row).isApprovalRequired) },
        { key: "permanentEligible", secondary: true, label: "Permanent eligible", value: (row) => permanentAllowed(row, "Expiration_Admin_Eligibility") },
        { key: "permanentActive", secondary: true, label: "Permanent active", value: (row) => permanentAllowed(row, "Expiration_Admin_Assignment") },
      ]}
      titleOf={(row) => text(row.roleName) || text(row.id) || "Untitled"}
      summary={(row) => (
        <ReviewSections
          sections={[
            {
              title: "Activation",
              fields: [
                { label: "Maximum duration", value: activationMax(row) },
                { label: "Require MFA", value: needsOnActivation(row, "MultiFactorAuthentication") },
                { label: "Require justification", value: needsOnActivation(row, "Justification") },
                { label: "Require ticket information", value: needsOnActivation(row, "Ticketing") },
                { label: "Require approval", value: yes(approval(row).isApprovalRequired) },
                { label: "Approvers", value: approvers(row) },
                { label: "Authentication context", value: rule(row, "AuthenticationContext_EndUser_Assignment").isEnabled ? text(rule(row, "AuthenticationContext_EndUser_Assignment").claimValue) : "Off" },
              ],
            },
            {
              title: "Eligible assignments",
              fields: [
                { label: "Allow permanent", value: permanentAllowed(row, "Expiration_Admin_Eligibility") },
                { label: "Expire after", value: duration(rule(row, "Expiration_Admin_Eligibility").maximumDuration) },
              ],
            },
            {
              title: "Active assignments",
              fields: [
                { label: "Allow permanent", value: permanentAllowed(row, "Expiration_Admin_Assignment") },
                { label: "Expire after", value: duration(rule(row, "Expiration_Admin_Assignment").maximumDuration) },
                { label: "Require MFA", value: yes(enabledRules(row, "Enablement_Admin_Assignment").includes("MultiFactorAuthentication")) },
                { label: "Require justification", value: yes(enabledRules(row, "Enablement_Admin_Assignment").includes("Justification")) },
              ],
            },
            {
              title: "Role",
              fields: [
                { label: "Built in", value: yes(row.isBuiltIn) },
                { label: "Last modified", value: isoDate(row.lastModifiedDateTime) },
              ],
            },
          ]}
        />
      )}
      pathname={route.pathname}
      search={route.search}
      signedIn={signedIn}
    />
  );
}

// Tenant settings (single-object Entra policies, one row each)

const onOff = (value: unknown) => (value === undefined || value === null ? "" : value ? "On" : "Off");
const at = (row: ReviewRow, path: string): unknown => path.split(".").reduce<unknown>((value, key) => asRecord(value)[key], row);
const MEMBERSHIP: Record<string, string> = {
  allDeviceRegistrationMembership: "All",
  enumeratedDeviceRegistrationMembership: "Selected",
  noDeviceRegistrationMembership: "None",
};
const membership = (value: unknown) => MEMBERSHIP[text(asRecord(value)["@odata.type"]).replace("#microsoft.graph.", "")] ?? "";
// Built-in guest role ids (Entra > External collaboration settings > Guest user access).
const GUEST_ACCESS: Record<string, string> = {
  "a0b1b346-4d3e-4e8b-98f8-753987be4970": "Same access as members",
  "10dae51f-b6af-4d8d-a1f2-0aa1f6af3e55": "Limited access (default)",
  "2af84b1e-32c8-42b7-82bc-daa82404023b": "Restricted access",
};
const userConsent = (row: ReviewRow) =>
  asList(row.permissionGrantPolicyIdsAssignedToDefaultUserRole).filter((id) => id.startsWith("ManagePermissionGrantsForSelf"));
const access = (row: ReviewRow, path: string) => humanize(at(row, `${path}.accessType`));

const SETTING_FIELDS: Record<string, (row: ReviewRow) => Array<{ label: string; value: string | string[] }>> = {
  authorization: (row) => [
    { label: "Guest user access", value: GUEST_ACCESS[text(row.guestUserRoleId)] ?? text(row.guestUserRoleId) },
    { label: "Guest invites from", value: humanize(row.allowInvitesFrom) },
    { label: "User consent policies", value: userConsent(row).length ? userConsent(row) : "Users can't consent" },
    { label: "Users can register applications", value: yes(at(row, "defaultUserRolePermissions.allowedToCreateApps")) },
    { label: "Users can create security groups", value: yes(at(row, "defaultUserRolePermissions.allowedToCreateSecurityGroups")) },
    { label: "Users can create tenants", value: yes(at(row, "defaultUserRolePermissions.allowedToCreateTenants")) },
    { label: "Users can read other users", value: yes(at(row, "defaultUserRolePermissions.allowedToReadOtherUsers")) },
    { label: "Users can read BitLocker keys for their devices", value: yes(at(row, "defaultUserRolePermissions.allowedToReadBitlockerKeysForOwnedDevice")) },
    { label: "Users can use self-service password reset", value: yes(row.allowedToUseSSPR) },
    { label: "Email-verified users can join", value: yes(row.allowEmailVerifiedUsersToJoinOrganization) },
    { label: "Email-based subscription sign-up", value: yes(row.allowedToSignUpEmailBasedSubscriptions) },
    { label: "Consent to risky apps allowed", value: yes(row.allowUserConsentForRiskyApps) },
    { label: "Block MSOnline PowerShell", value: yes(row.blockMsolPowerShell) },
  ],
  securityDefaults: (row) => [{ label: "Security defaults", value: onOff(row.isEnabled) }],
  crossTenantDefault: (row) => [
    { label: "B2B collaboration inbound (users)", value: access(row, "b2bCollaborationInbound.usersAndGroups") },
    { label: "B2B collaboration inbound (apps)", value: access(row, "b2bCollaborationInbound.applications") },
    { label: "B2B collaboration outbound (users)", value: access(row, "b2bCollaborationOutbound.usersAndGroups") },
    { label: "B2B collaboration outbound (apps)", value: access(row, "b2bCollaborationOutbound.applications") },
    { label: "B2B direct connect inbound", value: access(row, "b2bDirectConnectInbound.usersAndGroups") },
    { label: "B2B direct connect outbound", value: access(row, "b2bDirectConnectOutbound.usersAndGroups") },
    { label: "Trust MFA from other tenants", value: yes(at(row, "inboundTrust.isMfaAccepted")) },
    { label: "Trust compliant devices", value: yes(at(row, "inboundTrust.isCompliantDeviceAccepted")) },
    { label: "Trust hybrid joined devices", value: yes(at(row, "inboundTrust.isHybridAzureADJoinedDeviceAccepted")) },
  ],
  deviceRegistration: (row) => [
    { label: "Users can join devices", value: membership(at(row, "azureADJoin.allowedToJoin")) },
    { label: "Users can register devices", value: membership(at(row, "azureADRegistration.allowedToRegister")) },
    { label: "MFA to register or join", value: humanize(row.multiFactorAuthConfiguration) },
    { label: "Maximum devices per user", value: text(row.userDeviceQuota) },
    { label: "Local administrator password (LAPS)", value: onOff(at(row, "localAdminPassword.isEnabled")) },
    { label: "Global admins are local admins", value: yes(at(row, "azureADJoin.localAdmins.enableGlobalAdmins")) },
  ],
  adminConsent: (row) => [
    { label: "Admin consent requests", value: onOff(row.isEnabled) },
    { label: "Notify reviewers", value: yes(row.notifyReviewers) },
    { label: "Reminders", value: yes(row.remindersEnabled) },
    { label: "Requests expire after (days)", value: text(row.requestDurationInDays) },
    { label: "Reviewers", value: String(Array.isArray(row.reviewers) ? row.reviewers.length : 0) },
  ],
  authenticationFlows: (row) => [{ label: "Self-service sign-up for guests", value: onOff(at(row, "selfServiceSignUp.isEnabled")) }],
  externalIdentities: (row) => [
    { label: "External users can leave", value: yes(row.allowExternalIdentitiesToLeave) },
    { label: "Remove data of deleted external users", value: yes(row.allowDeletedIdentitiesDataRemoval) },
  ],
};

const SETTING_SUMMARY: Record<string, (row: ReviewRow) => string> = {
  authorization: (row) =>
    `Guests: ${GUEST_ACCESS[text(row.guestUserRoleId)] ?? "custom"} · user consent ${userConsent(row).length ? "allowed" : "off"}`,
  securityDefaults: (row) => onOff(row.isEnabled),
  crossTenantDefault: (row) =>
    `Inbound ${access(row, "b2bCollaborationInbound.usersAndGroups") || "?"} · trusts MFA: ${yes(at(row, "inboundTrust.isMfaAccepted"))}`,
  deviceRegistration: (row) => `Join: ${membership(at(row, "azureADJoin.allowedToJoin"))} · LAPS ${onOff(at(row, "localAdminPassword.isEnabled"))}`,
  adminConsent: (row) => onOff(row.isEnabled),
  authenticationFlows: (row) => `Guest sign-up ${onOff(at(row, "selfServiceSignUp.isEnabled"))}`,
  externalIdentities: (row) => `Users can leave: ${yes(row.allowExternalIdentitiesToLeave)}`,
};

const settingSummary = (row: ReviewRow) => (row.error ? text(row.error) : SETTING_SUMMARY[text(row.id)]?.(row) ?? "");

export function TenantSettingsView({ route, signedIn }: { route: Route; signedIn: boolean }) {
  return (
    <ReviewWorkbench
      key="tenantSetting"
      kind="tenantSetting"
      eyebrow="Entra · Tenant"
      title="Tenant settings"
      description="Tenant-wide identity settings: default user permissions, guest access, security defaults, cross-tenant access, device join and admin consent."
      columns={[{ key: "summary", label: "Summary", value: settingSummary }]}
      titleOf={(row) => text(row.settingName) || text(row.id)}
      summary={(row) => (
        <ReviewSections
          sections={[
            row.error
              ? { title: "Couldn't read this setting", fields: [{ label: "Error", value: text(row.error) }] }
              : { title: text(row.settingName), fields: SETTING_FIELDS[text(row.id)]?.(row) ?? [] },
            { title: "Source", fields: [{ label: "Graph path", value: text(row.graphPath) }] },
          ]}
        />
      )}
      pathname={route.pathname}
      search={route.search}
      signedIn={signedIn}
    />
  );
}

// Authentication strengths

const combinations = (row: ReviewRow) =>
  asList(row.allowedCombinations).map((combo) => combo.split(",").map((method) => humanize(method)).join(" + "));

export function AuthStrengthsView({ route, signedIn }: { route: Route; signedIn: boolean }) {
  return (
    <ReviewWorkbench
      key="authStrength"
      kind="authStrength"
      eyebrow="Entra · Conditional Access"
      title="Authentication strengths"
      description="Built-in and custom sets of sign-in methods that Conditional Access can require."
      columns={[
        { key: "type", label: "Type", value: (row) => humanize(row.policyType) },
        { key: "combinations", label: "Method combinations", value: (row) => String(combinations(row).length) },
        { key: "satisfies", secondary: true, label: "Satisfies", value: (row) => humanize(row.requirementsSatisfied) },
        { key: "modified", secondary: true, label: "Modified", value: (row) => isoDate(row.modifiedDateTime) },
      ]}
      summary={(row) => (
        <ReviewSections
          sections={[
            {
              title: "Strength",
              fields: [
                { label: "Type", value: humanize(row.policyType) },
                { label: "Satisfies", value: humanize(row.requirementsSatisfied) },
                { label: "Description", value: text(row.description) },
                { label: "Modified", value: isoDate(row.modifiedDateTime) },
              ],
            },
            { title: "Allowed method combinations", fields: [{ label: "Combinations", value: combinations(row) }] },
          ]}
        />
      )}
      pathname={route.pathname}
      search={route.search}
      signedIn={signedIn}
    />
  );
}

// Conditional Access templates without a matching policy

const matched = (row: ReviewRow) => (Array.isArray(row.matchedPolicies) ? row.matchedPolicies.map(asRecord) : []);

function templatesHeadline(rows: ReviewRow[]) {
  const missing = rows.filter((row) => !matched(row).length).length;
  return (
    <div className="axis-panel axis-panel-padded">
      <p className="axis-kicker">Templates without a policy</p>
      <h2 style={{ margin: 0 }}>
        {missing} of {rows.length}
      </h2>
      <p className="muted" style={{ margin: "0.35rem 0 0" }}>
        A template counts as used when a policy was created from it or has the same name.
      </p>
    </div>
  );
}

export function CaTemplatesView({ route, signedIn }: { route: Route; signedIn: boolean }) {
  return (
    <ReviewWorkbench
      key="caTemplate"
      kind="caTemplate"
      eyebrow="Entra · Conditional Access"
      title="Templates"
      description="Microsoft's Conditional Access templates, and whether this tenant has a policy for each."
      headline={templatesHeadline}
      headerActions={
        <button type="button" className="axis-btn axis-btn-primary" onClick={() => navigate("/entra/conditional-access/new")}>
          Create from templates
        </button>
      }
      columns={[
        { key: "status", label: "Status", value: (row) => (matched(row).length ? "Has policy" : "No policy") },
        { key: "scenarios", label: "Scenarios", value: (row) => text(row.scenarios).split(",").map((value) => humanize(value)).join(", ") },
        { key: "policies", secondary: true, label: "Policies", value: (row) => matched(row).map((policy) => text(policy.displayName)).join(", ") },
      ]}
      titleOf={(row) => text(row.name) || text(row.id)}
      summary={(row) => (
        <ReviewSections
          sections={[
            {
              title: "Template",
              fields: [
                { label: "Description", value: text(row.description) },
                { label: "Scenarios", value: text(row.scenarios).split(",").map((value) => humanize(value)) },
                { label: "Grant controls", value: asList(asRecord(asRecord(row.details).grantControls).builtInControls).map((value) => humanize(value)) },
              ],
            },
            {
              title: "Matching policies",
              fields: [
                {
                  label: "Policies",
                  value: matched(row).length ? matched(row).map((policy) => `${text(policy.displayName)} (${humanize(policy.state)})`) : "None",
                },
              ],
            },
          ]}
        />
      )}
      pathname={route.pathname}
      search={route.search}
      signedIn={signedIn}
    />
  );
}

// Users (read-only; the same page sits under Intune › Manage and Entra › Directory)

const userSource = (row: ReviewRow) => (row.onPremisesSyncEnabled ? "Synced" : "Cloud");
const licenceCount = (row: ReviewRow) => (Array.isArray(row.assignedLicenses) ? row.assignedLicenses.length : 0);
/** `skuPartNumber` per assigned licence (added by the backend); "None" when the user has none. */
const licenceNames = (row: ReviewRow) => {
  const names = asList(row.licenceNames).sort();
  return names.length ? names : ["None"];
};

function userHeadline(rows: ReviewRow[]) {
  const disabled = rows.filter((row) => row.accountEnabled === false).length;
  const guests = rows.filter((row) => row.userType === "Guest").length;
  const unlicensed = rows.filter((row) => row.userType !== "Guest" && licenceCount(row) === 0).length;
  return (
    <div className="axis-panel axis-panel-padded">
      <p className="axis-kicker">Directory</p>
      <h2 style={{ margin: 0 }}>
        {rows.length} user{rows.length === 1 ? "" : "s"} · {guests} guest{guests === 1 ? "" : "s"}
      </h2>
      <p className="muted" style={{ margin: "0.35rem 0 0" }}>
        {disabled} disabled · {unlicensed} member{unlicensed === 1 ? "" : "s"} without a licence
      </p>
    </div>
  );
}

export function UsersView({ route, signedIn }: { route: Route; signedIn: boolean }) {
  return (
    <ReviewWorkbench
      key="user"
      kind="user"
      eyebrow={route.pathname.startsWith("/entra") ? "Entra · Directory" : "Manage"}
      title="Users"
      description="Every user in this tenant: type, account state, where the account comes from and how many licences it holds."
      headline={userHeadline}
      columns={[
        { key: "upn", label: "User principal name", value: (row) => text(row.userPrincipalName) },
        { key: "type", label: "Type", filter: true, value: (row) => text(row.userType) },
        { key: "status", label: "Account", filter: true, value: (row) => (row.accountEnabled === false ? "Disabled" : "Enabled") },
        { key: "source", secondary: true, label: "Source", filter: true, value: userSource },
        { key: "licences", secondary: true, label: "Licences", filter: true, filterMulti: true, filterValues: licenceNames, value: (row) => licenceNames(row).join(", ") },
        { key: "department", secondary: true, label: "Department", filter: true, value: (row) => text(row.department) },
      ]}
      summary={(row) => (
        <>
          <ReviewSections
          sections={[
            {
              title: "Identity",
              fields: [
                { label: "User principal name", value: text(row.userPrincipalName) },
                { label: "Mail", value: text(row.mail) },
                { label: "Type", value: text(row.userType) },
                { label: "Invitation", value: humanize(row.externalUserState) },
              ],
            },
            {
              title: "Account",
              fields: [
                { label: "Account", value: row.accountEnabled === false ? "Disabled" : "Enabled" },
                { label: "Source", value: userSource(row) },
                { label: "Licences", value: licenceNames(row) },
                { label: "Usage location", value: text(row.usageLocation) },
                { label: "Created", value: isoDate(row.createdDateTime) },
                { label: "Object ID", value: text(row.id) },
              ],
            },
            {
              title: "Organisation",
              fields: [
                { label: "Job title", value: text(row.jobTitle) },
                { label: "Department", value: text(row.department) },
                { label: "Company", value: text(row.companyName) },
                { label: "Office", value: text(row.officeLocation) },
              ],
            },
          ]}
          />
          <button
            type="button"
            className="axis-btn"
            style={{ marginTop: "0.75rem" }}
            onClick={() => navigate(`/intune/tools/dynamic-rules?user=${encodeURIComponent(String(row.id))}`)}
          >
            Build a dynamic group from this user
          </button>
        </>
      )}
      pathname={route.pathname}
      search={route.search}
      signedIn={signedIn}
    />
  );
}
