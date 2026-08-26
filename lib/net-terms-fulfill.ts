/**
 * Net-terms invoice trigger — Workflow -> CRM.
 *
 * When an order's card enters a "Fulfilled" stage on the board, tell the CRM.
 * For Net-terms orders the CRM issues the invoice at that moment and starts the
 * Net-N clock from today (see CRM POST /api/webhook/order-fulfilled).
 *
 * No-op unless CRM_FULFILL_WEBHOOK_URL + CRM_FULFILL_SECRET are set and the card
 * carries a non-empty order number (whatever format the CRM uses today — e.g.
 * "675-1" or "ORD-2026-0298"). The CRM matches it against job_tickets.reference_code
 * and safely no-ops if there is no such order. Idempotency lives in the CRM, so
 * re-entering a fulfilled column never re-sends.
 */
import type { Order } from "@/lib/types";

/**
 * True for any terminal "fulfilled" column. Real boards name these either
 * "Fulfilled: …" or "Finished: …" (e.g. "Finished: No Review Request",
 * "Finished: Review Required"), so we match both roots. Anchored to the start
 * so mid-pipeline names like "Design Finished" never trigger.
 */
export function isFulfilledStage(columnName: string | null | undefined): boolean {
  if (!columnName) return false;
  return /fulfil/i.test(columnName) || /^\s*finished\b/i.test(columnName);
}

/** Which review variant of the fulfilled stage, if the name says so. */
export function reviewStateFromStage(columnName: string): "required" | "not_required" | null {
  // "No Review Request" / "No Review Required" / "Review Not Required" all mean no review.
  if (/no\s*review/i.test(columnName) || /not\s*required/i.test(columnName)) {
    return "not_required";
  }
  if (/review\s*required/i.test(columnName)) return "required";
  return null;
}

function orderNumberFromCard(order: Order): string {
  const raw = (order.specs as Record<string, unknown> | null | undefined)?.webhook_order_number;
  return typeof raw === "string" ? raw.trim() : "";
}

export async function notifyCrmOrderFulfilled(order: Order, columnName: string): Promise<void> {
  const url = process.env.CRM_FULFILL_WEBHOOK_URL;
  const secret = process.env.CRM_FULFILL_SECRET;
  if (!url || !secret) return;

  const orderNumber = orderNumberFromCard(order);
  if (!orderNumber) return;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-fulfill-secret": secret },
    body: JSON.stringify({
      order_number: orderNumber,
      fulfilled_at: new Date().toISOString(),
      stage: columnName,
      review_state: reviewStateFromStage(columnName),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[net-terms-fulfill] CRM responded", res.status, text.slice(0, 300));
  }
}
