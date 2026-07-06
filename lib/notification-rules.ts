import type { OrderExportData } from "@/lib/button-automation-order-data";
import type { NotificationRuleRecipient, NotificationRuleTrigger } from "@/lib/types";

export const NOTIFICATION_RULE_TRIGGER_LABELS: Record<
  NotificationRuleTrigger,
  string
> = {
  on_enter_column: "When a job enters a column",
  on_job_created: "When a new job is created",
};

export const NOTIFICATION_RULE_RECIPIENT_LABELS: Record<
  NotificationRuleRecipient,
  string
> = {
  customer: "Customer",
  staff: "Assigned Staff",
  both: "Both",
};

export const NOTIFICATION_RULE_TEMPLATE_VARS = [
  "{{customer_name}}",
  "{{customer_email}}",
  "{{customer_phone}}",
  "{{order_number}}",
  "{{order_id}}",
  "{{column_name}}",
  "{{column_id}}",
  "{{tenant_id}}",
  "{{due_date}}",
  "{{product}}",
  "{{die}}",
  "{{assigned_to}}",
  "{{moved_at}}",
] as const;

export const DEFAULT_NOTIFICATION_EMAIL_SUBJECT =
  "Your order {{order_number}} — status update";

export const DEFAULT_NOTIFICATION_EMAIL_BODY = `Hi {{customer_name}},

Your order {{order_number}} has moved to {{column_name}}.

Due date: {{due_date}}
Product: {{product}}

Questions? Reply to this email.

— BazaarPrinting`;

export const DEFAULT_NOTIFICATION_SMS_BODY =
  "Hi {{customer_name}}, your order {{order_number}} is now in {{column_name}}. Questions? Call us.";

export const DEFAULT_NOTIFICATION_WEBHOOK_BODY = `{
  "event": "job_status_update",
  "order_id": "{{order_id}}",
  "order_number": "{{order_number}}",
  "status": "{{column_name}}",
  "customer": "{{customer_name}}",
  "customer_email": "{{customer_email}}",
  "moved_at": "{{moved_at}}"
}`;

export interface NotificationRuleTemplateContext {
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  order_number: string;
  order_id: string;
  column_name: string;
  column_id: string;
  tenant_id: string;
  due_date: string;
  product: string;
  die: string;
  assigned_to: string;
  moved_at: string;
}

export function buildNotificationRuleTemplateContext(
  data: OrderExportData,
  extra?: { columnId?: string; tenantId?: string; movedAt?: string }
): NotificationRuleTemplateContext {
  return {
    customer_name: data.customerName === "—" ? "" : data.customerName,
    customer_email: data.customerEmail ?? "",
    customer_phone: data.customerPhone ?? "",
    order_number: data.orderNumber,
    order_id: data.order?.id ?? "",
    column_name: data.columnName,
    column_id: extra?.columnId ?? "",
    tenant_id: extra?.tenantId ?? "",
    due_date: data.dueDateFormatted === "—" ? "" : data.dueDateFormatted,
    product: data.product,
    die: data.die,
    assigned_to: data.assignedToName === "—" ? "" : data.assignedToName,
    moved_at: extra?.movedAt ?? new Date().toISOString(),
  };
}

export function renderNotificationRuleTemplate(
  template: string,
  ctx: NotificationRuleTemplateContext
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = ctx[key as keyof NotificationRuleTemplateContext];
    return value ?? "";
  });
}

export function validateNotificationRuleInput(body: {
  name?: string;
  send_email?: boolean;
  send_sms?: boolean;
  send_webhook?: boolean;
  email_subject?: string;
  email_body?: string;
  sms_body?: string;
  webhook_url?: string;
  recipient?: string;
}): string | null {
  if (!body.name?.trim()) return "Rule name is required";
  if (body.send_email === false && body.send_sms === false && body.send_webhook === false) {
    return "Enable at least one channel (Email, SMS, or Webhook)";
  }
  if (body.send_email) {
    if (!body.email_subject?.trim()) return "Email subject is required";
    if (!body.email_body?.trim()) return "Email message is required";
  }
  if (body.send_sms) {
    if (!body.sms_body?.trim()) return "SMS message is required";
    if (body.sms_body.length > 160) {
      return "SMS message must be 160 characters or fewer";
    }
  }
  if (body.send_webhook) {
    if (!body.webhook_url?.trim()) return "Webhook URL is required";
  }
  if (
    body.recipient &&
    !["customer", "staff", "both"].includes(body.recipient)
  ) {
    return "Invalid recipient";
  }
  return null;
}

export function normalizeNotificationRuleRecipient(
  value: unknown
): NotificationRuleRecipient {
  if (value === "customer" || value === "staff" || value === "both") {
    return value;
  }
  return "customer";
}

export function normalizeNotificationRuleTrigger(
  value: unknown
): NotificationRuleTrigger {
  if (value === "on_enter_column" || value === "on_job_created") {
    return value;
  }
  return "on_enter_column";
}
