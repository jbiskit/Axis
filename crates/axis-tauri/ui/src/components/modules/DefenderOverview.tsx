import { useInventory } from "../../hooks/useInventory";
import { hrefWithParam } from "../../lib/route";
import { AttentionTable, count, KpiTiles, OverviewHeader, pct, plural, ShareCard, shareRows, type Issue, type Kpi } from "../overview/OverviewParts";
import { asRecord, humanize, loaderFor, type ReviewRow } from "./ReviewWorkbench";

const SECURE_SCORE_PATH = "/defender/posture/secure-score";
const DEVICES_PATH = "/defender/endpoints/devices";
// Controls listed in Needs attention, by points still available.
const TOP_CONTROLS = 5;

const num = (value: unknown) => (typeof value === "number" ? value : Number(value) || 0);
const earned = (row: ReviewRow) => num(asRecord(row.current).score);
const left = (row: ReviewRow) => Math.max(0, num(row.maxScore) - earned(row));
const sensorDown = (row: ReviewRow) => Boolean(row.SensorHealthState) && row.SensorHealthState !== "Active";
const presetName = (row: ReviewRow) => (/strict/i.test(String(row.Identity ?? row.Name ?? "")) ? "Strict" : "Standard");
const presetOn = (row: ReviewRow) => String(asRecord(row.rule).State ?? row.State ?? "") === "Enabled";

export function DefenderOverview({ signedIn }: { signedIn: boolean }) {
  const score = useInventory(loaderFor("secureScoreControl"), signedIn, signedIn);
  const devices = useInventory(loaderFor("defenderDevice"), signedIn, signedIn);
  const endpointPolicies = useInventory(loaderFor("endpointSecurityPolicy"), signedIn, signedIn);
  const presets = useInventory(loaderFor("mdo:presetPolicies"), signedIn, signedIn);
  const dkim = useInventory(loaderFor("mdo:dkim"), signedIn, signedIn);
  const sources = [score, devices, endpointPolicies, presets, dkim];
  const loading = sources.some((source) => source.loading);
  const refresh = () => sources.forEach((source) => void source.reload());

  const controls = score.items;
  const scoreEarned = controls.reduce((sum, row) => sum + earned(row), 0);
  const scoreMax = controls.reduce((sum, row) => sum + num(row.maxScore), 0);
  const scorePct = scoreMax > 0 ? pct(scoreEarned, scoreMax) : null;

  const deviceRows = devices.items;
  const highExposure = deviceRows.filter((row) => row.ExposureLevel === "High").length;
  const sensorsDown = deviceRows.filter(sensorDown).length;

  const presetsOn = presets.items.filter(presetOn).map(presetName);
  const dkimOff = dkim.items.filter((row) => row.Enabled === false);

  const kpis: Kpi[] = [
    {
      label: "Secure Score",
      base: "Microsoft 365",
      value: scorePct == null ? "—" : `${Math.round(scorePct)}%`,
      unit: scoreMax ? `${scoreEarned.toFixed(0)} of ${count(scoreMax)} pts` : "",
      fill: scorePct ?? 0,
      tone: "quiet",
      foot: `${plural(controls.filter((row) => left(row) > 0).length, "control")} open`,
      state: "",
      tip: score.error || "Scored controls only, so the total matches the Defender portal",
      href: SECURE_SCORE_PATH,
    },
    {
      label: "Devices",
      base: "Defender for Endpoint",
      value: devices.error ? "—" : count(deviceRows.length),
      unit: "onboarded",
      fill: deviceRows.length ? 100 - pct(sensorsDown, deviceRows.length) : 0,
      tone: sensorsDown > 0 ? "warn" : "quiet",
      foot: `${count(sensorsDown)} sensor issues`,
      state: sensorsDown > 0 ? "Review" : deviceRows.length ? "Healthy" : "",
      tip: devices.error || "Latest DeviceInfo per device from advanced hunting",
      href: DEVICES_PATH,
    },
    {
      label: "High exposure",
      base: "Devices",
      value: devices.error ? "—" : count(highExposure),
      unit: "devices",
      fill: pct(highExposure, deviceRows.length),
      tone: highExposure > 0 ? "bad" : "quiet",
      foot: `of ${count(deviceRows.length)}`,
      state: highExposure > 0 ? "Act" : deviceRows.length ? "Clear" : "",
      tip: "Exposure level reported by Defender Vulnerability Management",
      href: DEVICES_PATH,
    },
    {
      label: "Preset policies",
      base: "Email",
      value: presets.error ? "—" : presetsOn.length ? [...new Set(presetsOn)].join(" + ") : "Off",
      unit: "",
      fill: presetsOn.length ? 100 : 0,
      tone: presets.error ? "quiet" : presetsOn.length ? "quiet" : "warn",
      foot: `${plural(presets.items.length, "rule")}`,
      state: presets.error ? "" : presetsOn.length ? "On" : "Review",
      tip: presets.error || "Standard and Strict preset security policies for Exchange Online Protection and Defender for Office 365",
      href: "/defender/email/preset-policies",
    },
    {
      label: "DKIM",
      base: "Domains",
      value: dkim.error ? "—" : count(dkim.items.length - dkimOff.length),
      unit: `of ${plural(dkim.items.length, "domain")}`,
      fill: pct(dkim.items.length - dkimOff.length, dkim.items.length),
      tone: dkimOff.length > 0 ? "warn" : "quiet",
      foot: `${count(dkimOff.length)} not signing`,
      state: dkimOff.length > 0 ? "Review" : dkim.items.length ? "Healthy" : "",
      tip: dkim.error || "Domains signing outbound mail with DKIM",
      href: "/defender/email/dkim",
    },
  ];

  const topControls = [...controls].filter((row) => left(row) > 0).sort((a, b) => left(b) - left(a)).slice(0, TOP_CONTROLS);
  const issues: Issue[] = [
    ...(highExposure > 0 ? [{
      key: "exposure", tone: "bad" as const, item: "High exposure devices", area: "Endpoints", count: highExposure,
      action: "Open devices", href: DEVICES_PATH,
    }] : []),
    ...(sensorsDown > 0 ? [{
      key: "sensors", tone: "warn" as const, item: "Sensor not active", area: "Endpoints", count: sensorsDown,
      tip: "Inactive, impaired communication or no sensor data", action: "Open devices", href: DEVICES_PATH,
    }] : []),
    ...(!presets.error && !presets.loading && presets.fetchedAt && presetsOn.length === 0 ? [{
      key: "presets", tone: "warn" as const, item: "Preset security policies", detail: "not on", area: "Email", count: null,
      action: "Open", href: "/defender/email/preset-policies",
    }] : []),
    ...dkimOff.map<Issue>((row) => ({
      key: `dkim-${String(row.Domain ?? row.id)}`, tone: "warn", item: String(row.Domain ?? row.Name ?? "Domain"), detail: "DKIM off", area: "Email",
      count: null, action: "Open", href: hrefWithParam("/defender/email/dkim", new URLSearchParams(), "object", String(row.id)),
    })),
    ...topControls.map<Issue>((row) => ({
      key: `control-${String(row.id)}`, tone: "warn", item: String(row.title ?? row.id), detail: `${left(row).toFixed(0)} pts`,
      area: String(row.controlCategory ?? "Secure Score"), count: null, tip: humanize(row.userImpact) ? `User impact: ${humanize(row.userImpact)}` : undefined,
      action: "Open", href: hrefWithParam(SECURE_SCORE_PATH, new URLSearchParams(), "object", String(row.id)),
    })),
  ];

  // Points still available per category: where the score can grow.
  const openByCategory = new Map<string, number>();
  for (const row of controls) {
    const category = String(row.controlCategory ?? "Other");
    openByCategory.set(category, (openByCategory.get(category) ?? 0) + Math.round(left(row)));
  }
  const gaps = sources.map((source) => source.error).filter((error): error is string => Boolean(error));

  return (
    <div className="stack ov-page">
      <OverviewHeader
        eyebrow="Defender"
        description="Secure Score, endpoints and email protection"
        fetchedAt={score.fetchedAt}
        gaps={gaps}
        loading={loading}
        onRefresh={refresh}
      />
      <KpiTiles kpis={kpis} />
      <div className="ov-split">
        <AttentionTable issues={issues} countLabel="Devices" loading={loading && controls.length === 0} />
        <ShareCard
          className="ov-health"
          title="Points available"
          base="By category"
          rows={[...openByCategory].map(([label, value]) => ({ label, count: value })).filter((row) => row.count > 0).sort((a, b) => b.count - a.count)}
        />
      </div>
      <div className="ov-shares">
        <ShareCard title="Device platforms" base={plural(deviceRows.length, "device")} rows={shareRows(deviceRows.map((row) => String(row.OSPlatform ?? "")))} />
        <ShareCard
          title="Exposure"
          base={plural(deviceRows.length, "device")}
          rows={shareRows(deviceRows.map((row) => String(row.ExposureLevel ?? "")), 4, (label) => label === "High")}
        />
        <ShareCard
          title="Endpoint security policies"
          base={plural(endpointPolicies.items.length, "policy", "policies")}
          rows={shareRows(endpointPolicies.items.map((row) => humanize(asRecord(row.templateReference).templateFamily).replace(/^Endpoint security /i, "")))}
        />
      </div>
    </div>
  );
}
