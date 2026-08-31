import { appendedNoteEntries } from "@/lib/note-history";
import type { Role } from "@/lib/types";

export type UserNotificationType = "designer_note";

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
};

type NotifyClient = {
  from: (table: string) => {
    insert: (
      row: Record<string, unknown>
    ) => PromiseLike<{ error: { message: string } | null }>;
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
