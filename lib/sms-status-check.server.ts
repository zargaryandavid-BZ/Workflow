import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSmsPhone } from "@/lib/sms";
import { findCustomersForSmsPhone } from "@/lib/order-sms";
import {
  clientStatusForColumn,
  isClosedClientStatus,
  SMS_CHECK_MAX_JOB_PARTS,
  SMS_CHECK_MAX_ORDERS,
  titleMatchesJobNumber,
  type SmsCheckOrderLine,
} from "@/lib/sms-status-check";

type Client = SupabaseClient;

type OrderRow = {
  id: string;
  tenant_id: string;
  title: string | null;
  column_id: string | null;
  created_at: string;
  webhook_order_number?: string | null;
  crm_order_number?: string | null;
};

const ORDER_SELECT =
  "id, tenant_id, title, column_id, created_at, webhook_order_number:specs->>webhook_order_number, crm_order_number:specs->>crm_order_number";

async function columnNames(client: Client, tenantIds: string[]): Promise<Map<string, string>> {
  if (tenantIds.length === 0) return new Map();
  const { data } = await client
    .from("board_columns")
    .select("id, name")
    .in("tenant_id", tenantIds);
  return new Map(((data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
}

function toLines(rows: OrderRow[], cols: Map<string, string>): (SmsCheckOrderLine & { closed: boolean })[] {
  return rows.map((r) => {
    const status = clientStatusForColumn(r.column_id ? cols.get(r.column_id) : null);
    return { number: (r.title ?? "").trim(), status, closed: isClosedClientStatus(status) };
  });
}

/**
 * Which shop a phone is talking to. One Twilio number serves the account, so:
 * the tenant of a customer with this phone, else SMS_CHECK_TENANT_ID, else the
 * tenant that most recently texted anyone from this number.
 */
export async function smsCheckTenantIds(client: Client, fromPhone: string): Promise<string[]> {
  const customers = await findCustomersForSmsPhone(client, fromPhone);
  const fromCustomers = [...new Set(customers.map((c) => c.tenant_id))];
  if (fromCustomers.length > 0) return fromCustomers;
  const envTenant = process.env.SMS_CHECK_TENANT_ID?.trim();
  if (envTenant) return [envTenant];
  const { data } = await client
    .from("order_sms_messages")
    .select("tenant_id")
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const t = (data as { tenant_id?: string } | null)?.tenant_id;
  return t ? [t] : [];
}

/** Option 1: open orders for the customer(s) with this phone (plus orders we texted this phone about), newest first. */
export async function smsCheckOrdersForPhone(
  client: Client,
  fromPhone: string
): Promise<SmsCheckOrderLine[]> {
  const customers = await findCustomersForSmsPhone(client, fromPhone);
  const customerIds = customers.map((c) => c.id);

  const { data: texted } = await client
    .from("order_sms_messages")
    .select("order_id")
    .eq("direction", "outbound")
    .eq("phone", normalizeSmsPhone(fromPhone))
    .order("created_at", { ascending: false })
    .limit(50);
  const textedIds = [
    ...new Set(((texted ?? []) as { order_id: string | null }[]).map((r) => r.order_id).filter(Boolean)),
  ] as string[];

  if (customerIds.length === 0 && textedIds.length === 0) return [];

  const ors: string[] = [];
  if (customerIds.length) ors.push(`customer_id.in.(${customerIds.join(",")})`);
  if (textedIds.length) ors.push(`id.in.(${textedIds.join(",")})`);

  const { data } = await client
    .from("orders")
    .select(ORDER_SELECT)
    .is("removed_at", null)
    .or(ors.join(","))
    .order("created_at", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as OrderRow[];
  const cols = await columnNames(client, [...new Set(rows.map((r) => r.tenant_id))]);
  return toLines(rows, cols)
    .filter((l) => !l.closed && l.number)
    .slice(0, SMS_CHECK_MAX_ORDERS)
    .map(({ number, status }) => ({ number, status }));
}

/** Option 2: every board card for a job ticket number (`15683` → all its parts), any status. */
export async function smsCheckOrdersForJob(
  client: Client,
  tenantIds: string[],
  jobNumber: string
): Promise<SmsCheckOrderLine[]> {
  if (tenantIds.length === 0) return [];
  // jobNumber is already limited to [A-Z0-9-] by normalizeJobNumber — safe inside the filter.
  const { data } = await client
    .from("orders")
    .select(ORDER_SELECT)
    .in("tenant_id", tenantIds)
    .is("removed_at", null)
    .or(
      [
        `title.ilike.${jobNumber}`,
        `title.ilike.${jobNumber}-*`,
        `specs->>webhook_order_number.ilike.${jobNumber}`,
        `specs->>crm_order_number.ilike.*-${jobNumber}`,
        `specs->>crm_order_number.ilike.${jobNumber}`,
      ].join(",")
    )
    .order("title", { ascending: true })
    .limit(20);
  const rows = ((data ?? []) as OrderRow[]).filter((r) =>
    titleMatchesJobNumber(
      {
        title: r.title ?? "",
        webhookOrderNumber: r.webhook_order_number,
        crmOrderNumber: r.crm_order_number,
      },
      jobNumber
    )
  );
  const cols = await columnNames(client, [...new Set(rows.map((r) => r.tenant_id))]);
  return toLines(rows, cols)
    .filter((l) => l.number)
    .slice(0, SMS_CHECK_MAX_JOB_PARTS)
    .map(({ number, status }) => ({ number, status }));
}
