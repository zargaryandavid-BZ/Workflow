/**
 * Automation: after a card sits in a column for X time, move it to another column.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  daysInCurrentColumn,
  hoursInCurrentColumn,
  normalizeWorkingDays,
} from "@/lib/card-warning-rules";
import {
  parseColumnIdleConfig,
  type ColumnIdleConfig,
} from "@/lib/column-idle-config";
import { logActivity, onEnterColumn } from "@/lib/automation";
import { fireNotificationRules } from "@/lib/fire-notification-rules";
import type { AutomationRule, BoardColumn, Order, Tenant } from "@/lib/types";

export type { ColumnIdleConfig, IdleUnit } from "@/lib/column-idle-config";
export {
  parseColumnIdleConfig,
  formatIdleDuration,
} from "@/lib/column-idle-config";

export function orderExceedsIdle(
  lastMovedAt: string | null | undefined,
  createdAt: string | null | undefined,
  cfg: ColumnIdleConfig,
  workingDays: number[],
  nowMs: number = Date.now()
): boolean {
  const anchor = lastMovedAt || createdAt || null;
  if (!anchor) return false;

  if (cfg.idle_unit === "hours") {
    const h = hoursInCurrentColumn(anchor, nowMs);
    return h != null && h >= cfg.idle_value;
  }
  if (cfg.idle_unit === "working_days") {
    const d = daysInCurrentColumn(anchor, nowMs, workingDays);
    return d != null && d >= cfg.idle_value;
  }
  // calendar days
  const movedAt = new Date(anchor).getTime();
  if (Number.isNaN(movedAt)) return false;
  const days = Math.floor((nowMs - movedAt) / (1000 * 60 * 60 * 24));
  return days >= cfg.idle_value;
}

type Client = SupabaseClient;

async function systemMoveOrder(
  client: Client,
  opts: {
    order: Order;
    fromColumn: BoardColumn;
    toColumn: BoardColumn;
    tenantName: string;
  }
): Promise<boolean> {
  const { order, fromColumn, toColumn, tenantName } = opts;
  if (order.column_id === toColumn.id) return false;

  const { data: maxPos } = await client
    .from("orders")
    .select("position")
    .eq("tenant_id", order.tenant_id)
    .eq("column_id", toColumn.id)
    .is("removed_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition =
    typeof maxPos?.position === "number" ? maxPos.position + 1 : 0;

  const { data: updated, error } = await client
    .from("orders")
    .update({
      column_id: toColumn.id,
      position: nextPosition,
      last_moved_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("tenant_id", order.tenant_id)
    .eq("column_id", fromColumn.id) // still in source column
    .is("removed_at", null)
    .select("*")
    .maybeSingle();

  if (error || !updated) return false;

  const moved = updated as Order;
  try {
    await logActivity(client, {
      tenantId: order.tenant_id,
      orderId: order.id,
      actor: null,
      action: "idle_auto_moved",
      metadata: {
        from: fromColumn.id,
        to: toColumn.id,
        fromName: fromColumn.name,
        toName: toColumn.name,
        automation: "on_column_idle",
      },
    });
  } catch (err) {
    console.error("[idle-move] logActivity", err);
  }

  try {
    await onEnterColumn(client, moved, toColumn, tenantName);
  } catch (err) {
    console.error("[idle-move] onEnterColumn", err);
  }

  try {
    await fireNotificationRules(order.id, toColumn.id, order.tenant_id);
  } catch (err) {
    console.error("[idle-move] fireNotificationRules", err);
  }

  try {
    const { notifyBazaarPortalStatus } = await import("@/lib/bazaar-portal-sync");
    await notifyBazaarPortalStatus({
      client,
      tenantId: order.tenant_id,
      order: moved,
      columnName: toColumn.name,
    });
  } catch (err) {
    console.error("[idle-move] bazaar-portal-sync", err);
  }

  return true;
}

export type IdleMoveRunResult = {
  tenantId: string;
  moved: number;
  checked: number;
  rules: number;
};

/**
 * Process all enabled on_column_idle rules for one tenant.
 */
export async function runColumnIdleMovesForTenant(
  client: Client,
  tenant: Pick<Tenant, "id" | "name" | "warning_working_days">
): Promise<IdleMoveRunResult> {
  const workingDays = normalizeWorkingDays(tenant.warning_working_days);
  const nowMs = Date.now();

  const { data: rulesRaw } = await client
    .from("automation_rules")
    .select("*")
    .eq("tenant_id", tenant.id)
    .eq("trigger", "on_column_idle")
    .eq("enabled", true);

  const rules = (rulesRaw ?? []) as AutomationRule[];
  let moved = 0;
  let checked = 0;

  const { data: columnsRaw } = await client
    .from("board_columns")
    .select("*")
    .eq("tenant_id", tenant.id);
  const columns = (columnsRaw ?? []) as BoardColumn[];
  const colById = new Map(columns.map((c) => [c.id, c]));

  for (const rule of rules) {
    if (!rule.from_column || !rule.to_column) continue;
    if (rule.from_column === rule.to_column) continue;
    const cfg = parseColumnIdleConfig(rule.config);
    if (!cfg) continue;

    const fromColumn = colById.get(rule.from_column);
    const toColumn = colById.get(rule.to_column);
    if (!fromColumn || !toColumn) continue;

    const { data: ordersRaw } = await client
      .from("orders")
      .select("*")
      .eq("tenant_id", tenant.id)
      .eq("column_id", rule.from_column)
      .is("removed_at", null);

    const orders = (ordersRaw ?? []) as Order[];
    for (const order of orders) {
      checked += 1;
      if (
        !orderExceedsIdle(
          order.last_moved_at,
          order.created_at,
          cfg,
          workingDays,
          nowMs
        )
      ) {
        continue;
      }
      const ok = await systemMoveOrder(client, {
        order,
        fromColumn,
        toColumn,
        tenantName: tenant.name,
      });
      if (ok) moved += 1;
    }
  }

  return {
    tenantId: tenant.id,
    moved,
    checked,
    rules: rules.length,
  };
}
