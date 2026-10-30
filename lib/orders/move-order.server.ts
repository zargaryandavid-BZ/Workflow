import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity, onEnterColumn } from "@/lib/automation";
import { getMissingFields } from "@/lib/orders/validate-ready-to-move";
import { isDesignerQueueColumnName } from "@/lib/designer-queue-columns";
import { resequenceDesignerQueue } from "@/lib/designer-queue.server";
import { canMove } from "@/lib/permissions";
import { isFollowUpBypassTarget } from "@/lib/follow-up-bypass";
import { fireNotificationRules } from "@/lib/fire-notification-rules";
import { isFulfilledStage, isInvoiceTriggerStage, notifyCrmOrderFulfilled } from "@/lib/net-terms-fulfill";
import { notifyCustomerOrderFinished } from "@/lib/finished-order-sms";
import { materializeDueOnProductionMove } from "@/lib/due-date-on-move.server";
import {
  chipsToStampOnEnter,
  withTimeChipStamp,
} from "@/lib/time-chips";
import type { TimeChip } from "@/lib/time-chips";
import type { BoardColumn, CustomField, Customer, Order, OrderWithRelations, Role } from "@/lib/types";
import {
  maybeStopWorkTimersOnColumnEnter,
  maybeStopPrepressTimersOnColumnLeave,
  stopOpenTimersForOrder,
} from "@/lib/stop-order-timers";

export type OrderMoveParams = {
  tenantId: string;
  tenantName: string;
  /** Staff user making the move; null for integrations (e.g. Pulse "Approve to Production"). */
  actorUserId: string | null;
  /** Staff role for the drop-permission check; null for integrations. */
  actorRole: Role | null;
  orderId: string;
  toColumnId: string;
  position?: number;
  /** When true, any role may move (staff follow-up buttons, integrations). */
  bypassDropRoles?: boolean;
};

export type OrderMoveResult = { status: number; body: Record<string, unknown> };

/**
 * One card move — shared by the staff board (POST /api/orders/move) and
 * integrations (POST /api/export/move-card), so both run the exact same checks
 * (lock, drop permission, required fields) and side effects (activity log, column
 * automations, notification rules, Bazaar portal status, due-date materialisation).
 */
export async function performOrderMove(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  params: OrderMoveParams
): Promise<OrderMoveResult> {
  const { tenantId, tenantName, actorUserId, actorRole, orderId, toColumnId, position, bypassDropRoles } = params;


  // Fetch order and both columns in parallel — saves 2 sequential round-trips.
  const [orderRes, toColumnRes] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("board_columns")
      .select("*")
      .eq("id", toColumnId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (!orderRes.data) {
    return { status: 404, body: { error: "Order not found" } };
  }
  const typedOrder = orderRes.data as Order;
  if (typedOrder.removed_at) {
    return { status: 400, body: { error: "Removed orders cannot be moved" } };
  }
  // Locked cards are frozen — only an admin or the person who locked it can move it.
  if (
    typedOrder.locked_by &&
    typedOrder.locked_by !== actorUserId &&
    actorRole !== "admin"
  ) {
    return { status: 423, body: {
        error: `This order is locked${typedOrder.locked_by_name ? ` by ${typedOrder.locked_by_name}` : ""} and can't be moved until it's unlocked.`,
      } };
  }

  if (!toColumnRes.data) {
    return { status: 404, body: { error: "Column not found" } };
  }
  const typedColumn = toColumnRes.data as BoardColumn;

  const fromColumnId = typedOrder.column_id;

  // Fetch source column (needed for permission check) — only if different.
  const fromColumnRes = fromColumnId !== toColumnId
    ? await supabase
        .from("board_columns")
        .select("*")
        .eq("id", fromColumnId)
        .eq("tenant_id", tenantId)
        .maybeSingle()
    : { data: typedColumn };

  const typedFromColumn = (fromColumnRes.data ?? typedColumn) as BoardColumn;

  if (!fromColumnRes.data) {
    return { status: 404, body: { error: "Column not found" } };
  }

  // The bypass is for the approval / missing-info follow-up buttons only:
  // never let a request body skip permissions into any other column.
  const bypass = Boolean(bypassDropRoles) && isFollowUpBypassTarget(typedColumn);
  if (
    !bypass &&
    (!actorRole || !canMove(actorRole, typedFromColumn, typedColumn))
  ) {
    return { status: 403, body: { error: "You don't have permission to move this order here." } };
  }

  // Incomplete cards may still enter Missing Info (exception) columns.
  if (fromColumnId !== toColumnId && typedColumn.kind !== "exception") {
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
        .eq("order_id", orderId),
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
      return { status: 422, body: {
          error: "Card cannot be moved — missing required fields",
          missing_fields: missing.map((f) => f.label),
        } };
    }
  }

  const newPosition = position ?? typedOrder.position;

  const isColumnChange = fromColumnId !== toColumnId;

  let nextSpecs = (typedOrder.specs ?? {}) as Record<string, unknown>;
  if (isColumnChange) {
    const { data: chipRows } = await supabase
      .from("time_chips")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("enabled", true)
      .eq("stamp_on_column_id", toColumnId);
    const toStamp = chipsToStampOnEnter(
      (chipRows ?? []) as TimeChip[],
      toColumnId
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
      column_id: toColumnId,
      position: newPosition,
      ...(isColumnChange ? { last_moved_at: new Date().toISOString() } : {}),
      ...(specsChanged ? { specs: nextSpecs } : {}),
    })
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) {
    return { status: 400, body: { error: error.message } };
  }

  // "N working days after approval" jobs dragged past approval by staff (or
  // skipping approval) start their deadline clock now — same math as a
  // customer approval. Never replaces an existing due date.
  let responseOrder = updated as Order;
  let dueMaterialized: string | null = null;
  if (isColumnChange) {
    const due = await materializeDueOnProductionMove(supabase, {
      tenantId,
      orderId: typedOrder.id,
      fromColumnId,
      toColumnId: toColumnId,
      movedAt: responseOrder.last_moved_at ?? undefined,
    });
    if (due) {
      dueMaterialized = due.dueDate;
      responseOrder = {
        ...responseOrder,
        due_date: due.dueDate,
        specs: due.specs as Order["specs"],
      };
    }
  }

  if (isColumnChange) {
    await maybeStopWorkTimersOnColumnEnter({
      tenantId,
      orderId: typedOrder.id,
      column: typedColumn,
    });
    await maybeStopPrepressTimersOnColumnLeave({
      tenantId,
      orderId: typedOrder.id,
      fromColumn: typedFromColumn,
      toColumn: typedColumn,
    });
  }

  // When a card leaves the designer queue (finished or moved to another column),
  // renumber that designer's remaining Start/In-Progress cards so the next in
  // line becomes #1 instead of leaving a gap. Done inline so the board's refetch
  // shows the new order immediately.
  if (
    isColumnChange &&
    isDesignerQueueColumnName(typedFromColumn.name) &&
    !isDesignerQueueColumnName(typedColumn.name)
  ) {
    // Leaving the designer's active queue (Start / In Progress) stops the work
    // timer and banks the time so it stops running in the background once the
    // card moves on (e.g. to In Production / Outsource). Starting again later
    // opens a fresh entry and the on-card total keeps accumulating.
    try {
      await stopOpenTimersForOrder(tenantId, typedOrder.id);
    } catch (err: unknown) {
      console.error(
        "[move] stop timer on leaving queue failed:",
        err instanceof Error ? err.message : err
      );
    }
    const designerId = (typedOrder.specs as { designer_id?: unknown } | null)
      ?.designer_id;
    try {
      await resequenceDesignerQueue(
        supabase,
        tenantId,
        typeof designerId === "string" ? designerId : null
      );
    } catch (err: unknown) {
      console.error(
        "[move] designer queue resequence failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  if (isColumnChange) {
    // Keep the move response fast, but use after() so Vercel/Node doesn't
    // freeze the isolate before SMS / column automations finish.
    const movedOrder = responseOrder;
    after(async () => {
      try {
        await logActivity(supabase, {
          tenantId,
          orderId: typedOrder.id,
          actor: actorUserId,
          action: "moved",
          metadata: {
            from: fromColumnId,
            to: toColumnId,
            fromName: typedFromColumn.name,
            toName: typedColumn.name,
            ...(dueMaterialized
              ? { due_date_materialized: dueMaterialized }
              : {}),
          },
        });
      } catch (err: unknown) {
        console.error(
          "[move] logActivity failed:",
          err instanceof Error ? err.message : err
        );
      }
      try {
        await onEnterColumn(
          supabase,
          movedOrder,
          typedColumn,
          tenantName,
          actorUserId
        );
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
          toColumnId,
          actorUserId
        );
      } catch (err: unknown) {
        console.error(
          "[move] workspace mirror failed:",
          err instanceof Error ? err.message : err
        );
      }
      try {
        const { generateApprovalLayerPreviewsIfWaitingColumn } = await import(
          "@/lib/approval-layer-previews"
        );
        await generateApprovalLayerPreviewsIfWaitingColumn(
          movedOrder,
          typedColumn
        );
      } catch (err: unknown) {
        console.error(
          "[move] approval layer previews failed:",
          err instanceof Error ? err.message : err
        );
      }
      try {
        await fireNotificationRules(orderId, toColumnId, tenantId);
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
          columnKind: typedColumn.kind,
          movedAt: movedOrder.last_moved_at ?? undefined,
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
        if (isInvoiceTriggerStage(typedColumn.name)) {
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

  return { status: 200, body: { order: responseOrder } };
}
