import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isCustomerEmailConfigured,
  sendNotificationEmail,
} from "@/lib/email";
import {
  approvalSubject,
  buildApprovalEmailHtml,
  buildApprovalSmsBody,
  buildMissingInfoEmailHtml,
  buildMissingInfoSmsBody,
  injectApprovalLink,
  injectReplyLink,
  messageToEmailHtml,
  missingInfoSubject,
} from "@/lib/notification-messages";
import { isSmsConfigured, normalizeSmsPhone, sendSms } from "@/lib/sms";
import { getEnabledNotifyRule, logActivity, onApprovalResult } from "@/lib/automation";
import type {
  CustomerResponse,
  JobNotification,
  NotificationChannel,
  NotificationType,
  Order,
} from "@/lib/types";

type Client = SupabaseClient;

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

async function resolveCustomerContact(
  client: Client,
  order: Order,
  toEmail?: string | null,
  toPhone?: string | null
) {
  let customerEmail: string | null = toEmail ?? null;
  let customerPhone: string | null = toPhone ?? null;
  let customerName: string | null = null;
  if (order.customer_id) {
    const { data: customer } = await client
      .from("customers")
      .select("name, email, phone")
      .eq("id", order.customer_id)
      .maybeSingle();
    const typed = customer as
      | { name: string | null; email: string | null; phone: string | null }
      | null;
    customerEmail = customerEmail ?? typed?.email ?? null;
    customerPhone = customerPhone ?? typed?.phone ?? null;
    customerName = typed?.name ?? null;
  }
  return { customerEmail, customerPhone, customerName };
}

function productFromOrder(order: Order): string {
  const specs = order.specs ?? {};
  const product =
    typeof specs.Product === "string"
      ? specs.Product
      : typeof specs.product === "string"
        ? specs.product
        : null;
  return product?.trim() || "order";
}

async function persistCustomerPhone(
  client: Client,
  order: Order,
  phone: string
) {
  if (!order.customer_id) return;
  await client
    .from("customers")
    .update({
      phone: normalizeSmsPhone(phone),
    })
    .eq("id", order.customer_id);
}

async function deliverNotification(
  client: Client,
  params: {
    notification: JobNotification;
    order: Order;
    tenantName: string;
    channel: "email" | "sms";
    staffNote?: string | null;
    toEmail?: string | null;
    toPhone?: string | null;
    subject?: string | null;
    messageBody?: string | null;
  }
): Promise<{ sent: boolean; error?: string }> {
  const actionUrl = `${appUrl()}/respond/${params.notification.token}`;
  const { customerEmail, customerPhone, customerName } =
    await resolveCustomerContact(
      client,
      params.order,
      params.toEmail,
      params.toPhone
    );

  if (params.channel === "email" && customerEmail) {
    const staffNote = params.staffNote ?? params.notification.staff_note;
    let htmlBody: string | undefined;
    if (params.notification.type === "missing_info") {
      htmlBody = buildMissingInfoEmailHtml({
        customerName: customerName ?? "there",
        productType: productFromOrder(params.order),
        orderNumber: params.order.title,
        replyLink: actionUrl,
        staffNote,
        teamName: `${params.tenantName} Team`,
      });
    } else if (params.notification.type === "customer_approval") {
      if (params.messageBody) {
        htmlBody = messageToEmailHtml(params.messageBody);
      } else {
        htmlBody = buildApprovalEmailHtml({
          customerName: customerName ?? "there",
          productType: productFromOrder(params.order),
          orderNumber: params.order.title,
          approvalLink: actionUrl,
          internalNote: staffNote,
          teamName: `${params.tenantName} Team`,
        });
      }
    } else if (params.messageBody) {
      htmlBody = messageToEmailHtml(
        injectReplyLink(params.messageBody, actionUrl)
      );
    }

    const emailResult = await sendNotificationEmail({
      to: customerEmail,
      type: params.notification.type,
      orderTitle: params.order.title,
      tenantName: params.tenantName,
      actionUrl,
      staffNote,
      customerName,
      productType: productFromOrder(params.order),
      subject:
        params.subject ??
        (params.notification.type === "missing_info"
          ? missingInfoSubject(params.order.title)
          : params.notification.type === "customer_approval"
            ? approvalSubject(params.order.title)
            : undefined),
      htmlBody,
      textBody:
        params.notification.type === "customer_approval" && params.messageBody
          ? params.messageBody
          : undefined,
    });
    if (!emailResult.sent) {
      return {
        sent: false,
        error: emailResult.error ?? deliveryErrorMessage("email"),
      };
    }
  } else if (params.channel === "sms" && customerPhone) {
    const greeting = customerName ? `Hi ${customerName}, ` : "";
    const body =
      params.notification.type === "missing_info"
        ? buildMissingInfoSmsBody({
            customerName,
            orderNumber: params.order.title,
            replyLink: actionUrl,
            brandName: params.tenantName,
          })
        : params.notification.type === "customer_approval"
          ? buildApprovalSmsBody({
              customerName,
              productType: productFromOrder(params.order),
              orderNumber: params.order.title,
              approvalLink: actionUrl,
              brandName: params.tenantName,
            })
          : params.messageBody
            ? injectReplyLink(params.messageBody, actionUrl)
            : `${greeting}we need more info for "${params.order.title}". Please respond: ${actionUrl}`;
    const smsResult = await sendSms({ to: customerPhone, body });
    if (!smsResult.sent) {
      return {
        sent: false,
        error: smsResult.error ?? deliveryErrorMessage("sms"),
      };
    }
    await persistCustomerPhone(client, params.order, customerPhone);
  } else {
    console.info(
      `[notification-link:${params.notification.type}] ${actionUrl}`
    );
    return {
      sent: false,
      error:
        params.channel === "email"
          ? "Customer email is required to send."
          : "Customer phone number is required to send.",
    };
  }

  await client
    .from("job_notifications")
    .update({ channel: params.channel, status: "sent" })
    .eq("id", params.notification.id);

  await logActivity(client, {
    tenantId: params.order.tenant_id,
    orderId: params.order.id,
    actor: null,
    action: "customer_notified",
    metadata: {
      type: params.notification.type,
      channel: params.channel,
      notificationId: params.notification.id,
    },
  });

  return { sent: true };
}

function deliveryErrorMessage(channel: "email" | "sms"): string {
  if (channel === "email") {
    if (!isCustomerEmailConfigured()) {
      return "Email not configured. Add INSTANTLY_API_KEY.";
    }
    return "Email failed. Check INSTANTLY_API_KEY.";
  }
  if (!isSmsConfigured()) {
    return "SMS not configured. Please add Twilio credentials.";
  }
  return "SMS failed to send. Please check Twilio config.";
}

/**
 * Saves a staff note on the order. Sends email via Instantly only when an enabled
 * notify automation rule exists for the order's current column.
 */
export async function saveNotificationRequest(
  client: Client,
  params: {
    order: Order;
    tenantName: string;
    type: NotificationType;
    staffNote: string;
    columnId: string;
    createdBy?: string | null;
    toEmail?: string | null;
  }
) {
  const note = params.staffNote.trim();
  if (!note) throw new Error("Note is required");

  const rule = await getEnabledNotifyRule(
    client,
    params.order.tenant_id,
    params.columnId,
    params.type
  );
  const autoSend = Boolean(rule);

  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const { data: notification, error } = await client
    .from("job_notifications")
    .insert({
      tenant_id: params.order.tenant_id,
      order_id: params.order.id,
      type: params.type,
      channel: autoSend ? "email" : "none",
      token_expires_at: expiresAt,
      staff_note: note,
      status: "pending",
      created_by: params.createdBy ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  let emailSent = false;
  if (autoSend) {
    const emailDelivery = await deliverNotification(client, {
      notification: notification as JobNotification,
      order: params.order,
      tenantName: params.tenantName,
      channel: "email",
      staffNote: note,
      toEmail: params.toEmail,
    });
    emailSent = emailDelivery.sent;
  }

  if (!emailSent) {
    await logActivity(client, {
      tenantId: params.order.tenant_id,
      orderId: params.order.id,
      actor: params.createdBy ?? null,
      action: "missing_info_saved",
      metadata: {
        type: params.type,
        notificationId: notification.id,
      },
    });
  }

  return {
    notification: notification as JobNotification,
    emailSent,
    actionUrl: `${appUrl()}/respond/${notification.token}`,
  };
}

/** Manually send an existing saved notification (from the Missing Info tab). */
export async function dispatchNotification(
  client: Client,
  params: {
    notification: JobNotification;
    order: Order;
    tenantName: string;
    channel: "email" | "sms";
    toEmail?: string | null;
    toPhone?: string | null;
    subject?: string | null;
    messageBody?: string | null;
  }
) {
  const delivery = await deliverNotification(client, params);
  if (!delivery.sent) {
    throw new Error(delivery.error ?? deliveryErrorMessage(params.channel));
  }
  return { actionUrl: `${appUrl()}/respond/${params.notification.token}` };
}

/**
 * Creates a customer notification for an order and dispatches it over the
 * chosen channel. `channel: "none"` records the request without sending (the
 * staff member chose to skip / notify manually).
 */
export async function createNotification(
  client: Client,
  params: {
    order: Order;
    tenantName: string;
    type: NotificationType;
    channel: NotificationChannel;
    staffNote?: string | null;
    /** Optional staff override for the destination address/number. */
    toEmail?: string | null;
    toPhone?: string | null;
    createdBy?: string | null;
    subject?: string | null;
    messageBody?: string | null;
  }
) {
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const { data: notification, error } = await client
    .from("job_notifications")
    .insert({
      tenant_id: params.order.tenant_id,
      order_id: params.order.id,
      type: params.type,
      channel: params.channel,
      token_expires_at: expiresAt,
      staff_note: params.staffNote ?? null,
      status: "pending",
      created_by: params.createdBy ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  const actionUrl = `${appUrl()}/respond/${notification.token}`;

  if (params.channel === "email" || params.channel === "sms") {
    const delivery = await deliverNotification(client, {
      notification: notification as JobNotification,
      order: params.order,
      tenantName: params.tenantName,
      channel: params.channel,
      staffNote: params.staffNote,
      toEmail: params.toEmail,
      toPhone: params.toPhone,
      subject: params.subject,
      messageBody:
        params.channel === "email" && params.messageBody
          ? injectApprovalLink(params.messageBody, actionUrl)
          : params.messageBody,
    });
    if (!delivery.sent) {
      throw new Error(
        delivery.error ?? deliveryErrorMessage(params.channel)
      );
    }
  } else if (params.channel === "manual") {
    await logActivity(client, {
      tenantId: params.order.tenant_id,
      orderId: params.order.id,
      actor: params.createdBy ?? null,
      action: "approval_manual",
      metadata: {
        type: params.type,
        notificationId: notification.id,
      },
    });
  } else if (params.channel !== "none") {
    console.info(`[notification-link:${params.type}] ${actionUrl}`);
    await logActivity(client, {
      tenantId: params.order.tenant_id,
      orderId: params.order.id,
      actor: params.createdBy ?? null,
      action: "customer_notified",
      metadata: { type: params.type, channel: params.channel },
    });
  }

  return { notification, actionUrl };
}

/**
 * Resolves the board column an order should move to when the customer submits
 * the requested information, based on the configured notify rule for the order's
 * current column.
 */
async function customerRepliedColumnId(
  client: Client,
  tenantId: string
): Promise<string | null> {
  const { data } = await client
    .from("board_columns")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", "Customer Replied")
    .limit(1)
    .maybeSingle();
  return (data?.id as string | null) ?? null;
}

async function missingInfoTargetColumn(
  client: Client,
  order: Order
): Promise<string | null> {
  const { data: rules } = await client
    .from("automation_rules")
    .select("*")
    .eq("tenant_id", order.tenant_id)
    .eq("trigger", "on_enter_column")
    .eq("from_column", order.column_id)
    .eq("enabled", true);

  const rule = (rules ?? []).find(
    (r) =>
      (r.config as { action?: string; notify_type?: string })?.action ===
        "notify" &&
      (r.config as { notify_type?: string })?.notify_type === "missing_info"
  );
  const fromRule = (rule?.to_column as string | null) ?? null;
  if (fromRule) return fromRule;
  return customerRepliedColumnId(client, order.tenant_id);
}

/**
 * Records a customer's response to a notification and applies the configured
 * card movement. Returns the resolved customer response value.
 *
 * - customer_approval: moves to the notify rule's target columns when configured
 *   (approved / rejected), otherwise falls back to on_approval_result rules.
 * - missing_info: moves the order to the notify rule's target column.
 */
export async function respondToNotification(
  admin: Client,
  params: {
    token: string;
    response: CustomerResponse;
    note?: string | null;
  }
) {
  const { data: notification } = await admin
    .from("job_notifications")
    .select("*")
    .eq("token", params.token)
    .maybeSingle();

  if (!notification) {
    return {
      ok: false as const,
      error: "This link is invalid or has already been used.",
      status: 404,
    };
  }
  if (notification.status === "responded") {
    return {
      ok: false as const,
      error: "Thank you — we already received your response.",
      status: 409,
    };
  }
  if (
    notification.token_expires_at &&
    new Date(notification.token_expires_at).getTime() < Date.now()
  ) {
    await admin
      .from("job_notifications")
      .update({ status: "expired" })
      .eq("id", notification.id);
    return {
      ok: false as const,
      error: "This link has expired. Please contact us directly.",
      status: 410,
    };
  }

  if (
    notification.type === "missing_info" &&
    params.response === "info_submitted"
  ) {
    const note = params.note?.trim() ?? "";
    const { count } = await admin
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("notification_id", notification.id);
    if (!note && (count ?? 0) === 0) {
      return {
        ok: false as const,
        error: "Please attach a file or leave a note before sending.",
        status: 400,
      };
    }
  }

  // Move the order / log activity before marking the notification responded so
  // Realtime subscribers see the final column when the notification event fires.
  if (notification.type === "customer_approval") {
    if (params.response === "approved") {
      await onApprovalResult(admin, {
        tenantId: notification.tenant_id,
        orderId: notification.order_id,
        result: "approved",
      });
    } else {
      await logActivity(admin, {
        tenantId: notification.tenant_id,
        orderId: notification.order_id,
        actor: null,
        action: "rejected",
        metadata: {
          via: "customer",
          note: params.note?.trim() || null,
        },
      });
    }
  } else {
    const { data: order } = await admin
      .from("orders")
      .select("*")
      .eq("id", notification.order_id)
      .maybeSingle();
    if (order) {
      const target = await missingInfoTargetColumn(admin, order as Order);
      if (target) {
        const { data: column } = await admin
          .from("board_columns")
          .select("name")
          .eq("id", target)
          .maybeSingle();
        await admin
          .from("orders")
          .update({ column_id: target })
          .eq("id", notification.order_id);
        await logActivity(admin, {
          tenantId: notification.tenant_id,
          orderId: notification.order_id,
          actor: null,
          action: "customer_replied",
          metadata: {
            via: "customer",
            toName: (column as { name: string } | null)?.name ?? null,
            note: params.note?.trim() || null,
          },
        });
      } else {
        await logActivity(admin, {
          tenantId: notification.tenant_id,
          orderId: notification.order_id,
          actor: null,
          action: "customer_replied",
          metadata: {
            via: "customer",
            note: params.note?.trim() || null,
          },
        });
      }
    } else {
      await logActivity(admin, {
        tenantId: notification.tenant_id,
        orderId: notification.order_id,
        actor: null,
        action: "customer_replied",
        metadata: {
          via: "customer",
          note: params.note?.trim() || null,
        },
      });
    }
  }

  await admin
    .from("job_notifications")
    .update({
      status: "responded",
      customer_response: params.response,
      customer_note: params.note ?? null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", notification.id);

  return { ok: true as const, type: notification.type as NotificationType };
}
