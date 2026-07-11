import type {
  ButtonAutomation,
  ButtonAutomationActionType,
  ButtonAutomationEmailConfig,
  ButtonAutomationEmailRecipient,
  ButtonAutomationSmsConfig,
  ButtonAutomationSmsRecipient,
} from "@/lib/types";

export const BUTTON_ACTION_LABELS: Record<ButtonAutomationActionType, string> = {
  copy_link: "Copy Card Link",
  send_email: "Send Email",
  send_sms: "Send SMS",
  generate_pdf: "Generate PDF",
  generate_packing_slip: "Generate Packing Slip",
};

export const EMAIL_RECIPIENT_LABELS: Record<
  ButtonAutomationEmailRecipient,
  string
> = {
  customer: "Customer email",
  designer: "Assigned Designer",
  custom: "Other",
};

export const SMS_RECIPIENT_LABELS: Record<ButtonAutomationSmsRecipient, string> = {
  customer: "Customer phone",
  custom: "Custom phone number",
};

const DEFAULT_SMS_BODY = "Order {{order_number}} — {{customer_name}}";

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

function normalizeSmsRecipient(value: unknown): ButtonAutomationSmsRecipient {
  if (value === "customer" || value === "custom") return value;
  return "customer";
}

export function parseSmsConfig(
  config: ButtonAutomation["config"]
): Required<Pick<ButtonAutomationSmsConfig, "recipient" | "body_template">> &
  Pick<ButtonAutomationSmsConfig, "custom_phone"> {
  const c = config as ButtonAutomationSmsConfig;
  return {
    recipient: normalizeSmsRecipient(c.recipient),
    custom_phone: c.custom_phone?.trim() || undefined,
    body_template: c.body_template?.trim() || DEFAULT_SMS_BODY,
  };
}

export interface SmsOrderData {
  customerPhone: string | null;
  orderNumber: string;
  customerName: string;
  dueDateFormatted: string;
  product: string;
  assignedToName: string;
}

export function resolveSmsPhone(
  data: SmsOrderData,
  config: ButtonAutomation["config"]
): string | null {
  const parsed = parseSmsConfig(config);
  if (parsed.recipient === "custom") {
    return parsed.custom_phone ?? null;
  }
  return data.customerPhone ?? null;
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
  config?: ButtonAutomationEmailConfig | ButtonAutomationSmsConfig;
}): string | null {
  if (!body.name?.trim()) return "Name is required";
  if (
    !body.action_type ||
    ![
      "copy_link",
      "send_email",
      "send_sms",
      "generate_pdf",
      "generate_packing_slip",
    ].includes(body.action_type)
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
  if (body.action_type === "send_sms") {
    const cfg = parseSmsConfig(body.config ?? {});
    if (cfg.recipient === "custom" && !cfg.custom_phone) {
      return "Phone number is required for custom recipient";
    }
  }
  return null;
}

export function buildButtonAutomationConfig(
  actionType: ButtonAutomationActionType,
  config?: ButtonAutomationEmailConfig | ButtonAutomationSmsConfig
): ButtonAutomation["config"] {
  if (actionType === "send_email") {
    const parsed = parseEmailConfig((config ?? {}) as ButtonAutomationEmailConfig);
    return {
      recipient: parsed.recipient,
      ...(parsed.custom_email ? { custom_email: parsed.custom_email } : {}),
      subject_template: parsed.subject_template,
    };
  }
  if (actionType === "send_sms") {
    const parsed = parseSmsConfig((config ?? {}) as ButtonAutomationSmsConfig);
    return {
      recipient: parsed.recipient,
      ...(parsed.custom_phone ? { custom_phone: parsed.custom_phone } : {}),
      body_template: parsed.body_template,
    };
  }
  return {};
}
