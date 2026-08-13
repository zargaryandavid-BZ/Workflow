import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  assertButtonVisibleForOrder,
  fetchOrderGroupSiblings,
  loadOrderExportData,
} from "@/lib/button-automation-order-data";
import { logActivity } from "@/lib/automation";
import { addOrderTag } from "@/lib/order-tags";
import {
  requiresStockConfirmationBeforeShip,
  STOCK_GATE_MESSAGE,
} from "@/lib/warehouse-stock";
import { requestWarehouseStockConfirmation } from "@/lib/warehouse-stock.server";
import {
  appBaseUrl,
  ensureShippingRequestForSend,
  parseShippingBoxes,
  sendPickupReadyNotifications,
  sendShippingPortalNotifications,
} from "@/lib/shipping";
import { getMessageTemplates } from "@/lib/message-templates.server";
import {
  loadShippingSettings,
  pickupLocationFromConfig,
  resolveFedExConfig,
} from "@/lib/shipping-settings";
import type { ShippingDimUnit, ShippingWeightUnit, ShippingBox } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    button_id?: string;
    boxes?: unknown;
    dimUnit?: ShippingDimUnit;
    weightUnit?: ShippingWeightUnit;
    fulfillment?: "choose" | "pickup";
  };

  if (!body.button_id) {
    return NextResponse.json({ error: "button_id required" }, { status: 422 });
  }

  // "pickup" = staff already know it's a pickup, so we pre-confirm the request
  // and notify the customer it's ready (no pickup/delivery choice on the portal).
  const pickupOnly = body.fulfillment === "pickup";

  const dimUnit: ShippingDimUnit = body.dimUnit === "cm" ? "cm" : "in";
  const weightUnit: ShippingWeightUnit =
    body.weightUnit === "kg" ? "kg" : "lbs";
  // Pickup-only notices do not need box sizes (no delivery rates).
  const parsedBoxes = pickupOnly
    ? { boxes: [] as ShippingBox[] }
    : parseShippingBoxes(body.boxes, dimUnit, weightUnit);
  if (!pickupOnly && parsedBoxes.error) {
    return NextResponse.json({ error: parsedBoxes.error }, { status: 422 });
  }

  const supabase = await createClient();
  const exportData = await loadOrderExportData(
    supabase,
    orderId,
    ctx.tenant.id,
    ctx.tenant.name
  );
  if (!exportData) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // "With Application" gate: block releasing a combo order (pickup or delivery)
  // until the warehouse confirms the containers are physically in stock.
  if (
    requiresStockConfirmationBeforeShip(
      exportData.order.specs,
      exportData.customFields,
      exportData.fieldValues
    )
  ) {
    const stockReq = await requestWarehouseStockConfirmation(supabase, {
      orderId: exportData.order.id,
      tenantId: ctx.tenant.id,
      title: exportData.order.title,
      specs: exportData.order.specs,
      orderNumber:
        exportData.orderNumberDisplay || exportData.orderNumber || null,
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

  const { error: buttonError, button } = await assertButtonVisibleForOrder(
    supabase,
    body.button_id,
    ctx.tenant.id,
    exportData.order.column_id,
    "send_sms"
  );
  if (buttonError || !button) {
    return NextResponse.json({ error: buttonError }, { status: 400 });
  }

  const email = exportData.customerEmail?.trim() || null;
  const phone = exportData.customerPhone?.trim() || null;
  if (!email && !phone) {
    return NextResponse.json(
      {
        error:
          "No email or phone on this order's customer record. Add a contact before sending.",
      },
      { status: 422 }
    );
  }

  // Reuse unanswered (pending) requests so the old portal link still works.
  // Answered / payment-pending / pickup-only flows still replace prior rows.
  const ensured = await ensureShippingRequestForSend(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    boxes: parsedBoxes.boxes,
    pickupOnly,
  });
  if (!ensured.ok) {
    return NextResponse.json({ error: ensured.error }, { status: 500 });
  }
  const { shippingReq, reused, superseded } = ensured;

  const portalUrl = `${appBaseUrl()}/shipping/${shippingReq.token}`;
  const templates = await getMessageTemplates(supabase, ctx.tenant.id);
  const orderNumber = exportData.orderNumberDisplay || exportData.orderNumber;

  const notify = pickupOnly
    ? await (async () => {
        const settings = await loadShippingSettings(supabase, ctx.tenant.id);
        const config = resolveFedExConfig(settings);
        const [street, cityLine, hours] = pickupLocationFromConfig(config);
        return sendPickupReadyNotifications({
          email,
          phone,
          customerName: exportData.customerName,
          orderNumber,
          portalUrl,
          pickupLocation: [street, cityLine].filter(Boolean).join(", "),
          pickupHours: hours ?? "",
          tenantName: ctx.tenant.name,
          templates,
        });
      })()
    : await sendShippingPortalNotifications({
        email,
        phone,
        customerName: exportData.customerName,
        orderNumber,
        portalUrl,
        tenantName: ctx.tenant.name,
        templates,
      });

  if (!notify.emailSent && !notify.smsSent) {
    return NextResponse.json(
      {
        error:
          notify.errors[0] ??
          "Could not send email or SMS. Check Instantly/Twilio configuration.",
        token: shippingReq.token,
        portalUrl,
      },
      { status: 502 }
    );
  }

  // Same Texted tagging as send-sms when all parts share this column.
  const siblings = await fetchOrderGroupSiblings(
    supabase,
    ctx.tenant.id,
    exportData.order
  );
  const columnId = exportData.order.column_id;
  const siblingsInColumn = siblings.filter((s) => s.column_id === columnId);
  const allReady =
    siblings.length >= 2 && siblingsInColumn.length === siblings.length;
  const tagTargets = allReady
    ? siblingsInColumn
    : [{ id: orderId, specs: exportData.order.specs }];

  for (const target of tagTargets) {
    await addOrderTag(
      supabase,
      target.id,
      ctx.tenant.id,
      "Texted",
      (target.specs ?? {}) as Record<string, unknown>
    );
  }

  const resent = superseded.length > 0;
  const priorResponded = superseded.some(
    (r) => r.status === "client_responded"
  );

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    actor: ctx.userId,
    action: "shipping_link_sent",
    metadata: {
      buttonId: button.id,
      buttonName: button.name,
      shippingRequestId: shippingReq.id,
      token: shippingReq.token,
      portalUrl,
      emailSent: notify.emailSent,
      smsSent: notify.smsSent,
      fulfillment: pickupOnly ? "pickup" : "choose",
      boxCount: parsedBoxes.boxes.length,
      taggedOrderIds: tagTargets.map((t) => t.id),
      groupFullyInColumn: allReady,
      resent,
      reused,
      supersededCount: superseded.length,
      supersededResponded: priorResponded,
    },
  });

  return NextResponse.json({
    ok: true,
    token: shippingReq.token,
    portalUrl,
    emailSent: notify.emailSent,
    smsSent: notify.smsSent,
    fulfillment: pickupOnly ? "pickup" : "choose",
    taggedCount: tagTargets.length,
    resent,
    reused,
    replacedResponse: priorResponded && !reused,
  });
}
