import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityLog, Order } from "@/lib/types";

export interface ActivityLogEntry extends ActivityLog {
  actor_name: string | null;
}

const CUSTOMER_ACTIONS = new Set([
  "approved",
  "rejected",
  "info_submitted",
  "customer_replied",
]);

export function describeActivity(log: ActivityLog): string {
  const meta = log.metadata ?? {};

  switch (log.action) {
    case "created":
      return "Order created";
    case "moved": {
      const toName = meta.toName as string | undefined;
      return toName ? `Moved to ${toName}` : "Moved";
    }
    case "updated":
      return "Order updated";
    case "asset_uploaded": {
      const file = meta.file as string | undefined;
      return file ? `File uploaded: ${file}` : "File uploaded";
    }
    case "approval_requested": {
      const column = meta.column as string | undefined;
      return column ? `Approval requested (${column})` : "Approval requested";
    }
    case "approved":
      return "Approved by customer";
    case "rejected":
      return "Rejected by customer";
    case "missing_info_saved":
      return "Missing info note saved";
    case "customer_notified":
      return "Customer notified";
    case "info_submitted":
      return "Customer submitted info";
    case "customer_replied": {
      const toName = meta.toName as string | undefined;
      return toName ? `Customer replied · moved to ${toName}` : "Customer replied";
    }
    case "missing_info_deleted":
      return "Missing info note removed";
    case "approval_manual":
      return "Manual approval follow-up saved";
    case "customer_merged":
      return "Customer records merged";
    default:
      return log.action.replace(/_/g, " ");
  }
}

export async function enrichActivityLog(
  client: SupabaseClient,
  activity: ActivityLog[],
  order?: Pick<Order, "created_at" | "created_by"> | null
): Promise<ActivityLogEntry[]> {
  const entries = [...(activity ?? [])];

  if (!entries.some((e) => e.action === "created") && order?.created_at) {
    entries.push({
      id: "synthetic-created",
      tenant_id: "",
      order_id: null,
      actor: order.created_by,
      action: "created",
      metadata: {},
      created_at: order.created_at,
    });
  }

  const actorIds = new Set<string>();
  const columnIds = new Set<string>();

  for (const log of entries) {
    if (log.actor) actorIds.add(log.actor);
    if (log.action === "moved") {
      const meta = log.metadata ?? {};
      if (typeof meta.from === "string") columnIds.add(meta.from);
      if (typeof meta.to === "string") columnIds.add(meta.to);
    }
  }

  let nameById = new Map<string, string>();
  if (actorIds.size > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, full_name")
      .in("id", [...actorIds]);
    nameById = new Map(
      ((profiles ?? []) as { id: string; full_name: string | null }[]).map(
        (p) => [p.id, p.full_name?.trim() || "Team member"]
      )
    );
  }

  let columnNameById = new Map<string, string>();
  if (columnIds.size > 0) {
    const { data: columns } = await client
      .from("board_columns")
      .select("id, name")
      .in("id", [...columnIds]);
    columnNameById = new Map(
      ((columns ?? []) as { id: string; name: string }[]).map((c) => [
        c.id,
        c.name,
      ])
    );
  }

  return entries
    .map((log) => {
      const meta = { ...(log.metadata ?? {}) };
      if (log.action === "moved") {
        if (!meta.toName && typeof meta.to === "string") {
          meta.toName = columnNameById.get(meta.to) ?? meta.to;
        }
        if (!meta.fromName && typeof meta.from === "string") {
          meta.fromName = columnNameById.get(meta.from) ?? meta.from;
        }
      }

      let actor_name: string | null = null;
      if (log.actor) {
        actor_name = nameById.get(log.actor) ?? "Team member";
      } else if (CUSTOMER_ACTIONS.has(log.action)) {
        actor_name = "Customer";
      }

      return { ...log, metadata: meta, actor_name };
    })
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
}
