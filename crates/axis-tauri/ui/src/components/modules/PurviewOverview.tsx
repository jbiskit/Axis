import { useInventory } from "../../hooks/useInventory";
import { AttentionTable, count, KpiTiles, OverviewHeader, pct, plural, ShareCard, shareRows, type Issue, type Kpi } from "../overview/OverviewParts";
import { asRecord, humanize, loaderFor, type ReviewRow } from "./ReviewWorkbench";

const SENSITIVITY_PATH = "/purview/information-protection/sensitivity-labels";
const RETENTION_PATH = "/purview/data-lifecycle/retention-labels";

const actionTypes = (row: ReviewRow) =>
  (Array.isArray(row.LabelActions) ? row.LabelActions.map(asRecord) : []).map((action) => String(action.Type ?? "").toLowerCase());
const encrypts = (row: ReviewRow) => actionTypes(row).includes("encrypt");
const isRecord = (row: ReviewRow) => /record/i.test(String(row.behaviorDuringRetentionPeriod ?? ""));

export function PurviewOverview({ signedIn }: { signedIn: boolean }) {
  const sensitivity = useInventory(loaderFor("purview:label"), signedIn, signedIn);
  const retention = useInventory(loaderFor("retentionLabel"), signedIn, signedIn);
  const sources = [sensitivity, retention];
  const loading = sources.some((source) => source.loading);
  const refresh = () => sources.forEach((source) => void source.reload());

  const labels = sensitivity.items.filter((row) => !row.IsLabelGroup);
  const groups = sensitivity.items.length - labels.length;
  const encrypting = labels.filter(encrypts).length;
  const off = labels.filter((row) => row.Disabled).length;
  const records = retention.items.filter(isRecord).length;
  const deleting = retention.items.filter((row) => /delete/i.test(String(row.actionAfterRetentionPeriod ?? ""))).length;
  const blocked = sensitivity.error ?? "";
  const refused = /not allowed|403|forbidden/i.test(blocked);

  const kpis: Kpi[] = [
    {
      label: "Sensitivity labels",
      base: "Information Protection",
      value: sensitivity.error ? "—" : count(labels.length),
      unit: "labels",
      fill: labels.length ? 100 - pct(off, labels.length) : 0,
      tone: sensitivity.error ? "bad" : "quiet",
      foot: `${plural(groups, "group")} · ${count(off)} off`,
      state: sensitivity.error ? (refused ? "No access" : "Error") : "",
      tip: sensitivity.error || "Every sensitivity label from Security & Compliance, label groups counted separately",
      href: SENSITIVITY_PATH,
    },
    {
      label: "Encrypting",
      base: "Labels",
      value: sensitivity.error ? "—" : count(encrypting),
      unit: `of ${count(labels.length)}`,
      fill: pct(encrypting, labels.length),
      tone: "quiet",
      foot: `${count(labels.length - encrypting)} marking or none`,
      state: "",
      tip: "Labels that apply encryption",
      href: SENSITIVITY_PATH,
    },
    {
      label: "Retention labels",
      base: "Data lifecycle",
      value: retention.error ? "—" : count(retention.items.length),
      unit: "labels",
      fill: retention.items.length ? 100 : 0,
      tone: retention.error ? "bad" : "quiet",
      foot: `${plural(records, "record label")}`,
      state: retention.error ? "Error" : "",
      tip: retention.error || "Retention labels from Microsoft Graph",
      href: RETENTION_PATH,
    },
    {
      label: "Records",
      base: "Retention",
      value: retention.error ? "—" : count(records),
      unit: `of ${count(retention.items.length)}`,
      fill: pct(records, retention.items.length),
      tone: "quiet",
      foot: "Declare as record",
      state: "",
      tip: "Labels that mark content as a record or regulatory record",
      href: RETENTION_PATH,
    },
    {
      label: "Auto delete",
      base: "After retention",
      value: retention.error ? "—" : count(deleting),
      unit: `of ${count(retention.items.length)}`,
      fill: pct(deleting, retention.items.length),
      tone: "quiet",
      foot: "Delete when retention ends",
      state: "",
      tip: "Labels that delete content when the retention period ends",
      href: RETENTION_PATH,
    },
  ];

  const issues: Issue[] = [
    ...(sensitivity.error ? [{
      key: "scc", tone: "bad" as const, item: "Sensitivity labels", detail: refused ? "access refused" : "could not load",
      area: "Security & Compliance", count: null, tip: sensitivity.error,
      action: "Open", href: SENSITIVITY_PATH,
    }] : []),
    ...(retention.error ? [{
      key: "retention", tone: "bad" as const, item: "Retention labels", detail: "could not load", area: "Graph", count: null,
      tip: retention.error, action: "Open", href: RETENTION_PATH,
    }] : []),
    ...(off > 0 ? [{
      key: "labels-off", tone: "warn" as const, item: "Sensitivity labels", detail: "turned off", area: "Information Protection", count: off,
      action: "Open", href: SENSITIVITY_PATH,
    }] : []),
  ];

  const scopes = labels.flatMap((row) =>
    String(row.ContentType ?? "").split(",").map((value) => value.trim()).filter((value) => value && value !== "None"),
  );

  return (
    <div className="stack ov-page">
      <OverviewHeader
        eyebrow="Purview"
        description="Sensitivity and retention labels"
        fetchedAt={retention.fetchedAt ?? sensitivity.fetchedAt}
        gaps={sources.map((source) => source.error).filter((error): error is string => Boolean(error))}
        loading={loading}
        onRefresh={refresh}
      />
      <KpiTiles kpis={kpis} />
      <div className="ov-split">
        <AttentionTable issues={issues} countLabel="Labels" loading={loading && !sensitivity.fetchedAt && !retention.fetchedAt} />
        <ShareCard className="ov-health" title="Label scope" base="Share of labels" of={labels.length} rows={shareRows(scopes, 5)} />
      </div>
      <div className="ov-shares">
        <ShareCard
          title="Label protection"
          base={plural(labels.length, "label")}
          rows={shareRows(labels.map((row) => (encrypts(row) ? "Encrypt" : actionTypes(row).length ? "Content marking" : "None")))}
        />
        <ShareCard
          title="During retention"
          base={plural(retention.items.length, "label")}
          rows={shareRows(retention.items.map((row) => humanize(row.behaviorDuringRetentionPeriod)))}
        />
        <ShareCard
          title="After retention"
          base={plural(retention.items.length, "label")}
          rows={shareRows(retention.items.map((row) => humanize(row.actionAfterRetentionPeriod)))}
        />
      </div>
    </div>
  );
}
