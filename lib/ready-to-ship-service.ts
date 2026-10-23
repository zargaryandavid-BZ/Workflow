import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchOrderGroupSiblings,
  loadOrderExportData,
} from "@/lib/button-automation-order-data";
import { logActivity } from "@/lib/automation";
import { addOrderTag } from "@/lib/order-tags";
import {
  ensureShippingRequestForSend,
  parseShippingBoxes,
  sendPickupReadyNotifications,
  sendShippingPortalNotifications,
  shippingPortalPublicUrl,
} from "@/lib/shipping";
import { getMessageTemplates } from "@/lib/message-templates.server";
import {
  ensureShippingSettings,
  loadPickupLocations,
  resolvePickupNotifyFields,
} from "@/lib/shipping-settings";
import { toStaffPickupLocation } from "@/lib/pickup-locations";
import {
  formatGroupPartLocations,
  formatReadyToShipGroupLabel,
  formatReadyToShipNotifyLabel,
  listOrderGroupMembers,
} from "@/lib/ready-to-ship-group";
import { materializeDueOnProductionMove } from "@/lib/due-date-on-move.server";
import { stopOpenTimersForOrder } from "@/lib/stop-order-timers";
import {
  finishedCustomerSmsKind,
  isFinishedNoReviewStage,
  FINISHED_CUSTOMER_SMS_SPEC_KEY,
} from "@/lib/net-terms-fulfill";
import { notifyCustomerOrderFinished } from "@/lib/finished-order-sms";
import { loadOrderWithRelations } from "@/lib/orders/load-with-relations";
import type {
  NotificationChannel,
  Order,
  ShippingBox,
  ShippingDimUnit,
  ShippingWeightUnit,
} from "@/lib/types";

/**
 * Ready-to-Ship popup logic shared by the signed-in staff routes and the
 * no-login floor scan / kiosk routes (`/fulfillment/scan` on the shop iPad).
 */
export type ReadyToShipCtx = {
  supabase: SupabaseClient;
  tenantId: string;
  tenantName: string;
  userId: string | null;
  /**
   * Floor / kiosk (no login). Notifications only go to the contact saved on
   * the order — typed-in destinations are ignored so the public endpoint
   * can't be used to text or email arbitrary numbers.
   */
  publicMode: boolean;
};

const CHANNELS: NotificationChannel[] = ["email", "sms", "both", "manual"];

export async function tenantNameFor(
  supabase: SupabaseClient,
  tenantId: string
): Promise<string> {
  const { data } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  return ((data as { name?: string } | null)?.name ?? "").trim();
}

/** GET order detail for the popup. */
export async function readyToShipOrder(ctx: ReadyToShipCtx, orderId: string) {
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }
  const order = await loadOrderWithRelations(ctx.supabase, orderId, ctx.tenantId);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  return NextResponse.json({ order });
}

/** GET group status + previous notification date. */
export async function readyToShipCheck(
  ctx: ReadyToShipCtx,
  orderId: string | null,
  columnId: string | null
) {
  if (!orderId || !columnId) {
    return NextResponse.json(
      { error: "orderId and columnId are required" },
      { status: 400 }
    );
  }
  const { supabase, tenantId } = ctx;

  const { data: order } = await supabase
    .from("orders")
    .select("id, title, specs, column_id, description")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const members = await listOrderGroupMembers(supabase, tenantId, {
    id: order.id as string,
    title: order.title as string,
    column_id: order.column_id as string | null,
    description: order.description as string | null,
    specs: (order.specs ?? {}) as Record<string, unknown>,
  });

  const siblingCount = members.length;
  const siblingsInColumn = members.filter((m) => m.column_id === columnId).length;
  const siblingTitles = members.map((m) => m.title);
  const groupLabel = formatReadyToShipGroupLabel(members);
  const notifyLabel = formatReadyToShipNotifyLabel(members, columnId);

  const columnIds = [
    ...new Set(
      members.map((m) => m.column_id).filter((id): id is string => Boolean(id))
    ),
  ];
  const { data: colRows } = columnIds.length
    ? await supabase
        .from("board_columns")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .in("id", columnIds)
    : { data: [] as { id: string; name: string }[] };
  const columnNameById = new Map(
    ((colRows ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
  );
  const partLocations = formatGroupPartLocations(
    members.map((m) => ({
      title: m.title,
      columnName: m.column_id ? (columnNameById.get(m.column_id) ?? null) : null,
    }))
  );
  const groupParts = members.map((member) => ({
    id: member.id,
    title: member.title,
    columnName: member.column_id
      ? (columnNameById.get(member.column_id) ?? "Unknown column")
      : "No column",
  }));

  const memberIds = members.map((m) => m.id);
  const [{ data: previousNotif }, { data: previousShip }] = await Promise.all([
    supabase
      .from("job_notifications")
      .select("created_at")
      .in("order_id", memberIds)
      .eq("type", "ready_to_ship")
      .in("status", ["sent", "responded", "pending"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("shipping_requests")
      .select("sent_at")
      .in("order_id", memberIds)
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const notifAt = previousNotif?.created_at
    ? new Date(previousNotif.created_at as string).getTime()
    : 0;
  const shipAt = previousShip?.sent_at
    ? new Date(previousShip.sent_at as string).getTime()
    : 0;
  const latest =
    notifAt || shipAt ? new Date(Math.max(notifAt, shipAt)).toISOString() : null;

  return NextResponse.json({
    siblingCount,
    siblingsInColumn,
    siblingTitles,
    groupLabel,
    notifyLabel,
    partLocations,
    groupParts,
    previousNotificationDate: latest,
  });
}

/** GET pickup addresses for the pickup option. */
export async function readyToShipPickupLocations(ctx: ReadyToShipCtx) {
  const { supabase, tenantId } = ctx;
  try {
    const settings = await ensureShippingSettings(supabase, tenantId);
    const rows = await loadPickupLocations(supabase, tenantId);
    const locations =
      rows.length > 0
        ? rows.map(toStaffPickupLocation)
        : [
            toStaffPickupLocation({
              id: "settings",
              tenant_id: tenantId,
              name: settings.shipper_street?.trim() || "Shop",
              street: settings.shipper_street ?? "",
              city: settings.shipper_city ?? "",
              state: settings.shipper_state ?? "",
              zip: settings.shipper_zip ?? "",
              country: settings.shipper_country ?? "US",
              hours_note: settings.pickup_hours_note,
              use_for_fedex: true,
              position: 0,
            }),
          ];
    return NextResponse.json({ locations });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load pickup locations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export type ReadyToShipSendBody = {
  channel?: NotificationChannel;
  boxes?: unknown;
  dimUnit?: ShippingDimUnit;
  weightUnit?: ShippingWeightUnit;
  fulfillment?: "choose" | "pickup";
  pickup_location_id?: string;
  toEmail?: string;
  toPhone?: string;
  subject?: string;
  messageBody?: string;
};

/** POST: save boxes, create the shipping link, notify the customer. */
export async function readyToShipSend(
  ctx: ReadyToShipCtx,
  orderId: string,
  body: ReadyToShipSendBody
) {
  const { supabase, tenantId, tenantName } = ctx;
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }
  if (!body.channel || !CHANNELS.includes(body.channel)) {
    return NextResponse.json(
      { error: "channel must be email, sms, both, or manual" },
      { status: 422 }
    );
  }

  const pickupOnly = body.fulfillment === "pickup";
  const dimUnit: ShippingDimUnit = body.dimUnit === "cm" ? "cm" : "in";
  const weightUnit: ShippingWeightUnit = body.weightUnit === "kg" ? "kg" : "lbs";
  const parsedBoxes = pickupOnly
    ? { boxes: [] as ShippingBox[] }
    : parseShippingBoxes(body.boxes, dimUnit, weightUnit);
  if (!pickupOnly && parsedBoxes.error) {
    return NextResponse.json({ error: parsedBoxes.error }, { status: 422 });
  }

  const exportData = await loadOrderExportData(
    supabase,
    orderId,
    tenantId,
    tenantName
  );
  if (!exportData) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const savedEmail = exportData.customerEmail?.trim() || null;
  const savedPhone = exportData.customerPhone?.trim() || null;
  const email = ctx.publicMode ? savedEmail : body.toEmail?.trim() || savedEmail;
  const phone = ctx.publicMode ? savedPhone : body.toPhone?.trim() || savedPhone;

  if (body.channel === "email" && !email) {
    return NextResponse.json(
      {
        error: ctx.publicMode
          ? "No email saved for this customer."
          : "Customer email is required.",
      },
      { status: 422 }
    );
  }
  if (body.channel === "sms" && !phone) {
    return NextResponse.json(
      {
        error: ctx.publicMode
          ? "No phone number saved for this customer."
          : "Customer phone number is required.",
      },
      { status: 422 }
    );
  }
  if (body.channel === "both" && !email && !phone) {
    return NextResponse.json(
      { error: "Customer email or phone number is required." },
      { status: 422 }
    );
  }

  const ensured = await ensureShippingRequestForSend(supabase, {
    tenantId,
    orderId,
    boxes: parsedBoxes.boxes,
    pickupOnly,
  });
  if (!ensured.ok) {
    return NextResponse.json(
      { error: ensured.error },
      { status: ensured.status ?? 500 }
    );
  }
  const { shippingReq, reused } = ensured;

  const portalUrl = await shippingPortalPublicUrl(
    supabase,
    tenantId,
    shippingReq.token
  );

  let orderLabel =
    exportData.orderNumberDisplay || exportData.orderNumber || exportData.order.title;
  try {
    const members = await listOrderGroupMembers(supabase, tenantId, {
      id: exportData.order.id,
      title: exportData.order.title,
      column_id: exportData.order.column_id,
      description: exportData.order.description,
      specs: (exportData.order.specs ?? {}) as Record<string, unknown>,
    });
    if (members.length > 1) {
      orderLabel = formatReadyToShipNotifyLabel(members, exportData.order.column_id);
    }
  } catch {
    // keep single-order label
  }

  let emailSent = false;
  let smsSent = false;

  if (body.channel !== "manual") {
    const templates = await getMessageTemplates(supabase, tenantId);
    const emailOverrides =
      body.channel === "email" || body.channel === "both"
        ? {
            emailSubject: body.subject?.trim() || null,
            emailBody: body.messageBody?.trim() || null,
          }
        : {};
    const notify = pickupOnly
      ? await (async () => {
          const { pickupLocation, pickupHours } = await resolvePickupNotifyFields(
            supabase,
            tenantId,
            body.pickup_location_id
          );
          return sendPickupReadyNotifications({
            email: body.channel === "email" || body.channel === "both" ? email : null,
            phone: body.channel === "sms" || body.channel === "both" ? phone : null,
            customerName: exportData.customerName,
            orderNumber: orderLabel,
            portalUrl,
            pickupLocation,
            pickupHours,
            tenantName,
            templates,
            ...emailOverrides,
          });
        })()
      : await sendShippingPortalNotifications({
          email: body.channel === "email" || body.channel === "both" ? email : null,
          phone: body.channel === "sms" || body.channel === "both" ? phone : null,
          customerName: exportData.customerName,
          orderNumber: orderLabel,
          portalUrl,
          tenantName,
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
            "Could not send email or SMS. Check Gmail/Twilio configuration.",
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
    tenant_id: tenantId,
    order_id: orderId,
    type: "ready_to_ship",
    channel: body.channel,
    token_expires_at: expiresAt,
    status: body.channel === "manual" ? "pending" : "sent",
    created_by: ctx.userId,
    staff_note: `portal:${shippingReq.token}`,
  });

  const siblings = await fetchOrderGroupSiblings(supabase, tenantId, exportData.order);
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
      tenantId,
      "Texted",
      (target.specs ?? {}) as Record<string, unknown>
    );
  }

  await logActivity(supabase, {
    tenantId,
    orderId,
    actor: ctx.userId,
    action: "shipping_link_sent",
    metadata: {
      source: ctx.publicMode ? "ready_to_ship_floor_scan" : "ready_to_ship",
      shippingRequestId: shippingReq.id,
      token: shippingReq.token,
      portalUrl,
      channel: body.channel,
      fulfillment: pickupOnly ? "pickup" : "choose",
      emailSent,
      smsSent,
      boxCount: parsedBoxes.boxes.length,
      taggedOrderIds: tagTargets.map((t) => t.id),
      reused,
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
    reused,
  });
}

/** POST: bring every part of the order into the Ready-to-Ship column. */
export async function readyToShipMoveGroup(
  ctx: ReadyToShipCtx,
  body: { orderId?: string; toColumnId?: string }
) {
  const { supabase, tenantId } = ctx;
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  const toColumnId = typeof body.toColumnId === "string" ? body.toColumnId : "";
  if (!orderId || !toColumnId) {
    return NextResponse.json(
      { error: "orderId and toColumnId are required" },
      { status: 400 }
    );
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, title, column_id, description, specs")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (orderErr) {
    return NextResponse.json({ error: orderErr.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { data: toColumn } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("id", toColumnId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!toColumn) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }
  const toColumnName = (toColumn.name as string | null) ?? "";
  const finishedKind = finishedCustomerSmsKind(toColumnName);
  const stampFinishedSiblings =
    Boolean(finishedKind) && !isFinishedNoReviewStage(toColumnName);

  const members = await listOrderGroupMembers(supabase, tenantId, {
    id: order.id as string,
    title: String(order.title ?? ""),
    column_id: order.column_id as string | null,
    description: order.description as string | null,
    specs: (order.specs ?? {}) as Record<string, unknown>,
  });

  const toMove = members.filter((m) => m.column_id !== toColumnId);
  if (toMove.length === 0) {
    return NextResponse.json({ moved: 0, movedIds: [], toColumnId });
  }

  const { data: existing } = await supabase
    .from("orders")
    .select("position")
    .eq("tenant_id", tenantId)
    .eq("column_id", toColumnId)
    .is("removed_at", null)
    .order("position", { ascending: false })
    .limit(1);
  let nextPos =
    (typeof existing?.[0]?.position === "number" ? existing[0].position : 0) + 1;

  const now = new Date().toISOString();
  const movedIds: string[] = [];
  for (const m of toMove) {
    const stampSpecs =
      stampFinishedSiblings && m.id !== order.id
        ? {
            specs: {
              ...(m.specs ?? {}),
              [FINISHED_CUSTOMER_SMS_SPEC_KEY]: { sent_at: now },
            },
          }
        : {};
    const { error: upErr } = await supabase
      .from("orders")
      .update({
        column_id: toColumnId,
        position: nextPos,
        last_moved_at: now,
        ...stampSpecs,
      })
      .eq("id", m.id)
      .eq("tenant_id", tenantId);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
    await materializeDueOnProductionMove(supabase, {
      tenantId,
      orderId: m.id,
      fromColumnId: m.column_id,
      toColumnId,
      movedAt: now,
    });
    try {
      await stopOpenTimersForOrder(tenantId, m.id);
    } catch {
      /* non-critical */
    }
    movedIds.push(m.id);
    nextPos += 1;
  }

  // Bazaar partner portal: report the card's new column (portal cards only;
  // runs after the response, never throws).
  try {
    const { scheduleBazaarPortalCurrentColumn } = await import("@/lib/bazaar-portal-sync");
    scheduleBazaarPortalCurrentColumn({ tenantId: tenantId, orderIds: movedIds });
  } catch (err) {
    console.error("[bazaar-portal-sync] schedule failed:", err instanceof Error ? err.message : err);
  }

  if (finishedKind) {
    try {
      await notifyCustomerOrderFinished(
        { ...(order as Record<string, unknown>), tenant_id: tenantId } as Order,
        toColumnName
      );
    } catch (err) {
      console.error("[move-group] finished notify failed", err);
    }
  }

  return NextResponse.json({ moved: movedIds.length, movedIds, toColumnId });
}

/**
 * Dispatch for the public routes: `<scanApiBase>/ready-to-ship/<action>`.
 * GET  order?orderId= · check?orderId=&columnId= · pickup-locations
 * POST send { orderId, ... } · move-group { orderId, toColumnId }
 */
export async function handlePublicReadyToShip(
  ctx: ReadyToShipCtx,
  method: "GET" | "POST",
  action: string,
  request: Request
) {
  if (method === "GET") {
    const params = new URL(request.url).searchParams;
    if (action === "order") {
      return readyToShipOrder(ctx, params.get("orderId") ?? "");
    }
    if (action === "check") {
      return readyToShipCheck(ctx, params.get("orderId"), params.get("columnId"));
    }
    if (action === "pickup-locations") {
      return readyToShipPickupLocations(ctx);
    }
  } else {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (action === "send") {
      return readyToShipSend(
        ctx,
        typeof body.orderId === "string" ? body.orderId : "",
        body as ReadyToShipSendBody
      );
    }
    if (action === "move-group") {
      return readyToShipMoveGroup(
        ctx,
        body as { orderId?: string; toColumnId?: string }
      );
    }
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
