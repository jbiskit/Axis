import { ReviewSections, ReviewWorkbench, isoDate, type ReviewRow, type ReviewSection } from "./ReviewWorkbench";

type Route = { pathname: string; search: URLSearchParams };

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const count = (value: unknown) => Number(value ?? 0) || 0;
const policyName = (row: ReviewRow) => text(row.PolicyName) || text(row.PolicyId) || "Untitled";

function failuresHeadline(rows: ReviewRow[]) {
  const failing = rows.filter((row) => count(row.FailedDevices) > 0).length;
  return (
    <div className="axis-panel axis-panel-padded">
      <p className="axis-kicker">Policies with failures</p>
      <h2 style={{ margin: 0 }}>
        {failing} of {rows.length}
      </h2>
    </div>
  );
}

const failureSections = (row: ReviewRow): ReviewSection[] => [
  {
    title: "Device status",
    fields: [
      { label: "Succeeded", value: text(count(row.NumberOfCompliantDevices)) },
      { label: "Error", value: text(count(row.NumberOfErrorDevices)) },
      { label: "Conflict", value: text(count(row.NumberOfConflictDevices)) },
      { label: "Not compliant", value: text(count(row.NumberOfNonCompliantDevices)) },
      { label: "Not applicable", value: text(count(row.NumberOfNotApplicableDevices)) },
    ],
  },
  {
    title: "Policy",
    fields: [
      { label: "Type", value: text(row.UnifiedPolicyType_loc) },
      { label: "Platform", value: text(row.UnifiedPolicyPlatformType_loc) },
      { label: "Source", value: text(row.ProfileSource) },
      { label: "Policy ID", value: text(row.PolicyId) },
    ],
  },
];

export function AssignmentFailuresView({ route, signedIn }: { route: Route; signedIn: boolean }) {
  return (
    <ReviewWorkbench
      kind="assignmentFailure"
      eyebrow="Endpoint security · Monitor"
      title="Assignment failures"
      description="Devices in error or conflict for each policy. Policies with failures sort first."
      note="From the Intune policy status report. Only policies that devices have reported on are listed."
      headline={failuresHeadline}
      defaultSort="failed"
      columns={[
        { key: "type", label: "Type", value: (row) => text(row.UnifiedPolicyType_loc) },
        { key: "platform", secondary: true, label: "Platform", value: (row) => text(row.UnifiedPolicyPlatformType_loc) },
        { key: "failed", label: "Failed", value: (row) => text(count(row.FailedDevices)) },
        { key: "error", secondary: true, label: "Error", value: (row) => text(count(row.NumberOfErrorDevices)) },
        { key: "conflict", secondary: true, label: "Conflict", value: (row) => text(count(row.NumberOfConflictDevices)) },
        { key: "succeeded", secondary: true, label: "Succeeded", value: (row) => text(count(row.NumberOfCompliantDevices)) },
      ]}
      summary={(row) => <ReviewSections sections={failureSections(row)} />}
      titleOf={policyName}
      pathname={route.pathname}
      search={route.search}
      signedIn={signedIn}
    />
  );
}

const updateRelease = (row: ReviewRow) => text(row.FeatureUpdateVersion) || isoDate(row.ExpediteQUReleaseDate);

export function UpdateDeploymentStatusView({ route, signedIn }: { route: Route; signedIn: boolean }) {
  return (
    <ReviewWorkbench
      kind="updateAlert"
      eyebrow="Windows Update · Monitor"
      title="Deployment status"
      description="Feature, quality and driver update policies, with the number of devices reporting update errors."
      note="From the Windows update alert reports. Policies appear once devices report against them."
      defaultSort="errors"
      columns={[
        { key: "type", label: "Update type", value: (row) => text(row.UpdateType) },
        { key: "release", label: "Version / release", value: updateRelease },
        { key: "errors", label: "Devices with errors", value: (row) => text(count(row.NumberOfDevicesWithErrors)) },
      ]}
      summary={(row) => (
        <ReviewSections
          sections={[
            {
              title: "Deployment",
              fields: [
                { label: "Update type", value: text(row.UpdateType) },
                { label: "Version / release", value: updateRelease(row) },
                { label: "Devices with errors", value: text(count(row.NumberOfDevicesWithErrors)) },
                { label: "Policy ID", value: text(row.PolicyId) },
              ],
            },
          ]}
        />
      )}
      titleOf={policyName}
      pathname={route.pathname}
      search={route.search}
      signedIn={signedIn}
    />
  );
}
