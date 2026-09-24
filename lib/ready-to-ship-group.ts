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
    // Use .eq on the JSON path — .filter("specs->>'…'") silently returns no rows.
    q = q.eq("specs->>webhook_order_number", webhookKey);
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

export function membersInColumn<T extends { column_id?: string | null }>(
  members: T[],
  columnId: string | null | undefined
): T[] {
  if (!columnId) return members;
  return members.filter((m) => m.column_id === columnId);
}

/**
 * Parts currently in the Ready to Ship column. Falls back to the full group
 * only when none match (e.g. the notified card already left the column).
 */
export function groupMembersReadyInColumn<
  T extends { column_id?: string | null },
>(members: T[], readyColumnId: string | null | undefined): T[] {
  const ready = membersInColumn(members, readyColumnId);
  return ready.length > 0 ? ready : members;
}

/** Customer-facing SMS/email label: only parts in the notify column. */
export function formatReadyToShipNotifyLabel(
  members: Array<{
    title: string;
    column_id?: string | null;
    specs?: Record<string, unknown> | null;
  }>,
  readyColumnId: string | null | undefined
): string {
  const ready = membersInColumn(members, readyColumnId);
  const listed = ready.length > 0 ? ready : members;
  if (members.length <= 1 || listed.length === members.length) {
    return formatReadyToShipGroupLabel(listed);
  }
  const key = orderGroupKey(members[0]) ?? members[0].title.replace(/-\d+$/, "");
  const titles = listed.map((m) => m.title).join(", ");
  return `${key} (${listed.length} of ${members.length} parts: ${titles})`;
}

export function partNumberFromTitle(title: string): number | null {
  const m = title.trim().match(/-(\d+)\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "(Boyd Only) Ready to Ship" → "Boyd Only"; other names stay as-is. */
export function shortPartColumnName(name: string): string {
  const t = name.trim();
  if (!t) return "Unknown";
  if (/boyd only/i.test(t)) return "Boyd Only";
  return t;
}

/** e.g. "Part 1- In Production, Part 2- Boyd Only" */
export function formatGroupPartLocations(
  members: Array<{ title: string; columnName: string | null | undefined }>
): string {
  return members
    .map((m, i) => {
      const n = partNumberFromTitle(m.title) ?? i + 1;
      const col = shortPartColumnName(m.columnName ?? "");
      return `Part ${n}- ${col}`;
    })
    .join(", ");
}

/** Column where a complete group should be highlighted for shipping-ready SMS. */
export function isReadyToShipNotifyColumn(col: {
  kind?: string | null;
  name: string;
}): boolean {
  if (col.kind === "ready_to_ship") return true;
  return /boyd only/i.test(col.name) && /ready to ship/i.test(col.name);
}

/** True when every part of a multi-item order is in this column. */
export function isCompleteGroupInColumn(
  partsInThisColumn: number,
  groupSize: number | null | undefined
): boolean {
  const n = groupSize ?? 0;
  return n >= 2 && partsInThisColumn === n;
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

  const ready = groupMembersReadyInColumn(
    members,
    (order.column_id as string | null) ?? null
  );
  return ready.map((m) => m.id);
}
