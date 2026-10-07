import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/automation";
import { loadOrderExportData } from "@/lib/button-automation-order-data";
import { sendTransactionalEmail } from "@/lib/email";
import { fedexTrackingUrl } from "@/lib/fedex-tracking";
import { getMessageTemplates } from "@/lib/message-templates.server";
import {
  buildFedexTrackingEmailBody,
  buildFedexTrackingEmailHtml,
  buildFedexTrackingSmsBody,
  fedexTrackingEmailSubject,
} from "@/lib/notification-messages";
import { insertOrderSmsMessage } from "@/lib/order-sms";
import { sendSms } from "@/lib/sms";

/**
 * Email/SMS the customer the FedEx tracking link after a label is created.
 * Failures are logged and do not undo the label.
 */
export async function notifyFedexTrackingCreated(
  admin: SupabaseClient,
  args: {
    tenantId: string;
    orderId: string;
    trackingNumber: string;
  }
): Promise<void> {
  const trackingNumber = args.trackingNumber.trim();
  if (!trackingNumber) return;

  const trackingUrl = fedexTrackingUrl(trackingNumber);
  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", args.tenantId)
    .maybeSingle();
  const tenantName =
    (typeof tenant?.name === "string" && tenant.name.trim()) ||
    "Bazaar Printing";
  const teamName = `${tenantName} Team`;

  const data = await loadOrderExportData(
    admin,
    args.orderId,
    args.tenantId,
    tenantName
  );
  const email = data?.customerEmail?.trim() || null;
  const phone = data?.customerPhone?.trim() || null;
  if (!email && !phone) {
    console.info(
      `[fedex-tracking] skip ${args.orderId}: no customer email or phone`
    );
    return;
  }

  const templates = await getMessageTemplates(admin, args.tenantId);
  const orderNumber =
    data?.orderNumberDisplay?.trim() ||
    data?.orderNumber?.trim() ||
    "your order";
  const customerName =
    data?.customerName && data.customerName !== "—"
      ? data.customerName
      : "there";

  const smsBody = buildFedexTrackingSmsBody({
    customerName,
    orderNumber,
    trackingNumber,
    trackingUrl,
    templates,
  });
  const emailText = buildFedexTrackingEmailBody({
    customerName,
    orderNumber,
    trackingNumber,
    trackingUrl,
    teamName,
    templates,
  });

  let emailSent = false;
  let smsSent = false;
  const errors: string[] = [];

  if (email) {
    const subject = fedexTrackingEmailSubject(orderNumber, templates, {
      customer_name: customerName,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      team_name: teamName,
    });
    const result = await sendTransactionalEmail({
      to: email,
      subject,
      html: buildFedexTrackingEmailHtml({
        customerName,
        orderNumber,
        trackingNumber,
        trackingUrl,
        teamName,
        templates,
      }),
      text: emailText,
    });
    emailSent = result.sent;
    if (!result.sent && result.error) errors.push(result.error);
  }

  if (phone) {
    const result = await sendSms({ to: phone, body: smsBody });
    smsSent = result.sent;
    if (!result.sent && result.error) errors.push(result.error);
    if (result.sent) {
      await insertOrderSmsMessage(admin, {
        tenantId: args.tenantId,
        orderId: args.orderId,
        direction: "outbound",
        phone,
        body: smsBody,
        twilioSid: result.sid ?? null,
      });
    }
  }

  await logActivity(admin, {
    tenantId: args.tenantId,
    orderId: args.orderId,
    actor: null,
    action: "fedex_tracking_sent",
    metadata: {
      trackingNumber,
      trackingUrl,
      emailSent,
      smsSent,
      errors,
      email: email ?? undefined,
      phone: phone ?? undefined,
      messageBody: smsSent ? smsBody : emailText,
      emailBody: emailText,
    },
  });

  if (errors.length > 0) {
    console.error("[fedex-tracking] notify errors", args.orderId, errors);
  }
}
