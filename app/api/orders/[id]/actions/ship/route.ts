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
  appBaseUrl,
  parseShippingBoxes,
  sendShippingPortalNotifications,
} from "@/lib/shipping";
import { getMessageTemplates } from "@/lib/message-templates.server";
import type { ShippingDimUnit, ShippingWeightUnit } from "@/lib/types";

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
  };

  if (!body.button_id) {
    return NextResponse.json({ error: "button_id required" }, { status: 422 });
  }

  const dimUnit: ShippingDimUnit = body.dimUnit === "cm" ? "cm" : "in";
  const weightUnit: ShippingWeightUnit =
    body.weightUnit === "kg" ? "kg" : "lbs";
  const parsedBoxes = parseShippingBoxes(body.boxes, dimUnit, weightUnit);
  if (parsedBoxes.error) {
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

  const nowIso = new Date().toISOString();

  // Overwrite semantics: resending replaces any prior shipping request for this
  // order. Deleting the old row(s) invalidates the previous portal link (a new
  // token is issued) and clears any earlier customer response, so the next
  // client submission is the single source of truth.
  const { data: supersededRows } = await supabase
    .from("shipping_requests")
    .select("id, token, status, client_choice")
    .eq("tenant_id", ctx.tenant.id)
    .eq("order_id", orderId);
  const superseded = supersededRows ?? [];
  if (superseded.length > 0) {
    const { error: deleteError } = await supabase
      .from("shipping_requests")
      .delete()
      .eq("tenant_id", ctx.tenant.id)
      .eq("order_id", orderId);
    if (deleteError) {
      console.error("[shipping] failed to clear previous request", deleteError);
      return NextResponse.json(
        { error: "Failed to replace the previous shipping request." },
        { status: 500 }
      );
    }
  }

  const { data: shippingReq, error: insertError } = await supabase
    .from("shipping_requests")
    .insert({
      tenant_id: ctx.tenant.id,
      order_id: orderId,
      boxes: parsedBoxes.boxes,
      status: "pending",
      sent_at: nowIso,
    })
    .select("id, token")
    .single();

  if (insertError || !shippingReq) {
    console.error("[shipping] insert failed", insertError);
    const msg = insertError?.message?.includes("shipping_requests")
      ? "Shipping requests require migration 0044_shipping_requests.sql. Run it in Supabase or use supabase db push."
      : insertError?.message ?? "Failed to create shipping request";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const portalUrl = `${appBaseUrl()}/shipping/${shippingReq.token}`;
  const templates = await getMessageTemplates(supabase, ctx.tenant.id);
  const notify = await sendShippingPortalNotifications({
    email,
    phone,
    customerName: exportData.customerName,
    orderNumber: exportData.orderNumberDisplay || exportData.orderNumber,
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
      boxCount: parsedBoxes.boxes.length,
      taggedOrderIds: tagTargets.map((t) => t.id),
      groupFullyInColumn: allReady,
      resent,
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
    taggedCount: tagTargets.length,
    resent,
    replacedResponse: priorResponded,
  });
}
