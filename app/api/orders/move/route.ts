import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity, onEnterColumn } from "@/lib/automation";
import { canMove } from "@/lib/permissions";
import type { BoardColumn, Order } from "@/lib/types";

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    orderId?: string;
    toColumnId?: string;
    position?: number;
  };
  if (!body.orderId || !body.toColumnId) {
    return NextResponse.json(
      { error: "orderId and toColumnId are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", body.orderId)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const typedOrder = order as Order;

  const { data: toColumn } = await supabase
    .from("board_columns")
    .select("*")
    .eq("id", body.toColumnId)
    .maybeSingle();
  if (!toColumn) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }
  const typedColumn = toColumn as BoardColumn;

  const fromColumnId = typedOrder.column_id;

  // Enforce per-column drop permissions based on the mover's role.
  const { data: fromColumn } = await supabase
    .from("board_columns")
    .select("*")
    .eq("id", fromColumnId)
    .maybeSingle();
  const typedFromColumn = (fromColumn ?? typedColumn) as BoardColumn;

  if (!canMove(ctx.role, typedFromColumn, typedColumn)) {
    return NextResponse.json(
      { error: "You don't have permission to move this order here." },
      { status: 403 }
    );
  }

  const newPosition = body.position ?? typedOrder.position;

  const { data: updated, error } = await supabase
    .from("orders")
    .update({ column_id: body.toColumnId, position: newPosition })
    .eq("id", body.orderId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (fromColumnId !== body.toColumnId) {
    await logActivity(supabase, {
      tenantId: ctx.tenant.id,
      orderId: typedOrder.id,
      actor: ctx.userId,
      action: "moved",
      metadata: {
        from: fromColumnId,
        to: body.toColumnId,
        fromName: typedFromColumn.name,
        toName: typedColumn.name,
      },
    });
    await onEnterColumn(supabase, updated as Order, typedColumn, ctx.tenant.name);
  }

  return NextResponse.json({ order: updated });
}
