/**
 * SMS the customer when a card enters a Finished / Fulfilled column.
 * Review columns include a Google review link; no-review columns do not.
 */
import "server-only";

import { formatShortOrderNumber } from "@/lib/board-order-filters";
import { loadOrderExportData } from "@/lib/button-automation-order-data";
import { getMessageTemplates } from "@/lib/message-templates.server";
import { renderMessageTemplate } from "@/lib/message-templates";
import {
  FINISHED_CUSTOMER_SMS_SPEC_KEY,
  finishedCustomerSmsKind,
  isFinishedNoReviewStage,
  type FinishedCustomerSmsKind,
} from "@/lib/net-terms-fulfill";
import { insertOrderSmsMessage } from "@/lib/order-sms";
import { sendSms } from "@/lib/sms";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Order } from "@/lib/types";

export { FINISHED_CUSTOMER_SMS_SPEC_KEY };

export const DEFAULT_GOOGLE_REVIEW_URL =
  "https://g.page/r/CX6v8SiBU70cEBM/review";

export function preserveFinishedCustomerSms(
  existing: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  const prev = existing[FINISHED_CUSTOMER_SMS_SPEC_KEY];
  if (
    prev == null ||
    Object.prototype.hasOwnProperty.call(next, FINISHED_CUSTOMER_SMS_SPEC_KEY)
  ) {
    return next;
  }
  return { ...next, [FINISHED_CUSTOMER_SMS_SPEC_KEY]: prev };
}

function alreadySent(specs: Record<string, unknown> | null | undefined): boolean {
  const raw = specs?.[FINISHED_CUSTOMER_SMS_SPEC_KEY];
  if (!raw || typeof raw !== "object") return false;
  return typeof (raw as { sent_at?: unknown }).sent_at === "string";
}

export async function markFinishedCompletionSmsSkipped(
  order: Order
): Promise<void> {
  const specs = (order.specs ?? {}) as Record<string, unknown>;
  if (alreadySent(specs)) return;

  const admin = createAdminClient();
  await admin
    .from("orders")
    .update({
      specs: {
        ...specs,
        [FINISHED_CUSTOMER_SMS_SPEC_KEY]: {
          kind: "no_review",
          skipped: true,
          skipped_at: new Date().toISOString(),
        },
      },
    })
    .eq("id", order.id)
    .eq("tenant_id", order.tenant_id);
}

export async function notifyCustomerOrderFinished(
  order: Order,
  columnName: string,
  opts?: { confirmed?: boolean }
): Promise<void> {
  const kind = finishedCustomerSmsKind(columnName);
  if (!kind) return;
  // No-review / "not review" completion SMS is opt-in from the board popup.
  if (isFinishedNoReviewStage(columnName) && opts?.confirmed !== true) {
    return;
  }

  const specs = (order.specs ?? {}) as Record<string, unknown>;
  if (alreadySent(specs)) return;

  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", order.tenant_id)
    .maybeSingle();
  const tenantName =
    (typeof tenant?.name === "string" && tenant.name.trim()) || "Bazaar Printing";

  const data = await loadOrderExportData(
    admin,
    order.id,
    order.tenant_id,
    tenantName
  );
  const phone = data?.customerPhone?.trim() || "";
  if (!phone) {
    console.info(
      `[finished-sms] skip ${order.id}: no customer phone for "${columnName}"`
    );
    return;
  }

  const templates = await getMessageTemplates(admin, order.tenant_id);
  const orderNumber = formatShortOrderNumber(order.title);
  const customerName =
    data?.customerName && data.customerName !== "—"
      ? data.customerName
      : "there";
  const body = renderFinishedSms(kind, templates, {
    customer_name: customerName,
    order_number: orderNumber,
    review_link: DEFAULT_GOOGLE_REVIEW_URL,
    brand: "Bazaar Printing",
    team_name: `${tenantName} Team`,
  });

  const result = await sendSms({ to: phone, body });
  if (!result.sent) {
    console.error(
      `[finished-sms] Twilio failed for ${order.id}:`,
      result.error ?? "unknown"
    );
    return;
  }

  await insertOrderSmsMessage(admin, {
    tenantId: order.tenant_id,
    orderId: order.id,
    direction: "outbound",
    phone,
    body,
    twilioSid: result.sid ?? null,
  });

  await admin
    .from("orders")
    .update({
      specs: {
        ...specs,
        [FINISHED_CUSTOMER_SMS_SPEC_KEY]: {
          kind,
          column: columnName,
          sent_at: new Date().toISOString(),
        },
      },
    })
    .eq("id", order.id)
    .eq("tenant_id", order.tenant_id);
}

function renderFinishedSms(
  kind: FinishedCustomerSmsKind,
  templates: Awaited<ReturnType<typeof getMessageTemplates>>,
  vars: Record<string, string>
): string {
  const template =
    kind === "review"
      ? templates.finished_review_sms
      : templates.finished_no_review_sms;
  return renderMessageTemplate(template, vars).trim();
}
