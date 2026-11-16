import type { ComponentProps } from "react";
import { resolveReviewNames } from "../../lib/tauri";
import { asList, asRecord, humanize, isoDate, ReviewSections, ReviewWorkbench, type ReviewNames, type ReviewRow } from "./ReviewWorkbench";

type Route = { pathname: string; search: URLSearchParams };
type PageProps = { route: Route; signedIn: boolean };
type ViewProps = Omit<ComponentProps<typeof ReviewWorkbench>, "pathname" | "search" | "signedIn">;

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const yes = (value: unknown) => (value ? "Yes" : "No");
const records = (value: unknown) => (Array.isArray(value) ? value.map(asRecord) : []);
const odataType = (row: ReviewRow) => humanize(text(row["@odata.type"]).replace("#microsoft.graph.", ""));

function page(view: ViewProps) {
  return function Page({ route, signedIn }: PageProps) {
    return <ReviewWorkbench key={view.kind} {...view} pathname={route.pathname} search={route.search} signedIn={signedIn} />;
  };
}

// Intune roles

const SCOPE_TYPE: Record<string, string> = {
  allDevices: "All devices",
  allLicensedUsers: "All licensed users",
  allDevicesAndLicensedUsers: "All devices and licensed users",
};
const allowedActions = (row: ReviewRow) =>
  records(row.rolePermissions).flatMap((permission) => records(permission.resourceActions).flatMap((action) => asList(action.allowedResourceActions)));
const groupNames = (ids: unknown, names: ReviewNames) => asList(ids).map((id) => names[id] ?? id);

async function resolveRoleGroups(rows: ReviewRow[]): Promise<ReviewNames> {
  const groups = new Set<string>();
  rows.forEach((row) => records(row.assignments).forEach((assignment) => [...asList(assignment.members), ...asList(assignment.scopeMembers)].forEach((id) => groups.add(id))));
  return resolveReviewNames({ users: [], groups: [...groups], roles: [], apps: [], locations: [] });
}

export const IntuneRolesView = page({
  kind: "intuneRole",
  eyebrow: "Tenant admin · Roles",
  title: "Intune roles",
  description: "Built-in and custom Intune roles, who holds each one, and which groups they can manage.",
  resolveNames: resolveRoleGroups,
  columns: [
    { key: "type", label: "Type", value: (row) => (row.isBuiltIn ? "Built-in" : "Custom") },
    { key: "assignments", label: "Assignments", value: (row) => String(records(row.assignments).length) },
    { key: "permissions", secondary: true, label: "Permissions", value: (row) => String(allowedActions(row).length) },
  ],
  summary: (row, names) => (
    <ReviewSections
      sections={[
        {
          title: "Role",
          fields: [
            { label: "Type", value: row.isBuiltIn ? "Built-in" : "Custom" },
            { label: "Description", value: text(row.description) },
            { label: "Scope tags", value: asList(row.roleScopeTagIds) },
          ],
        },
        {
          title: "Assignments",
          groups: records(row.assignments).map((assignment) => ({
            label: text(assignment.displayName),
            fields: [
              { label: "Members", value: groupNames(assignment.members, names) },
              {
                label: "Scope",
                value: SCOPE_TYPE[text(assignment.scopeType)] ?? (groupNames(assignment.scopeMembers, names).length ? groupNames(assignment.scopeMembers, names) : "None"),
              },
              { label: "Scope tags", value: asList(assignment.roleScopeTagIds) },
            ],
          })),
          fields: records(row.assignments).length ? undefined : [{ label: "Assignments", value: "Not assigned" }],
        },
        { title: "Allowed actions", fields: [{ label: "Actions", value: allowedActions(row) }] },
      ]}
    />
  ),
});

// Connectors

export const IntuneConnectorsView = page({
  kind: "intuneConnector",
  eyebrow: "Tenant admin · Connectors",
  title: "Connectors",
  description: "Mobile Threat Defense, device management partners, remote assistance and certificate connectors, with their state and last contact.",
  columns: [
    { key: "type", label: "Type", value: (row) => text(row.connectorType) },
    { key: "state", label: "State", value: (row) => humanize(row.state) },
    { key: "lastContact", label: "Last contact", value: (row) => isoDate(row.lastSeen) },
  ],
  defaultSort: "type",
  summary: (row) => (
    <ReviewSections
      sections={[
        {
          title: "Connector",
          fields: [
            { label: "Type", value: text(row.connectorType) },
            { label: "State", value: humanize(row.state) },
            { label: "Last contact", value: isoDate(row.lastSeen) },
            { label: "Android", value: row.androidEnabled === undefined ? "" : yes(row.androidEnabled) },
            { label: "iOS", value: row.iosEnabled === undefined ? "" : yes(row.iosEnabled) },
            { label: "macOS", value: row.macEnabled === undefined ? "" : yes(row.macEnabled) },
            { label: "Windows", value: row.windowsEnabled === undefined ? "" : yes(row.windowsEnabled) },
            { label: "Devices non-compliant after", value: isoDate(row.whenPartnerDevicesWillBeMarkedAsNonCompliantDateTime) },
            { label: "Onboarding expires", value: isoDate(row.onboardingRequestExpiryDateTime) },
            { label: "Connector ID", value: text(row.connectorId) },
          ].filter((field) => field.value),
        },
      ]}
    />
  ),
});

// App configuration

function decodedPayload(row: ReviewRow): string {
  if (typeof row.payloadJson !== "string" || !row.payloadJson) return "";
  try {
    return JSON.stringify(JSON.parse(atob(row.payloadJson)), null, 2);
  } catch {
    return row.payloadJson;
  }
}

export const AppConfigurationsView = page({
  kind: "appConfig",
  eyebrow: "Apps · Configuration",
  title: "App configuration policies",
  description: "Configuration sent to apps on managed devices and to managed apps, with the targeted apps and settings.",
  columns: [
    { key: "configType", label: "Applies to", value: (row) => text(row.configType) },
    { key: "type", label: "Type", value: odataType },
    { key: "apps", secondary: true, label: "Targeted apps", value: (row) => String(asList(row.targetedMobileApps).length || records(row.apps).length) },
    { key: "modified", label: "Modified", value: (row) => isoDate(row.lastModifiedDateTime) },
  ],
  summary: (row) => (
    <ReviewSections
      sections={[
        {
          title: "Policy",
          fields: [
            { label: "Applies to", value: text(row.configType) },
            { label: "Type", value: odataType(row) },
            { label: "Description", value: text(row.description) },
            { label: "Package", value: text(row.packageId) },
            { label: "Modified", value: isoDate(row.lastModifiedDateTime) },
          ].filter((field) => field.value),
        },
        {
          title: "Settings",
          fields: [
            ...records(row.settings).map((setting) => ({ label: text(setting.appConfigKey), value: text(setting.appConfigKeyValue) })),
            ...records(row.customSettings).map((setting) => ({ label: text(setting.name), value: text(setting.value) })),
            ...(decodedPayload(row) ? [{ label: "Payload", value: decodedPayload(row) }] : []),
          ],
        },
      ]}
    />
  ),
});

// Assignment filters

export const AssignmentFiltersView = page({
  kind: "assignmentFilter",
  eyebrow: "Tenant admin · Filters",
  title: "Assignment filters",
  description: "Filters that narrow app and policy assignments by device or app properties.",
  columns: [
    { key: "platform", label: "Platform", value: (row) => humanize(row.platform) },
    { key: "management", label: "Management type", value: (row) => humanize(row.assignmentFilterManagementType) },
    { key: "rule", secondary: true, label: "Rule", value: (row) => text(row.rule) },
    { key: "modified", label: "Modified", value: (row) => isoDate(row.lastModifiedDateTime) },
  ],
  summary: (row) => (
    <ReviewSections
      sections={[
        {
          title: "Filter",
          fields: [
            { label: "Platform", value: humanize(row.platform) },
            { label: "Management type", value: humanize(row.assignmentFilterManagementType) },
            { label: "Description", value: text(row.description) },
            { label: "Rule", value: text(row.rule) },
          ],
        },
      ]}
    />
  ),
});

// Notification templates

export const NotificationTemplatesView = page({
  kind: "notificationTemplate",
  eyebrow: "Tenant admin · Notifications",
  title: "Notification templates",
  description: "Email messages that compliance actions send to users, with each language's subject and body.",
  columns: [
    { key: "locale", label: "Default language", value: (row) => text(row.defaultLocale) },
    { key: "languages", label: "Languages", value: (row) => String(records(row.localizedNotificationMessages).length) },
    { key: "modified", label: "Modified", value: (row) => isoDate(row.lastModifiedDateTime) },
  ],
  summary: (row) => (
    <ReviewSections
      sections={[
        {
          title: "Template",
          fields: [
            { label: "Description", value: text(row.description) },
            { label: "Branding", value: text(row.brandingOptions).split(",").map((value) => humanize(value)) },
          ],
        },
        {
          title: "Messages",
          groups: records(row.localizedNotificationMessages).map((message) => ({
            label: `${text(message.locale)}${message.isDefault ? " (default)" : ""}`,
            fields: [
              { label: "Subject", value: text(message.subject) },
              { label: "Body", value: text(message.messageTemplate) },
            ],
          })),
        },
      ]}
    />
  ),
});

// Company Portal branding

export const BrandingProfilesView = page({
  kind: "brandingProfile",
  eyebrow: "Tenant admin · Branding",
  title: "Company Portal branding",
  description: "Branding profiles: company name, support contact and Company Portal options.",
  columns: [
    { key: "default", label: "Default", value: (row) => yes(row.isDefaultProfile) },
    { key: "company", label: "Company name", value: (row) => text(row.displayName) },
    { key: "contact", secondary: true, label: "IT contact", value: (row) => text(row.contactITName) },
  ],
  titleOf: (row) => text(row.profileName) || text(row.displayName) || text(row.id),
  summary: (row) => (
    <ReviewSections
      sections={[
        {
          title: "Profile",
          fields: [
            { label: "Default profile", value: yes(row.isDefaultProfile) },
            { label: "Company name", value: text(row.displayName) },
            { label: "Description", value: text(row.profileDescription) },
            { label: "Theme colour", value: text(asRecord(row.themeColor).r) ? `rgb(${text(asRecord(row.themeColor).r)}, ${text(asRecord(row.themeColor).g)}, ${text(asRecord(row.themeColor).b)})` : "" },
          ],
        },
        {
          title: "Support contact",
          fields: [
            { label: "Name", value: text(row.contactITName) },
            { label: "Phone", value: text(row.contactITPhoneNumber) },
            { label: "Email", value: text(row.contactITEmailAddress) },
            { label: "Notes", value: text(row.contactITNotes) },
            { label: "Website", value: text(row.onlineSupportSiteUrl) },
            { label: "Privacy statement", value: text(row.privacyUrl) },
          ],
        },
        {
          title: "Company Portal",
          fields: [
            { label: "Enrollment", value: humanize(row.enrollmentAvailability) },
            { label: "Device category prompt disabled", value: yes(row.disableDeviceCategorySelection) },
            { label: "Users can't remove devices", value: yes(row.isRemoveDeviceDisabled) },
            { label: "Users can't factory reset", value: yes(row.isFactoryResetDisabled) },
            { label: "Telemetry disabled", value: yes(row.disableClientTelemetry) },
          ],
        },
      ]}
    />
  ),
});

// Device categories and terms and conditions

export const DeviceCategoriesView = page({
  kind: "deviceCategory",
  eyebrow: "Tenant admin · Device categories",
  title: "Device categories",
  description: "Categories users pick when they enroll, used to build dynamic device groups.",
  columns: [{ key: "description", label: "Description", value: (row) => text(row.description) }],
  summary: (row) => <ReviewSections sections={[{ title: "Category", fields: [{ label: "Description", value: text(row.description) }] }]} />,
});

export const TermsAndConditionsView = page({
  kind: "termsAndConditions",
  eyebrow: "Tenant admin · Terms and conditions",
  title: "Terms and conditions",
  description: "Terms users accept in the Company Portal before they enroll.",
  columns: [
    { key: "version", label: "Version", value: (row) => text(row.version) },
    { key: "modified", label: "Modified", value: (row) => isoDate(row.lastModifiedDateTime) },
  ],
  summary: (row) => (
    <ReviewSections
      sections={[
        {
          title: "Terms",
          fields: [
            { label: "Title", value: text(row.title) },
            { label: "Version", value: text(row.version) },
            { label: "Summary", value: text(row.description) },
            { label: "Terms", value: text(row.bodyText) },
            { label: "Acceptance statement", value: text(row.acceptanceStatement) },
          ],
        },
      ]}
    />
  ),
});

// Enrollment profiles

function tokenStatus(row: ReviewRow) {
  const expires = Date.parse(text(row.tokenExpirationDateTime));
  if (Number.isNaN(expires)) return "No token";
  return expires < Date.now() ? "Expired" : `Valid until ${isoDate(row.tokenExpirationDateTime)}`;
}

export const AndroidEnrollmentProfilesView = page({
  kind: "androidEnrollmentProfile",
  eyebrow: "Enrollment · Android",
  title: "Android Enterprise enrollment profiles",
  description: "Fully managed, dedicated and corporate-owned work profile enrollment profiles, with token expiry and enrolled devices.",
  columns: [
    { key: "mode", label: "Enrollment mode", value: (row) => humanize(row.enrollmentMode) },
    { key: "token", label: "Token", value: tokenStatus },
    { key: "devices", label: "Enrolled devices", value: (row) => text(row.enrolledDeviceCount ?? 0) },
    { key: "uses", secondary: true, label: "Token uses", value: (row) => text(row.enrollmentTokenUsageCount ?? 0) },
  ],
  summary: (row) => (
    <ReviewSections
      sections={[
        {
          title: "Profile",
          fields: [
            { label: "Enrollment mode", value: humanize(row.enrollmentMode) },
            { label: "Token type", value: humanize(row.enrollmentTokenType) },
            { label: "Description", value: text(row.description) },
            { label: "Device name template", value: text(row.deviceNameTemplate) },
            { label: "Teams device", value: yes(row.isTeamsDeviceProfile) },
          ],
        },
        {
          title: "Token",
          fields: [
            { label: "Status", value: tokenStatus(row) },
            { label: "Created", value: isoDate(row.tokenCreationDateTime) },
            { label: "Uses", value: text(row.enrollmentTokenUsageCount ?? 0) },
            { label: "Enrolled devices", value: text(row.enrolledDeviceCount ?? 0) },
          ],
        },
      ]}
    />
  ),
});

export const AppleEnrollmentProfilesView = page({
  kind: "appleEnrollmentProfile",
  eyebrow: "Enrollment · Apple",
  title: "User-initiated enrollment profiles",
  description: "Apple enrollment profiles users start from the Company Portal or Settings, with the enrollment types they offer.",
  columns: [
    { key: "platform", label: "Platform", value: (row) => humanize(row.platform) },
    { key: "default", label: "Default type", value: (row) => humanize(row.defaultEnrollmentType) },
    { key: "priority", label: "Priority", value: (row) => text(row.priority) },
  ],
  defaultSort: "priority",
  summary: (row) => (
    <ReviewSections
      sections={[
        {
          title: "Profile",
          fields: [
            { label: "Platform", value: humanize(row.platform) },
            { label: "Default enrollment type", value: humanize(row.defaultEnrollmentType) },
            { label: "Priority", value: text(row.priority) },
            { label: "Description", value: text(row.description) },
          ],
        },
        {
          title: "Options",
          groups: records(row.availableEnrollmentTypeOptions).map((option) => ({
            label: humanize(option.userChoice) || "Option",
            fields: [{ label: "Enrollment types", value: asList(option.options).map((value) => humanize(value)) }],
          })),
        },
      ]}
    />
  ),
});
