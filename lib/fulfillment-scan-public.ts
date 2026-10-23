import { after, NextResponse } from "next/server";
import { materializeDueOnProductionMove } from "@/lib/due-date-on-move.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findScanButton,
  normalizeScanButtons,
} from "@/lib/fulfillment-scan-config";
import { logActivity, onEnterColumn } from "@/lib/automation";
import { maybeStopPrepressTimersOnColumnLeave } from "@/lib/stop-order-timers";
import { fireNotificationRules } from "@/lib/fire-notification-rules";
import {
  isFulfilledStage,
  notifyCrmOrderFulfilled,
} from "@/lib/net-terms-fulfill";
import { notifyCustomerOrderFinished } from "@/lib/finished-order-sms";
import {
  buildScanCardDisplay,
  nestedCustomer,
  parseScanQuery,
  pickScannedOrder,
  sanitizeScanLookupToken,
  scanDesignerNameFromSpecs,
  scanOwnerNameFromSpecs,
  scanPartLocationsFromMembers,
  scanQtyPerSkuFromSpecs,
} from "@/lib/fulfillment-scan-order";
import { normalizeSkus } from "@/lib/skus";
import { formatShortOrderNumber } from "@/lib/order-number-tokens";
import { listOrderGroupMembers } from "@/lib/ready-to-ship-group";
import { loadScanFinalArtworkPictures } from "@/lib/fulfillment-scan-final-artwork";
import type { Order, BoardColumn } from "@/lib/types";

type Client = SupabaseClient;

/** Public scan lookup used by the kiosk URL and the no-login floor page. */
export async function lookupFulfillmentScan(
  supabase: Client,
  tenantId: string,
  q: string
) {
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  const scanned = parseScanQuery(q);
  const lookupToken = scanned.lookupToken || sanitizeScanLookupToken(q);
  if (!lookupToken) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const orderSelect =
    "id, title, specs, due_date, column_id, customer_id, created_by, customer:customers(id, name, email, phone, preferred_channel)";

  const { data: exactRows, error: exactError } = await supabase
    .from("orders")
    .select(orderSelect)
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .or(
      `title.eq.${lookupToken},specs->>webhook_order_number.eq.${lookupToken}`
    );

  if (exactError) {
    return NextResponse.json({ error: exactError.message }, { status: 500 });
  }

  let order = pickScannedOrder(exactRows ?? [], q);

  if (!order) {
    const { data: fuzzyRows, error: fuzzyError } = await supabase
      .from("orders")
      .select(orderSelect)
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .or(
        `title.ilike.%${lookupToken}%,specs->>webhook_order_number.ilike.%${lookupToken}%`
      )
      .limit(40);

    if (fuzzyError) {
      return NextResponse.json({ error: fuzzyError.message }, { status: 500 });
    }
    order = pickScannedOrder(fuzzyRows ?? [], q);
  }

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const specs = (order.specs ?? {}) as Record<string, unknown>;
  const designerId =
    typeof specs.designer_id === "string" ? specs.designer_id.trim() : "";
  const createdBy =
    typeof (order as { created_by?: unknown }).created_by === "string"
      ? ((order as { created_by: string }).created_by)
      : "";

  const profileIds = [...new Set([createdBy, designerId].filter(Boolean))];

  const [columnsRes, fieldsRes, valuesRes, profilesRes, shippingRes, lastSmsRes, members] =
    await Promise.all([
      supabase
        .from("board_columns")
        .select("id, name")
        .eq("tenant_id", tenantId),
      supabase
        .from("custom_fields")
        .select("id, name")
        .eq("tenant_id", tenantId),
      supabase
        .from("custom_field_values")
        .select("custom_field_id, value")
        .eq("order_id", order.id),
      profileIds.length > 0
        ? supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", profileIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      supabase
        .from("shipping_requests")
        .select("id, token, client_choice, status")
        .eq("order_id", order.id)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("order_sms_messages")
        .select("created_at")
        .eq("order_id", order.id)
        .eq("tenant_id", tenantId)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      listOrderGroupMembers(supabase, tenantId, {
        id: order.id as string,
        title: String(order.title ?? ""),
        column_id: (order.column_id as string | null) ?? null,
        specs,
      }),
    ]);

  const finalArtwork = await loadScanFinalArtworkPictures(
    {
      id: order.id as string,
      title: String(order.title ?? ""),
      tenant_id: tenantId,
      specs: specs as never,
    },
    normalizeSkus(specs.skus)
  );
  const skuImages = finalArtwork.pictures;
  const finalArtworkSkuCount = finalArtwork.pageCount || null;

  const fieldNameById = new Map(
    ((fieldsRes.data ?? []) as { id: string; name: string }[]).map((f) => [
      f.id,
      f.name,
    ])
  );
  const fieldValuesByName: Record<string, unknown> = {};
  for (const row of (valuesRes.data ?? []) as {
    custom_field_id: string;
    value: unknown;
  }[]) {
    const name = fieldNameById.get(row.custom_field_id);
    if (!name) continue;
    fieldValuesByName[name] = row.value;
  }

  const card = buildScanCardDisplay({
    specs,
    dueDate: (order as { due_date?: string | null }).due_date,
    fieldValuesByName,
  });

  const profiles = (profilesRes.data ?? []) as {
    id: string;
    full_name: string | null;
  }[];
  const profileName = (id: string) =>
    profiles.find((p) => p.id === id)?.full_name?.trim() || null;

  const columnNameById = new Map(
    ((columnsRes.data ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ])
  );
  const columnName = columnNameById.get(order.column_id as string) ?? null;
  const designerName =
    profileName(designerId) || scanDesignerNameFromSpecs(specs);
  const ownerName =
    profileName(createdBy) || scanOwnerNameFromSpecs(specs);

  const billing = specs.billing as
    | { deposit?: number | null; balance?: number | null }
    | null
    | undefined;

  const customer = nestedCustomer(
    (order as { customer?: unknown }).customer
  );

  const shippingRow = shippingRes.data as {
    id: string;
    token: string | null;
    client_choice: string | null;
    status: string | null;
  } | null;

  const groupParts = scanPartLocationsFromMembers(members, columnNameById);
  const qtyPerSku = scanQtyPerSkuFromSpecs(specs, finalArtworkSkuCount);

  return NextResponse.json({
    id: order.id,
    title: order.title,
    order_number: scanned.orderNumber || formatShortOrderNumber(String(order.title ?? "")),
    main_item_count: groupParts.length || scanned.mainItemCount,
    group_parts: groupParts,
    due_date: (order as { due_date?: string | null }).due_date ?? null,
    due_display: card.dueDisplay,
    column_id: order.column_id,
    column_name: columnName,
    spec_lines: card.specLines,
    qty: card.qty,
    final_artwork_sku_count: finalArtworkSkuCount,
    qty_per_sku: qtyPerSku,
    customer,
    thumbnail_url: skuImages[0]?.url ?? null,
    sku_images: skuImages,
    owner_name: ownerName,
    designer_name: designerName,
    billing: billing
      ? {
          deposit: billing.deposit ?? null,
          balance: billing.balance ?? null,
        }
      : null,
    shipping_request: shippingRow
      ? {
          token: shippingRow.token,
          client_choice: shippingRow.client_choice as "pickup" | "delivery" | "uber" | "curri" | null,
          status: shippingRow.status,
        }
      : null,
    last_sms_at: (lastSmsRes.data as { created_at: string } | null)?.created_at ?? null,
  });
}

/** Public scan column move used by the kiosk URL and the no-login floor page. */
export async function applyFulfillmentScanAction(input: {
  supabase: Client;
  tenantId: string;
  scanColumnConfig: unknown;
  body: {
    order_id?: string;
    button_id?: string;
    action?: string;
  };
  via: "kiosk_scan" | "floor_scan";
}) {
  const { supabase, tenantId, body, via } = input;

  if (!body.order_id?.trim()) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }
  const buttonId = (body.button_id ?? body.action ?? "").trim();
  if (!buttonId) {
    return NextResponse.json({ error: "button_id is required" }, { status: 400 });
  }

  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  const tenantName = (tenantRow as { name: string } | null)?.name ?? "";

  const buttons = normalizeScanButtons(input.scanColumnConfig);
  const button = findScanButton(buttons, buttonId);
  const targetColumnId = button?.columnId ?? null;

  if (!button) {
    return NextResponse.json({ error: "Unknown scan action" }, { status: 400 });
  }
  if (!targetColumnId) {
    return NextResponse.json(
      {
        error: `Column not configured for "${button.label}". Set it in Configure columns.`,
      },
      { status: 422 }
    );
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", body.order_id)
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { data: column, error: colError } = await supabase
    .from("board_columns")
    .select("*")
    .eq("id", targetColumnId)
    .eq("tenant_id", tenantId)
    .single();

  if (colError || !column) {
    return NextResponse.json({ error: "Target column not found" }, { status: 404 });
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      column_id: targetColumnId,
      last_moved_at: new Date().toISOString(),
    })
    .eq("id", body.order_id)
    .eq("tenant_id", tenantId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // After-approval jobs scanned past approval start their deadline clock now.
  await materializeDueOnProductionMove(supabase, {
    tenantId,
    orderId: body.order_id,
    fromColumnId: order.column_id as string | null,
    toColumnId: targetColumnId,
  });

  const { data: sourceColumn } = await supabase
    .from("board_columns")
    .select("name")
    .eq("id", order.column_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  await maybeStopPrepressTimersOnColumnLeave({
    tenantId,
    orderId: body.order_id,
    fromColumn: {
      name: (sourceColumn as { name?: string } | null)?.name,
    },
    toColumn: { name: (column as BoardColumn).name },
  });

  const movedOrder = { ...order, column_id: targetColumnId } as Order;
  const typedColumn = column as BoardColumn;

  after(async () => {
    try {
      await logActivity(supabase, {
        tenantId,
        orderId: movedOrder.id,
        actor: null,
        action: "moved",
        metadata: {
          from: order.column_id,
          to: targetColumnId,
          toName: typedColumn.name,
          via,
        },
      });
    } catch (err) {
      console.error(`[${via}] logActivity failed:`, err);
    }
    // Bazaar partner portal: a scan move must reach the portal like a board move.
    try {
      const { notifyBazaarPortalCurrentColumn } = await import("@/lib/bazaar-portal-sync");
      await notifyBazaarPortalCurrentColumn({ tenantId, orderId: movedOrder.id });
    } catch (err) {
      console.error(`[${via}] bazaar-portal-sync failed:`, err);
    }
    try {
      await onEnterColumn(supabase, movedOrder, typedColumn, tenantName, null);
    } catch (err) {
      console.error(`[${via}] onEnterColumn failed:`, err);
    }
    try {
      await fireNotificationRules(movedOrder.id, targetColumnId, tenantId);
    } catch (err) {
      console.error(`[${via}] fireNotificationRules failed:`, err);
    }
    try {
      if (isFulfilledStage(typedColumn.name)) {
        await notifyCrmOrderFulfilled(movedOrder, typedColumn.name);
      }
    } catch (err) {
      console.error(`[${via}] notifyCrmOrderFulfilled failed:`, err);
    }
    try {
      if (isFulfilledStage(typedColumn.name)) {
        await notifyCustomerOrderFinished(movedOrder, typedColumn.name);
      }
    } catch (err) {
      console.error(`[${via}] notifyCustomerOrderFinished failed:`, err);
    }
  });

  return NextResponse.json({
    success: true,
    order_id: body.order_id,
    button_id: button.id,
    action: button.id,
    column_id: typedColumn.id,
    column_name: typedColumn.name,
  });
}
