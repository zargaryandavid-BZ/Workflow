import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  fetchOrderGroupSiblings,
  loadOrderExportData,
} from "@/lib/button-automation-order-data";
import { logActivity } from "@/lib/automation";
import { addOrderTag } from "@/lib/order-tags";
import {
  appBaseUrl,
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
import { formatReadyToShipGroupLabel, listOrderGroupMembers } from "@/lib/ready-to-ship-group";
import type {
  NotificationChannel,
  ShippingBox,
  ShippingDimUnit,
  ShippingWeightUnit,
} from "@/lib/types";

const CHANNELS: NotificationChannel[] = ["email", "sms", "manual"];

/**
 * Ready-to-ship notify: creates a shipping portal link and sends one SMS/email.
 * - choose (default): box sizes required; customer picks pickup or delivery
 * - pickup: no boxes; pre-confirms pickup and sends a ready-for-pickup notice
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    channel?: NotificationChannel;
    boxes?: unknown;
    dimUnit?: ShippingDimUnit;
    weightUnit?: ShippingWeightUnit;
    fulfillment?: "choose" | "pickup";
    toEmail?: string;
    toPhone?: string;
    subject?: string;
    messageBody?: string;
  };

  if (!body.channel || !CHANNELS.includes(body.channel)) {
    return NextResponse.json(
      { error: "channel must be email, sms, or manual" },
      { status: 422 }
    );
  }

  const pickupOnly = body.fulfillment === "pickup";

  const dimUnit: ShippingDimUnit = body.dimUnit === "cm" ? "cm" : "in";
  const weightUnit: ShippingWeightUnit =
    body.weightUnit === "kg" ? "kg" : "lbs";
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

  const email =
    body.toEmail?.trim() || exportData.customerEmail?.trim() || null;
  const phone =
    body.toPhone?.trim() || exportData.customerPhone?.trim() || null;

  if (body.channel === "email" && !email) {
    return NextResponse.json(
      { error: "Customer email is required." },
      { status: 422 }
    );
  }
  if (body.channel === "sms" && !phone) {
    return NextResponse.json(
      { error: "Customer phone number is required." },
      { status: 422 }
    );
  }

  const nowIso = new Date().toISOString();

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
      status: pickupOnly ? "client_responded" : "pending",
      client_choice: pickupOnly ? "pickup" : null,
      sent_at: nowIso,
      responded_at: pickupOnly ? nowIso : null,
    })
    .select("id, token")
    .single();

  if (insertError || !shippingReq) {
    const msg = insertError?.message?.includes("shipping_requests")
      ? "Shipping requests require migration 0044_shipping_requests.sql."
      : insertError?.message ?? "Failed to create shipping request";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const portalUrl = `${appBaseUrl()}/shipping/${shippingReq.token}`;

  let orderLabel =
    exportData.orderNumberDisplay || exportData.orderNumber || exportData.order.title;
  try {
    const members = await listOrderGroupMembers(supabase, ctx.tenant.id, {
      id: exportData.order.id,
      title: exportData.order.title,
      column_id: exportData.order.column_id,
      description: exportData.order.description,
      specs: (exportData.order.specs ?? {}) as Record<string, unknown>,
    });
    if (members.length > 1) {
      orderLabel = formatReadyToShipGroupLabel(members);
    }
  } catch {
    // keep single-order label
  }

  let emailSent = false;
  let smsSent = false;

  if (body.channel !== "manual") {
    const templates = await getMessageTemplates(supabase, ctx.tenant.id);
    const emailOverrides =
      body.channel === "email"
        ? {
            emailSubject: body.subject?.trim() || null,
            emailBody: body.messageBody?.trim() || null,
          }
        : {};
    const notify = pickupOnly
      ? await (async () => {
          const settings = await loadShippingSettings(supabase, ctx.tenant.id);
          const config = resolveFedExConfig(settings);
          const [street, cityLine, hours] = pickupLocationFromConfig(config);
          return sendPickupReadyNotifications({
            email: body.channel === "email" ? email : null,
            phone: body.channel === "sms" ? phone : null,
            customerName: exportData.customerName,
            orderNumber: orderLabel,
            portalUrl,
            pickupLocation: [street, cityLine].filter(Boolean).join(", "),
            pickupHours: hours ?? "",
            tenantName: ctx.tenant.name,
            templates,
            ...emailOverrides,
          });
        })()
      : await sendShippingPortalNotifications({
          email: body.channel === "email" ? email : null,
          phone: body.channel === "sms" ? phone : null,
          customerName: exportData.customerName,
          orderNumber: orderLabel,
          portalUrl,
          tenantName: ctx.tenant.name,
          templates,
          ...emailOverrides,
        });
    emailSent = notify.emailSent;
    smsSent = notify.smsSent;
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
  }

  // Track as ready_to_ship so the RTS popup "already sent" check still works.
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("job_notifications").insert({
    tenant_id: ctx.tenant.id,
    order_id: orderId,
    type: "ready_to_ship",
    channel: body.channel,
    token_expires_at: expiresAt,
    status: body.channel === "manual" ? "pending" : "sent",
    created_by: ctx.userId,
    staff_note: `portal:${shippingReq.token}`,
  });

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

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    actor: ctx.userId,
    action: "shipping_link_sent",
    metadata: {
      source: "ready_to_ship",
      shippingRequestId: shippingReq.id,
      token: shippingReq.token,
      portalUrl,
      channel: body.channel,
      fulfillment: pickupOnly ? "pickup" : "choose",
      emailSent,
      smsSent,
      boxCount: parsedBoxes.boxes.length,
      taggedOrderIds: tagTargets.map((t) => t.id),
    },
  });

  return NextResponse.json({
    ok: true,
    token: shippingReq.token,
    portalUrl,
    emailSent,
    smsSent,
    fulfillment: pickupOnly ? "pickup" : "choose",
    taggedCount: tagTargets.length,
  });
}
