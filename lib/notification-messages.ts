import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
} from "@/lib/constants";
import type { CustomField, OrderWithRelations } from "@/lib/types";

const REPLY_LINK_PLACEHOLDER = "[REPLY_LINK]";

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
}) {
  return buildMissingInfoEmailBody({
    customerName: params.customerName,
    productType: params.product,
    orderNumber: params.orderNumber,
    replyLink: params.replyLink ?? REPLY_LINK_PLACEHOLDER,
    staffNote: params.staffNote,
    teamName: params.tenantName ?? "BazaarPrinting Team",
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

/** Shared HTML shell — compact spacing, branded header (matches respond page). */
function customerEmailLayout(params: {
  tenantLabel: string;
  orderNumber: string;
  bodyHtml: string;
}): string {
  const tenant = escapeHtml(params.tenantLabel.replace(/ Team$/, ""));
  const order = escapeHtml(params.orderNumber);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.45;color:#1e293b;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;">
    <tr>
      <td align="center" style="padding:16px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:#1d4ed8;padding:12px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:14px;font-weight:600;color:#ffffff;">${tenant}</td>
                  <td align="right" style="font-size:12px;color:#dbeafe;">Order ${order}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 20px;">${params.bodyHtml}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function emailParagraph(html: string) {
  return `<p style="margin:0 0 10px;font-size:15px;line-height:1.45;color:#334155;">${html}</p>`;
}

function emailCta(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr><td style="border-radius:6px;background:#1d4ed8;"><a href="${href}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${label}</a></td></tr></table>`;
}

function emailLinkFallback(href: string) {
  return `<p style="margin:0 0 10px;padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;line-height:1.35;color:#64748b;">Or copy this link:<br><a href="${href}" style="color:#1d4ed8;word-break:break-all;text-decoration:underline;">${href}</a></p>`;
}

function emailFinePrint(text: string) {
  return `<p style="margin:0 0 10px;font-size:12px;line-height:1.35;color:#94a3b8;">${text}</p>`;
}

function emailSignoff(team: string) {
  return `<p style="margin:0;font-size:14px;line-height:1.4;color:#475569;">Thank you,<br><strong style="color:#1e293b;">${team}</strong></p>`;
}

function emailNoteBox(note: string) {
  return `<div style="margin:0 0 10px;padding:10px 12px;background:#eff6ff;border-left:3px solid #1d4ed8;border-radius:0 6px 6px 0;font-size:14px;line-height:1.45;color:#334155;">${escapeHtml(note)}</div>`;
}

/** Plain-text customer missing-info email body. */
export function buildMissingInfoEmailBody(params: {
  customerName: string;
  productType: string;
  orderNumber: string;
  replyLink: string;
  staffNote?: string | null;
  teamName?: string;
}) {
  const team = params.teamName ?? "BazaarPrinting Team";
  const ref = formatOrderReference(params.productType, params.orderNumber);
  const noteBlock = params.staffNote?.trim()
    ? `\n\nNote from our team:\n${params.staffNote.trim()}`
    : "";
  return compactPlainEmail([
    `Hi ${params.customerName},`,
    `We need more information to complete your ${ref}.${noteBlock} Please use the link below to attach your file or leave a note:`,
    params.replyLink,
    `This link expires in 7 days.`,
    `Thank you,\n${team}`,
  ]);
}

/** HTML email for Instantly / email clients (full document, not a fragment). */
export function buildMissingInfoEmailHtml(params: {
  customerName: string;
  productType: string;
  orderNumber: string;
  replyLink: string;
  staffNote?: string | null;
  teamName?: string;
}) {
  const team = escapeHtml(params.teamName ?? "BazaarPrinting Team");
  const name = escapeHtml(params.customerName);
  const ref = escapeHtml(
    formatOrderReference(params.productType, params.orderNumber)
  );
  const link = escapeHtml(params.replyLink);
  const noteHtml = params.staffNote?.trim()
    ? emailNoteBox(params.staffNote.trim())
    : "";

  const bodyHtml = [
    emailParagraph(`Hi ${name},`),
    emailParagraph(
      `We need more information to complete your ${ref}. Please attach your file or leave a note using the button below.`
    ),
    noteHtml,
    emailCta(link, "Attach files &amp; respond"),
    emailLinkFallback(link),
    emailFinePrint("This link expires in 7 days."),
    emailSignoff(team),
  ].join("");

  return customerEmailLayout({
    tenantLabel: params.teamName ?? "BazaarPrinting Team",
    orderNumber: params.orderNumber,
    bodyHtml,
  });
}

/** Short SMS body for missing-info notifications. */
export function buildMissingInfoSmsBody(params: {
  customerName?: string | null;
  orderNumber: string;
  replyLink: string;
  brandName?: string;
}) {
  const name = params.customerName?.trim() || "there";
  const brand = params.brandName ?? "BazaarPrinting";
  return `Hi ${name}, we need more info for your order ${params.orderNumber}.
Please reply here: ${params.replyLink}
- ${brand}`;
}

export function missingInfoSubject(orderNumber: string) {
  return `Action needed: missing info for order ${orderNumber}`;
}

const APPROVAL_LINK_PLACEHOLDER = "[APPROVAL_LINK]";

export function approvalSubject(orderNumber: string) {
  return `Your print proof is ready for approval — Order ${orderNumber}`;
}

/** Plain-text customer approval email body. */
export function buildApprovalEmailBody(params: {
  customerName: string;
  productType: string;
  orderNumber: string;
  approvalLink: string;
  internalNote?: string | null;
  teamName?: string;
}) {
  const team = params.teamName ?? "BazaarPrinting Team";
  const ref = formatOrderReference(params.productType, params.orderNumber);
  const noteBlock = params.internalNote?.trim()
    ? `\n\nNote from our team:\n${params.internalNote.trim()}`
    : "";
  return [
    `Hi ${params.customerName},`,
    `Your ${ref} proof is ready for review.${noteBlock}`,
    `Please use the link below to approve or request changes:`,
    ``,
    params.approvalLink,
    `This link expires in 7 days.`,
    `Thank you,\n${team}`,
  ].join("\n");
}

export function buildApprovalMessage(params: {
  customerName: string;
  productType: string;
  orderNumber: string;
  teamName?: string;
}) {
  return buildApprovalEmailBody({
    customerName: params.customerName,
    productType: params.productType,
    orderNumber: params.orderNumber,
    approvalLink: APPROVAL_LINK_PLACEHOLDER,
    teamName: params.teamName ?? "BazaarPrinting Team",
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
}) {
  const team = escapeHtml(params.teamName ?? "BazaarPrinting Team");
  const name = escapeHtml(params.customerName);
  const ref = escapeHtml(
    formatOrderReference(params.productType, params.orderNumber)
  );
  const link = escapeHtml(params.approvalLink);
  const noteHtml = params.internalNote?.trim()
    ? emailNoteBox(params.internalNote.trim())
    : "";

  const bodyHtml = [
    emailParagraph(`Hi ${name},`),
    emailParagraph(`Your ${ref} proof is ready for review.`),
    noteHtml,
    emailParagraph(
      "Please review your order details and artwork on the page, then approve or request changes."
    ),
    emailCta(link, "Review &amp; approve"),
    emailLinkFallback(link),
    emailFinePrint("This link expires in 7 days."),
    emailSignoff(team),
  ].join("");

  return customerEmailLayout({
    tenantLabel: params.teamName ?? "BazaarPrinting Team",
    orderNumber: params.orderNumber,
    bodyHtml,
  });
}

/** Short SMS body for customer approval notifications. */
export function buildApprovalSmsBody(params: {
  customerName?: string | null;
  productType: string;
  orderNumber: string;
  approvalLink: string;
  brandName?: string;
}) {
  const name = params.customerName?.trim() || "there";
  const brand = params.brandName ?? "BazaarPrinting";
  return `Hi ${name}, your ${params.productType} proof for order ${params.orderNumber} is ready.
Approve here: ${params.approvalLink}
- ${brand}`;
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
      '<a href="$1" style="color:#1d4ed8;word-break:break-all;">$1</a>'
    )))
    .join("");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:16px;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;font-size:15px;line-height:1.45;color:#334155;">
    ${paragraphs}
  </div>
</body></html>`;
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
