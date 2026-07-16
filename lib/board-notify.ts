import {
  approvalSubject,
  buildApprovalEmailBody,
  buildApprovalSmsBody,
  customerContactFromOrder,
  customerNameFromOrder,
  missingInfoSubject,
  productFromOrder,
  buildReadyToShipEmailBody,
  buildReadyToShipSmsBody,
  readyToShipSubject,
} from "@/lib/notification-messages";
import { postJsonWithTimeout } from "@/lib/fetch-with-timeout";
import { resolvePreferredNotifyChannel } from "@/lib/preferred-channel";
import type {
  CustomField,
  NotificationChannel,
  NotificationType,
  OrderWithRelations,
} from "@/lib/types";

export interface NotifyColumnConfig {
  column_id: string;
  notify_type: NotificationType;
  automation_enabled: boolean;
}

function buildSendBody(params: {
  order: OrderWithRelations;
  type: NotificationType;
  channel: NotificationChannel;
  tenantName: string;
  customFields: CustomField[];
  fieldValues: Record<string, unknown>;
  contact: { email: string | null; phone: string | null };
  customerName: string;
  product: string;
}) {
  const { order, type, channel, tenantName, contact, customerName, product } =
    params;
  const teamName = `${tenantName} Team`;

  if (channel === "manual") {
    return { orderId: order.id, type, channel: "manual" as const };
  }

  if (type === "missing_info") {
    return {
      orderId: order.id,
      type,
      channel,
      staffNote: "We need additional information to complete your order.",
      subject: channel === "email" ? missingInfoSubject(order.title) : undefined,
      toEmail: channel === "email" ? contact.email : undefined,
      toPhone: channel === "sms" ? contact.phone : undefined,
    };
  }

  if (type === "ready_to_ship") {
    return {
      orderId: order.id,
      type,
      channel,
      subject: channel === "email" ? readyToShipSubject(order.title) : undefined,
      messageBody:
        channel === "email"
          ? buildReadyToShipEmailBody({ customerName, orderNumber: order.title, teamName })
          : channel === "sms"
            ? buildReadyToShipSmsBody({ customerName, orderNumber: order.title, brandName: tenantName })
            : undefined,
      toEmail: channel === "email" ? contact.email : undefined,
      toPhone: channel === "sms" ? contact.phone : undefined,
    };
  }

  if (channel === "sms") {
    return {
      orderId: order.id,
      type,
      channel,
      messageBody: buildApprovalSmsBody({
        customerName,
        productType: product,
        orderNumber: order.title,
        approvalLink: "[reply link added on send]",
        brandName: tenantName,
      }),
      toPhone: contact.phone,
    };
  }

  return {
    orderId: order.id,
    type,
    channel,
    subject: approvalSubject(order.title),
    messageBody: buildApprovalEmailBody({
      customerName,
      productType: product,
      orderNumber: order.title,
      approvalLink: "[reply link added on send]",
      teamName,
    }),
    toEmail: contact.email,
  };
}

/** Runs the configured column notification without opening a popup. */
export async function runColumnNotify(params: {
  order: OrderWithRelations;
  notifyColumn: NotifyColumnConfig;
  tenantName: string;
  customFields: CustomField[];
  fieldValues: Record<string, unknown>;
  smsConfigured: boolean;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const contact = customerContactFromOrder(
    params.order,
    params.fieldValues,
    params.customFields
  );
  const customerName = customerNameFromOrder(
    params.order,
    params.fieldValues,
    params.customFields
  );
  const product = productFromOrder(params.fieldValues, params.customFields);

  const channel: NotificationChannel = params.notifyColumn.automation_enabled
    ? resolvePreferredNotifyChannel(
        contact,
        params.order.customer?.preferred_channel,
        params.smsConfigured
      )
    : "manual";

  const body = buildSendBody({
    order: params.order,
    type: params.notifyColumn.notify_type,
    channel,
    tenantName: params.tenantName,
    customFields: params.customFields,
    fieldValues: params.fieldValues,
    contact,
    customerName,
    product,
  });

  try {
    const { ok, data } = await postJsonWithTimeout<{ error?: string }>(
      "/api/notifications/send",
      body
    );
    if (!ok) {
      return {
        ok: false,
        error: data.error ?? "Failed to save notification",
      };
    }

    if (channel === "manual") {
      return { ok: true, message: "Saved — manual follow-up" };
    }
    if (channel === "email") {
      return { ok: true, message: "Notification email sent" };
    }
    return { ok: true, message: "Notification SMS sent" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to notify customer",
    };
  }
}
