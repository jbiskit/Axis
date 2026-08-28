import type {
  RemediationScheduleDraft,
  RemediationScheduleKind,
} from "../types/inventory";

export function defaultRemediationSchedule(): RemediationScheduleDraft {
  return {
    kind: "daily",
    interval: 1,
    time: "08:00",
    useUtc: false,
  };
}

export function remediationScheduleKindLabel(kind: RemediationScheduleKind): string {
  switch (kind) {
    case "hourly":
      return "Hourly";
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "runOnce":
      return "Once";
    default:
      return kind;
  }
}

export function remediationScheduleIntervalLabel(
  kind: RemediationScheduleKind,
  interval: number,
): string {
  const value = Math.max(1, Math.min(23, interval));
  switch (kind) {
    case "hourly":
      return value === 1 ? "Every hour" : `Every ${value} hours`;
    case "daily":
      return value === 1 ? "Every day" : `Every ${value} days`;
    case "weekly":
      return value === 1 ? "Every week" : `Every ${value} weeks`;
    case "monthly":
      return value === 1 ? "Every month" : `Every ${value} months`;
    case "runOnce":
      return "Once";
    default:
      return `Every ${value}`;
  }
}

export function summarizeRemediationSchedule(
  schedule: RemediationScheduleDraft | null | undefined,
  runRemediationScript?: boolean | null,
): string | null {
  if (!schedule) return null;
  const parts = [remediationScheduleIntervalLabel(schedule.kind, schedule.interval)];
  if (schedule.kind !== "hourly" && schedule.time) {
    parts.push(`at ${schedule.time}`);
  }
  if (schedule.kind === "runOnce" && schedule.date) {
    parts.push(`on ${schedule.date}`);
  }
  if (schedule.useUtc) {
    parts.push("UTC");
  } else if (schedule.kind !== "hourly") {
    parts.push("local time");
  }
  if (runRemediationScript === false) {
    parts.push("detection only");
  }
  return parts.join(" · ");
}

export function scheduleFromGraphAssignment(row: Record<string, unknown>): {
  runRemediationScript?: boolean;
  runSchedule?: RemediationScheduleDraft;
} {
  const runRemediationScript =
    typeof row.runRemediationScript === "boolean"
      ? row.runRemediationScript
      : undefined;
  const raw = row.runSchedule;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { runRemediationScript };
  }
  const schedule = raw as Record<string, unknown>;
  const odata = String(schedule["@odata.type"] ?? "");
  let kind: RemediationScheduleKind | null = null;
  if (odata.includes("HourlySchedule")) kind = "hourly";
  else if (odata.includes("DailySchedule")) kind = "daily";
  else if (odata.includes("WeeklySchedule")) kind = "weekly";
  else if (odata.includes("MonthlySchedule")) kind = "monthly";
  else if (odata.includes("RunOnceSchedule")) kind = "runOnce";
  if (!kind) return { runRemediationScript };

  const interval =
    typeof schedule.interval === "number" ? schedule.interval : 1;
  const time =
    typeof schedule.time === "string" ? normalizeTimeForUi(schedule.time) : null;
  const useUtc =
    typeof schedule.useUtc === "boolean" ? schedule.useUtc : undefined;
  const date = typeof schedule.date === "string" ? schedule.date : null;

  return {
    runRemediationScript,
    runSchedule: {
      kind,
      interval,
      time,
      useUtc,
      date,
    },
  };
}

function normalizeTimeForUi(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 5 && trimmed[2] === ":") {
    return trimmed.slice(0, 5);
  }
  return trimmed;
}
