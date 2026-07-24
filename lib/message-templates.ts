/**
 * Per-tenant SMS / email templates for customer notifications.
 * Defaults match the previous hardcoded copy in notification-messages.ts.
 */

export const MESSAGE_TEMPLATE_KEYS = [
  "missing_info_email_subject",
  "missing_info_email_body",
  "missing_info_sms",
  "approval_email_subject",
  "approval_email_body",
  "approval_sms",
  "ready_to_ship_email_subject",
  "ready_to_ship_email_body",
  "ready_to_ship_sms",
  "shipping_portal_email_subject",
  "shipping_portal_email_body",
  "shipping_portal_sms",
  "team_invite_email_subject",
  "team_invite_email_body",
  "password_reset_email_subject",
  "password_reset_email_body",
] as const;

export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number];

export type MessageTemplateMap = Record<MessageTemplateKey, string>;

export type MessageTemplateVars = Record<string, string>;

export const MESSAGE_TEMPLATE_SECTIONS: Array<{
  id: string;
  title: string;
  description: string;
  keys: Array<{
    key: MessageTemplateKey;
    label: string;
    kind: "subject" | "email" | "sms";
  }>;
  variables: string[];
}> = [
  {
    id: "missing_info",
    title: "Missing info",
    description: "Sent when you ask the customer for more information.",
    keys: [
      { key: "missing_info_email_subject", label: "Email subject", kind: "subject" },
      { key: "missing_info_email_body", label: "Email body", kind: "email" },
      { key: "missing_info_sms", label: "SMS", kind: "sms" },
    ],
    variables: [
      "{{customer_name}}",
      "{{order_number}}",
      "{{product}}",
      "{{reply_link}}",
      "{{staff_note_block}}",
      "{{team_name}}",
      "{{brand}}",
    ],
  },
  {
    id: "approval",
    title: "Proof approval",
    description: "Sent when a proof is ready for the customer to approve.",
    keys: [
      { key: "approval_email_subject", label: "Email subject", kind: "subject" },
      { key: "approval_email_body", label: "Email body", kind: "email" },
      { key: "approval_sms", label: "SMS", kind: "sms" },
    ],
    variables: [
      "{{customer_name}}",
      "{{order_number}}",
      "{{product}}",
      "{{approval_link}}",
      "{{staff_note_block}}",
      "{{team_name}}",
      "{{brand}}",
    ],
  },
  {
    id: "ready_to_ship",
    title: "Ready to ship / pickup",
    description: "Sent when the order is ready for pickup or delivery.",
    keys: [
      {
        key: "ready_to_ship_email_subject",
        label: "Email subject",
        kind: "subject",
      },
      { key: "ready_to_ship_email_body", label: "Email body", kind: "email" },
      { key: "ready_to_ship_sms", label: "SMS", kind: "sms" },
    ],
    variables: [
      "{{customer_name}}",
      "{{order_number}}",
      "{{order_link}}",
      "{{staff_note_block}}",
      "{{team_name}}",
      "{{brand}}",
    ],
  },
  {
    id: "shipping_portal",
    title: "Shipping portal",
    description: "Sent with a link for the customer to choose pickup or delivery.",
    keys: [
      {
        key: "shipping_portal_email_subject",
        label: "Email subject",
        kind: "subject",
      },
      {
        key: "shipping_portal_email_body",
        label: "Email body",
        kind: "email",
      },
      { key: "shipping_portal_sms", label: "SMS", kind: "sms" },
    ],
    variables: [
      "{{customer_name}}",
      "{{order_number}}",
      "{{portal_url}}",
      "{{team_name}}",
    ],
  },
  {
    id: "team_invite",
    title: "Team invite",
    description: "Email sent when inviting a teammate to Workflow.",
    keys: [
      {
        key: "team_invite_email_subject",
        label: "Email subject",
        kind: "subject",
      },
      { key: "team_invite_email_body", label: "Email body", kind: "email" },
    ],
    variables: ["{{invitee_name}}", "{{tenant_name}}", "{{invite_url}}"],
  },
  {
    id: "password_reset",
    title: "Password reset",
    description: "Email sent when an admin resets a teammate’s password.",
    keys: [
      {
        key: "password_reset_email_subject",
        label: "Email subject",
        kind: "subject",
      },
      {
        key: "password_reset_email_body",
        label: "Email body",
        kind: "email",
      },
    ],
    variables: ["{{invitee_name}}", "{{tenant_name}}", "{{reset_url}}"],
  },
];

export const DEFAULT_MESSAGE_TEMPLATES: MessageTemplateMap = {
  missing_info_email_subject:
    "Action needed: missing info for order {{order_number}}",
  missing_info_email_body: `Hi {{customer_name}},

We need more information to complete your {{product}} order (#{{order_number}}).{{staff_note_block}}

Please use the link below to attach your file or leave a note:

{{reply_link}}

This link expires in 7 days.

Thank you,
{{team_name}}`,
  missing_info_sms: `Hi {{customer_name}}, we need more info for your order {{order_number}}.
Please reply here: {{reply_link}}
- {{brand}}`,

  approval_email_subject:
    "Your print proof is ready for approval — Order {{order_number}}",
  approval_email_body: `Hi {{customer_name}},
Your {{product}} order (#{{order_number}}) proof is ready for review.{{staff_note_block}}
Please use the link below to approve or request changes:

{{approval_link}}
This link expires in 7 days.
Thank you,
{{team_name}}`,
  approval_sms: `Hi {{customer_name}}, your {{product}} proof for order {{order_number}} is ready.
Approve here: {{approval_link}}
- {{brand}}`,

  ready_to_ship_email_subject: "Your order is ready — #{{order_number}}",
  ready_to_ship_email_body: `Hi {{customer_name}},
Great news! Your order #{{order_number}} is ready.{{staff_note_block}}
View your order details here:
{{order_link}}
This link expires in 7 days.
Please contact us to arrange pickup or delivery.
Thank you,
{{team_name}}`,
  ready_to_ship_sms:
    "Hi, this is Bazaar Printing. Your order {{order_number}} is ready at 306 Boyd St, LA. Available for pickup: Mon-Fri 9:30 AM - 5:30 PM, and Sat until 4:00 PM. View order: {{order_link}} (No-Reply Automated Text)",

  shipping_portal_email_subject:
    "Your order {{order_number}} is ready — choose delivery or pickup",
  shipping_portal_email_body: `Hi {{customer_name}},

Your order {{order_number}} is ready to ship!

Please open this link to choose self pickup or delivery:

{{portal_url}}

This link expires in 7 days.

— {{team_name}}`,
  shipping_portal_sms:
    "Hi {{customer_name}}, your order {{order_number}} is ready! Choose pickup or delivery: {{portal_url}}",

  team_invite_email_subject:
    "You've been invited to join {{tenant_name}} on Workflow",
  team_invite_email_body: `Hi {{invitee_name}},

You've been invited to join {{tenant_name}} on Workflow.
Use the link below to create your account and set your password:

{{invite_url}}
This link expires in 24 hours.
Thank you,
{{tenant_name}} Team`,

  password_reset_email_subject:
    "Reset your password for {{tenant_name}} on Workflow",
  password_reset_email_body: `Hi {{invitee_name}},

An admin at {{tenant_name}} has sent you a password reset link.
Use the link below to set a new password:

{{reset_url}}
This link expires in 24 hours.
Thank you,
{{tenant_name}} Team`,
};

export function staffNoteBlock(note?: string | null): string {
  const trimmed = note?.trim();
  if (!trimmed) return "";
  return `\n\nNote from our team:\n${trimmed}`;
}

export function formatOrderProductLabel(productType: string): string {
  const product = productType.trim();
  if (!product || product.toLowerCase() === "order") return "order";
  return product;
}

/** Replace {{var}} placeholders. Unknown vars become empty string. */
export function renderMessageTemplate(
  template: string,
  vars: MessageTemplateVars
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value == null ? "" : value;
  });
}

export function mergeMessageTemplates(
  stored: Record<string, unknown> | null | undefined
): MessageTemplateMap {
  const result = { ...DEFAULT_MESSAGE_TEMPLATES };
  if (!stored || typeof stored !== "object") return result;
  for (const key of MESSAGE_TEMPLATE_KEYS) {
    const value = stored[key];
    if (typeof value === "string" && value.trim()) {
      result[key] = value;
    }
  }
  return result;
}

export function sanitizeMessageTemplatesPatch(
  patch: Record<string, unknown>
): Partial<MessageTemplateMap> {
  const out: Partial<MessageTemplateMap> = {};
  for (const key of MESSAGE_TEMPLATE_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    out[key] = trimmed || DEFAULT_MESSAGE_TEMPLATES[key];
  }
  return out;
}
