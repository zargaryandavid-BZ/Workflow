import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/automation";
import { loadOrderExportData } from "@/lib/button-automation-order-data";
import { sendTransactionalEmail } from "@/lib/email";
import {
  formatPickupDateTime,
  pickupRecipientName,
  savePickupConfirmation,
  type PickupConfirmation,
  type PickupConfirmationInput,
} from "@/lib/fulfillment-pickup";
import { getMessageTemplates } from "@/lib/message-templates.server";
import {
  buildOrderPickedUpEmailBody,
  buildOrderPickedUpEmailHtml,
  buildOrderPickedUpSmsBody,
  orderPickedUpEmailSubject,
} from "@/lib/notification-messages";
import { insertOrderSmsMessage } from "@/lib/order-sms";
import { sendSms } from "@/lib/sms";

export type PickupCustomerNotice = {
  emailSent: boolean;
  smsSent: boolean;
  message: string;
};

function customerNotice(args: {
  pickedUpBy: string;
  pickedUpAt: string;
  email: string | null;
  phone: string | null;
  emailSent: boolean;
  smsSent: boolean;
  errors: string[];
}): string {
  const detail = `${args.pickedUpBy} on ${args.pickedUpAt}`;
  if (args.emailSent && args.smsSent) {
    return `The customer was emailed and texted that the order was picked up by ${detail}.`;
  }
  if (args.emailSent) {
    return `The customer was emailed that the order was picked up by ${detail}.`;
  }
  if (args.smsSent) {
    return `The customer was texted that the order was picked up by ${detail}.`;
  }
  if (!args.email && !args.phone) {
    return "Pickup saved. This order has no customer email or phone, so no message was sent.";
  }
  const reason = args.errors[0]?.trim();
  return reason
    ? `Pickup saved. The customer message could not be sent: ${reason}`
    : "Pickup saved. The customer message could not be sent.";
}

export async function notifyCustomerOrderPickedUp(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    orderId: string;
    confirmation: PickupConfirmation;
  }
): Promise<PickupCustomerNotice> {
  const pickedUpBy = pickupRecipientName(
    args.confirmation.first_name,
    args.confirmation.last_name
  );
  const pickedUpAt = formatPickupDateTime(args.confirmation.picked_up_at);

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", args.tenantId)
    .maybeSingle();
  const tenantName =
    (typeof tenant?.name === "string" && tenant.name.trim()) ||
    "Bazaar Printing";
  const teamName = `${tenantName} Team`;

  const data = await loadOrderExportData(
    supabase,
    args.orderId,
    args.tenantId,
    tenantName
  );
  const email = data?.customerEmail?.trim() || null;
  const phone = data?.customerPhone?.trim() || null;
  const orderNumber =
    data?.orderNumberDisplay?.trim() ||
    data?.orderNumber?.trim() ||
    "your order";
  const customerName =
    data?.customerName && data.customerName !== "—"
      ? data.customerName
      : "there";

  if (!email && !phone) {
    return {
      emailSent: false,
      smsSent: false,
      message: customerNotice({
        pickedUpBy,
        pickedUpAt,
        email,
        phone,
        emailSent: false,
        smsSent: false,
        errors: [],
      }),
    };
  }

  const templates = await getMessageTemplates(supabase, args.tenantId);
  const smsBody = buildOrderPickedUpSmsBody({
    customerName,
    orderNumber,
    pickedUpBy,
    pickedUpAt,
    brand: tenantName,
    templates,
  });
  const emailText = buildOrderPickedUpEmailBody({
    customerName,
    orderNumber,
    pickedUpBy,
    pickedUpAt,
    teamName,
    brand: tenantName,
    templates,
  });

  let emailSent = false;
  let smsSent = false;
  const errors: string[] = [];

  if (email) {
    const result = await sendTransactionalEmail({
      to: email,
      subject: orderPickedUpEmailSubject(orderNumber, templates, {
        customer_name: customerName,
        picked_up_by: pickedUpBy,
        picked_up_at: pickedUpAt,
        team_name: teamName,
        brand: tenantName,
      }),
      html: buildOrderPickedUpEmailHtml({
        customerName,
        orderNumber,
        pickedUpBy,
        pickedUpAt,
        teamName,
        brand: tenantName,
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
      await insertOrderSmsMessage(supabase, {
        tenantId: args.tenantId,
        orderId: args.orderId,
        direction: "outbound",
        phone,
        body: smsBody,
        twilioSid: result.sid ?? null,
      });
    }
  }

  await logActivity(supabase, {
    tenantId: args.tenantId,
    orderId: args.orderId,
    actor: null,
    action: "order_picked_up_sent",
    metadata: {
      pickedUpBy,
      pickedUpAt,
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
    console.error("[pickup] customer notify errors", args.orderId, errors);
  }

  return {
    emailSent,
    smsSent,
    message: customerNotice({
      pickedUpBy,
      pickedUpAt,
      email,
      phone,
      emailSent,
      smsSent,
      errors,
    }),
  };
}

export async function savePickupAndNotifyCustomer(args: {
  supabase: SupabaseClient;
  tenantId: string;
  input: PickupConfirmationInput;
}): Promise<
  | { confirmation: PickupConfirmation; customerNotified: PickupCustomerNotice }
  | { error: string; status: number }
> {
  const saved = await savePickupConfirmation(args);
  if ("error" in saved) return saved;

  try {
    const customerNotified = await notifyCustomerOrderPickedUp(args.supabase, {
      tenantId: args.tenantId,
      orderId: args.input.orderId.trim(),
      confirmation: saved.confirmation,
    });
    return { confirmation: saved.confirmation, customerNotified };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Customer message failed";
    console.error("[pickup] customer notify failed", reason);
    return {
      confirmation: saved.confirmation,
      customerNotified: {
        emailSent: false,
        smsSent: false,
        message: `Pickup saved. The customer message could not be sent: ${reason}`,
      },
    };
  }
}
