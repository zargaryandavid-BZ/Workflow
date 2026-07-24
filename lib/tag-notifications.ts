import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTransactionalEmail } from "@/lib/email";
import {
  customerContactFromOrder,
  customerNameFromOrder,
  messageToEmailHtml,
} from "@/lib/notification-messages";
import { renderMessageTemplate } from "@/lib/message-templates";
import {
  normalizeSmsPhone,
  sendSms,
  validateSmsRecipient,
} from "@/lib/sms";
import { normalizeTagNotifyRecipients } from "@/lib/tag-notify-config";
import type { CustomField, OrderWithRelations, Tag } from "@/lib/types";

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v?.trim())))];
}

async function authEmail(
  admin: ReturnType<typeof createAdminClient>,
  userId: string | null | undefined
): Promise<string | null> {
  if (!userId) return null;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return data.user?.email?.trim() || null;
  } catch {
    return null;
  }
}

async function profilePhone(
  client: SupabaseClient,
  userId: string | null | undefined
): Promise<string | null> {
  if (!userId) return null;
  const { data } = await client
    .from("profiles")
    .select("phone")
    .eq("id", userId)
    .maybeSingle();
  const phone = (data as { phone: string | null } | null)?.phone?.trim();
  return phone || null;
}

export type TagNotifyResult = {
  sentEmail: number;
  sentSms: number;
  warnings: string[];
};

/**
 * Sends configured tag notifications for an order.
 * Missing contacts are skipped with warnings (does not throw).
 */
export async function sendTagNotifications(params: {
  client: SupabaseClient;
  tenantId: string;
  orderId: string;
  tag: Tag;
  order: OrderWithRelations;
  customFields: CustomField[];
  fieldValues: Record<string, unknown>;
}): Promise<TagNotifyResult> {
  const { client, tag, order, customFields, fieldValues } = params;
  const warnings: string[] = [];
  let sentEmail = 0;
  let sentSms = 0;

  if (!tag.notify_enabled) {
    return { sentEmail, sentSms, warnings };
  }

  const sendEmail = Boolean(tag.notify_send_email);
  const sendSmsFlag = Boolean(tag.notify_send_sms);
  if (!sendEmail && !sendSmsFlag) {
    warnings.push(
      `Tag "${tag.name}" has notifications on but no channel selected.`
    );
    return { sentEmail, sentSms, warnings };
  }

  const recipients = normalizeTagNotifyRecipients(tag.notify_recipients);
  if (recipients.length === 0) {
    warnings.push(
      `Tag "${tag.name}" has notifications on but no recipients.`
    );
    return { sentEmail, sentSms, warnings };
  }

  const admin = createAdminClient();
  const contact = customerContactFromOrder(order, fieldValues, customFields);
  const customerName = customerNameFromOrder(order, fieldValues, customFields);

  const designerId =
    typeof order.specs?.designer_id === "string"
      ? order.specs.designer_id
      : null;
  const ownerId = order.created_by;

  const designerEmail = recipients.includes("designer")
    ? await authEmail(admin, designerId)
    : null;
  const ownerEmail = recipients.includes("owner")
    ? await authEmail(admin, ownerId)
    : null;
  const designerPhone =
    recipients.includes("designer") && sendSmsFlag
      ? await profilePhone(client, designerId)
      : null;
  const ownerPhone =
    recipients.includes("owner") && sendSmsFlag
      ? await profilePhone(client, ownerId)
      : null;

  const emails: string[] = [];
  const phones: string[] = [];

  if (recipients.includes("customer")) {
    if (sendEmail) {
      if (contact.email) emails.push(contact.email);
      else warnings.push("Customer has no email — skipped.");
    }
    if (sendSmsFlag) {
      if (contact.phone) phones.push(contact.phone);
      else warnings.push("Customer has no phone — skipped.");
    }
  }

  if (recipients.includes("designer")) {
    if (sendEmail) {
      if (designerEmail) emails.push(designerEmail);
      else if (!designerId) warnings.push("No designer assigned — skipped.");
      else warnings.push("Designer has no email — skipped.");
    }
    if (sendSmsFlag) {
      if (designerPhone) phones.push(designerPhone);
      else if (!designerId) {
        /* already warned above when no designer */
      } else {
        warnings.push("Designer has no phone on file — skipped.");
      }
    }
  }

  if (recipients.includes("owner")) {
    if (sendEmail) {
      if (ownerEmail) emails.push(ownerEmail);
      else if (!ownerId) warnings.push("No owner assigned — skipped.");
      else warnings.push("Owner has no email — skipped.");
    }
    if (sendSmsFlag) {
      if (ownerPhone) phones.push(ownerPhone);
      else if (!ownerId) {
        /* already warned above when no owner */
      } else {
        warnings.push("Owner has no phone on file — skipped.");
      }
    }
  }

  if (recipients.includes("custom")) {
    const customEmail = tag.notify_custom_email?.trim() || null;
    const customPhone = tag.notify_custom_phone?.trim() || null;
    if (sendEmail) {
      if (customEmail) emails.push(customEmail);
      else warnings.push("Custom email is empty — skipped.");
    }
    if (sendSmsFlag) {
      if (customPhone) phones.push(customPhone);
      else warnings.push("Custom phone is empty — skipped.");
    }
  }

  const vars: Record<string, string> = {
    order_number: order.title,
    tag_name: tag.name,
    customer_name: customerName,
    designer_name:
      typeof order.specs?.designer_name === "string"
        ? order.specs.designer_name
        : "",
    brand: "BazaarPrinting",
  };

  const subjectTemplate =
    tag.notify_email_subject?.trim() ||
    `Tag update: {{tag_name}} — #{{order_number}}`;
  const emailBodyTemplate =
    tag.notify_email_body?.trim() ||
    `Hi {{customer_name}},\n\nOrder #{{order_number}} was tagged "{{tag_name}}".\n\n— {{brand}}`;
  const smsBodyTemplate =
    tag.notify_sms_body?.trim() ||
    `Bazaar Printing: order {{order_number}} tagged "{{tag_name}}".`;

  const subject = renderMessageTemplate(subjectTemplate, vars);
  const emailText = renderMessageTemplate(emailBodyTemplate, vars);
  const smsText = renderMessageTemplate(smsBodyTemplate, vars);
  const emailHtml = messageToEmailHtml(emailText);

  for (const to of unique(emails)) {
    const result = await sendTransactionalEmail({
      to,
      subject,
      html: emailHtml,
      text: emailText,
    }).catch((err: unknown) => ({
      sent: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));
    if (result.sent) sentEmail += 1;
    else warnings.push(`Email to ${to} failed: ${result.error ?? "unknown"}`);
  }

  for (const raw of unique(phones)) {
    const validationError = validateSmsRecipient(raw);
    if (validationError) {
      warnings.push(`SMS skipped — ${validationError} (${raw})`);
      continue;
    }
    const to = normalizeSmsPhone(raw);
    const result = await sendSms({ to, body: smsText });
    if (result.sent) sentSms += 1;
    else warnings.push(`SMS to ${to} failed: ${result.error ?? "unknown"}`);
  }

  return { sentEmail, sentSms, warnings };
}

/** Load custom field values keyed by field id for an order. */
export async function loadOrderFieldValueMap(
  client: SupabaseClient,
  orderId: string
): Promise<Record<string, unknown>> {
  const { data } = await client
    .from("custom_field_values")
    .select("custom_field_id, value")
    .eq("order_id", orderId);
  const map: Record<string, unknown> = {};
  for (const row of (data ?? []) as {
    custom_field_id: string;
    value: unknown;
  }[]) {
    map[row.custom_field_id] = row.value;
  }
  return map;
}
