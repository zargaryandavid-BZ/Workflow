import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/automation";
import { loadOrderExportData } from "@/lib/button-automation-order-data";
import { sendTransactionalEmail } from "@/lib/email";
import { messageToEmailHtml } from "@/lib/notification-messages";
import { pickupCodeFromSpecs } from "@/lib/pickup-code";
import {
  isPickupColumnName,
  nextPickupReminderState,
  pickupReadySince,
  pickupReminderMessage,
  pickupReminderStep,
  readPickupReminderState,
  stateForStay,
  type PickupReminderStep,
} from "@/lib/pickup-reminders";
import { resolvePickupNotifyFields } from "@/lib/shipping-settings";
import { sendSms } from "@/lib/sms";

/** Most customer sends per run (cron runs daily). */
const MAX_SENDS_PER_RUN = 60;

type Specs = Record<string, unknown>;
type OrderRow = {
  id: string;
  tenant_id: string;
  column_id: string;
  last_moved_at: string | null;
  created_at: string;
  specs: Specs | null;
};

export type PickupReminderResult = {
  orderId: string;
  tenantId: string;
  step: PickupReminderStep["kind"];
  day?: number;
  readySince: string;
  sent?: { email: boolean; sms: boolean };
  skipped?: string;
  error?: string;
};

function asSpecs(raw: unknown): Specs {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Specs) : {};
}

/**
 * Daily pickup reminders. `live=false` (default) only reports what would be
 * sent — no messages, no writes. Turned on with PICKUP_REMINDERS_LIVE=true.
 */
export async function runPickupReminders(
  admin: SupabaseClient,
  opts: { live: boolean; now?: Date }
): Promise<{ checked: number; results: PickupReminderResult[] }> {
  const now = opts.now ?? new Date();

  const { data: cols, error: colErr } = await admin
    .from("board_columns")
    .select("id, tenant_id, name");
  if (colErr) throw new Error(colErr.message);
  const pickupCols = (cols ?? []).filter((c) =>
    isPickupColumnName((c as { name?: string }).name)
  ) as { id: string; tenant_id: string; name: string }[];
  if (pickupCols.length === 0) return { checked: 0, results: [] };
  const pickupIds = new Set(pickupCols.map((c) => c.id));

  const { data: orderData, error: orderErr } = await admin
    .from("orders")
    .select("id, tenant_id, column_id, last_moved_at, created_at, specs")
    .in("column_id", [...pickupIds])
    .is("removed_at", null)
    .limit(1000);
  if (orderErr) throw new Error(orderErr.message);
  const orders = ((orderData ?? []) as OrderRow[]).filter(
    (o) => !asSpecs(o.specs).pickup_confirmation
  );
  if (orders.length === 0) return { checked: 0, results: [] };

  const { data: moveData } = await admin
    .from("activity_log")
    .select("order_id, created_at, metadata")
    .eq("action", "moved")
    .in("order_id", orders.map((o) => o.id))
    .order("created_at", { ascending: true })
    .limit(10000);
  const movesByOrder = new Map<string, { created_at: string; to: string | null; from: string | null }[]>();
  for (const m of (moveData ?? []) as { order_id: string; created_at: string; metadata: Specs | null }[]) {
    const meta = asSpecs(m.metadata);
    const list = movesByOrder.get(m.order_id) ?? [];
    list.push({
      created_at: m.created_at,
      to: typeof meta.to === "string" ? meta.to : null,
      from: typeof meta.from === "string" ? meta.from : null,
    });
    movesByOrder.set(m.order_id, list);
  }

  const tenantNames = new Map<string, string>();
  const { data: tenants } = await admin.from("tenants").select("id, name");
  for (const t of (tenants ?? []) as { id: string; name: string | null }[]) {
    tenantNames.set(t.id, (t.name ?? "").trim());
  }

  const results: PickupReminderResult[] = [];
  /** One message per pickup code (grouped orders share a code) per run. */
  const notifiedKeys = new Set<string>();
  let sends = 0;

  for (const order of orders) {
    const fallback = new Date(order.last_moved_at ?? order.created_at);
    const readySince = pickupReadySince(movesByOrder.get(order.id) ?? [], pickupIds, fallback);
    if (!readySince) continue;
    const specs = asSpecs(order.specs);
    const state = stateForStay(readPickupReminderState(specs), readySince);
    const step = pickupReminderStep(readySince, state, now);
    if (!step) continue;

    const result: PickupReminderResult = {
      orderId: order.id,
      tenantId: order.tenant_id,
      step: step.kind,
      ...(step.kind === "reminder" ? { day: step.day } : {}),
      readySince: readySince.toISOString(),
    };
    results.push(result);
    if (!opts.live) continue;

    try {
      if (step.kind === "recycle") {
        await saveState(admin, order, nextPickupReminderState(state, step, now));
        await logActivity(admin, {
          tenantId: order.tenant_id,
          orderId: order.id,
          actor: null,
          action: "pickup_recycle_ok",
          metadata: { holdUntil: state.hold_until, finalNoticeAt: state.final_notice_at },
        });
        continue;
      }

      const tenantName = tenantNames.get(order.tenant_id) ?? "";
      const exportData = await loadOrderExportData(admin, order.id, order.tenant_id, tenantName);
      if (!exportData) {
        result.skipped = "order not found";
        continue;
      }
      const email = exportData.customerEmail?.trim() || null;
      const phone = exportData.customerPhone?.trim() || null;
      const code = pickupCodeFromSpecs(specs);
      const key = code ? `code:${code}` : `contact:${(phone || email || order.id).toLowerCase()}:${step.kind}`;

      let sent = { email: false, sms: false };
      if (notifiedKeys.has(key)) {
        result.skipped = "same customer already notified this run (grouped order)";
      } else if (!email && !phone) {
        result.skipped = "no email or phone on file";
      } else if (sends >= MAX_SENDS_PER_RUN) {
        result.skipped = "daily send limit reached — next run";
        continue; // don't save state: retry tomorrow
      } else {
        const pickup = await resolvePickupNotifyFields(admin, order.tenant_id, null, [order.id]);
        const msg = pickupReminderMessage(step, {
          tenantName,
          orderNumber: exportData.orderNumberDisplay || exportData.orderNumber || order.id.slice(0, 8),
          pickupLocation: pickup.pickupLocation,
          pickupHours: pickup.pickupHours,
          pickupCode: code,
        });
        if (!msg) continue;
        if (email) {
          const r = await sendTransactionalEmail({
            to: email,
            subject: msg.subject,
            html: messageToEmailHtml(msg.text),
            text: msg.text,
          });
          sent.email = r.sent;
        }
        if (phone) {
          const r = await sendSms({ to: phone, body: msg.text });
          sent.sms = r.sent;
        }
        sends += 1;
        notifiedKeys.add(key);
        result.sent = sent;
        await logActivity(admin, {
          tenantId: order.tenant_id,
          orderId: order.id,
          actor: null,
          action: "customer_notified",
          metadata: {
            type: step.kind === "final" ? "pickup_final_notice" : "pickup_reminder",
            channel: sent.email && sent.sms ? "both" : sent.sms ? "sms" : "email",
            subject: msg.subject,
            messageBody: msg.text,
            smsBody: sent.sms ? msg.text : undefined,
            emailBody: sent.email ? msg.text : undefined,
            recipients: sent.email && email ? [email] : undefined,
            phone: sent.sms ? phone : undefined,
          },
        });
        if (!sent.email && !sent.sms) {
          result.error = "send failed";
          continue; // retry next run
        }
      }
      await saveState(admin, order, nextPickupReminderState(state, step, now));
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }
  }

  return { checked: orders.length, results };
}

/** Merge into the CURRENT specs so nothing else on the card is overwritten. */
async function saveState(admin: SupabaseClient, order: OrderRow, state: object) {
  const { data } = await admin
    .from("orders")
    .select("specs")
    .eq("id", order.id)
    .eq("tenant_id", order.tenant_id)
    .maybeSingle();
  const current = asSpecs((data as { specs?: unknown } | null)?.specs);
  const { error } = await admin
    .from("orders")
    .update({ specs: { ...current, pickup_reminders: state } })
    .eq("id", order.id)
    .eq("tenant_id", order.tenant_id);
  if (error) throw new Error(error.message);
}
