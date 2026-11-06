import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyDieManufacturer } from "@/lib/die-notify";
import {
  buildDieQuoteEmailBody,
  buildDieQuoteEmailHtml,
  buildDieQuoteSmsBody,
  dieQuoteSubject,
} from "@/lib/die-request-messages";
import { mapDieManufacturerRow } from "@/lib/die-manufacturers";
import { formatDieSize } from "@/lib/die-request";
import { ensureShortCustomerUrl } from "@/lib/short-link";
import { formatDate } from "@/lib/utils";
import { logDieEvent } from "@/lib/dies.server";

/**
 * Email + text the manufacturer the "please quote this die" link
 * (/die/<token>). Used for a new request and when a request is moved to a
 * different manufacturer.
 */
export async function sendDieQuoteRequest(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    token: string;
    orderTitle: string;
    manufacturer: Record<string, unknown>;
    productName: string | null;
    width: number | null;
    height: number | null;
    depth: number | null;
    requiredDate: string;
    comment: string | null;
    /** A follow-up nudge: "Reminder:" in the subject and text. */
    reminder?: boolean;
  }
): Promise<{ warning: string | null }> {
  const quoteUrl = await ensureShortCustomerUrl(supabase, args.tenantId, `/die/${args.token}`);
  const size = formatDieSize(args.width, args.height, args.depth);
  const requiredDate = formatDate(args.requiredDate) || args.requiredDate;
  const common = {
    orderNumber: args.orderTitle,
    productName: args.productName,
    size,
    requiredDate,
    quoteUrl,
    comment: args.comment,
  };
  return notifyDieManufacturer({
    manufacturer: mapDieManufacturerRow(args.manufacturer),
    email: {
      subject: `${args.reminder ? "Reminder: " : ""}${dieQuoteSubject(args.orderTitle)}`,
      html: (contactName) => buildDieQuoteEmailHtml({ ...common, contactName }),
      text: (contactName) => buildDieQuoteEmailBody({ ...common, contactName }),
    },
    smsBody: `${args.reminder ? "Reminder: " : ""}${buildDieQuoteSmsBody({
      orderNumber: args.orderTitle,
      requiredDate,
      quoteUrl,
    })}`,
  });
}

/**
 * Send one reminder for a request still waiting on the manufacturer's price.
 * Claims the reminder first (reminder_count must still match) so the daily
 * job and a "Remind now" click can't both send it.
 */
export async function sendDieReminder(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    requestId: string;
    actor?: { id: string | null; name: string | null } | null;
  }
): Promise<{ ok: true; warning: string | null; count: number } | { error: string; status: number }> {
  const { data: row, error } = await supabase
    .from("die_requests")
    .select(
      "id, tenant_id, token, status, die_id, product_name, width, height, depth, required_date, comment, reminder_count, manufacturer_id, to_email, order:orders(title), manufacturer:die_manufacturers(*)"
    )
    .eq("id", args.requestId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  if (error) {
    return /reminder_count/i.test(error.message)
      ? { error: "Run migration 0098_die_request_reminders.sql in Supabase, then try again.", status: 400 }
      : { error: error.message, status: 400 };
  }
  if (!row) return { error: "Request not found.", status: 404 };
  const r = row as Record<string, unknown>;
  if (r.status !== "sent") {
    return { error: "Only a request still waiting for a price gets a reminder.", status: 409 };
  }
  const count = Number(r.reminder_count ?? 0) || 0;

  const { data: claimed } = await supabase
    .from("die_requests")
    .update({ reminder_count: count + 1, last_reminder_at: new Date().toISOString() })
    .eq("id", args.requestId)
    .eq("status", "sent")
    .eq("reminder_count", count)
    .select("id");
  if (!claimed?.length) return { error: "A reminder was just sent.", status: 409 };

  const order = r.order as { title?: string } | { title?: string }[] | null;
  const orderTitle = (Array.isArray(order) ? order[0]?.title : order?.title) ?? "Order";
  const mfgRaw = r.manufacturer as Record<string, unknown> | Record<string, unknown>[] | null;
  const manufacturer =
    (Array.isArray(mfgRaw) ? mfgRaw[0] : mfgRaw) ??
    ({ full_name: "", email: r.to_email } as Record<string, unknown>);
  const num = (v: unknown) => (v == null ? null : Number(v));

  const notify = await sendDieQuoteRequest(supabase, {
    tenantId: args.tenantId,
    token: String(r.token),
    orderTitle,
    manufacturer,
    productName: r.product_name ? String(r.product_name) : null,
    width: num(r.width),
    height: num(r.height),
    depth: num(r.depth),
    requiredDate: String(r.required_date).slice(0, 10),
    comment: r.comment ? String(r.comment) : null,
    reminder: true,
  });

  if (r.die_id) {
    await logDieEvent(supabase, {
      tenantId: args.tenantId,
      dieId: String(r.die_id),
      kind: "reminded",
      actor: args.actor ?? null,
      note: args.actor ? null : "Automatic reminder",
      meta: {
        manufacturer: String((manufacturer as { full_name?: string }).full_name ?? "").trim() || null,
        reminder_number: count + 1,
      },
    });
  }
  return { ok: true, warning: notify.warning, count: count + 1 };
}
