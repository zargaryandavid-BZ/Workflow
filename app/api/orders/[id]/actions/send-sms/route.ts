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
import { addOrderTag } from "@/lib/order-tags";

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

  // Multi-part orders: if every sibling is in this column, tag all of them
  // Texted. Otherwise only tag the card the SMS was sent from.
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
    action: "texted",
    metadata: {
      buttonId: button.id,
      buttonName: button.name,
      phone,
      taggedOrderIds: tagTargets.map((t) => t.id),
      groupFullyInColumn: allReady,
    },
  });

  return NextResponse.json({
    ok: true,
    taggedCount: tagTargets.length,
  });
}
