import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
} from "@/lib/constants";
import {
  DEFAULT_MESSAGE_TEMPLATES,
  formatOrderProductLabel,
  renderMessageTemplate,
  staffNoteBlock,
  type MessageTemplateMap,
} from "@/lib/message-templates";
import type { CustomField, OrderWithRelations } from "@/lib/types";

const REPLY_LINK_PLACEHOLDER = "[REPLY_LINK]";

function templatesOrDefault(
  templates?: MessageTemplateMap | null
): MessageTemplateMap {
  return templates ?? DEFAULT_MESSAGE_TEMPLATES;
}

export function parseCustomerContact(
  raw: unknown
): { email: string | null; phone: string | null } {
  const value = String(raw ?? "").trim();
  if (!value) return { email: null, phone: null };
  if (value.includes("@")) return { email: value, phone: null };
  return { email: null, phone: value };
}

export function customerContactFromOrder(
  order: OrderWithRelations,
  fieldValues: Record<string, unknown>,
  customFields: CustomField[]
): { email: string | null; phone: string | null } {
  const contactField = customFields.find(
    (f) =>
      f.name.toLowerCase() === CUSTOMER_CONTACT_FIELD_NAME.toLowerCase()
  );
  const fromField = contactField
    ? parseCustomerContact(fieldValues[contactField.id])
    : { email: null, phone: null };

  return {
    email: fromField.email ?? order.customer?.email ?? null,
    phone: fromField.phone ?? order.customer?.phone ?? null,
  };
}

export function customerNameFromOrder(
  order: OrderWithRelations,
  fieldValues: Record<string, unknown>,
  customFields: CustomField[]
): string {
  const nameField = customFields.find(
    (f) => f.name.toLowerCase() === CUSTOMER_NAME_FIELD_NAME.toLowerCase()
  );
  const fromField = nameField
    ? String(fieldValues[nameField.id] ?? "").trim()
    : "";
  return fromField || order.customer?.name || "there";
}

export function productFromOrder(
  fieldValues: Record<string, unknown>,
  customFields: CustomField[]
): string {
  const productField = customFields.find(
    (f) => f.name.toLowerCase() === "product"
  );
  const value = productField
    ? String(fieldValues[productField.id] ?? "").trim()
    : "";
  return value || "order";
}

export function buildMissingInfoMessage(params: {
  customerName: string;
  product: string;
  orderNumber: string;
  replyLink?: string;
  staffNote?: string | null;
  tenantName?: string;
  templates?: MessageTemplateMap | null;
}) {
  return buildMissingInfoEmailBody({
    customerName: params.customerName,
    productType: params.product,
    orderNumber: params.orderNumber,
    replyLink: params.replyLink ?? REPLY_LINK_PLACEHOLDER,
    staffNote: params.staffNote,
    teamName: params.tenantName ?? "BazaarPrinting Team",
    templates: params.templates,
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** e.g. "Business Cards order (#PO-1)" or "order #PO-1" when product unknown */
export function formatOrderReference(
  productType: string,
  orderNumber: string
): string {
  const product = productType.trim();
  if (!product || product.toLowerCase() === "order") {
    return `order #${orderNumber}`;
  }
  return `${product} order (#${orderNumber})`;
}

function compactPlainEmail(blocks: string[]): string {
  return blocks.filter(Boolean).join("\n\n");
}

/** Shared HTML shell for customer and team emails. */
export function buildBrandedEmailLayout(params: {
  contextLabel: string;
  bodyHtml: string;
  emailTitle?: string;
}): string {
  const contextLabel = escapeHtml(params.contextLabel);
  const title = escapeHtml(params.emailTitle ?? "BazaarPrinting");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0; padding:0; background-color:#eaecf7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eaecf7; padding:24px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px; background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#2563EB; padding:20px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:#ffffff; font-size:16px; font-weight:700; letter-spacing:-0.2px;">BazaarPrinting</td>
                  <td align="right" style="color:rgba(255,255,255,0.85); font-size:13px;">${contextLabel}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 24px;">
              ${params.bodyHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function emailParagraph(html: string) {
  return `<p style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.7;">${html}</p>`;
}

/** Linkify URLs before inserting <br/> so hrefs are not polluted by escaped markup. */
function linkifyEscapedPlainText(text: string): string {
  return text
    .split(/(https?:\/\/[^\s]+)/g)
    .map((part, index) => {
      if (index % 2 === 1) {
        const href = escapeHtml(part);
        return `<a href="${href}" style="color:#2563EB;word-break:break-all;">${href}</a>`;
      }
      return escapeHtml(part).replace(/\n/g, "<br/>");
    })
    .join("");
}

function plainTextToEmailParagraphs(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((block) => emailParagraph(linkifyEscapedPlainText(block)))
    .join("");
}

/** Plain-text customer missing-info email body. */
export function buildMissingInfoEmailBody(params: {
  customerName: string;
  productType: string;
  orderNumber: string;
  replyLink: string;
  staffNote?: string | null;
  teamName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const map = templatesOrDefault(params.templates);
  return renderMessageTemplate(map.missing_info_email_body, {
    customer_name: params.customerName,
    product: formatOrderProductLabel(params.productType),
    order_number: params.orderNumber,
    reply_link: params.replyLink,
    staff_note_block: staffNoteBlock(params.staffNote),
    team_name: params.teamName ?? "BazaarPrinting Team",
    brand: "BazaarPrinting",
  });
}

/** HTML email for Instantly / email clients (full document, not a fragment). */
export function buildMissingInfoEmailHtml(params: {
  customerName: string;
  productType: string;
  orderNumber: string;
  replyLink: string;
  staffNote?: string | null;
  teamName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const text = buildMissingInfoEmailBody(params);
  return buildBrandedEmailLayout({
    contextLabel: `Order #${params.orderNumber}`,
    bodyHtml: plainTextToEmailParagraphs(text),
    emailTitle: missingInfoSubject(params.orderNumber, params.templates, {
      customer_name: params.customerName,
      product: formatOrderProductLabel(params.productType),
      reply_link: params.replyLink,
      staff_note_block: staffNoteBlock(params.staffNote),
      team_name: params.teamName ?? "BazaarPrinting Team",
      brand: "BazaarPrinting",
    }),
  });
}

/** Short SMS body for missing-info notifications. */
export function buildMissingInfoSmsBody(params: {
  customerName?: string | null;
  orderNumber: string;
  replyLink: string;
  brandName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const map = templatesOrDefault(params.templates);
  return renderMessageTemplate(map.missing_info_sms, {
    customer_name: params.customerName?.trim() || "there",
    order_number: params.orderNumber,
    reply_link: params.replyLink,
    brand: params.brandName ?? "BazaarPrinting",
    product: "order",
    team_name: params.brandName ? `${params.brandName} Team` : "BazaarPrinting Team",
    staff_note_block: "",
  });
}

export type MissingInfoSubjectVars = {
  customer_name?: string;
  product?: string;
  reply_link?: string;
  staff_note_block?: string;
  team_name?: string;
  brand?: string;
};

export function missingInfoSubject(
  orderNumber: string,
  templates?: MessageTemplateMap | null,
  vars?: MissingInfoSubjectVars | null
) {
  const map = templatesOrDefault(templates);
  return renderMessageTemplate(map.missing_info_email_subject, {
    order_number: orderNumber,
    customer_name: vars?.customer_name ?? "",
    product: vars?.product ?? "",
    reply_link: vars?.reply_link ?? "",
    staff_note_block: vars?.staff_note_block ?? "",
    team_name: vars?.team_name ?? "",
    brand: vars?.brand ?? "",
  });
}

const APPROVAL_LINK_PLACEHOLDER = "[APPROVAL_LINK]";

export type ApprovalSubjectVars = {
  customer_name?: string;
  product?: string;
  approval_link?: string;
  staff_note_block?: string;
  team_name?: string;
  brand?: string;
};

export function approvalSubject(
  orderNumber: string,
  templates?: MessageTemplateMap | null,
  vars?: ApprovalSubjectVars | null
) {
  const map = templatesOrDefault(templates);
  return renderMessageTemplate(map.approval_email_subject, {
    order_number: orderNumber,
    customer_name: vars?.customer_name ?? "",
    product: vars?.product ?? "",
    approval_link: vars?.approval_link ?? "",
    staff_note_block: vars?.staff_note_block ?? "",
    team_name: vars?.team_name ?? "",
    brand: vars?.brand ?? "",
  });
}

/** Plain-text customer approval email body. */
export function buildApprovalEmailBody(params: {
  customerName: string;
  productType: string;
  orderNumber: string;
  approvalLink: string;
  internalNote?: string | null;
  teamName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const map = templatesOrDefault(params.templates);
  return renderMessageTemplate(map.approval_email_body, {
    customer_name: params.customerName,
    product: formatOrderProductLabel(params.productType),
    order_number: params.orderNumber,
    approval_link: params.approvalLink,
    staff_note_block: staffNoteBlock(params.internalNote),
    team_name: params.teamName ?? "BazaarPrinting Team",
    brand: "BazaarPrinting",
  });
}

export function buildApprovalMessage(params: {
  customerName: string;
  productType: string;
  orderNumber: string;
  teamName?: string;
  templates?: MessageTemplateMap | null;
}) {
  return buildApprovalEmailBody({
    customerName: params.customerName,
    productType: params.productType,
    orderNumber: params.orderNumber,
    approvalLink: APPROVAL_LINK_PLACEHOLDER,
    teamName: params.teamName ?? "BazaarPrinting Team",
    templates: params.templates,
  });
}

/** HTML email for customer approval via Instantly. */
export function buildApprovalEmailHtml(params: {
  customerName: string;
  productType: string;
  orderNumber: string;
  approvalLink: string;
  internalNote?: string | null;
  teamName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const text = buildApprovalEmailBody(params);
  return buildBrandedEmailLayout({
    contextLabel: `Order #${params.orderNumber}`,
    bodyHtml: plainTextToEmailParagraphs(text),
    emailTitle: approvalSubject(params.orderNumber, params.templates, {
      customer_name: params.customerName,
      product: formatOrderProductLabel(params.productType),
      approval_link: params.approvalLink,
      staff_note_block: staffNoteBlock(params.internalNote),
      team_name: params.teamName ?? "BazaarPrinting Team",
      brand: "BazaarPrinting",
    }),
  });
}

/** Short SMS body for customer approval notifications. */
export function buildApprovalSmsBody(params: {
  customerName?: string | null;
  productType: string;
  orderNumber: string;
  approvalLink: string;
  brandName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const map = templatesOrDefault(params.templates);
  return renderMessageTemplate(map.approval_sms, {
    customer_name: params.customerName?.trim() || "there",
    product: formatOrderProductLabel(params.productType),
    order_number: params.orderNumber,
    approval_link: params.approvalLink,
    brand: params.brandName ?? "BazaarPrinting",
  });
}

export function injectApprovalLink(message: string, approvalUrl: string) {
  return message
    .replaceAll(APPROVAL_LINK_PLACEHOLDER, approvalUrl)
    .replaceAll("[reply link added on send]", approvalUrl);
}

export function isPublicAppUrl(url?: string): boolean {
  const value = url ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  try {
    const { hostname } = new URL(value);
    return hostname !== "localhost" && hostname !== "127.0.0.1";
  } catch {
    return false;
  }
}

/** Public customer respond URL for a notification token. */
export function respondUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  return `${base}/respond/${token}`;
}

export function injectReplyLink(message: string, replyUrl: string) {
  return message
    .replaceAll(REPLY_LINK_PLACEHOLDER, replyUrl)
    .replaceAll("${replyLink}", replyUrl);
}

export function messageToEmailHtml(text: string) {
  const escaped = escapeHtml(text.trim());
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n/g, "<br/>"))
    .filter(Boolean)
    .map((block) => emailParagraph(block.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" style="color:#2563EB;word-break:break-all;">$1</a>'
    )))
    .join("");
  return buildBrandedEmailLayout({
    contextLabel: "Notification",
    bodyHtml: paragraphs,
  });
}

/**
 * Renders a notification-rule email body with proper structure:
 * - Order number in the header label
 * - "Key: Value" lines styled as a detail card
 * - All other lines rendered as normal paragraphs
 */
export function buildNotificationRuleEmailHtml(text: string, orderNumber: string): string {
  const lines = text.trim().split("\n");
  const sections: string[] = [];
  const detailRows: { label: string; value: string }[] = [];
  const pendingLines: string[] = [];

  function flushPending() {
    if (!pendingLines.length) return;
    const block = pendingLines.join("\n").trim();
    if (block) {
      sections.push(
        `<p style="margin:0 0 16px; font-size:14px; color:#374151; line-height:1.7;">${linkifyEscapedPlainText(
          block
        )}</p>`
      );
    }
    pendingLines.length = 0;
  }

  function flushDetails() {
    if (!detailRows.length) return;
    const rows = detailRows
      .map(
        (r) =>
          `<tr>` +
          `<td style="padding:9px 16px 9px 0; font-size:13px; color:#6b7280; white-space:nowrap; vertical-align:top; width:38%;">${escapeHtml(r.label)}</td>` +
          `<td style="padding:9px 0; font-size:13px; color:#111827; font-weight:600;">${escapeHtml(r.value)}</td>` +
          `</tr>`
      )
      .join(`<tr><td colspan="2" style="padding:0;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;"/></td></tr>`);
    sections.push(
      `<table cellpadding="0" cellspacing="0" style="width:100%; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:2px 14px; margin:0 0 20px;">` +
        `<tbody>${rows}</tbody>` +
      `</table>`
    );
    detailRows.length = 0;
  }

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushDetails();
      flushPending();
      continue;
    }

    const kvMatch = line.match(/^([^:]{2,30}):\s+(.+)$/);
    if (kvMatch) {
      flushPending();
      detailRows.push({ label: kvMatch[1].trim(), value: kvMatch[2].trim() });
    } else {
      flushDetails();
      pendingLines.push(line);
    }
  }

  flushDetails();
  flushPending();

  return buildBrandedEmailLayout({
    contextLabel: `Order #${orderNumber}`,
    bodyHtml: sections.join(""),
    emailTitle: `Order ${orderNumber} — status update`,
  });
}

export type ReadyToShipSubjectVars = {
  customer_name?: string;
  order_link?: string;
  staff_note_block?: string;
  team_name?: string;
  brand?: string;
};

export function readyToShipSubject(
  orderNumber: string,
  templates?: MessageTemplateMap | null,
  vars?: ReadyToShipSubjectVars | null
) {
  const map = templatesOrDefault(templates);
  return renderMessageTemplate(map.ready_to_ship_email_subject, {
    order_number: orderNumber,
    customer_name: vars?.customer_name ?? "",
    order_link: vars?.order_link ?? "",
    staff_note_block: vars?.staff_note_block ?? "",
    team_name: vars?.team_name ?? "",
    brand: vars?.brand ?? "",
  });
}

const ORDER_LINK_PLACEHOLDER = "[order link added on send]";

/** Ensures a ready-to-ship message includes the public order link. */
export function ensureReadyToShipOrderLink(message: string, orderUrl: string) {
  const injected = injectReplyLink(message, orderUrl)
    .replaceAll(ORDER_LINK_PLACEHOLDER, orderUrl)
    .replaceAll("[reply link added on send]", orderUrl);
  if (injected.includes(orderUrl) || /\/respond\//.test(injected)) {
    return injected;
  }
  return `${injected.trim()}\n\nView your order: ${orderUrl}\nThis link expires in 7 days.`;
}

/** Plain-text "ready to ship/pickup" email body. */
export function buildReadyToShipEmailBody(params: {
  customerName: string;
  orderNumber: string;
  orderLink: string;
  staffNote?: string | null;
  teamName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const map = templatesOrDefault(params.templates);
  return renderMessageTemplate(map.ready_to_ship_email_body, {
    customer_name: params.customerName,
    order_number: params.orderNumber,
    order_link: params.orderLink,
    staff_note_block: staffNoteBlock(params.staffNote),
    team_name: params.teamName ?? "BazaarPrinting Team",
    brand: "BazaarPrinting",
  });
}

/** HTML email for ready-to-ship notifications. */
export function buildReadyToShipEmailHtml(params: {
  customerName: string;
  orderNumber: string;
  orderLink: string;
  staffNote?: string | null;
  teamName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const text = buildReadyToShipEmailBody(params);
  return buildBrandedEmailLayout({
    contextLabel: `Order #${params.orderNumber}`,
    bodyHtml: plainTextToEmailParagraphs(text),
    emailTitle: readyToShipSubject(params.orderNumber, params.templates, {
      customer_name: params.customerName,
      order_link: params.orderLink,
      staff_note_block: staffNoteBlock(params.staffNote),
      team_name: params.teamName ?? "BazaarPrinting Team",
      brand: "BazaarPrinting",
    }),
  });
}

/** Short SMS body for ready-to-ship notifications. */
export function buildReadyToShipSmsBody(params: {
  customerName?: string | null;
  orderNumber: string;
  orderLink: string;
  staffNote?: string | null;
  brandName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const map = templatesOrDefault(params.templates);
  return renderMessageTemplate(map.ready_to_ship_sms, {
    customer_name: params.customerName?.trim() || "there",
    order_number: params.orderNumber,
    order_link: params.orderLink,
    staff_note_block: staffNoteBlock(params.staffNote),
    brand: params.brandName ?? "BazaarPrinting",
    team_name: params.brandName
      ? `${params.brandName} Team`
      : "BazaarPrinting Team",
  });
}

export type ShippingPortalSubjectVars = {
  customer_name?: string;
  portal_url?: string;
  team_name?: string;
};

export function shippingPortalSubject(
  orderNumber: string,
  templates?: MessageTemplateMap | null,
  vars?: ShippingPortalSubjectVars | null
) {
  const map = templatesOrDefault(templates);
  return renderMessageTemplate(map.shipping_portal_email_subject, {
    order_number: orderNumber,
    customer_name: vars?.customer_name ?? "",
    portal_url: vars?.portal_url ?? "",
    team_name: vars?.team_name ?? "",
  });
}

/** Plain-text shipping portal email. */
export function buildShippingPortalEmailBody(params: {
  customerName: string;
  orderNumber: string;
  portalUrl: string;
  teamName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const map = templatesOrDefault(params.templates);
  return renderMessageTemplate(map.shipping_portal_email_body, {
    customer_name: params.customerName,
    order_number: params.orderNumber,
    portal_url: params.portalUrl,
    team_name: params.teamName ?? "BazaarPrinting Team",
  });
}

/** HTML shipping portal email. */
export function buildShippingPortalEmailHtml(params: {
  customerName: string;
  orderNumber: string;
  portalUrl: string;
  teamName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const text = buildShippingPortalEmailBody(params);
  return buildBrandedEmailLayout({
    contextLabel: `Order #${params.orderNumber}`,
    bodyHtml: plainTextToEmailParagraphs(text),
    emailTitle: shippingPortalSubject(params.orderNumber, params.templates, {
      customer_name: params.customerName,
      portal_url: params.portalUrl,
      team_name: params.teamName ?? "BazaarPrinting Team",
    }),
  });
}

/** SMS with portal link for shipping choice. */
export function buildShippingPortalSmsBody(params: {
  customerName?: string | null;
  orderNumber: string;
  portalUrl: string;
  templates?: MessageTemplateMap | null;
}) {
  const map = templatesOrDefault(params.templates);
  return renderMessageTemplate(map.shipping_portal_sms, {
    customer_name: params.customerName?.trim() || "there",
    order_number: params.orderNumber,
    portal_url: params.portalUrl,
  });
}

export function formatFileSize(bytes: number | null | undefined) {
  if (bytes == null || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size < 10 && i > 0 ? size.toFixed(1) : Math.round(size)} ${units[i]}`;
}
