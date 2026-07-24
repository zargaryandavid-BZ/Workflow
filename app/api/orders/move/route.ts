import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity, onEnterColumn } from "@/lib/automation";
import { getMissingFields } from "@/lib/orders/validate-ready-to-move";
import { canMove } from "@/lib/permissions";
import { fireNotificationRules } from "@/lib/fire-notification-rules";
import {
  chipsToStampOnEnter,
  withTimeChipStamp,
} from "@/lib/time-chips";
import type { TimeChip } from "@/lib/time-chips";
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

  // Fetch order and both columns in parallel — saves 2 sequential round-trips.
  const [orderRes, toColumnRes] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .eq("id", body.orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("board_columns")
      .select("*")
      .eq("id", body.toColumnId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (!orderRes.data) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  const typedOrder = orderRes.data as Order;
  if (typedOrder.removed_at) {
    return NextResponse.json(
      { error: "Removed orders cannot be moved" },
      { status: 400 }
    );
  }

  if (!toColumnRes.data) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }
  const typedColumn = toColumnRes.data as BoardColumn;

  const fromColumnId = typedOrder.column_id;

  // Fetch source column (needed for permission check) — only if different.
  const fromColumnRes = fromColumnId !== body.toColumnId
    ? await supabase
        .from("board_columns")
        .select("*")
        .eq("id", fromColumnId)
        .eq("tenant_id", tenantId)
        .maybeSingle()
    : { data: typedColumn };

  const typedFromColumn = (fromColumnRes.data ?? typedColumn) as BoardColumn;

  if (!fromColumnRes.data) {
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
    // Fetch customer, fields, and values in parallel — saves 2 more round-trips.
    const [customerRes, customFieldsRes, customFieldValuesRes] = await Promise.all([
      typedOrder.customer_id
        ? supabase
            .from("customers")
            .select("*")
            .eq("id", typedOrder.customer_id)
            .eq("tenant_id", tenantId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("custom_fields")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("position", { ascending: true }),
      supabase
        .from("custom_field_values")
        .select("custom_field_id, value")
        .eq("order_id", body.orderId),
    ]);

    const customer = (customerRes.data as Customer | null) ?? null;

    const fieldValues: Record<string, unknown> = {};
    for (const row of (customFieldValuesRes.data ?? []) as {
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
      (customFieldsRes.data ?? []) as CustomField[]
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

  const isColumnChange = fromColumnId !== body.toColumnId;

  let nextSpecs = (typedOrder.specs ?? {}) as Record<string, unknown>;
  if (isColumnChange) {
    const { data: chipRows } = await supabase
      .from("time_chips")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("enabled", true)
      .eq("stamp_on_column_id", body.toColumnId);
    const toStamp = chipsToStampOnEnter(
      (chipRows ?? []) as TimeChip[],
      body.toColumnId
    );
    if (toStamp.length > 0) {
      const now = new Date().toISOString();
      for (const chip of toStamp) {
        nextSpecs = withTimeChipStamp(nextSpecs, chip.id, now);
      }
    }
  }

  const specsChanged =
    isColumnChange &&
    JSON.stringify(nextSpecs) !== JSON.stringify(typedOrder.specs ?? {});

  const { data: updated, error } = await supabase
    .from("orders")
    .update({
      column_id: body.toColumnId,
      position: newPosition,
      ...(isColumnChange ? { last_moved_at: new Date().toISOString() } : {}),
      ...(specsChanged ? { specs: nextSpecs } : {}),
    })
    .eq("id", body.orderId)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (isColumnChange) {
    // Fire activity logging and automations after the response is sent — they
    // don't affect the outcome and were the biggest source of latency.
    logActivity(supabase, {
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
    }).catch((err: unknown) => {
      console.error("[move] logActivity failed:", err instanceof Error ? err.message : err);
    });
    onEnterColumn(supabase, updated as Order, typedColumn, ctx.tenant.name).catch(
      (err: unknown) => {
        console.error("[move] onEnterColumn failed:", err instanceof Error ? err.message : err);
      }
    );
    fireNotificationRules(body.orderId, body.toColumnId, tenantId).catch(
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[NotifRule] failed:", message);
      }
    );
  }

  return NextResponse.json({ order: updated });
}
