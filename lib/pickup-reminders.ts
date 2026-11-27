/**
 * Pickup reminders + final notice (Hayk 2026-11-26 pickup policy).
 *
 * Orders waiting in a pickup column (Pickups / Not Picked Up) that haven't
 * been picked up get:
 *   - a reminder on day 3, 7 and 14 (only the latest one due — a card that is
 *     already 10 days in gets the day-7 one, never 3 and 7 back to back)
 *   - a final notice on day 30: "we hold it until <date>, then it's recycled"
 *   - 30 days after the final notice: no message — the card is flagged
 *     "OK to recycle" in its history so staff can toss it.
 * Nothing is deleted or moved automatically.
 */

export const PICKUP_REMINDER_DAYS = [3, 7, 14] as const;
export const PICKUP_FINAL_NOTICE_DAY = 30;
export const PICKUP_HOLD_DAYS_AFTER_NOTICE = 30;

/** Stored on `orders.specs.pickup_reminders`. */
export type PickupReminderState = {
  /** Start of the stay in the pickup columns these reminders belong to. */
  ready_since?: string;
  sent_days?: number[];
  final_notice_at?: string;
  hold_until?: string;
  recycle_ok_at?: string;
};

export type PickupReminderStep =
  | { kind: "reminder"; day: number }
  | { kind: "final"; holdUntil: Date }
  | { kind: "recycle" };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Board columns where a finished order waits for the customer. */
export function isPickupColumnName(name: string | null | undefined): boolean {
  return /pick(?:ed)?\s*-?\s*up/i.test(name ?? "");
}

export function readPickupReminderState(
  specs: Record<string, unknown> | null | undefined
): PickupReminderState {
  const raw = specs?.pickup_reminders;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as PickupReminderState;
}

/**
 * State for the current stay. A card that left the pickup columns and came
 * back later starts over (old reminders belonged to the earlier stay).
 */
export function stateForStay(
  state: PickupReminderState,
  readySince: Date
): PickupReminderState {
  if (state.ready_since && new Date(state.ready_since).getTime() === readySince.getTime()) {
    return state;
  }
  return { ready_since: readySince.toISOString() };
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/** What (if anything) is due for this order today. */
export function pickupReminderStep(
  readySince: Date,
  state: PickupReminderState,
  now: Date
): PickupReminderStep | null {
  if (state.recycle_ok_at) return null;
  if (state.final_notice_at) {
    const holdUntil = state.hold_until
      ? new Date(state.hold_until)
      : new Date(new Date(state.final_notice_at).getTime() + PICKUP_HOLD_DAYS_AFTER_NOTICE * DAY_MS);
    return now.getTime() >= holdUntil.getTime() ? { kind: "recycle" } : null;
  }
  const days = daysBetween(readySince, now);
  if (days >= PICKUP_FINAL_NOTICE_DAY) {
    return {
      kind: "final",
      holdUntil: new Date(now.getTime() + PICKUP_HOLD_DAYS_AFTER_NOTICE * DAY_MS),
    };
  }
  const sent = new Set(state.sent_days ?? []);
  const highestSent = Math.max(0, ...sent);
  const due = [...PICKUP_REMINDER_DAYS].filter((d) => d <= days && d > highestSent);
  if (due.length === 0) return null;
  return { kind: "reminder", day: due[due.length - 1]! };
}

/** State to save after a step was handled. */
export function nextPickupReminderState(
  state: PickupReminderState,
  step: PickupReminderStep,
  now: Date
): PickupReminderState {
  if (step.kind === "reminder") {
    return { ...state, sent_days: [...(state.sent_days ?? []), step.day] };
  }
  if (step.kind === "final") {
    return {
      ...state,
      final_notice_at: now.toISOString(),
      hold_until: step.holdUntil.toISOString(),
    };
  }
  return { ...state, recycle_ok_at: now.toISOString() };
}

/**
 * Start of the order's current stay in the pickup columns, from its "moved"
 * history (oldest first). Falls back to `fallback` (last_moved_at).
 */
export function pickupReadySince(
  moves: { created_at: string; to: string | null; from: string | null }[],
  pickupColumnIds: Set<string>,
  fallback: Date | null
): Date | null {
  let since: Date | null = null;
  for (const m of moves) {
    const intoPickup = m.to ? pickupColumnIds.has(m.to) : false;
    const fromPickup = m.from ? pickupColumnIds.has(m.from) : false;
    if (intoPickup && !fromPickup) since = new Date(m.created_at);
    if (!intoPickup) since = null;
  }
  return since ?? fallback;
}

export function formatHoldDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

type MessageArgs = {
  tenantName: string;
  orderNumber: string;
  pickupLocation: string;
  pickupHours: string;
  pickupCode: string | null;
};

function tail(args: MessageArgs): string {
  return [
    args.pickupLocation ? `Pickup at ${args.pickupLocation}.` : "",
    args.pickupHours ? args.pickupHours.replace(/\.?$/, ".") : "",
    args.pickupCode ? `Pickup code: ${args.pickupCode}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function pickupReminderMessage(
  step: PickupReminderStep,
  args: MessageArgs
): { subject: string; text: string } | null {
  const shop = args.tenantName.trim() || "Our shop";
  if (step.kind === "reminder") {
    return {
      subject: `Reminder: order ${args.orderNumber} is ready for pickup`,
      text: `Hi, this is ${shop}. Friendly reminder: your order ${args.orderNumber} is ready and waiting for you. ${tail(args)} Need it shipped instead? Just reply to this message.`,
    };
  }
  if (step.kind === "final") {
    return {
      subject: `Final notice: order ${args.orderNumber} is waiting for pickup`,
      text: `Hi, this is ${shop}. Your order ${args.orderNumber} has been ready for pickup for 30 days. We'll hold it until ${formatHoldDate(step.holdUntil)}. After that it will be recycled and can't be refunded. ${tail(args)} Need it shipped instead? Just reply to this message.`,
    };
  }
  return null;
}
