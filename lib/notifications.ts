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
  buildReadyToShipEmailHtml,
  buildReadyToShipSmsBody,
  ensureReadyToShipOrderLink,
  injectApprovalLink,
  injectReplyLink,
  itemTitleFromSpecs,
  messageToEmailHtml,
  missingInfoSubject,
  readyToShipSubject,
} from "@/lib/notification-messages";
import { getMessageTemplates } from "@/lib/message-templates.server";
import {
  formatOrderProductLabel,
  staffNoteBlock,
  type MessageTemplateMap,
} from "@/lib/message-templates";
import {
  formatReadyToShipGroupLabel,
  listOrderGroupMembers,
} from "@/lib/ready-to-ship-group";
import { resolveCustomerApprovalActionUrl } from "@/lib/approval-group";
import { ensureShortCustomerUrl } from "@/lib/short-link";
import { syncCustomerFromNotification } from "@/lib/customers";
import { isSmsConfigured, normalizeSmsPhone, sendSms } from "@/lib/sms";
import { insertOrderSmsMessage } from "@/lib/order-sms";
import { snapshotApprovalFiles } from "@/lib/approval-snapshot";
import { getEnabledNotifyRule, logActivity, onApprovalResult } from "@/lib/automation";
import type {
  CustomerResponse,
  JobNotification,
  NotificationChannel,
  NotificationType,
  Order,
} from "@/lib/types";

type Client = SupabaseClient;

export const NOTIFICATION_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_TTL_MS = NOTIFICATION_TOKEN_TTL_MS;

async function respondCustomerUrl(
  client: Client,
  tenantId: string,
  token: string
): Promise<string> {
  return ensureShortCustomerUrl(client, tenantId, `/respond/${token}`);
}

/** Once an approval round is replaced or decided, its other open links are stale. */
export async function expireOtherApprovalRequests(
  client: Client,
  orderId: string,
  exceptNotificationId: string
) {
  const { error } = await client
    .from("job_notifications")
    .update({ status: "expired" })
    .eq("order_id", orderId)
    .eq("type", "customer_approval")
    .in("status", ["pending", "sent"])
    .neq("id", exceptNotificationId);
  if (error) throw new Error(error.message);
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

type DeliverChannel = "email" | "sms" | "both";

async function deliverNotification(
  client: Client,
  params: {
    notification: JobNotification;
    order: Order;
    tenantName: string;
    channel: DeliverChannel;
    staffNote?: string | null;
    toEmail?: string | null;
    toPhone?: string | null;
    subject?: string | null;
    messageBody?: string | null;
    actorUserId?: string | null;
  }
): Promise<{ sent: boolean; error?: string; channel?: DeliverChannel }> {
  const actionUrl =
    params.notification.type === "customer_approval"
      ? await resolveCustomerApprovalActionUrl(
          client,
          params.order,
          params.notification.token
        )
      : await respondCustomerUrl(
          client,
          params.order.tenant_id,
          params.notification.token
        );
  const { customerEmail, customerPhone, customerName } =
    await resolveCustomerContact(
      client,
      params.order,
      params.toEmail,
      params.toPhone
    );

  let readyToShipOrderLabel = params.order.title;
  if (params.notification.type === "ready_to_ship") {
    const members = await listOrderGroupMembers(
      client,
      params.order.tenant_id,
      params.order
    );
    readyToShipOrderLabel = formatReadyToShipGroupLabel(members);
  }

  // Each order line item is its own part/card — name it so the customer knows
  // exactly which item we need files for.
  const itemTitle = itemTitleFromSpecs(
    params.order.specs,
    productFromOrder(params.order),
    params.order.title
  );

  const syncedCustomerId = await syncCustomerFromNotification(client, {
    tenantId: params.order.tenant_id,
    orderId: params.order.id,
    customerId: params.order.customer_id,
    customerName,
    customerEmail,
    customerPhone,
    toEmail: params.toEmail,
    toPhone: params.toPhone,
  });
  if (syncedCustomerId && syncedCustomerId !== params.order.customer_id) {
    params.order = { ...params.order, customer_id: syncedCustomerId };
  }

  const wantEmail =
    params.channel === "email" || params.channel === "both";
  const wantSms = params.channel === "sms" || params.channel === "both";
  const sentParts: Array<"email" | "sms"> = [];
  const errors: string[] = [];
  let sentSubject: string | null = null;
  let sentEmailBody: string | null = null;
  let sentSmsBody: string | null = null;
  let sentToEmail: string | null = null;
  let sentToPhone: string | null = null;

  let templates: MessageTemplateMap | null = null;
  try {
    templates = await getMessageTemplates(client, params.order.tenant_id);
  } catch {
    templates = null;
  }

  if (wantEmail) {
    if (!customerEmail?.trim()) {
      errors.push("Customer email is required to send.");
    } else {
      const staffNote = params.staffNote ?? params.notification.staff_note;
      let htmlBody: string | undefined;
      if (params.notification.type === "missing_info") {
        htmlBody = buildMissingInfoEmailHtml({
          customerName: customerName ?? "there",
          productType: productFromOrder(params.order),
          orderNumber: params.order.title,
          replyLink: actionUrl,
          itemTitle,
          staffNote,
          teamName: `${params.tenantName} Team`,
          templates,
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
            templates,
          });
        }
      } else if (params.notification.type === "ready_to_ship") {
        if (params.messageBody) {
          htmlBody = messageToEmailHtml(
            ensureReadyToShipOrderLink(params.messageBody, actionUrl)
          );
        } else {
          htmlBody = buildReadyToShipEmailHtml({
            customerName: customerName ?? "there",
            orderNumber: readyToShipOrderLabel,
            orderLink: actionUrl,
            staffNote,
            teamName: `${params.tenantName} Team`,
            templates,
          });
        }
      } else if (params.messageBody) {
        htmlBody = messageToEmailHtml(
          injectReplyLink(params.messageBody, actionUrl)
        );
      }

      const productType = productFromOrder(params.order);
      const productLabel = formatOrderProductLabel(productType);
      const teamName = `${params.tenantName} Team`;
      const noteBlock = staffNoteBlock(staffNote);
      const subjectVars = {
        customer_name: customerName?.trim() || "there",
        product: productLabel,
        item_title: itemTitle,
        reply_link: actionUrl,
        approval_link: actionUrl,
        order_link: actionUrl,
        staff_note_block: noteBlock,
        team_name: teamName,
        brand: params.tenantName,
      };
      const resolvedSubject =
        params.subject ??
        (params.notification.type === "missing_info"
          ? missingInfoSubject(params.order.title, templates, subjectVars)
          : params.notification.type === "customer_approval"
            ? approvalSubject(params.order.title, templates, subjectVars)
            : params.notification.type === "ready_to_ship"
              ? readyToShipSubject(readyToShipOrderLabel, templates, subjectVars)
              : undefined);
      const textBody =
        params.notification.type === "customer_approval" && params.messageBody
          ? params.messageBody
          : params.notification.type === "ready_to_ship" && params.messageBody
            ? ensureReadyToShipOrderLink(params.messageBody, actionUrl)
            : undefined;
      const emailResult = await sendNotificationEmail({
        to: customerEmail,
        type: params.notification.type,
        orderTitle: params.order.title,
        tenantName: params.tenantName,
        actionUrl,
        staffNote,
        customerName,
        productType,
        subject: resolvedSubject,
        htmlBody,
        textBody,
        templates,
      });
      if (emailResult.sent) {
        sentParts.push("email");
        sentToEmail = customerEmail;
        sentSubject = resolvedSubject ?? null;
        sentEmailBody = textBody ?? params.messageBody ?? null;
      } else {
        errors.push(emailResult.error ?? deliveryErrorMessage("email"));
      }
    }
  }

  if (wantSms) {
    if (!customerPhone?.trim()) {
      errors.push("Customer phone number is required to send.");
    } else {
      const greeting = customerName ? `Hi ${customerName}, ` : "";
      const body =
        params.notification.type === "missing_info"
          ? buildMissingInfoSmsBody({
              customerName,
              orderNumber: params.order.title,
              replyLink: actionUrl,
              itemTitle,
              brandName: params.tenantName,
              templates,
            })
          : params.notification.type === "customer_approval"
            ? buildApprovalSmsBody({
                customerName,
                productType: productFromOrder(params.order),
                orderNumber: params.order.title,
                approvalLink: actionUrl,
                brandName: params.tenantName,
                templates,
              })
            : params.notification.type === "ready_to_ship"
              ? buildReadyToShipSmsBody({
                  customerName,
                  orderNumber: readyToShipOrderLabel,
                  orderLink: actionUrl,
                  brandName: params.tenantName,
                  templates,
                })
              : params.messageBody
                ? injectReplyLink(params.messageBody, actionUrl)
                : `${greeting}we need more info for "${params.order.title}". Please respond: ${actionUrl}`;
      const smsResult = await sendSms({ to: customerPhone, body });
      if (smsResult.sent) {
        sentParts.push("sms");
        sentToPhone = customerPhone;
        sentSmsBody = body;
        await insertOrderSmsMessage(client, {
          tenantId: params.order.tenant_id,
          orderId: params.order.id,
          direction: "outbound",
          phone: customerPhone,
          body,
          twilioSid: smsResult.sid ?? null,
          actorUserId: null,
        });
      } else {
        errors.push(smsResult.error ?? deliveryErrorMessage("sms"));
      }
    }
  }

  if (sentParts.length === 0) {
    console.info(
      `[notification-link:${params.notification.type}] ${actionUrl}`
    );
    return {
      sent: false,
      error: errors[0] ?? deliveryErrorMessage(wantEmail ? "email" : "sms"),
    };
  }

  const storedChannel: DeliverChannel =
    sentParts.includes("email") && sentParts.includes("sms")
      ? "both"
      : sentParts[0];

  await client
    .from("job_notifications")
    .update({ channel: storedChannel, status: "sent" })
    .eq("id", params.notification.id);

  await logActivity(client, {
    tenantId: params.order.tenant_id,
    orderId: params.order.id,
    actor: params.actorUserId ?? params.notification.created_by ?? null,
    action: "customer_notified",
    metadata: {
      type: params.notification.type,
      channel: storedChannel,
      notificationId: params.notification.id,
      subject: sentSubject,
      messageBody: sentSmsBody ?? sentEmailBody,
      emailBody: sentEmailBody,
      smsBody: sentSmsBody,
      recipients: sentToEmail ? [sentToEmail] : undefined,
      phone: sentToPhone,
    },
  });

  if (errors.length > 0) {
    return {
      sent: true,
      channel: storedChannel,
      error: errors.join(" "),
    };
  }

  return { sent: true, channel: storedChannel };
}

function deliveryErrorMessage(channel: "email" | "sms" | "both"): string {
  if (channel === "email") {
    if (!isCustomerEmailConfigured()) {
      return "Email not configured. Add INSTANTLY_API_KEY.";
    }
    return "Email failed. Check INSTANTLY_API_KEY.";
  }
  if (channel === "both") {
    return "Failed to send email and/or SMS. Check Instantly and Twilio config.";
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

  if (params.toEmail) {
    const { customerEmail, customerPhone, customerName } =
      await resolveCustomerContact(
        client,
        params.order,
        params.toEmail,
        null
      );
    await syncCustomerFromNotification(client, {
      tenantId: params.order.tenant_id,
      orderId: params.order.id,
      customerId: params.order.customer_id,
      customerName,
      customerEmail,
      customerPhone,
      toEmail: params.toEmail,
    });
  }

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

  if (params.type === "customer_approval") {
    await expireOtherApprovalRequests(
      client,
      params.order.id,
      notification.id as string
    );
  }

  // Freeze the files for this approval round so the history keeps the exact
  // file the customer saw, even after the live file is later replaced.
  if (params.type === "customer_approval") {
    try {
      await snapshotApprovalFiles(client, (notification as JobNotification).id);
    } catch (err) {
      console.error("[approval-snapshot] failed:", err);
    }
  }

  let emailSent = false;
  if (autoSend) {
    const emailDelivery = await deliverNotification(client, {
      notification: notification as JobNotification,
      order: params.order,
      tenantName: params.tenantName,
      channel: "email",
      staffNote: note,
      toEmail: params.toEmail,
      actorUserId: params.createdBy,
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

  const actionUrl =
    params.type === "customer_approval"
      ? await resolveCustomerApprovalActionUrl(
          client,
          params.order,
          (notification as JobNotification).token
        )
      : await respondCustomerUrl(
          client,
          params.order.tenant_id,
          notification.token as string
        );

  return {
    notification: notification as JobNotification,
    emailSent,
    actionUrl,
  };
}

/** Manually send an existing saved notification (from the Missing Info tab). */
export async function dispatchNotification(
  client: Client,
  params: {
    notification: JobNotification;
    order: Order;
    tenantName: string;
    channel: DeliverChannel;
    toEmail?: string | null;
    toPhone?: string | null;
    subject?: string | null;
    messageBody?: string | null;
    actorUserId?: string | null;
  }
) {
  const delivery = await deliverNotification(client, params);
  if (!delivery.sent) {
    throw new Error(delivery.error ?? deliveryErrorMessage(params.channel));
  }
  const actionUrl =
    params.notification.type === "customer_approval"
      ? await resolveCustomerApprovalActionUrl(
          client,
          params.order,
          params.notification.token
        )
      : await respondCustomerUrl(
          client,
          params.order.tenant_id,
          params.notification.token
        );
  return {
    actionUrl,
    warning: delivery.error ?? null,
  };
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

  if (params.type === "customer_approval") {
    await expireOtherApprovalRequests(
      client,
      params.order.id,
      notification.id as string
    );
  }

  if (params.type === "customer_approval") {
    try {
      await snapshotApprovalFiles(client, (notification as JobNotification).id);
    } catch (err) {
      console.error("[approval-snapshot] failed:", err);
    }
  }

  const actionUrl =
    params.type === "customer_approval"
      ? await resolveCustomerApprovalActionUrl(
          client,
          params.order,
          (notification as JobNotification).token
        )
      : await respondCustomerUrl(
          client,
          params.order.tenant_id,
          notification.token as string
        );
  let warning: string | null = null;

  if (
    params.channel === "email" ||
    params.channel === "sms" ||
    params.channel === "both"
  ) {
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
        (params.channel === "email" || params.channel === "both") &&
        params.messageBody
          ? injectApprovalLink(params.messageBody, actionUrl)
          : params.messageBody,
      actorUserId: params.createdBy,
    });
    if (!delivery.sent) {
      throw new Error(
        delivery.error ?? deliveryErrorMessage(params.channel)
      );
    }
    // Partial success (e.g. email ok, SMS failed on channel "both").
    warning = delivery.error ?? null;
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

  return { notification, actionUrl, warning };
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
  if (notification.status === "expired") {
    return {
      ok: false as const,
      error:
        "This request was replaced or closed. Please use the newest link.",
      status: 410,
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
    if (
      params.response === "changes_requested" &&
      !(params.note?.trim())
    ) {
      return {
        ok: false as const,
        error: "Please tell us why the proof was not approved.",
        status: 400,
      };
    }
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
  } else if (notification.type === "ready_to_ship") {
    // View/acknowledge only — do not move the order off Ready to Ship.
    await logActivity(admin, {
      tenantId: notification.tenant_id,
      orderId: notification.order_id,
      actor: null,
      action: "customer_replied",
      metadata: {
        via: "customer",
        type: "ready_to_ship",
        note: params.note?.trim() || null,
      },
    });
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
      customer_note: params.note?.trim() || null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", notification.id);

  if (notification.type === "customer_approval") {
    await expireOtherApprovalRequests(
      admin,
      notification.order_id,
      notification.id
    );
  }

  return { ok: true as const, type: notification.type as NotificationType };
}
