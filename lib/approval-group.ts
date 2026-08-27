import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listOrderGroupMembers,
  orderGroupKey,
  type GroupOrderMember,
} from "@/lib/ready-to-ship-group";
import { itemTitleFromSpecs } from "@/lib/notification-messages";
import { ensureShortCustomerUrl, appOrigin } from "@/lib/short-link";
import { snapshotApprovalFiles } from "@/lib/approval-snapshot";
import type { CustomerResponse, NotificationStatus } from "@/lib/types";

type Client = SupabaseClient;

export type ApprovalItemStatus =
  | "waiting"
  | "pending"
  | "approved"
  | "rejected";

export type ApprovalGroupItemSummary = {
  orderId: string;
  title: string;
  itemLabel: string;
  status: ApprovalItemStatus;
  /** Per-item respond token when a customer_approval round exists. */
  notificationToken: string | null;
  staffNote: string | null;
  customerNote: string | null;
  customerResponse: CustomerResponse | null;
  notificationStatus: NotificationStatus | null;
  notificationId: string | null;
};

function appUrl() {
  return appOrigin();
}

/** Ensure a stable portal row exists for this order group; return its token. */
export async function ensureApprovalGroupPortal(
  client: Client,
  tenantId: string,
  groupKey: string
): Promise<{ token: string; groupKey: string }> {
  const key = groupKey.trim();
  if (!key) throw new Error("group_key is required");

  const { data: existing } = await client
    .from("approval_group_portals")
    .select("token, group_key")
    .eq("tenant_id", tenantId)
    .eq("group_key", key)
    .maybeSingle();

  if (existing?.token) {
    return {
      token: existing.token as string,
      groupKey: existing.group_key as string,
    };
  }

  const { data: inserted, error } = await client
    .from("approval_group_portals")
    .insert({ tenant_id: tenantId, group_key: key })
    .select("token, group_key")
    .single();

  if (error) {
    // Race: another send created it — re-read.
    const { data: again } = await client
      .from("approval_group_portals")
      .select("token, group_key")
      .eq("tenant_id", tenantId)
      .eq("group_key", key)
      .maybeSingle();
    if (again?.token) {
      return {
        token: again.token as string,
        groupKey: again.group_key as string,
      };
    }
    throw new Error(error.message);
  }

  return {
    token: inserted.token as string,
    groupKey: inserted.group_key as string,
  };
}

export function approvalGroupRespondPath(
  portalToken: string,
  itemId?: string | null
): string {
  const base = `/respond/g/${portalToken}`;
  const item = itemId?.trim();
  if (!item) return base;
  return `${base}?item=${encodeURIComponent(item)}`;
}

export function approvalGroupRespondUrl(
  portalToken: string,
  itemId?: string | null
): string {
  return `${appUrl()}${approvalGroupRespondPath(portalToken, itemId)}`;
}

/**
 * Customer-facing approval link for SMS/email.
 * Multi-item groups → stable /respond/g/{token}?item=…; single cards → /respond/{notifToken}.
 */
export async function resolveCustomerApprovalActionUrl(
  client: Client,
  order: {
    id: string;
    title: string;
    tenant_id: string;
    column_id?: string | null;
    description?: string | null;
    specs?: Record<string, unknown> | null;
  },
  notificationToken: string
): Promise<string> {
  const members = await listOrderGroupMembers(client, order.tenant_id, order);
  const key = orderGroupKey(order);
  let longPath = `/respond/${notificationToken}`;
  if (members.length > 1 && key) {
    const portal = await ensureApprovalGroupPortal(
      client,
      order.tenant_id,
      key
    );
    longPath = approvalGroupRespondPath(portal.token, order.id);
  }
  return ensureShortCustomerUrl(client, order.tenant_id, longPath);
}

function statusFromNotification(row: {
  status: NotificationStatus;
  customer_response: CustomerResponse | null;
} | null): ApprovalItemStatus {
  if (!row) return "pending";
  if (row.status === "pending" || row.status === "sent") return "waiting";
  if (row.status === "responded") {
    if (row.customer_response === "approved") return "approved";
    if (row.customer_response === "changes_requested") return "rejected";
  }
  // expired / unknown → treat as pending (not actionable via this round)
  return "pending";
}

function productFromMemberFields(fields: Record<string, unknown>): string {
  const product = fields["Product"] ?? fields["product"];
  return product ? String(product) : "order";
}

/** Latest customer_approval notification per order (any status). */
async function latestApprovalByOrderId(
  client: Client,
  orderIds: string[]
): Promise<
  Map<
    string,
    {
      id: string;
      token: string;
      status: NotificationStatus;
      customer_response: CustomerResponse | null;
      customer_note: string | null;
      staff_note: string | null;
    }
  >
> {
  const map = new Map<
    string,
    {
      id: string;
      token: string;
      status: NotificationStatus;
      customer_response: CustomerResponse | null;
      customer_note: string | null;
      staff_note: string | null;
    }
  >();
  if (orderIds.length === 0) return map;

  const { data } = await client
    .from("job_notifications")
    .select(
      "id, order_id, token, status, customer_response, customer_note, staff_note, created_at"
    )
    .in("order_id", orderIds)
    .eq("type", "customer_approval")
    .order("created_at", { ascending: false });

  for (const row of data ?? []) {
    const orderId = row.order_id as string;
    if (map.has(orderId)) continue;
    map.set(orderId, {
      id: row.id as string,
      token: row.token as string,
      status: row.status as NotificationStatus,
      customer_response: row.customer_response as CustomerResponse | null,
      customer_note: (row.customer_note as string | null) ?? null,
      staff_note: (row.staff_note as string | null) ?? null,
    });
  }
  return map;
}

const GROUP_APPROVAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function isOpenApprovalStatus(status: NotificationStatus | undefined): boolean {
  return status === "pending" || status === "sent";
}

/**
 * Group SMS/email used to create a request on only one part. The portal then
 * showed the rest as Pending. Open a review round for every sibling still in
 * an approval column so the customer can approve each item.
 */
export async function ensureMissingGroupApprovalNotifications(
  client: Client,
  members: GroupOrderMember[],
  columnKindById: Map<string, string>
): Promise<void> {
  if (members.length < 2) return;

  const latest = await latestApprovalByOrderId(
    client,
    members.map((m) => m.id)
  );

  const inApproval = members.filter(
    (m) => columnKindById.get(m.column_id ?? "") === "approval"
  );
  if (inApproval.length === 0) return;

  const template = inApproval
    .map((m) => latest.get(m.id))
    .find((n) => n && isOpenApprovalStatus(n.status));

  const expiresAt = new Date(Date.now() + GROUP_APPROVAL_TTL_MS).toISOString();
  const tenantId = members[0]!.tenant_id;

  for (const member of inApproval) {
    const existing = latest.get(member.id);
    if (existing && isOpenApprovalStatus(existing.status)) continue;
    if (existing?.status === "responded") continue;

    const { data: inserted, error } = await client
      .from("job_notifications")
      .insert({
        tenant_id: tenantId,
        order_id: member.id,
        type: "customer_approval",
        channel: "none",
        token_expires_at: expiresAt,
        staff_note: template?.staff_note ?? existing?.staff_note ?? null,
        status: "sent",
        created_by: null,
      })
      .select("id")
      .single();
    if (error || !inserted?.id) {
      console.error(
        "[approval-group] failed to open review round for",
        member.title,
        error?.message
      );
      continue;
    }
    try {
      await snapshotApprovalFiles(client, inserted.id as string);
    } catch (err) {
      console.error("[approval-snapshot] failed:", err);
    }
  }
}

export async function loadApprovalGroupItemSummaries(
  client: Client,
  members: GroupOrderMember[],
  fieldByOrderId?: Map<string, Record<string, unknown>>
): Promise<ApprovalGroupItemSummary[]> {
  const latest = await latestApprovalByOrderId(
    client,
    members.map((m) => m.id)
  );

  return members.map((m) => {
    const note = latest.get(m.id) ?? null;
    const fields = fieldByOrderId?.get(m.id) ?? {};
    const itemLabel = itemTitleFromSpecs(
      m.specs,
      productFromMemberFields(fields),
      m.title
    );
    return {
      orderId: m.id,
      title: m.title,
      itemLabel,
      status: statusFromNotification(note),
      notificationToken: note?.token ?? null,
      staffNote: note?.staff_note ?? null,
      customerNote: note?.customer_note ?? null,
      customerResponse: note?.customer_response ?? null,
      notificationStatus: note?.status ?? null,
      notificationId: note?.id ?? null,
    };
  });
}

export function waitingCount(items: ApprovalGroupItemSummary[]): number {
  return items.filter((i) => i.status === "waiting").length;
}

export function defaultSelectedOrderId(
  items: ApprovalGroupItemSummary[]
): string | null {
  const waiting = items.find((i) => i.status === "waiting");
  if (waiting) return waiting.orderId;
  const clickable = items.find((i) => i.status !== "pending");
  return clickable?.orderId ?? null;
}
