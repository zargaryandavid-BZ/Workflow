import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityLog, Order } from "@/lib/types";
import { pauseReasonLabel, formatDuration } from "@/lib/time-tracking";

export interface ActivityLogEntry extends ActivityLog {
  actor_name: string;
}

export interface SentMessageEntry {
  id: string;
  created_at: string;
  actor_name: string;
  channel: "email" | "sms" | "both" | "unknown";
  title: string;
  to: string | null;
  email: string | null;
  phone: string | null;
  subject: string | null;
  messageBody: string | null;
  action: string;
  notificationId: string | null;
}

export interface CustomerResponseEntry {
  id: string;
  created_at: string;
  action: "approved" | "rejected" | "info_submitted" | "customer_replied" | "combo_stock_reply";
  /** Short human label shown as the "title" in the history row. */
  title: string;
  /** Any free-text note the customer left. */
  note: string | null;
  /** Phone / email shown as "from" — pulled from notification meta if present. */
  from: string | null;
  notificationId: string | null;
}

const CUSTOMER_ACTIONS = new Set([
  "approved",
  "rejected",
  "info_submitted",
  "customer_replied",
  "combo_stock_reply",
]);

const COLUMN_MOVE_ACTIONS = new Set(["moved", "idle_auto_moved"]);

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

function recipientList(meta: Record<string, unknown>): string[] {
  return Array.isArray(meta.recipients)
    ? (meta.recipients as unknown[]).filter(
        (r): r is string => typeof r === "string" && r.trim().length > 0
      )
    : [];
}

function formatSentToLine(opts: {
  channel: SentMessageEntry["channel"];
  email: string | null;
  phone: string | null;
}): string | null {
  const email = opts.email?.trim() || null;
  const phone = opts.phone?.trim() || null;
  if (opts.channel === "sms") return phone;
  if (opts.channel === "email") return email;
  const parts = [email, phone].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Latest logged send destination for a job_notifications row. */
export function latestSentToForNotification(
  activity: ActivityLogEntry[],
  notificationId: string
): { email: string | null; phone: string | null; line: string | null } | null {
  for (let i = activity.length - 1; i >= 0; i--) {
    const log = activity[i];
    if (!isSentMessageActivity(log)) continue;
    const meta = (log.metadata ?? {}) as Record<string, unknown>;
    if (metaString(meta, "notificationId") !== notificationId) continue;
    const email = recipientList(meta)[0] ?? metaString(meta, "email");
    const phone = metaString(meta, "phone");
    const channelRaw = metaString(meta, "channel");
    const channel: SentMessageEntry["channel"] =
      channelRaw === "email" || channelRaw === "sms" || channelRaw === "both"
        ? channelRaw
        : phone && email
          ? "both"
          : phone
            ? "sms"
            : email
              ? "email"
              : "unknown";
    return {
      email,
      phone,
      line: formatSentToLine({ channel, email, phone }),
    };
  }
  return null;
}

export function isColumnMoveActivity(
  log: Pick<ActivityLog, "action" | "metadata">
): boolean {
  if (COLUMN_MOVE_ACTIONS.has(log.action)) return true;
  const meta = (log.metadata ?? {}) as Record<string, unknown>;
  if (log.action === "customer_replied") {
    return Boolean(meta.to || meta.toName || meta.from || meta.fromName);
  }
  if (log.action === "approved" || log.action === "rejected") {
    return Boolean(meta.movedTo || meta.to || meta.toName);
  }
  return false;
}

export function columnMoveColumnIds(
  log: Pick<ActivityLog, "action" | "metadata">
): string[] {
  const meta = (log.metadata ?? {}) as Record<string, unknown>;
  const ids: string[] = [];
  for (const key of ["from", "to", "movedTo"] as const) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) ids.push(value.trim());
  }
  return ids;
}

export function formatStayDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0m";
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "0m";
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

export function mergeActivityById(
  primary: ActivityLog[],
  extra: ActivityLog[]
): ActivityLog[] {
  const byId = new Map<string, ActivityLog>();
  for (const row of [...primary, ...extra]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

export function resolveActivityActorName(
  log: ActivityLog,
  nameById: Map<string, string>,
  notificationActorById: Map<string, string> = new Map()
): string {
  if (log.actor) {
    return nameById.get(log.actor) ?? "Team member";
  }

  const meta = (log.metadata ?? {}) as Record<string, unknown>;
  const notificationId = metaString(meta, "notificationId");
  const notificationActorId = notificationId
    ? notificationActorById.get(notificationId)
    : null;
  if (notificationActorId) {
    return nameById.get(notificationActorId) ?? "Team member";
  }

  const source = metaString(meta, "source")?.toLowerCase();
  const via = metaString(meta, "via")?.toLowerCase();
  if (
    CUSTOMER_ACTIONS.has(log.action) ||
    via === "customer" ||
    source === "twilio_inbound"
  ) {
    return "Customer";
  }

  if (source === "sms_link") {
    const confirmedBy = metaString(meta, "confirmedBy");
    return confirmedBy && confirmedBy !== "warehouse-sms"
      ? confirmedBy
      : "Warehouse";
  }

  if (
    log.action === "idle_auto_moved" ||
    source === "notification_rule" ||
    Boolean(meta.automation)
  ) {
    return "Automation";
  }

  if (source === "webhook" || meta.webhook_source) {
    return "Webhook";
  }

  return "System";
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

    const email = recipients[0] ?? metaString(meta, "email");
    const to = formatSentToLine({ channel, email, phone });

    return {
      id: log.id,
      created_at: log.created_at,
      actor_name: log.actor_name,
      channel,
      title,
      to,
      email,
      phone,
      subject,
      messageBody,
      action: log.action,
      notificationId: metaString(meta, "notificationId"),
    };
  });
}

/**
 * Returns activity-log entries that represent a customer's response (approval,
 * rejection, info submission, or a freeform reply) — but NOT entries that also
 * encode a column move (those are already surfaced in the board move history).
 */
export function customerResponsesFromActivity(
  activity: ActivityLogEntry[]
): CustomerResponseEntry[] {
  return activity
    .filter((log) => {
      if (!CUSTOMER_ACTIONS.has(log.action)) return false;
      // Skip entries that are really column-move events (already shown elsewhere).
      return !isColumnMoveActivity(log);
    })
    .map((log) => {
      const meta = (log.metadata ?? {}) as Record<string, unknown>;
      const note =
        metaString(meta, "note") ??
        metaString(meta, "customerNote") ??
        metaString(meta, "message") ??
        metaString(meta, "response") ??
        null;
      const from =
        metaString(meta, "phone") ??
        metaString(meta, "email") ??
        metaString(meta, "customerPhone") ??
        metaString(meta, "customerEmail") ??
        null;

      let title: string;
      switch (log.action) {
        case "approved":
          title = "Customer approved";
          break;
        case "rejected":
          title = "Customer rejected";
          break;
        case "info_submitted":
          title = "Missing info submitted";
          break;
        case "combo_stock_reply":
          title = "Combo stock reply";
          break;
        case "customer_replied":
        default:
          title = "Customer replied";
          break;
      }

      return {
        id: log.id,
        created_at: log.created_at,
        action: log.action as CustomerResponseEntry["action"],
        title,
        note,
        from,
        notificationId: metaString(meta, "notificationId"),
      };
    });
}

export function describeActivity(log: ActivityLog): string {
  const meta = log.metadata ?? {};

  switch (log.action) {
    case "created":
      return "Order created";
    case "hold_reason": {
      const reason = meta.reason as string | undefined;
      return reason ? `On hold: ${reason}` : "Put on hold";
    }
    case "moved":
    case "idle_auto_moved": {
      const fromName = meta.fromName as string | undefined;
      const toName = meta.toName as string | undefined;
      if (fromName && toName) return `${fromName} → ${toName}`;
      if (toName) return `Moved to ${toName}`;
      return log.action === "idle_auto_moved" ? "Moved by automation" : "Moved";
    }
    case "updated": {
      type ChangeEntry = { field: string; from?: unknown; to?: unknown };
      const changes = meta.changes as ChangeEntry[] | undefined;
      if (!changes || changes.length === 0) return "Order updated";

      const parts = changes.map((c) => {
        const fromText =
          c.from !== undefined && c.from !== null && c.from !== ""
            ? String(c.from)
            : null;
        const toText =
          c.to !== undefined && c.to !== null && c.to !== ""
            ? String(c.to)
            : null;
        if (fromText && toText) return `${c.field}: ${fromText} → ${toText}`;
        if (toText && !fromText) return `${c.field}: ${toText}`;
        if (fromText && !toText) return `${c.field}: ${fromText} → cleared`;
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
    case "approved": {
      const toName = meta.toName as string | undefined;
      return toName
        ? `Approved by customer · moved to ${toName}`
        : "Approved by customer";
    }
    case "rejected": {
      const toName = meta.toName as string | undefined;
      return toName
        ? `Rejected by customer · moved to ${toName}`
        : "Rejected by customer";
    }
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
    case "timer_started":
      return "Started working";
    case "timer_paused": {
      const reason = pauseReasonLabel(meta.reason as string | null | undefined);
      return reason ? `Paused · ${reason}` : "Paused";
    }
    case "timer_resumed":
      return "Resumed working";
    case "timer_stopped": {
      const secs = typeof meta.seconds === "number" ? meta.seconds : null;
      return secs != null ? `Finished — ${formatDuration(secs)}` : "Finished working";
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
    /** Notification id → staff user id, used for historical send attribution. */
    notificationActorById?: Map<string, string>;
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
    if (isColumnMoveActivity(log)) {
      for (const id of columnMoveColumnIds(log)) columnIds.add(id);
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
      if (isColumnMoveActivity(log)) {
        const toId =
          typeof meta.to === "string"
            ? meta.to
            : typeof meta.movedTo === "string"
              ? meta.movedTo
              : null;
        if (!meta.toName && toId) {
          meta.toName = columnNameById.get(toId) ?? toId;
        }
        if (!meta.fromName && typeof meta.from === "string") {
          meta.fromName = columnNameById.get(meta.from) ?? meta.from;
        }
        if (!meta.to && toId) meta.to = toId;
      }

      const actor_name = resolveActivityActorName(
        log,
        nameById,
        options?.notificationActorById
      );

      return { ...log, metadata: meta, actor_name };
    })
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
}
