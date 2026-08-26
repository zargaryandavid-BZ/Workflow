import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity, onEnterColumn } from "@/lib/automation";
import { getMissingFields } from "@/lib/orders/validate-ready-to-move";
import { canMove } from "@/lib/permissions";
import { fireNotificationRules } from "@/lib/fire-notification-rules";
import { isFulfilledStage, notifyCrmOrderFulfilled } from "@/lib/net-terms-fulfill";
import { notifyCustomerOrderFinished } from "@/lib/finished-order-sms";
import {
  isShipStageKind,
  requiresStockConfirmationBeforeShip,
  STOCK_GATE_MESSAGE,
} from "@/lib/warehouse-stock";
import { requestWarehouseStockConfirmation } from "@/lib/warehouse-stock.server";
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
    /** When true, any authenticated tenant role may move (staff follow-up buttons). */
    bypassDropRoles?: boolean;
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
  // Locked cards are frozen — only an admin or the person who locked it can move it.
  if (
    typedOrder.locked_by &&
    typedOrder.locked_by !== ctx.userId &&
    ctx.role !== "admin"
  ) {
    return NextResponse.json(
      {
        error: `This order is locked${typedOrder.locked_by_name ? ` by ${typedOrder.locked_by_name}` : ""} and can't be moved until it's unlocked.`,
      },
      { status: 423 },
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

  if (
    !body.bypassDropRoles &&
    !canMove(ctx.role, typedFromColumn, typedColumn)
  ) {
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

    // "With Application" gate: a combo order that needs application must have
    // warehouse stock confirmed before it can enter Ready-to-Ship / Done.
    // The card stays put and the warehouse is texted (once) to confirm stock.
    if (
      isShipStageKind(typedColumn.kind) &&
      requiresStockConfirmationBeforeShip(
        typedOrder.specs,
        (customFieldsRes.data ?? []) as CustomField[],
        fieldValues
      )
    ) {
      const stockReq = await requestWarehouseStockConfirmation(supabase, {
        orderId: typedOrder.id,
        tenantId,
        title: typedOrder.title,
        specs: typedOrder.specs,
        orderNumber: null,
        tenantName: ctx.tenant.name,
        actorUserId: ctx.userId,
      });
      return NextResponse.json(
        {
          error: STOCK_GATE_MESSAGE,
          needs_stock_confirmation: true,
          warehouse_notified: stockReq.smsSent,
          warehouse_already_notified: stockReq.alreadySent,
          warehouse_notify_error: stockReq.error ?? null,
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
    // Keep the move response fast, but use after() so Vercel/Node doesn't
    // freeze the isolate before SMS / column automations finish.
    const movedOrder = updated as Order;
    const actorUserId = ctx.userId;
    const tenantName = ctx.tenant.name;
    after(async () => {
      try {
        await logActivity(supabase, {
          tenantId,
          orderId: typedOrder.id,
          actor: actorUserId,
          action: "moved",
          metadata: {
            from: fromColumnId,
            to: body.toColumnId,
            fromName: typedFromColumn.name,
            toName: typedColumn.name,
          },
        });
      } catch (err: unknown) {
        console.error(
          "[move] logActivity failed:",
          err instanceof Error ? err.message : err
        );
      }
      try {
        await onEnterColumn(supabase, movedOrder, typedColumn, tenantName);
      } catch (err: unknown) {
        console.error(
          "[move] onEnterColumn failed:",
          err instanceof Error ? err.message : err
        );
      }
      try {
        const { processWorkspaceMirrorOnEnter } = await import(
          "@/lib/workspace-mirror"
        );
        await processWorkspaceMirrorOnEnter(
          movedOrder,
          body.toColumnId!,
          actorUserId
        );
      } catch (err: unknown) {
        console.error(
          "[move] workspace mirror failed:",
          err instanceof Error ? err.message : err
        );
      }
      try {
        await fireNotificationRules(body.orderId!, body.toColumnId!, tenantId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[NotifRule] failed:", message);
      }
      try {
        const { notifyBazaarPortalStatus } = await import(
          "@/lib/bazaar-portal-sync"
        );
        await notifyBazaarPortalStatus({
          client: supabase,
          tenantId,
          order: movedOrder,
          columnName: typedColumn.name,
        });
      } catch (err: unknown) {
        console.error(
          "[move] bazaar-portal-sync failed:",
          err instanceof Error ? err.message : err
        );
      }
      // Net-terms: on entering a Fulfilled stage, have the CRM issue the invoice
      // and start the Net-N clock from today. No-op for non-net orders (CRM decides).
      try {
        if (isFulfilledStage(typedColumn.name)) {
          await notifyCrmOrderFulfilled(movedOrder, typedColumn.name);
        }
      } catch (err: unknown) {
        console.error(
          "[move] net-terms-fulfill failed:",
          err instanceof Error ? err.message : err
        );
      }
      try {
        if (isFulfilledStage(typedColumn.name)) {
          await notifyCustomerOrderFinished(movedOrder, typedColumn.name);
        }
      } catch (err: unknown) {
        console.error(
          "[move] finished-sms failed:",
          err instanceof Error ? err.message : err
        );
      }
    });
  }

  return NextResponse.json({ order: updated });
}
