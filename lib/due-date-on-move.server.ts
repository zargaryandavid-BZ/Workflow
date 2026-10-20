import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeDueSpecsIntoOrderSpecs } from "@/lib/due-date";
import { planDueOnMove, type GateColumn } from "@/lib/due-date-on-move";

export interface DueOnMoveResult {
  dueDate: string;
  specs: Record<string, unknown>;
}

/**
 * Call AFTER a card's column move has been saved. When the move takes an
 * "N working days after approval" card past approval (see due-date-on-move.ts)
 * and it still has no due date, set the deadline anchored at the move.
 *
 * Additive only: the write is guarded by `due_date IS NULL`, re-reads specs
 * after the move (so time-chip stamps etc. are kept) and only touches the
 * five due_* keys. Never throws — a failure here must never break a move.
 */
export async function materializeDueOnProductionMove(
  client: SupabaseClient,
  args: {
    tenantId: string;
    orderId: string;
    fromColumnId: string | null | undefined;
    toColumnId: string | null | undefined;
    movedAt?: string;
  }
): Promise<DueOnMoveResult | null> {
  try {
    if (!args.fromColumnId || !args.toColumnId) return null;
    if (args.fromColumnId === args.toColumnId) return null;

    const [orderRes, colsRes] = await Promise.all([
      client
        .from("orders")
        .select("id, due_date, specs")
        .eq("id", args.orderId)
        .eq("tenant_id", args.tenantId)
        .maybeSingle(),
      client
        .from("board_columns")
        .select("id, position, kind, name")
        .eq("tenant_id", args.tenantId),
    ]);
    const order = orderRes.data as
      | { id: string; due_date: string | null; specs: unknown }
      | null;
    if (!order) return null;

    const plan = planDueOnMove({
      order,
      fromColumnId: args.fromColumnId,
      toColumnId: args.toColumnId,
      columns: (colsRes.data ?? []) as GateColumn[],
      movedAt: args.movedAt ?? new Date().toISOString(),
    });
    if (!plan) return null;

    const nextSpecs = mergeDueSpecsIntoOrderSpecs(order.specs, plan.specs);
    const { data, error } = await client
      .from("orders")
      .update({ due_date: plan.dueDate, specs: nextSpecs })
      .eq("id", args.orderId)
      .eq("tenant_id", args.tenantId)
      .is("due_date", null)
      .select("id")
      .maybeSingle();
    if (error || !data) return null;

    return { dueDate: plan.dueDate, specs: nextSpecs };
  } catch (err) {
    console.error(
      "[due-on-move] materialize failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
