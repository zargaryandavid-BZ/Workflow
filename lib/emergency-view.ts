/**
 * Emergency / Urgency view — rule engine.
 *
 * Rules come from tenant Emergency Balance settings (`by_column[columnId]`).
 * Empty conditions = no column-specific warning. Optional global late flag
 * still marks past-due cards.
 */

import {
  DEFAULT_EMERGENCY_BALANCE,
  type EmergencyBalanceConfig,
  type EmergencyCondition,
  type EmergencyConditionSeverity,
} from "@/lib/emergency-balance";

/** amber = heads-up · red = emergency · critical = "extra emergency" (worst). */
export type EmergencySeverity = "amber" | "red" | "critical";

const SEVERITY_RANK: Record<EmergencySeverity, number> = {
  amber: 1,
  red: 2,
  critical: 3,
};

export const EMERGENCY_SEVERITY_BORDER: Record<EmergencySeverity, string> = {
  amber: "#f59e0b",
  red: "#ef4444",
  critical: "#b91c1c",
};

export const EMERGENCY_SEVERITY_LABEL: Record<EmergencySeverity, string> = {
  amber: "Heads-up",
  red: "Emergency",
  critical: "Critical",
};

export interface EmergencyInput {
  /** Board column id — looks up rules in config.by_column. */
  columnId: string;
  /** Display / reason text. */
  columnName: string;
  hoursHere: number | null;
  workingDaysHere: number | null;
  daysToDue: number | null;
  isRush: boolean;
  hasApplication: boolean;
  priorityScore: number | null;
  isKeyAccount: boolean;
}

export interface EmergencyResult {
  severity: EmergencySeverity | null;
  reasons: string[];
}

const isLate = (d: number | null): boolean => d != null && d < 0;
const isDueToday = (d: number | null): boolean => d === 0;
const dueWithin = (d: number | null, n: number): boolean => d != null && d <= n;
const turnaround = (d: number | null, n: number): boolean => d === n;
const turnaroundUnder1 = (d: number | null): boolean => d != null && d <= 0;
const hrs = (h: number | null): number => (h == null ? 0 : h);
const wdays = (d: number | null): number => (d == null ? 0 : d);

class Trigger {
  private best: EmergencySeverity | null = null;
  readonly reasons: string[] = [];

  add(severity: EmergencySeverity, reason: string): void {
    this.reasons.unshift(reason);
    if (!this.best || SEVERITY_RANK[severity] > SEVERITY_RANK[this.best]) {
      this.best = severity;
    }
  }

  get severity(): EmergencySeverity | null {
    return this.best;
  }
}

function applyDueOverlay(
  t: Trigger,
  i: EmergencyInput,
  cfg: EmergencyBalanceConfig
): void {
  if (isLate(i.daysToDue)) t.add("red", "Past due");
  else if (isDueToday(i.daysToDue)) t.add("red", "Due today");
  else if (turnaround(i.daysToDue, 1)) t.add("red", "Due in 1 day");
  else if (dueWithin(i.daysToDue, cfg.due_overlay_amber_tight_days))
    t.add("amber", `Due in ${cfg.due_overlay_amber_tight_days} days`);
  else if (dueWithin(i.daysToDue, cfg.due_overlay_amber_days))
    t.add("amber", `Due within ${cfg.due_overlay_amber_days} days`);
}

function resolveSeverity(
  sev: EmergencyConditionSeverity,
  t: Trigger,
  i: EmergencyInput,
  cfg: EmergencyBalanceConfig,
  reason: string
): void {
  if (sev === "due_overlay") {
    applyDueOverlay(t, i, cfg);
    return;
  }
  t.add(sev, reason);
}

function applyCondition(
  t: Trigger,
  i: EmergencyInput,
  c: EmergencyCondition,
  cfg: EmergencyBalanceConfig
): void {
  switch (c.kind) {
    case "idle_hours": {
      if (hrs(i.hoursHere) > c.value) {
        resolveSeverity(
          c.severity,
          t,
          i,
          cfg,
          `Sitting ${hrs(i.hoursHere)}h in ${i.columnName}`
        );
      }
      break;
    }
    case "idle_working_days": {
      if (wdays(i.workingDaysHere) > c.value) {
        resolveSeverity(
          c.severity,
          t,
          i,
          cfg,
          `${wdays(i.workingDaysHere)}d in ${i.columnName}`
        );
      }
      break;
    }
    case "due_within_days": {
      if (dueWithin(i.daysToDue, c.value)) {
        resolveSeverity(
          c.severity,
          t,
          i,
          cfg,
          `Due within ${c.value} days`
        );
      }
      break;
    }
    case "due_within_and_idle_hours": {
      if (dueWithin(i.daysToDue, c.value) && hrs(i.hoursHere) > (c.value2 ?? 0)) {
        resolveSeverity(c.severity, t, i, cfg, "Due soon & idle in column");
      }
      break;
    }
    case "rush_or_due_and_idle_hours": {
      if (
        (i.isRush || dueWithin(i.daysToDue, c.value)) &&
        hrs(i.hoursHere) > (c.value2 ?? 0)
      ) {
        resolveSeverity(
          c.severity,
          t,
          i,
          cfg,
          "Urgent job stalled in column"
        );
      }
      break;
    }
    case "rush_and_idle_hours": {
      if (i.isRush && hrs(i.hoursHere) > c.value) {
        resolveSeverity(c.severity, t, i, cfg, "Rush job stalled");
      }
      break;
    }
    case "turnaround_days_and_idle_hours": {
      if (
        turnaround(i.daysToDue, c.value) &&
        hrs(i.hoursHere) > (c.value2 ?? 0)
      ) {
        resolveSeverity(
          c.severity,
          t,
          i,
          cfg,
          `${c.value}-day job stalled`
        );
      }
      break;
    }
    case "application_and_due_within": {
      if (i.hasApplication && dueWithin(i.daysToDue, c.value)) {
        resolveSeverity(
          c.severity,
          t,
          i,
          cfg,
          "Combo (application) due soon"
        );
      }
      break;
    }
    case "turnaround_under_1_day": {
      if (turnaroundUnder1(i.daysToDue)) {
        resolveSeverity(
          c.severity,
          t,
          i,
          cfg,
          "Sub-1-day turnaround"
        );
      }
      break;
    }
    case "late_or_due_within_days": {
      if (isLate(i.daysToDue) || dueWithin(i.daysToDue, c.value)) {
        resolveSeverity(c.severity, t, i, cfg, "Due soon or late");
      }
      break;
    }
  }
}

export function evaluateEmergency(
  input: EmergencyInput,
  config: EmergencyBalanceConfig = DEFAULT_EMERGENCY_BALANCE
): EmergencyResult {
  const t = new Trigger();
  const conditions = config.by_column[input.columnId] ?? [];

  for (const c of conditions) {
    applyCondition(t, input, c, config);
  }

  if (
    config.flag_late_always &&
    isLate(input.daysToDue) &&
    !t.reasons.some((r) => /past due/i.test(r))
  ) {
    t.add("red", "Past due");
  }

  let severity = t.severity;
  const reasons = [...t.reasons];

  if (severity && input.isKeyAccount) {
    severity = severity === "amber" ? "red" : "critical";
    reasons.unshift("Key account");
  }

  return { severity, reasons };
}

/* --------------------------- top quick-filters ----------------------------- */

export type EmergencyQuickFilter =
  | "one_day_left"
  | "due_today"
  | "late"
  | "combo_at_risk";

export interface QuickFilterInput {
  daysToDue: number | null;
  hasApplication: boolean;
  beforeApplicationStage: boolean;
}

export function matchesQuickFilter(
  filter: EmergencyQuickFilter,
  i: QuickFilterInput,
  config: EmergencyBalanceConfig = DEFAULT_EMERGENCY_BALANCE
): boolean {
  switch (filter) {
    case "one_day_left":
      return turnaround(i.daysToDue, 1);
    case "due_today":
      return isDueToday(i.daysToDue);
    case "late":
      return isLate(i.daysToDue);
    case "combo_at_risk":
      return (
        i.hasApplication &&
        dueWithin(i.daysToDue, config.combo_at_risk_due_days) &&
        i.beforeApplicationStage
      );
  }
}

export function quickFilterMeta(
  config: EmergencyBalanceConfig = DEFAULT_EMERGENCY_BALANCE
): Record<EmergencyQuickFilter, { label: string; description: string }> {
  return {
    one_day_left: { label: "1 day left", description: "Due in exactly one day" },
    due_today: { label: "Due today", description: "Due on today's date" },
    late: { label: "Late", description: "Past the due date" },
    combo_at_risk: {
      label: "Combo at risk",
      description: `Needs application, due ≤ ${config.combo_at_risk_due_days} days, not yet in the application stage`,
    },
  };
}

export const QUICK_FILTER_META = quickFilterMeta();
