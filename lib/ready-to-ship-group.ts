import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient;

export type GroupOrderMember = {
  id: string;
  title: string;
  tenant_id: string;
  column_id: string | null;
  description: string | null;
  specs: Record<string, unknown>;
};

/** Group key from a plain order row (same rules as board grouping). */
export function orderGroupKey(order: {
  title: string;
  specs?: Record<string, unknown> | null;
}): string | null {
  const webhookKey =
    typeof order.specs?.webhook_order_number === "string"
      ? order.specs.webhook_order_number.trim()
      : null;
  if (webhookKey) return webhookKey;
  const match = order.title.match(/^(.+)-(\d+)$/);
  if (match) return match[1];
  return null;
}

/**
 * All non-removed orders in the same group as `order` (including itself),
 * sorted by title.
 */
export async function listOrderGroupMembers(
  client: Client,
  tenantId: string,
  order: {
    id: string;
    title: string;
    column_id?: string | null;
    description?: string | null;
    specs?: Record<string, unknown> | null;
  }
): Promise<GroupOrderMember[]> {
  const webhookKey =
    typeof order.specs?.webhook_order_number === "string"
      ? order.specs.webhook_order_number.trim()
      : null;
  const groupKey = orderGroupKey(order);

  if (!groupKey) {
    return [
      {
        id: order.id,
        title: order.title,
        tenant_id: tenantId,
        column_id: order.column_id ?? null,
        description: order.description ?? null,
        specs: (order.specs ?? {}) as Record<string, unknown>,
      },
    ];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = client
    .from("orders")
    .select("id, title, tenant_id, column_id, description, specs")
    .eq("tenant_id", tenantId)
    .is("removed_at", null);

  if (webhookKey) {
    q = q.filter("specs->>'webhook_order_number'", "eq", webhookKey);
  } else {
    q = q.ilike("title", `${groupKey}-%`);
  }

  const { data } = await q;
  const members = ((data ?? []) as GroupOrderMember[]).slice();
  if (!members.some((m) => m.id === order.id)) {
    members.push({
      id: order.id,
      title: order.title,
      tenant_id: tenantId,
      column_id: order.column_id ?? null,
      description: order.description ?? null,
      specs: (order.specs ?? {}) as Record<string, unknown>,
    });
  }

  return members.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
}

/** e.g. "0272 (3 parts: 0272-1, 0272-2, 0272-3)" or a single title. */
export function formatReadyToShipGroupLabel(
  members: Array<{ title: string; specs?: Record<string, unknown> | null }>
): string {
  if (members.length === 0) return "order";
  if (members.length === 1) return members[0].title;
  const key = orderGroupKey(members[0]) ?? members[0].title.replace(/-\d+$/, "");
  const titles = members.map((m) => m.title).join(", ");
  return `${key} (${members.length} parts: ${titles})`;
}

/** Order IDs allowed for a ready-to-ship respond token (primary + siblings). */
export async function orderIdsForReadyToShipToken(
  client: Client,
  token: string
): Promise<string[]> {
  const { data: notification } = await client
    .from("job_notifications")
    .select("order_id, tenant_id, type")
    .eq("token", token)
    .maybeSingle();

  if (!notification?.order_id) return [];

  if (notification.type !== "ready_to_ship") {
    return [notification.order_id as string];
  }

  const { data: order } = await client
    .from("orders")
    .select("id, title, column_id, description, specs")
    .eq("id", notification.order_id)
    .maybeSingle();

  if (!order) return [notification.order_id as string];

  const members = await listOrderGroupMembers(
    client,
    notification.tenant_id as string,
    order as {
      id: string;
      title: string;
      column_id: string | null;
      description: string | null;
      specs: Record<string, unknown>;
    }
  );

  return members.map((m) => m.id);
}
