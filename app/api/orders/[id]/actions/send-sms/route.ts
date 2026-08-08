import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  assertButtonVisibleForOrder,
  fetchOrderGroupSiblings,
  loadOrderExportData,
} from "@/lib/button-automation-order-data";
import {
  parseSmsConfig,
  resolveSmsPhone,
  renderButtonAutomationTemplate,
} from "@/lib/button-automations";
import { logActivity } from "@/lib/automation";
import { sendSms, isSmsConfigured } from "@/lib/sms";
import { actionTagForButton, addOrderTag } from "@/lib/order-tags";
import { insertOrderSmsMessage } from "@/lib/order-sms";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    button_id?: string;
  };
  if (!body.button_id) {
    return NextResponse.json({ error: "button_id required" }, { status: 422 });
  }

  if (!isSmsConfigured()) {
    return NextResponse.json(
      {
        error:
          "SMS is not configured on this account. Add Twilio credentials in your environment.",
      },
      { status: 503 }
    );
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

  const phone = resolveSmsPhone(exportData, button.config);
  if (!phone) {
    const parsed = parseSmsConfig(button.config);
    const errorByRecipient: Record<string, string> = {
      customer: "No phone number on this order's customer record",
      custom: "No custom phone number configured on this button",
    };
    return NextResponse.json(
      {
        error:
          errorByRecipient[parsed.recipient] ??
          "No phone number found for this order",
      },
      { status: 422 }
    );
  }

  const parsed = parseSmsConfig(button.config);
  const messageBody = renderButtonAutomationTemplate(parsed.body_template, {
    orderNumber: exportData.orderNumber,
    customerName: exportData.customerName,
    dueDate: exportData.dueDateFormatted,
    product: exportData.product,
    assignedTo: exportData.assignedToName,
  });

  const result = await sendSms({ to: phone, body: messageBody });
  if (!result.sent) {
    return NextResponse.json(
      { error: result.error ?? "Failed to send SMS" },
      { status: 502 }
    );
  }

  // Multi-part orders: if every sibling is in this column, tag all of them.
  // Otherwise only tag the card the SMS was sent from.
  // "Review Request" (and similarly named) buttons tag Review instead of Texted.
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
    : [
        {
          id: orderId,
          specs: exportData.order.specs,
        },
      ];
  const tag = actionTagForButton(button.name, "Texted");

  // Log SMS on every tagged card so Com. History matches the tag. Twilio SID
  // is unique, so only the card the send was triggered from keeps it.
  for (const target of tagTargets) {
    await insertOrderSmsMessage(supabase, {
      tenantId: ctx.tenant.id,
      orderId: target.id,
      direction: "outbound",
      phone,
      body: messageBody,
      twilioSid: target.id === orderId ? (result.sid ?? null) : null,
      actorUserId: ctx.userId,
    });
    await addOrderTag(
      supabase,
      target.id,
      ctx.tenant.id,
      tag,
      (target.specs ?? {}) as Record<string, unknown>
    );
  }

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    actor: ctx.userId,
    action: "texted",
    metadata: {
      buttonId: button.id,
      buttonName: button.name,
      phone,
      channel: "sms",
      messageBody,
      twilioSid: result.sid ?? null,
      taggedOrderIds: tagTargets.map((t) => t.id),
      groupFullyInColumn: allReady,
    },
  });

  return NextResponse.json({
    ok: true,
    taggedCount: tagTargets.length,
  });
}
