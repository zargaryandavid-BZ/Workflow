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
import {
  PORTAL_FOOTER,
  PORTAL_PRODUCT_NAME,
} from "@/lib/portal-branding";
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

/**
 * The customer-facing title of a single part/card (each order line item is its
 * own board card). Prefers the per-item webhook title, then the product name,
 * then the card's order number/title. Data-driven from the part being notified.
 */
export function itemTitleFromSpecs(
  specs: Record<string, unknown> | null | undefined,
  productType: string,
  orderTitle: string
): string {
  const rawItem =
    specs && typeof specs.webhook_item_title === "string"
      ? specs.webhook_item_title.trim()
      : "";
  if (rawItem) return rawItem;
  const product = productType.trim();
  if (product && product.toLowerCase() !== "order") return product;
  const rawOrder =
    specs && typeof specs.webhook_order_title === "string"
      ? specs.webhook_order_title.trim()
      : "";
  return rawOrder || orderTitle;
}

export function buildMissingInfoMessage(params: {
  customerName: string;
  product: string;
  orderNumber: string;
  replyLink?: string;
  itemTitle?: string;
  staffNote?: string | null;
  tenantName?: string;
  templates?: MessageTemplateMap | null;
}) {
  return buildMissingInfoEmailBody({
    customerName: params.customerName,
    productType: params.product,
    orderNumber: params.orderNumber,
    replyLink: params.replyLink ?? REPLY_LINK_PLACEHOLDER,
    itemTitle: params.itemTitle,
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
  /** Customer portal-style expiry footer. Default true; off for invite/reset. */
  showPortalFooter?: boolean;
}): string {
  const contextLabel = escapeHtml(params.contextLabel);
  const title = escapeHtml(params.emailTitle ?? PORTAL_PRODUCT_NAME);
  const brand = escapeHtml(PORTAL_PRODUCT_NAME);
  const showFooter = params.showPortalFooter !== false;
  const footerRow = showFooter
    ? `<tr>
            <td style="margin:0;padding:10px 16px 14px;background:#ffffff;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;line-height:1.4;text-align:center;">
              ${escapeHtml(PORTAL_FOOTER)}
            </td>
          </tr>`
    : "";

  return `<!DOCTYPE html>
<html style="margin:0;padding:0;">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style type="text/css">
    html, body { margin: 0 !important; padding: 0 !important; }
    body { -webkit-text-size-adjust: 100%; }
    table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    p { margin: 0 !important; }
  </style>
</head>
<body style="margin:0!important;padding:0!important;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0;padding:0;border-collapse:collapse;background-color:#ffffff;width:100%;">
    <tr>
      <td align="center" valign="top" style="margin:0;padding:0;vertical-align:top;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0;padding:0;border-collapse:collapse;max-width:520px;width:100%;background:#ffffff;">
          <tr>
            <td style="margin:0;padding:10px 16px;background:#2563EB;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0;padding:0;border-collapse:collapse;">
                <tr>
                  <td style="margin:0;padding:0;color:#ffffff;font-size:16px;font-weight:700;letter-spacing:-0.2px;line-height:1.2;">${brand}</td>
                  <td align="right" style="margin:0;padding:0;color:rgba(255,255,255,0.85);font-size:13px;line-height:1.2;">${contextLabel}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="margin:0;padding:12px 16px;background:#ffffff;">
              ${params.bodyHtml}
            </td>
          </tr>
          ${footerRow}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const GOOGLE_REVIEW_URL_RE =
  /https?:\/\/(?:g\.page\/r\/[^\s<>"']+|www\.google\.com\/maps[^\s<>"']*|search\.google\.com\/local\/writereview[^\s<>"']*)/i;

const BAZAAR_EMAIL_LOGO_URL = "https://bazaarprinting.com/assets/Bazaar.png";
const BAZAAR_BRAND_BLUE = "#2563EB";
const BAZAAR_BRAND_BLUE_SOFT = "#DBEAFE";

const FEEDBACK_EMAIL_HEADLINE = "We'd love your feedback";
const FEEDBACK_EMAIL_SUBTEXT =
  "Thank you for choosing Bazaar Printing! We want to make sure we exceeded your expectations. Could you take a moment to share your feedback?";

/** Normalize the Google-review notification subject. */
export function normalizeFeedbackEmailSubject(
  subject: string,
  orderNumber?: string
): string {
  const isFeedbackSubject =
    /your feedback helps us grow/i.test(subject) ||
    /will be highly appreciated for your feedback/i.test(subject) ||
    /we'd love your feedback/i.test(subject);
  if (!isFeedbackSubject) return subject;
  const order = orderNumber?.trim();
  if (order) {
    return `We'd love your feedback on Order #${order} | ${PORTAL_PRODUCT_NAME}`;
  }
  return `We'd love your feedback | ${PORTAL_PRODUCT_NAME}`;
}

function extractGoogleReviewUrl(text: string): string | null {
  const match = text.match(GOOGLE_REVIEW_URL_RE);
  if (!match) return null;
  return match[0].replace(/[.,);]+$/g, "");
}

/** Plain-text body for Google review feedback emails. */
export function normalizeFeedbackEmailPlainText(text: string): string {
  const reviewUrl = extractGoogleReviewUrl(text);
  if (!reviewUrl) {
    return text.trim().replace(/\n{3,}/g, "\n\n");
  }
  return [
    FEEDBACK_EMAIL_HEADLINE,
    "",
    FEEDBACK_EMAIL_SUBTEXT,
    "",
    `Leave a Google Review: ${reviewUrl}`,
    "",
    "(+1) 747 348 4444 | info@bazaarprinting.com",
    "306 Boyd St, Los Angeles, CA 90013",
    "Order online: www.bazaarprinting.com",
  ].join("\n");
}

/**
 * SMS body for Google-review feedback. Replaces the legacy one-liner
 * with a short review request + Google review URL.
 */
export function normalizeFeedbackSmsText(
  text: string,
  _orderNumber?: string
): string {
  const reviewUrl = extractGoogleReviewUrl(text);
  if (!reviewUrl) {
    return text.trim().replace(/\n{3,}/g, "\n\n");
  }
  return `Thank you for choosing Bazaar Printing! Could you take a moment to share your feedback? We'd love your review: ${reviewUrl}`;
}

/**
 * Full feedback / Google-review email (wonderblum-style card, Bazaar blue + white).
 */
export function buildGoogleReviewFeedbackEmailHtml(
  orderNumber: string,
  reviewUrl: string
): string {
  const href = escapeHtml(reviewUrl);
  const orderLabel = escapeHtml(`Order #${orderNumber}`);
  const logoUrl = escapeHtml(BAZAAR_EMAIL_LOGO_URL);
  const title = escapeHtml(
    `We'd love your feedback on Order #${orderNumber} | ${PORTAL_PRODUCT_NAME}`
  );
  const brand = escapeHtml(PORTAL_PRODUCT_NAME);
  const footer = escapeHtml(PORTAL_FOOTER);

  const html = `<!DOCTYPE html>
<html style="margin:0;padding:0;">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style type="text/css">
    html, body { margin: 0 !important; padding: 0 !important; }
    body { -webkit-text-size-adjust: 100%; }
    table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    p { margin: 0 !important; }
    img { border: 0; display: block; }
  </style>
</head>
<body style="margin:0!important;padding:0!important;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0;padding:0;width:100%;background-color:#f3f4f6;border-collapse:collapse;">
    <tr>
      <td align="center" style="margin:0;padding:12px 12px;vertical-align:top;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:520px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border-collapse:collapse;">
          <tr>
            <td style="margin:0;padding:12px 18px;background:${BAZAAR_BRAND_BLUE};vertical-align:top;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;">
                <tr>
                  <td style="margin:0;padding:0;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;vertical-align:top;">${brand}</td>
                  <td align="right" style="margin:0;padding:0;color:rgba(255,255,255,0.9);font-size:12px;line-height:1.2;vertical-align:top;">${orderLabel}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="margin:0;padding:18px 20px 8px;background:#ffffff;line-height:0;font-size:0;vertical-align:top;">
              <img src="${logoUrl}" width="64" height="64" alt="Bazaar Printing" style="display:block;width:64px;height:64px;margin:0 auto;border:0;border-radius:10px;" />
            </td>
          </tr>
          <tr>
            <td align="center" style="margin:0;padding:8px 24px 0;background:#ffffff;vertical-align:top;">
              <div style="margin:0;padding:0;font-size:22px;line-height:1.25;font-weight:700;color:#111827;text-align:center;">
                ${escapeHtml(FEEDBACK_EMAIL_HEADLINE)}
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="margin:0;padding:8px 24px 16px;background:#ffffff;vertical-align:top;">
              <div style="margin:0;padding:0;font-size:14px;line-height:1.45;color:#374151;text-align:center;">
                ${escapeHtml(FEEDBACK_EMAIL_SUBTEXT)}
              </div>
            </td>
          </tr>
          <tr>
            <td style="margin:0;padding:0 16px 18px;background:#ffffff;vertical-align:top;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;background:${BAZAAR_BRAND_BLUE_SOFT};border-radius:12px;border-collapse:collapse;">
                <tr>
                  <td align="center" style="padding:16px 16px 6px;vertical-align:top;">
                    <div style="margin:0;padding:0;font-size:17px;line-height:1.25;font-weight:700;color:#1e3a8a;text-align:center;">
                      Rate your experience
                    </div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:0 16px 8px;vertical-align:top;">
                    <div style="margin:0;padding:0;font-size:13px;line-height:1.35;color:#1e40af;text-align:center;">
                      Click below to leave your Google review:
                    </div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:4px 16px 16px;vertical-align:top;">
                    <a href="${href}" target="_blank" rel="noopener noreferrer"
                      style="display:inline-block;background:${BAZAAR_BRAND_BLUE};color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                      <span style="display:block;font-size:20px;line-height:1;letter-spacing:3px;font-weight:700;color:#FACC15;">★★★★★</span>
                      <span style="display:block;font-size:14px;line-height:1.2;font-weight:600;margin-top:4px;color:#ffffff;">Leave a Google Review</span>
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:520px;width:100%;border-collapse:collapse;">
          <tr>
            <td align="center" style="padding:12px 12px 2px;vertical-align:top;">
              <div style="margin:0;padding:0;font-size:11px;line-height:1.4;color:#94a3b8;text-align:center;">
                ${footer}
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 12px 2px;vertical-align:top;">
              <div style="margin:0;padding:0;font-size:12px;line-height:1.4;color:#6b7280;text-align:center;">
                <a href="tel:+17473484444" style="color:#6b7280;text-decoration:none;">(+1) 747 348 4444</a>
                &nbsp;|&nbsp;
                <a href="mailto:info@bazaarprinting.com" style="color:#6b7280;text-decoration:none;">info@bazaarprinting.com</a>
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:2px 12px;vertical-align:top;">
              <div style="margin:0;padding:0;font-size:12px;line-height:1.4;color:#6b7280;text-align:center;">
                306 Boyd St, Los Angeles, CA 90013
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:2px 12px 8px;vertical-align:top;">
              <div style="margin:0;padding:0;font-size:12px;line-height:1.4;color:#6b7280;text-align:center;">
                Order online:
                <a href="https://www.bazaarprinting.com" style="color:${BAZAAR_BRAND_BLUE};text-decoration:none;font-weight:600;">www.bazaarprinting.com</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Instantly converts source newlines into <br> in the delivered MIME — minify.
  return html.replace(/\r?\n/g, "").replace(/>\s+</g, "><").trim();
}

function emailParagraph(html: string) {
  return `<div style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.7;">${html}</div>`;
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
  itemTitle?: string;
  staffNote?: string | null;
  teamName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const map = templatesOrDefault(params.templates);
  const productLabel = formatOrderProductLabel(params.productType);
  return renderMessageTemplate(map.missing_info_email_body, {
    customer_name: params.customerName,
    product: productLabel,
    item_title: params.itemTitle?.trim() || productLabel,
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
  itemTitle?: string;
  staffNote?: string | null;
  teamName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const text = buildMissingInfoEmailBody(params);
  const productLabel = formatOrderProductLabel(params.productType);
  return buildBrandedEmailLayout({
    contextLabel: `Order #${params.orderNumber}`,
    bodyHtml: plainTextToEmailParagraphs(text),
    emailTitle: missingInfoSubject(params.orderNumber, params.templates, {
      customer_name: params.customerName,
      product: productLabel,
      item_title: params.itemTitle?.trim() || productLabel,
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
  itemTitle?: string;
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
    item_title: params.itemTitle?.trim() || "your order",
    team_name: params.brandName ? `${params.brandName} Team` : "BazaarPrinting Team",
    staff_note_block: "",
  });
}

export type MissingInfoSubjectVars = {
  customer_name?: string;
  product?: string;
  item_title?: string;
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
    item_title: vars?.item_title?.trim() || vars?.product || orderNumber,
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
 * - Google review URLs use the dedicated feedback email template
 */
export function buildNotificationRuleEmailHtml(text: string, orderNumber: string): string {
  const reviewUrl = extractGoogleReviewUrl(text);
  if (reviewUrl) {
    return buildGoogleReviewFeedbackEmailHtml(orderNumber, reviewUrl);
  }

  const lines = text.trim().split("\n");
  const sections: string[] = [];
  const detailRows: { label: string; value: string }[] = [];
  const pendingLines: string[] = [];

  function flushPending() {
    if (!pendingLines.length) return;
    const block = pendingLines.join("\n").trim();
    if (block) {
      sections.push(
        `<p style="margin:0 0 8px!important;padding:0;font-size:14px;color:#374151;line-height:1.5;">${linkifyEscapedPlainText(
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
          `<td style="padding:8px 14px 8px 0; font-size:13px; color:#6b7280; white-space:nowrap; vertical-align:top; width:38%;">${escapeHtml(r.label)}</td>` +
          `<td style="padding:8px 0; font-size:13px; color:#111827; font-weight:600;">${escapeHtml(r.value)}</td>` +
          `</tr>`
      )
      .join(`<tr><td colspan="2" style="padding:0;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;"/></td></tr>`);
    sections.push(
      `<table cellpadding="0" cellspacing="0" role="presentation" style="width:100%; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:2px 12px; margin:0 0 12px;">` +
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
const LINK_ADDED_ON_SEND_PLACEHOLDER = "[link added on send]";

/** Ensures a ready-to-ship message includes the public order link. */
export function ensureReadyToShipOrderLink(message: string, orderUrl: string) {
  const injected = injectReplyLink(message, orderUrl)
    .replaceAll(ORDER_LINK_PLACEHOLDER, orderUrl)
    .replaceAll(LINK_ADDED_ON_SEND_PLACEHOLDER, orderUrl)
    .replaceAll("[reply link added on send]", orderUrl);
  if (injected.includes(orderUrl) || /\/respond\//.test(injected)) {
    return injected;
  }
  return `${injected.trim()}\n\nView your order: ${orderUrl}`;
}

/**
 * Injects the shipping portal URL into a staff-edited email/SMS body.
 * Replaces preview placeholders used by ReadyToShipPopup.
 */
export function ensureShippingPortalLink(message: string, portalUrl: string) {
  const injected = injectReplyLink(message, portalUrl)
    .replaceAll(ORDER_LINK_PLACEHOLDER, portalUrl)
    .replaceAll(LINK_ADDED_ON_SEND_PLACEHOLDER, portalUrl)
    .replaceAll("[reply link added on send]", portalUrl);
  if (
    injected.includes(portalUrl) ||
    /\/shipping\//.test(injected) ||
    /\/respond\//.test(injected)
  ) {
    return injected;
  }
  return `${injected.trim()}\n\n${portalUrl}`;
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

export type PickupReadySubjectVars = {
  customer_name?: string;
  portal_url?: string;
  pickup_location?: string;
  pickup_hours?: string;
  team_name?: string;
};

export function pickupReadySubject(
  orderNumber: string,
  templates?: MessageTemplateMap | null,
  vars?: PickupReadySubjectVars | null
) {
  const map = templatesOrDefault(templates);
  return renderMessageTemplate(map.pickup_ready_email_subject, {
    order_number: orderNumber,
    customer_name: vars?.customer_name ?? "",
    portal_url: vars?.portal_url ?? "",
    pickup_location: vars?.pickup_location ?? "",
    pickup_hours: vars?.pickup_hours ?? "",
    team_name: vars?.team_name ?? "",
  });
}

/** Plain-text "ready for pickup" email (no choice needed). */
export function buildPickupReadyEmailBody(params: {
  customerName: string;
  orderNumber: string;
  portalUrl: string;
  pickupLocation: string;
  pickupHours: string;
  teamName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const map = templatesOrDefault(params.templates);
  return renderMessageTemplate(map.pickup_ready_email_body, {
    customer_name: params.customerName,
    order_number: params.orderNumber,
    portal_url: params.portalUrl,
    pickup_location: params.pickupLocation,
    pickup_hours: params.pickupHours,
    team_name: params.teamName ?? "BazaarPrinting Team",
  });
}

/** HTML "ready for pickup" email. */
export function buildPickupReadyEmailHtml(params: {
  customerName: string;
  orderNumber: string;
  portalUrl: string;
  pickupLocation: string;
  pickupHours: string;
  teamName?: string;
  templates?: MessageTemplateMap | null;
}) {
  const text = buildPickupReadyEmailBody(params);
  return buildBrandedEmailLayout({
    contextLabel: `Order #${params.orderNumber}`,
    bodyHtml: plainTextToEmailParagraphs(text),
    emailTitle: pickupReadySubject(params.orderNumber, params.templates, {
      customer_name: params.customerName,
      portal_url: params.portalUrl,
      pickup_location: params.pickupLocation,
      pickup_hours: params.pickupHours,
      team_name: params.teamName ?? "BazaarPrinting Team",
    }),
  });
}

/** SMS telling the customer the order is ready for pickup (no choice needed). */
export function buildPickupReadySmsBody(params: {
  customerName?: string | null;
  orderNumber: string;
  portalUrl: string;
  pickupLocation: string;
  pickupHours: string;
  templates?: MessageTemplateMap | null;
}) {
  const map = templatesOrDefault(params.templates);
  return renderMessageTemplate(map.pickup_ready_sms, {
    customer_name: params.customerName?.trim() || "there",
    order_number: params.orderNumber,
    portal_url: params.portalUrl,
    pickup_location: params.pickupLocation,
    pickup_hours: params.pickupHours,
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
