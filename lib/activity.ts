import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityLog, Order } from "@/lib/types";

export interface ActivityLogEntry extends ActivityLog {
  actor_name: string | null;
}

export interface SentMessageEntry {
  id: string;
  created_at: string;
  actor_name: string | null;
  channel: "email" | "sms" | "both" | "unknown";
  title: string;
  to: string | null;
  subject: string | null;
  messageBody: string | null;
  action: string;
}

const CUSTOMER_ACTIONS = new Set([
  "approved",
  "rejected",
  "info_submitted",
  "customer_replied",
]);

const MESSAGE_ACTIONS = new Set([
  "emailed",
  "texted",
  "customer_notified",
  "shipping_link_sent",
]);

function metaString(
  meta: Record<string, unknown>,
  key: string
): string | null {
  const value = meta[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isSentMessageActivity(log: ActivityLog): boolean {
  return MESSAGE_ACTIONS.has(log.action);
}

export function sentMessagesFromActivity(
  activity: ActivityLogEntry[]
): SentMessageEntry[] {
  return activity.filter(isSentMessageActivity).map((log) => {
    const meta = (log.metadata ?? {}) as Record<string, unknown>;
    const buttonName = metaString(meta, "buttonName");
    const subject = metaString(meta, "subject");
    const messageBody =
      metaString(meta, "messageBody") ??
      metaString(meta, "smsBody") ??
      metaString(meta, "emailBody");
    const phone = metaString(meta, "phone");
    const recipients = Array.isArray(meta.recipients)
      ? (meta.recipients as unknown[]).filter(
          (r): r is string => typeof r === "string" && r.trim().length > 0
        )
      : [];
    const channelRaw = metaString(meta, "channel");
    const channel: SentMessageEntry["channel"] =
      channelRaw === "email" ||
      channelRaw === "sms" ||
      channelRaw === "both"
        ? channelRaw
        : log.action === "emailed"
          ? "email"
          : log.action === "texted"
            ? "sms"
            : meta.emailSent && meta.smsSent
              ? "both"
              : meta.emailSent
                ? "email"
                : meta.smsSent
                  ? "sms"
                  : "unknown";

    const type = metaString(meta, "type");
    let title = describeActivity(log);
    if (buttonName) {
      title = buttonName;
    } else if (type === "customer_approval") {
      title = "Approval request";
    } else if (type === "missing_info") {
      title = "Missing info request";
    } else if (type === "ready_to_ship") {
      title = "Ready to ship";
    } else if (log.action === "shipping_link_sent") {
      title = buttonName ?? "Shipping link";
    }

    const to =
      recipients.length > 0
        ? recipients.join(", ")
        : phone
          ? phone
          : null;

    return {
      id: log.id,
      created_at: log.created_at,
      actor_name: log.actor_name,
      channel,
      title,
      to,
      subject,
      messageBody,
      action: log.action,
    };
  });
}

export function describeActivity(log: ActivityLog): string {
  const meta = log.metadata ?? {};

  switch (log.action) {
    case "created":
      return "Order created";
    case "moved": {
      const toName = meta.toName as string | undefined;
      return toName ? `Moved to ${toName}` : "Moved";
    }
    case "updated": {
      type ChangeEntry = { field: string; from?: unknown; to?: unknown };
      const changes = meta.changes as ChangeEntry[] | undefined;
      if (!changes || changes.length === 0) return "Order updated";

      const parts = changes.map((c) => {
        const hasFrom = c.from !== undefined && c.from !== null && c.from !== "";
        const hasTo = c.to !== undefined && c.to !== null && c.to !== "";
        if (hasFrom && hasTo) return `${c.field}: ${String(c.from)} → ${String(c.to)}`;
        if (hasTo) return `${c.field}: ${String(c.to)}`;
        if (hasFrom) return `${c.field} removed`;
        return c.field;
      });

      if (parts.length <= 3) return parts.join(" · ");
      return `${parts.slice(0, 3).join(" · ")} +${parts.length - 3} more`;
    }
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
    case "removed":
      return "Order removed";
    case "restored":
      return "Order restored";
    case "approval_manual":
      return "Manual approval follow-up saved";
    case "emailed": {
      const buttonName = meta.buttonName as string | undefined;
      const recipients = meta.recipients as string[] | undefined;
      if (buttonName && recipients?.length) {
        return `Email sent (${buttonName}) to ${recipients.join(", ")}`;
      }
      return "Email sent";
    }
    case "texted": {
      const phone = meta.phone as string | undefined;
      const buttonName = meta.buttonName as string | undefined;
      if (buttonName) return `SMS sent (${buttonName})${phone ? ` to ${phone}` : ""}`;
      if (phone) return `SMS sent to ${phone}`;
      return "SMS sent";
    }
    case "shipping_link_sent": {
      const buttonName = meta.buttonName as string | undefined;
      const portalUrl = meta.portalUrl as string | undefined;
      if (buttonName && portalUrl) {
        return `Shipping link sent (${buttonName})`;
      }
      return "Shipping link sent";
    }
    case "customer_merged":
      return "Customer records merged";
    case "archived_downloaded": {
      const fileName = meta.fileName as string | undefined;
      return fileName
        ? `Archive downloaded (${fileName})`
        : "Archive downloaded";
    }
    default:
      return log.action.replace(/_/g, " ");
  }
}

export async function enrichActivityLog(
  client: SupabaseClient,
  activity: ActivityLog[],
  order?: Pick<Order, "created_at" | "created_by"> | null,
  options?: {
    /** Prefetched profile id → display name (skips a profiles query when complete). */
    nameById?: Map<string, string>;
    /** Prefetched column id → name. */
    columnNameById?: Map<string, string>;
  }
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

  let nameById = options?.nameById ?? new Map<string, string>();
  const missingActors = [...actorIds].filter((id) => !nameById.has(id));
  if (missingActors.length > 0) {
    const { data: profiles } = await client
      .from("profiles")
      .select("id, full_name")
      .in("id", missingActors);
    const fetched = new Map(
      ((profiles ?? []) as { id: string; full_name: string | null }[]).map(
        (p) => [p.id, p.full_name?.trim() || "Team member"]
      )
    );
    nameById = new Map([...nameById, ...fetched]);
  }

  let columnNameById = options?.columnNameById ?? new Map<string, string>();
  const missingColumns = [...columnIds].filter((id) => !columnNameById.has(id));
  if (missingColumns.length > 0) {
    const { data: columns } = await client
      .from("board_columns")
      .select("id, name")
      .in("id", missingColumns);
    const fetched = new Map(
      ((columns ?? []) as { id: string; name: string }[]).map((c) => [
        c.id,
        c.name,
      ])
    );
    columnNameById = new Map([...columnNameById, ...fetched]);
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
