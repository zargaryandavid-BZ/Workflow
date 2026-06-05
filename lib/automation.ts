import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVITY_LOG_LIMIT } from "@/lib/constants";
import { sendApprovalEmail } from "@/lib/email";
import type { ApprovalStatus, BoardColumn, Order } from "@/lib/types";

type Client = SupabaseClient;

async function trimActivityLog(client: Client, orderId: string) {
  while (true) {
    const { data: stale } = await client
      .from("activity_log")
      .select("id")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .range(ACTIVITY_LOG_LIMIT, ACTIVITY_LOG_LIMIT + 200);

    if (!stale?.length) break;

    await client
      .from("activity_log")
      .delete()
      .in(
        "id",
        stale.map((row) => row.id as string)
      );

    if (stale.length <= 200) break;
  }
}

export async function logActivity(
  client: Client,
  params: {
    tenantId: string;
    orderId: string | null;
    actor: string | null;
    action: string;
    metadata?: Record<string, unknown>;
  }
) {
  await client.from("activity_log").insert({
    tenant_id: params.tenantId,
    order_id: params.orderId,
    actor: params.actor,
    action: params.action,
    metadata: params.metadata ?? {},
  });

  if (params.orderId) {
    await trimActivityLog(client, params.orderId);
  }
}

/**
 * Creates a pending approval for an order and dispatches the approval link.
 * Returns the created approval (or the existing pending one).
 */
export async function createApprovalForOrder(
  client: Client,
  order: Order,
  tenantName: string
) {
  // Reuse an existing pending approval if one is already open.
  const { data: existing } = await client
    .from("approvals")
    .select("*")
    .eq("order_id", order.id)
    .eq("status", "pending")
    .maybeSingle();

  let approval = existing;

  if (!approval) {
    let customerEmail: string | null = null;
    if (order.customer_id) {
      const { data: customer } = await client
        .from("customers")
        .select("email")
        .eq("id", order.customer_id)
        .maybeSingle();
      customerEmail = (customer as { email: string | null } | null)?.email ?? null;
    }

    const { data: inserted, error } = await client
      .from("approvals")
      .insert({
        tenant_id: order.tenant_id,
        order_id: order.id,
        customer_email: customerEmail,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    approval = inserted;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const approvalUrl = `${appUrl}/approve/${approval.token}`;

  if (approval.customer_email) {
    await sendApprovalEmail({
      to: approval.customer_email,
      orderTitle: order.title,
      tenantName,
      approvalUrl,
    });
  } else {
    console.info(`[approval-link] ${tenantName}: ${approvalUrl}`);
  }

  return { approval, approvalUrl };
}

/**
 * Runs automation when an order enters a column. Today: when entering an
 * approval-kind column, open a customer approval. Generic on_enter_column rules
 * are also honored (single hop, no chaining to avoid loops).
 */
export async function onEnterColumn(
  client: Client,
  order: Order,
  column: BoardColumn,
  tenantName: string
) {
  if (column.kind === "approval") {
    // Customer approval is handled via the drop popup (Email / SMS / Manual).
    return;
  }
}

/**
 * Returns the enabled notify automation rule for a column, optionally filtered
 * by notification type.
 */
export async function getEnabledNotifyRule(
  client: Client,
  tenantId: string,
  columnId: string,
  notifyType?: string
) {
  const { data: rules } = await client
    .from("automation_rules")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("trigger", "on_enter_column")
    .eq("from_column", columnId)
    .eq("enabled", true);

  return (
    (rules ?? []).find((r) => {
      const cfg = r.config as { action?: string; notify_type?: string };
      if (cfg?.action !== "notify") return false;
      if (notifyType && cfg.notify_type !== notifyType) return false;
      return true;
    }) ?? null
  );
}

/**
 * Resolves where an order should move after a customer approval decision.
 * Prefers the per-column notify rule (Settings → Automations → Customer
 * notifications), then falls back to global on_approval_result rules.
 */
export async function approvalTargetColumn(
  client: Client,
  order: Order,
  result: ApprovalStatus
): Promise<string | null> {
  const { data: notifyRules } = await client
    .from("automation_rules")
    .select("*")
    .eq("tenant_id", order.tenant_id)
    .eq("trigger", "on_enter_column")
    .eq("from_column", order.column_id)
    .eq("enabled", true);

  const notifyRule = (notifyRules ?? []).find(
    (r) =>
      (r.config as { action?: string; notify_type?: string })?.action ===
        "notify" &&
      (r.config as { notify_type?: string })?.notify_type ===
        "customer_approval"
  );

  if (notifyRule) {
    if (result === "approved" && notifyRule.to_column) {
      return notifyRule.to_column as string;
    }
    const rejectedTo = (
      notifyRule.config as { rejected_to_column?: string | null }
    )?.rejected_to_column;
    if (result === "rejected" && rejectedTo) {
      return rejectedTo;
    }
  }

  const { data: rules } = await client
    .from("automation_rules")
    .select("*")
    .eq("tenant_id", order.tenant_id)
    .eq("trigger", "on_approval_result")
    .eq("enabled", true);

  const rule = (rules ?? []).find(
    (r) => (r.config as { result?: string })?.result === result
  );
  return (rule?.to_column as string | null) ?? null;
}

/**
 * Applies the configured automation when an approval is decided and moves the
 * order to the resolved target column.
 */
export async function onApprovalResult(
  client: Client,
  params: {
    tenantId: string;
    orderId: string;
    result: ApprovalStatus;
  }
) {
  const { data: order } = await client
    .from("orders")
    .select("*")
    .eq("id", params.orderId)
    .maybeSingle();

  const target = order
    ? await approvalTargetColumn(client, order as Order, params.result)
    : null;

  if (target) {
    await client
      .from("orders")
      .update({ column_id: target })
      .eq("id", params.orderId);
  }

  await logActivity(client, {
    tenantId: params.tenantId,
    orderId: params.orderId,
    actor: null,
    action: params.result === "approved" ? "approved" : "rejected",
    metadata: { via: "customer", movedTo: target },
  });

  return target;
}
