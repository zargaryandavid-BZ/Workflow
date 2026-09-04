import { appendedNoteEntries } from "@/lib/note-history";
import {
  holdNotificationRecipientIds,
  isHoldWatchTeammateName,
} from "@/lib/hold-column";
import { formatShortOrderNumber } from "@/lib/order-number-tokens";
import type { Role } from "@/lib/types";

export type UserNotificationType = "designer_note" | "order_hold";

export type UserNotification = {
  id: string;
  tenant_id: string;
  user_id: string;
  type: UserNotificationType | string;
  title: string;
  body: string | null;
  order_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  read_at: string | null;
  created_at: string;
  /** Recipient display name — filled for admin team inbox. */
  recipient_name?: string | null;
};

type NotifyClient = {
  // Supabase query builder — insert plus memberships/profiles lookups.
  from: (table: string) => {
    insert: (
      row: Record<string, unknown> | Record<string, unknown>[]
    ) => PromiseLike<{ error: { message: string } | null }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (cols: string) => any;
  };
};

const SALES_ROLES: Role[] = ["account_manager", "admin"];

export function isSalesRepRole(role: Role): boolean {
  return SALES_ROLES.includes(role);
}

function trimSnippet(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1).trimEnd()}…`;
}

/**
 * When a sales rep (Account Manager / Admin) appends a Designer note, notify
 * the assigned designer. No-op if there is no assignee or they wrote it themselves.
 */
export async function notifyDesignerOfSalesNote(params: {
  client: NotifyClient;
  tenantId: string;
  orderId: string;
  orderTitle: string;
  actorId: string;
  actorName: string;
  actorRole: Role;
  previousSpecs: Record<string, unknown>;
  nextSpecs: Record<string, unknown>;
}): Promise<void> {
  if (!isSalesRepRole(params.actorRole)) return;

  const designerId =
    typeof params.nextSpecs.designer_id === "string"
      ? params.nextSpecs.designer_id.trim()
      : typeof params.previousSpecs.designer_id === "string"
        ? params.previousSpecs.designer_id.trim()
        : "";
  if (!designerId || designerId === params.actorId) return;

  const added = appendedNoteEntries(
    typeof params.previousSpecs.designer_notes === "string"
      ? params.previousSpecs.designer_notes
      : null,
    typeof params.nextSpecs.designer_notes === "string"
      ? params.nextSpecs.designer_notes
      : null
  );
  if (added.length === 0) return;

  const latest = added[added.length - 1]!;
  const snippet = trimSnippet(latest.text);
  const title = snippet || `Designer note on ${params.orderTitle}`;
  const body = `${params.actorName} added a designer note on ${params.orderTitle}`;

  const { error } = await params.client.from("user_notifications").insert({
    tenant_id: params.tenantId,
    user_id: designerId,
    type: "designer_note",
    title,
    body,
    order_id: params.orderId,
    actor_id: params.actorId,
    actor_name: params.actorName,
  });
  if (error) {
    console.error("[user-notifications] designer note insert failed:", error.message);
  }
}

/**
 * When a job enters Hold, ping the card owner and teammate Rafayel in the
 * in-app inbox.
 */
export async function notifyHoldWatchers(params: {
  client: NotifyClient;
  tenantId: string;
  orderId: string;
  orderTitle: string;
  ownerId: string | null;
  columnName: string;
  actorId: string | null;
  reason?: string | null;
}): Promise<void> {
  const { data: memberships } = await params.client
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", params.tenantId);

  const memberIds = ((memberships ?? []) as { user_id: string }[])
    .map((m) => m.user_id)
    .filter(Boolean);

  let watcherIds: string[] = [];
  if (memberIds.length > 0) {
    const { data: profiles } = await params.client
      .from("profiles")
      .select("id, full_name")
      .in("id", memberIds);
    watcherIds = ((profiles ?? []) as { id: string; full_name: string | null }[])
      .filter((p) => isHoldWatchTeammateName(p.full_name))
      .map((p) => p.id);
  }

  const recipientIds = holdNotificationRecipientIds(
    params.ownerId,
    watcherIds,
    params.actorId
  );
  if (recipientIds.length === 0) return;

  let actorName: string | null = null;
  if (params.actorId) {
    const { data: actor } = await params.client
      .from("profiles")
      .select("full_name")
      .eq("id", params.actorId)
      .maybeSingle();
    actorName =
      typeof actor?.full_name === "string" ? actor.full_name.trim() || null : null;
  }

  const short = formatShortOrderNumber(params.orderTitle) || params.orderTitle;
  const col = params.columnName.trim() || "Hold";
  const reason = params.reason?.trim() || "";
  const title = `${short} is on ${col}`;
  const who = actorName ? `${actorName} moved this job to ${col}` : `This job is on ${col}`;
  const body = reason ? `${who}. Reason: ${reason}` : who;

  const rows = recipientIds.map((user_id) => ({
    tenant_id: params.tenantId,
    user_id,
    type: "order_hold",
    title,
    body,
    order_id: params.orderId,
    actor_id: params.actorId,
    actor_name: actorName,
  }));

  const { error } = await params.client.from("user_notifications").insert(rows);
  if (error) {
    console.error("[user-notifications] hold watch insert failed:", error.message);
  }
}
