import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity, onEnterColumn } from "@/lib/automation";
import { getMissingFields } from "@/lib/orders/validate-ready-to-move";
import { canMove } from "@/lib/permissions";
import type { BoardColumn, CustomField, Customer, Order, OrderWithRelations } from "@/lib/types";

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
  const tenantId = ctx.tenant.id;

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", body.orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const typedOrder = order as Order;
  if (typedOrder.removed_at) {
    return NextResponse.json(
      { error: "Removed orders cannot be moved" },
      { status: 400 }
    );
  }

  const { data: toColumn } = await supabase
    .from("board_columns")
    .select("*")
    .eq("id", body.toColumnId)
    .eq("tenant_id", tenantId)
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
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const typedFromColumn = (fromColumn ?? typedColumn) as BoardColumn;

  if (!fromColumn) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  if (!canMove(ctx.role, typedFromColumn, typedColumn)) {
    return NextResponse.json(
      { error: "You don't have permission to move this order here." },
      { status: 403 }
    );
  }

  // Incomplete cards may still enter Missing Info (exception) columns.
  if (fromColumnId !== body.toColumnId && typedColumn.kind !== "exception") {
    let customer: Customer | null = null;
    if (typedOrder.customer_id) {
      const { data: customerRow } = await supabase
        .from("customers")
        .select("*")
        .eq("id", typedOrder.customer_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      customer = (customerRow as Customer | null) ?? null;
    }

    const { data: customFieldsRows } = await supabase
      .from("custom_fields")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true });

    const { data: customFieldValues } = await supabase
      .from("custom_field_values")
      .select("custom_field_id, value")
      .eq("order_id", body.orderId);

    const fieldValues: Record<string, unknown> = {};
    for (const row of (customFieldValues ?? []) as {
      custom_field_id: string;
      value: unknown;
    }[]) {
      fieldValues[row.custom_field_id] = row.value;
    }

    const orderWithRelations: OrderWithRelations = {
      ...typedOrder,
      customer,
    };

    const missing = getMissingFields(
      orderWithRelations,
      fieldValues,
      (customFieldsRows ?? []) as CustomField[]
    );

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: "Card cannot be moved — missing required fields",
          missing_fields: missing.map((f) => f.label),
        },
        { status: 422 }
      );
    }
  }

  const newPosition = body.position ?? typedOrder.position;

  const { data: updated, error } = await supabase
    .from("orders")
    .update({ column_id: body.toColumnId, position: newPosition })
    .eq("id", body.orderId)
    .eq("tenant_id", tenantId)
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
