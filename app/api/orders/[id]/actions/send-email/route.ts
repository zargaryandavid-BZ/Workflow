import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  assertButtonVisibleForOrder,
  loadOrderExportData,
} from "@/lib/button-automation-order-data";
import {
  buildButtonAutomationEmailHtml,
  buildButtonAutomationEmailSubject,
  buildButtonAutomationEmailText,
  resolveEmailRecipients,
} from "@/lib/button-automation-messages";
import { sendTransactionalEmail } from "@/lib/email";
import type { ButtonAutomationEmailConfig } from "@/lib/types";

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
    "send_email"
  );
  if (buttonError || !button) {
    return NextResponse.json({ error: buttonError }, { status: 400 });
  }

  const config = button.config as ButtonAutomationEmailConfig;
  const recipients = resolveEmailRecipients(exportData, config);
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "No recipient email address found for this order" },
      { status: 422 }
    );
  }

  const subject = buildButtonAutomationEmailSubject(exportData, config);
  const html = buildButtonAutomationEmailHtml(exportData);
  const text = buildButtonAutomationEmailText(exportData);

  const results = await Promise.all(
    recipients.map((to) =>
      sendTransactionalEmail({ to, subject, html, text })
    )
  );

  const failed = results.find((r) => !r.sent);
  if (failed) {
    return NextResponse.json(
      { error: failed.error ?? "Failed to send email" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, sent: recipients.length });
}
