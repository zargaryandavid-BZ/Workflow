/**
 * Emergency / Urgency view — rule engine.
 *
 * Rafael runs ~300 jobs on the board; things slip. The Emergency view filters +
 * highlights ONLY the jobs that are crucial to notice right now, by per-column
 * time-in-column + due-date + rush/turnaround/application rules, and always
 * elevates flagged key accounts.
 *
 * Every threshold below is grounded in a REAL field:
 *   - time in column  → `order.last_moved_at`  (hoursInCurrentColumn / daysInCurrentColumn)
 *   - due date        → `order.due_date`        (calendarDaysUntilDue; negative = late)
 *   - "turnaround"    → the due date itself     (Hayk: 1-day turnaround = due in 1 day, 2-day = due in 2)
 *   - rush            → the "Rush Order" tag     (order.tag)
 *   - application     → `specs.application` / "Application" custom field (combo jobs)
 *   - key account     → CRM customer flag        (companion piece, surfaced to the board)
 *
 * This module is PURE: the board computes a normalized `EmergencyInput` per card
 * from those fields and calls `evaluateEmergency`. Keeping it field-free makes it
 * unit-testable and independent of custom-field plumbing.
 *
 * Spec: knowledge/workflow-urgency-view-spec-2026-08-11.md
 */

import { stageKey } from "@/lib/stage-groups";

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
  /** Raw column/stage name (normalized internally via stageKey). */
  columnName: string;
  /** Wall-clock hours since the card last changed columns (last_moved_at). */
  hoursHere: number | null;
  /** Working days since the card last changed columns. */
  workingDaysHere: number | null;
  /** Calendar days until due (negative = late, 0 = due today). null = no due date. */
  daysToDue: number | null;
  /** The "Rush Order" tag is attached. */
  isRush: boolean;
  /** Application/combo job (needs an application step). */
  hasApplication: boolean;
  /** Board priority score 1–5 (5 = top/red). */
  priorityScore: number | null;
  /** Customer is a flagged key account in the CRM. */
  isKeyAccount: boolean;
}

export interface EmergencyResult {
  /** null = not an emergency (hidden when the Emergency filter is on). */
  severity: EmergencySeverity | null;
  /** Human-readable reasons, worst first. */
  reasons: string[];
}

/* ----------------------------- due-date helpers ---------------------------- */

const isLate = (d: number | null): boolean => d != null && d < 0;
const isDueToday = (d: number | null): boolean => d === 0;
/** due within the next `n` calendar days (includes today and late). */
const dueWithin = (d: number | null, n: number): boolean => d != null && d <= n;
/** exactly an `n`-day turnaround (due in exactly n days). */
const turnaround = (d: number | null, n: number): boolean => d === n;
/** sub-1-day turnaround: due today or already late. */
const turnaroundUnder1 = (d: number | null): boolean => d != null && d <= 0;

const hrs = (h: number | null): number => (h == null ? 0 : h);
const wdays = (d: number | null): number => (d == null ? 0 : d);

/* ------------------------------ rule builder ------------------------------- */

class Trigger {
  private best: EmergencySeverity | null = null;
  readonly reasons: string[] = [];

  add(severity: EmergencySeverity, reason: string): void {
    this.reasons.unshift(reason); // worst tends to be added last; keep it first
    if (!this.best || SEVERITY_RANK[severity] > SEVERITY_RANK[this.best]) {
      this.best = severity;
    }
  }

  get severity(): EmergencySeverity | null {
    return this.best;
  }
}

/**
 * The shared due-date overlay applied to most columns:
 *   late → red · due today / 1-day turnaround → red · due < 3 days → amber.
 * Columns opt in via `dueOverlay` so the table stays declarative.
 */
function applyDueOverlay(t: Trigger, i: EmergencyInput): void {
  if (isLate(i.daysToDue)) t.add("red", "Past due");
  else if (isDueToday(i.daysToDue)) t.add("red", "Due today");
  else if (turnaround(i.daysToDue, 1)) t.add("red", "Due in 1 day");
  else if (dueWithin(i.daysToDue, 2)) t.add("amber", "Due in 2 days");
  else if (dueWithin(i.daysToDue, 3)) t.add("amber", "Due within 3 days");
}

/**
 * Per-column rule table. Each entry mutates the Trigger for its stage.
 * Keyed by stageKey(name) so it's robust to case/spacing/punctuation.
 */
const COLUMN_RULES: Record<string, (t: Trigger, i: EmergencyInput) => void> = {
  // Start (Created): >5h amber; >20h critical. Also due < 3 days.
  [stageKey("Start")]: (t, i) => {
    if (hrs(i.hoursHere) > 20) t.add("critical", `Sitting ${hrs(i.hoursHere)}h at Start`);
    else if (hrs(i.hoursHere) > 5) t.add("amber", `${hrs(i.hoursHere)}h at Start`);
    if (dueWithin(i.daysToDue, 3)) applyDueOverlay(t, i);
  },

  // In Progress: same as Start (>5h/>20h; due<3d) PLUS flag if >10h.
  [stageKey("In Progress")]: (t, i) => {
    if (hrs(i.hoursHere) > 20) t.add("critical", `Sitting ${hrs(i.hoursHere)}h in In Progress`);
    else if (hrs(i.hoursHere) > 10) t.add("red", `${hrs(i.hoursHere)}h in In Progress`);
    else if (hrs(i.hoursHere) > 5) t.add("amber", `${hrs(i.hoursHere)}h in In Progress`);
    if (dueWithin(i.daysToDue, 3)) applyDueOverlay(t, i);
  },

  // Hold: > 24h in column.
  [stageKey("Hold")]: (t, i) => {
    if (hrs(i.hoursHere) > 24) t.add("amber", `On Hold ${hrs(i.hoursHere)}h`);
  },

  // Missing Info: > 48h. ALSO due < 2 days AND > 5h → flag.
  [stageKey("Missing Info / Changes")]: (t, i) => {
    if (hrs(i.hoursHere) > 48) t.add("red", `Missing info ${hrs(i.hoursHere)}h`);
    if (dueWithin(i.daysToDue, 2) && hrs(i.hoursHere) > 5)
      t.add("red", "Missing info & due soon");
  },

  // Customer Replied: > 1h → flag (needs immediate pickup).
  [stageKey("Customer Replied")]: (t, i) => {
    if (hrs(i.hoursHere) > 1) t.add("red", `Customer replied ${hrs(i.hoursHere)}h ago`);
  },

  // Waiting Approval: > 24h. ALSO (rush OR due < 2 days) AND > 2h → red.
  [stageKey("Waiting Approval")]: (t, i) => {
    if (hrs(i.hoursHere) > 24) t.add("amber", `Awaiting approval ${hrs(i.hoursHere)}h`);
    if ((i.isRush || dueWithin(i.daysToDue, 2)) && hrs(i.hoursHere) > 2)
      t.add("red", "Approval stalled on an urgent job");
  },

  // Done (Ready for Prod): > 1h → red (should move to production fast).
  [stageKey("Done (Ready for Prod)")]: (t, i) => {
    if (hrs(i.hoursHere) > 1) t.add("red", `Ready for prod, idle ${hrs(i.hoursHere)}h`);
  },

  // Arsen: > 1h → red.
  [stageKey("Arsen")]: (t, i) => {
    if (hrs(i.hoursHere) > 1) t.add("red", `At Arsen ${hrs(i.hoursHere)}h`);
  },

  // Hrach: > 20h → red. ALSO rush & >8h; OR 1-day turnaround & >1h; OR 2-day & >3h.
  [stageKey("Hrach")]: (t, i) => {
    if (hrs(i.hoursHere) > 20) t.add("red", `At Hrach ${hrs(i.hoursHere)}h`);
    if (i.isRush && hrs(i.hoursHere) > 8) t.add("red", "Rush job stalled at Hrach");
    if (turnaround(i.daysToDue, 1) && hrs(i.hoursHere) > 1)
      t.add("red", "1-day job stalled at Hrach");
    if (turnaround(i.daysToDue, 2) && hrs(i.hoursHere) > 3)
      t.add("red", "2-day job stalled at Hrach");
  },

  // Apparel: 1 day left OR due today OR late.
  [stageKey("Apparel")]: (t, i) => {
    if (isLate(i.daysToDue) || isDueToday(i.daysToDue) || turnaround(i.daysToDue, 1))
      applyDueOverlay(t, i);
  },

  // Apparel In Production: same as Apparel.
  [stageKey("Apparel In Production")]: (t, i) => {
    if (isLate(i.daysToDue) || isDueToday(i.daysToDue) || turnaround(i.daysToDue, 1))
      applyDueOverlay(t, i);
  },

  // In Production: application & due<2d → red; turnaround<1d → red; <2d turnaround → amber; >4 days in col.
  [stageKey("In Production")]: (t, i) => {
    if (i.hasApplication && dueWithin(i.daysToDue, 2))
      t.add("red", "Combo (application) due soon in production");
    if (turnaroundUnder1(i.daysToDue)) t.add("red", "Sub-1-day turnaround in production");
    else if (dueWithin(i.daysToDue, 2)) t.add("amber", "2-day turnaround in production");
    if (wdays(i.workingDaysHere) > 4) t.add("amber", `${wdays(i.workingDaysHere)}d in production`);
  },

  // Outsource: similar to In Production.
  [stageKey("Outsource")]: (t, i) => {
    if (i.hasApplication && dueWithin(i.daysToDue, 2))
      t.add("red", "Combo (application) due soon at outsource");
    if (turnaroundUnder1(i.daysToDue)) t.add("red", "Sub-1-day turnaround at outsource");
    else if (dueWithin(i.daysToDue, 2)) t.add("amber", "2-day turnaround at outsource");
    if (wdays(i.workingDaysHere) > 4) t.add("amber", `${wdays(i.workingDaysHere)}d at outsource`);
  },

  // Production Completed: > 2h in this stage.
  [stageKey("Production Completed")]: (t, i) => {
    if (hrs(i.hoursHere) > 2) t.add("red", `Completed but idle ${hrs(i.hoursHere)}h`);
  },

  // Apparel Prod. Completed: same (>2h).
  [stageKey("Apparel Prod. Completed")]: (t, i) => {
    if (hrs(i.hoursHere) > 2) t.add("red", `Completed but idle ${hrs(i.hoursHere)}h`);
  },

  // Shipped Boyd & Boyd Received: can't sit > 2h.
  [stageKey("Shipped Boyd")]: (t, i) => {
    if (hrs(i.hoursHere) > 2) t.add("red", `At Boyd handoff ${hrs(i.hoursHere)}h`);
  },
  [stageKey("Boyd Received")]: (t, i) => {
    if (hrs(i.hoursHere) > 2) t.add("red", `Boyd received, idle ${hrs(i.hoursHere)}h`);
  },

  // In the application: > 2 (working) days; plus the usual late/urgent due flags.
  [stageKey("In the application")]: (t, i) => {
    if (wdays(i.workingDaysHere) > 2) t.add("amber", `${wdays(i.workingDaysHere)}d in application`);
    if (dueWithin(i.daysToDue, 2)) applyDueOverlay(t, i);
  },

  // (Boyd Only) Ready to Ship: > 3 (working) days.
  [stageKey("(Boyd Only) Ready to Ship")]: (t, i) => {
    if (wdays(i.workingDaysHere) > 3) t.add("amber", `Ready to ship ${wdays(i.workingDaysHere)}d`);
  },

  // Shipping: > 3h.
  [stageKey("Shipping")]: (t, i) => {
    if (hrs(i.hoursHere) > 3) t.add("red", `In shipping ${hrs(i.hoursHere)}h`);
  },
};

/**
 * Evaluate one card. Returns the worst severity triggered + reasons, or
 * `{severity: null}` when the card is not an emergency.
 *
 * Key accounts elevate: if a rule already fired, a flagged key account bumps the
 * severity one tier (amber→red→critical) and is noted. Key accounts with no
 * trigger are NOT forced red here — the board surfaces them via its own toggle so
 * the emergency list doesn't flood with quiet VIP jobs.
 */
export function evaluateEmergency(input: EmergencyInput): EmergencyResult {
  const t = new Trigger();
  const rule = COLUMN_RULES[stageKey(input.columnName)];
  if (rule) rule(t, input);

  // Cross-column safety net: anything genuinely late is at least red, even in a
  // stage without an explicit due rule.
  if (isLate(input.daysToDue) && !t.reasons.some((r) => /past due/i.test(r))) {
    t.add("red", "Past due");
  }

  let severity = t.severity;
  const reasons = [...t.reasons];

  if (severity && input.isKeyAccount) {
    severity = bumpSeverity(severity);
    reasons.unshift("Key account");
  }

  return { severity, reasons };
}

function bumpSeverity(s: EmergencySeverity): EmergencySeverity {
  if (s === "amber") return "red";
  return "critical";
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
  /** True when the card is NOT yet in the "In the application" stage. */
  beforeApplicationStage: boolean;
}

/** Does a card match a given always-visible quick-filter button? */
export function matchesQuickFilter(
  filter: EmergencyQuickFilter,
  i: QuickFilterInput
): boolean {
  switch (filter) {
    case "one_day_left":
      return turnaround(i.daysToDue, 1);
    case "due_today":
      return isDueToday(i.daysToDue);
    case "late":
      return isLate(i.daysToDue);
    // Combo item that needs application AND due < 2 days AND still not in the
    // application stage → the highest-risk quick filter.
    case "combo_at_risk":
      return i.hasApplication && dueWithin(i.daysToDue, 2) && i.beforeApplicationStage;
  }
}

export const QUICK_FILTER_META: Record<
  EmergencyQuickFilter,
  { label: string; description: string }
> = {
  one_day_left: { label: "1 day left", description: "Due in exactly one day" },
  due_today: { label: "Due today", description: "Due on today's date" },
  late: { label: "Late", description: "Past the due date" },
  combo_at_risk: {
    label: "Combo at risk",
    description: "Needs application, due < 2 days, not yet in the application stage",
  },
};
