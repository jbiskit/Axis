import type { ReactNode } from "react";
import type { ManagedDeviceDetail, ManagedDeviceHardwareDetails } from "../../types/inventory";

const EMPTY_HARDWARE: ManagedDeviceHardwareDetails = {};

function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  const gb = value / 1024 ** 3;
  if (gb >= 0.01) return `${gb.toFixed(2)} GB`;
  const mb = value / 1024 ** 2;
  if (mb >= 0.01) return `${mb.toFixed(2)} MB`;
  return `${value} bytes`;
}

function formatBool(value: boolean | null | undefined): string {
  if (value == null) return "—";
  return value ? "Yes" : "No";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function display(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  return String(value);
}

function CopyableValue({ value }: { value: string | null | undefined }) {
  const text = value?.trim() || "";
  if (!text) return <span>—</span>;
  return (
    <span className="copy-row">
      <span style={{ wordBreak: "break-all" }}>{text}</span>
      <button type="button" className="axis-btn" title="Copy" onClick={() => void navigator.clipboard.writeText(text)}>
        Copy
      </button>
    </span>
  );
}

function DetailSection({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      <dl>
        {rows.map((row) => (
          <div key={row.label} className="detail-row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function DeviceHardwareDetailsPanel({ device }: { device: ManagedDeviceDetail }) {
  const hw = device.hardware ?? EMPTY_HARDWARE;
  const skuLabel =
    hw.skuFamily || hw.skuNumber != null
      ? [hw.skuFamily, hw.skuNumber != null ? `(${hw.skuNumber})` : null].filter(Boolean).join(" ")
      : null;

  return (
    <div className="stack">
      <p className="muted">Physical device details and key Intune / Entra management fields.</p>
      <DetailSection
        title="System"
        rows={[
          { label: "Device name", value: device.deviceName },
          { label: "Management name", value: display(hw.managedDeviceName) },
          { label: "Intune device ID", value: <CopyableValue value={device.id} /> },
          { label: "Registered in Microsoft Entra", value: formatBool(hw.azureAdRegistered) },
          { label: "Microsoft Entra device ID", value: <CopyableValue value={device.azureADDeviceId} /> },
          { label: "Serial number", value: <CopyableValue value={hw.serialNumber} /> },
          { label: "Last check-in", value: formatDate(device.lastSyncDateTime) },
        ]}
      />
      <DetailSection
        title="Enrollment details"
        rows={[
          { label: "Enrollment profile", value: display(hw.enrollmentProfileName) },
          { label: "Enrolled date", value: formatDate(device.enrolledDateTime) },
          {
            label: "Enrolled by",
            value: [hw.userDisplayName, device.userPrincipalName || device.emailAddress]
              .filter(Boolean)
              .join(" · ") || "—",
          },
        ]}
      />
      <DetailSection
        title="Operating system"
        rows={[
          { label: "Operating system", value: display(device.operatingSystem) },
          { label: "Operating system version", value: display(device.osVersion) },
          { label: "Operating system language", value: display(hw.operatingSystemLanguage) },
          { label: "Operating system edition", value: display(hw.operatingSystemEdition) },
          { label: "Operating system SKU", value: display(skuLabel) },
        ]}
      />
      <DetailSection
        title="Subscription + licensing"
        rows={[{ label: "Status", value: display(hw.subscriptionState) }]}
      />
      <DetailSection
        title="Network details"
        rows={[
          { label: "Subscriber carrier", value: display(hw.subscriberCarrier) },
          { label: "Cellular technology", value: display(hw.cellularTechnology) },
          { label: "Wi-Fi MAC", value: display(hw.wifiMacAddress) },
          { label: "Ethernet MAC", value: display(hw.ethernetMacAddress) },
          { label: "ICCID", value: display(hw.iccid) },
          { label: "Wi-Fi IPv4 address", value: <CopyableValue value={hw.ipAddressV4} /> },
          { label: "Wi-Fi subnet ID", value: display(hw.subnetAddress) },
          { label: "Wired IPv4 address", value: <CopyableValue value={hw.wiredIpv4Addresses?.[0] ?? null} /> },
        ]}
      />
      <DetailSection
        title="Storage"
        rows={[
          { label: "Total storage space", value: formatBytes(hw.totalStorageSpaceInBytes) },
          { label: "Free storage space", value: formatBytes(hw.freeStorageSpaceInBytes) },
          { label: "Total physical memory", value: formatBytes(hw.physicalMemoryInBytes) },
        ]}
      />
      <DetailSection
        title="System enclosure"
        rows={[
          { label: "IMEI", value: display(hw.imei) },
          { label: "MEID", value: display(hw.meid) },
          { label: "Device manufacturer", value: display(device.manufacturer) },
          { label: "Device model", value: display(device.model) },
          { label: "Processor architecture", value: display(hw.processorArchitecture) },
          { label: "TPM version", value: display(hw.tpmSpecificationVersion) },
          { label: "TPM manufacturer ID", value: display(hw.tpmManufacturer) },
          { label: "TPM manufacturer version", value: display(hw.tpmVersion) },
          { label: "System Management BIOS version", value: display(hw.systemManagementBiosVersion) },
        ]}
      />
      <DetailSection
        title="Conditional access"
        rows={[
          { label: "Activation lock bypass code", value: display(hw.activationLockBypassCode) },
          { label: "Compliance", value: display(device.complianceState) },
          { label: "EAS activated", value: formatBool(hw.easActivated) },
          { label: "EAS activation ID", value: <CopyableValue value={hw.easDeviceId} /> },
          { label: "EAS activation time", value: formatDate(hw.easActivationDateTime) },
          { label: "Supervised", value: formatBool(hw.isSupervised) },
          { label: "Encrypted", value: formatBool(device.isEncrypted) },
          { label: "Jailbroken", value: display(device.jailBroken) },
          { label: "Ownership", value: display(hw.managedDeviceOwnerType) },
        ]}
      />
    </div>
  );
}
