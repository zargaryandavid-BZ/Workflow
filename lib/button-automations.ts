import type {
  ButtonAutomation,
  ButtonAutomationActionType,
  ButtonAutomationEmailConfig,
  ButtonAutomationEmailRecipient,
} from "@/lib/types";

export const BUTTON_ACTION_LABELS: Record<ButtonAutomationActionType, string> = {
  copy_link: "Copy Card Link",
  send_email: "Send Email",
  generate_pdf: "Generate PDF",
};

export const EMAIL_RECIPIENT_LABELS: Record<
  ButtonAutomationEmailRecipient,
  string
> = {
  customer: "Customer email",
  designer: "Assigned Designer",
  custom: "Other",
};

const DEFAULT_SUBJECT =
  "Order {{order_number}} — {{customer_name}}";

function normalizeEmailRecipient(
  value: unknown
): ButtonAutomationEmailRecipient {
  if (value === "customer" || value === "designer" || value === "custom") {
    return value;
  }
  // Legacy configs
  if (value === "staff") return "designer";
  if (value === "both") return "customer";
  return "designer";
}

export function parseEmailConfig(
  config: ButtonAutomation["config"]
): Required<
  Pick<ButtonAutomationEmailConfig, "recipient" | "subject_template">
> &
  Pick<ButtonAutomationEmailConfig, "custom_email"> {
  const c = config as ButtonAutomationEmailConfig;
  return {
    recipient: normalizeEmailRecipient(c.recipient),
    custom_email: c.custom_email?.trim() || undefined,
    subject_template: c.subject_template?.trim() || DEFAULT_SUBJECT,
  };
}

export function filterButtonsForColumn(
  buttons: ButtonAutomation[],
  columnId: string
): ButtonAutomation[] {
  return buttons.filter(
    (btn) =>
      btn.enabled &&
      (btn.column_ids.length === 0 || btn.column_ids.includes(columnId))
  );
}

export function orderCardShareUrl(orderId: string, appUrl: string): string {
  const base = appUrl.replace(/\/$/, "");
  return `${base}/board?order=${orderId}`;
}

export interface ButtonAutomationTemplateContext {
  orderNumber: string;
  customerName: string;
  dueDate: string;
  product: string;
  assignedTo: string;
}

export function renderButtonAutomationTemplate(
  template: string,
  ctx: ButtonAutomationTemplateContext
): string {
  return template
    .replaceAll("{{order_number}}", ctx.orderNumber)
    .replaceAll("{{customer_name}}", ctx.customerName)
    .replaceAll("{{due_date}}", ctx.dueDate)
    .replaceAll("{{product}}", ctx.product)
    .replaceAll("{{assigned_to}}", ctx.assignedTo);
}

export function validateButtonAutomationInput(body: {
  name?: string;
  action_type?: string;
  config?: ButtonAutomationEmailConfig;
}): string | null {
  if (!body.name?.trim()) return "Name is required";
  if (
    !body.action_type ||
    !["copy_link", "send_email", "generate_pdf"].includes(body.action_type)
  ) {
    return "Invalid action type";
  }
  if (body.action_type === "send_email") {
    const cfg = parseEmailConfig(body.config ?? {});
    if (cfg.recipient === "custom" && !cfg.custom_email) {
      return "Email address is required for Other recipient";
    }
    if (
      cfg.custom_email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.custom_email)
    ) {
      return "Invalid custom email";
    }
  }
  return null;
}

export function buildButtonAutomationConfig(
  actionType: ButtonAutomationActionType,
  config?: ButtonAutomationEmailConfig
): ButtonAutomation["config"] {
  if (actionType !== "send_email") return {};
  const parsed = parseEmailConfig(config ?? {});
  return {
    recipient: parsed.recipient,
    ...(parsed.custom_email ? { custom_email: parsed.custom_email } : {}),
    subject_template: parsed.subject_template,
  };
}
