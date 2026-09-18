import { localDateString } from "@/lib/board-order-filters";
import {
  formatPendingDueChipLabel,
  holdAfterApprovalLateChip,
  readOrderDueSpecs,
} from "@/lib/due-date";
import { isWaitingApprovalColumn } from "@/lib/waiting-approval-column";

export type DueDateStatus =
  | { kind: "none"; label: string }
  | { kind: "no_date"; label: string }
  | { kind: "pending_approval"; label: string }
  | { kind: "late"; days: number; label: string; severe: boolean }
  | { kind: "today"; label: string }
  | { kind: "soon"; days: number; label: string };

/** Calendar-day difference: dueDate − today (negative = late). */
export function calendarDaysUntilDue(
  dueDate: string,
  today: string = localDateString()
): number {
  const due = dueDate.slice(0, 10);
  const a = Date.UTC(
    Number(due.slice(0, 4)),
    Number(due.slice(5, 7)) - 1,
    Number(due.slice(8, 10))
  );
  const b = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10))
  );
  return Math.round((a - b) / 86_400_000);
}

/**
 * Calendar days until due, or null when the after-approval clock has not started
 * (Waiting Approval / pending). Use this instead of calendarDaysUntilDue for
 * Late, due-today, and emergency overlays.
 */
export function effectiveDaysUntilDue(
  dueDate: string | null | undefined,
  specs: unknown,
  opts?: {
    today?: string;
    column?: { kind?: string | null; name?: string | null } | null;
    awaitingCustomerApproval?: boolean;
  }
): number | null {
  const awaiting =
    opts?.awaitingCustomerApproval ?? isWaitingApprovalColumn(opts?.column);
  if (holdAfterApprovalLateChip(dueDate, specs, awaiting)) return null;
  if (!dueDate?.trim()) return null;
  return calendarDaysUntilDue(dueDate, opts?.today);
}

/**
 * Due-date badge for cards/rows. Terminal (done) columns skip late/soon flags.
 * @param soonWithinDays — show amber "Due in N days" when 1…N days away
 * @param severeAfterDays — escalate late styling when late ≥ this many days
 */
export function dueDateStatus(
  dueDate: string | null | undefined,
  opts?: {
    inDoneColumn?: boolean;
    today?: string;
    soonWithinDays?: number;
    severeAfterDays?: number;
    /** Order specs — used for CRM after-approval relative due. */
    specs?: unknown;
    /**
     * Waiting Approval (or equivalent): after-approval dues do not count
     * Late until the customer actually approves.
     */
    awaitingCustomerApproval?: boolean;
  }
): DueDateStatus {
  const today = opts?.today ?? localDateString();
  const soonWithin = opts?.soonWithinDays ?? 3;
  const severeAfter = opts?.severeAfterDays ?? 7;
  const pendingAfterApproval = holdAfterApprovalLateChip(
    dueDate,
    opts?.specs,
    opts?.awaitingCustomerApproval
  );

  if (pendingAfterApproval) {
    return {
      kind: "pending_approval",
      label: formatPendingDueChipLabel(opts?.specs),
    };
  }

  if (!dueDate?.trim()) {
    const due = readOrderDueSpecs(opts?.specs);
    if (due.due_date_label && due.due_date_status !== "none") {
      return {
        kind: "pending_approval",
        label: formatPendingDueChipLabel(opts?.specs),
      };
    }
    return { kind: "no_date", label: "No due date" };
  }
  if (opts?.inDoneColumn) {
    return { kind: "none", label: "" };
  }

  const delta = calendarDaysUntilDue(dueDate, today);
  if (delta < 0) {
    const days = Math.abs(delta);
    return {
      kind: "late",
      days,
      severe: days >= severeAfter,
      label: days === 1 ? "Late 1 day" : `Late ${days} days`,
    };
  }
  if (delta === 0) {
    return { kind: "today", label: "Due today" };
  }
  if (delta <= soonWithin) {
    return {
      kind: "soon",
      days: delta,
      label: delta === 1 ? "Due in 1 day" : `Due in ${delta} days`,
    };
  }
  return { kind: "none", label: "" };
}

export function dueDateBadgeClass(status: DueDateStatus): string {
  switch (status.kind) {
    case "late":
      return status.severe
        ? "border-red-400 bg-red-100 text-red-800"
        : "border-red-300 bg-red-50 text-red-700";
    case "today":
      return "border-amber-300 bg-amber-50 text-amber-800";
    case "soon":
      return "border-amber-200 bg-amber-50/80 text-amber-700";
    case "pending_approval":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "no_date":
      return "border-slate-200 bg-slate-50 text-slate-500";
    default:
      return "";
  }
}
