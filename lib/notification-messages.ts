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
  const name = escapeHtml(params.customerName);
  const orderNumber = escapeHtml(params.orderNumber);
  const link = escapeHtml(params.replyLink);
  const missingInfoMessage = params.staffNote?.trim()
    ? `<p style="margin:0 0 20px; font-size:14px; color:#374151; line-height:1.7;">${escapeHtml(params.staffNote.trim())}</p>`
    : "";

  const bodyHtml = [
    `<p style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.7;">Hi ${name},</p>`,
    `<p style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.7;">We need some additional information for your order <strong>#${orderNumber}</strong> before we can proceed.</p>`,
    missingInfoMessage,
    `<p style="margin:0 0 20px;"><a href="${link}" style="display:inline-block; background:#2563EB; color:#ffffff; text-decoration:none; padding:10px 22px; border-radius:6px; font-size:14px; font-weight:500;">Provide Information</a></p>`,
    `<hr style="border:none; border-top:1px solid #f3f4f6; margin:0 0 16px;" />`,
    `<p style="margin:0 0 6px; font-size:13px; color:#9ca3af;">Or copy this link:</p>`,
    `<p style="margin:0 0 16px;"><a href="${link}" style="color:#2563EB; font-size:13px; word-break:break-all;">${link}</a></p>`,
    `<hr style="border:none; border-top:1px solid #f3f4f6; margin:0 0 16px;" />`,
    `<p style="margin:0; font-size:13px; color:#9ca3af;">BazaarPrinting Team</p>`,
  ]
    .filter(Boolean)
    .join("");

  return buildBrandedEmailLayout({
    contextLabel: `Order #${params.orderNumber}`,
    bodyHtml,
    emailTitle: missingInfoSubject(params.orderNumber),
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
  const name = escapeHtml(params.customerName);
  const product = escapeHtml(params.productType.trim() || "order");
  const link = escapeHtml(params.approvalLink);

  const bodyHtml = [
    `<p style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.7;">Hi ${name},</p>`,
    `<p style="margin:0 0 20px; font-size:14px; color:#374151; line-height:1.7;">Your <strong>${product}</strong> proof is ready for review. Please approve or request changes:</p>`,
    `<p style="margin:0 0 20px;"><a href="${link}" style="display:inline-block; background:#2563EB; color:#ffffff; text-decoration:none; padding:10px 22px; border-radius:6px; font-size:14px; font-weight:500;">Review &amp; Approve</a></p>`,
    `<hr style="border:none; border-top:1px solid #f3f4f6; margin:0 0 16px;" />`,
    `<p style="margin:0 0 6px; font-size:13px; color:#9ca3af;">Or copy this link:</p>`,
    `<p style="margin:0 0 16px;"><a href="${link}" style="color:#2563EB; font-size:13px; word-break:break-all;">${link}</a></p>`,
    `<hr style="border:none; border-top:1px solid #f3f4f6; margin:0 0 16px;" />`,
    `<p style="margin:0; font-size:13px; color:#9ca3af;">This link expires in 7 days. — BazaarPrinting Team</p>`,
  ].join("");

  return buildBrandedEmailLayout({
    contextLabel: `Order #${params.orderNumber}`,
    bodyHtml,
    emailTitle: approvalSubject(params.orderNumber),
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
    const block = pendingLines.join("<br/>").trim();
    if (block) {
      sections.push(
        `<p style="margin:0 0 16px; font-size:14px; color:#374151; line-height:1.7;">${
          escapeHtml(block).replace(
            /(https?:\/\/[^\s]+)/g,
            '<a href="$1" style="color:#2563EB;word-break:break-all;">$1</a>'
          )
        }</p>`
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

export function readyToShipSubject(orderNumber: string) {
  return `Your order is ready — #${orderNumber}`;
}

/** Plain-text "ready to ship/pickup" email body. */
export function buildReadyToShipEmailBody(params: {
  customerName: string;
  orderNumber: string;
  staffNote?: string | null;
  teamName?: string;
}) {
  const team = params.teamName ?? "BazaarPrinting Team";
  const noteBlock = params.staffNote?.trim()
    ? `\n\nNote from our team:\n${params.staffNote.trim()}`
    : "";
  return [
    `Hi ${params.customerName},`,
    `Great news! Your order #${params.orderNumber} is ready.${noteBlock}`,
    `Please contact us to arrange pickup or delivery.`,
    `Thank you,\n${team}`,
  ].join("\n");
}

/** HTML email for ready-to-ship notifications. */
export function buildReadyToShipEmailHtml(params: {
  customerName: string;
  orderNumber: string;
  staffNote?: string | null;
  teamName?: string;
}) {
  const name = escapeHtml(params.customerName);
  const orderNum = escapeHtml(params.orderNumber);
  const noteHtml = params.staffNote?.trim()
    ? `<p style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.7;"><strong>Note from our team:</strong> ${escapeHtml(params.staffNote.trim())}</p>`
    : "";

  const bodyHtml = [
    `<p style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.7;">Hi ${name},</p>`,
    `<p style="margin:0 0 20px; font-size:14px; color:#374151; line-height:1.7;">Great news! Your order <strong>#${orderNum}</strong> is ready.</p>`,
    noteHtml,
    `<p style="margin:0 0 20px; font-size:14px; color:#374151; line-height:1.7;">Please contact us to arrange pickup or delivery.</p>`,
    `<hr style="border:none; border-top:1px solid #f3f4f6; margin:0 0 16px;" />`,
    `<p style="margin:0; font-size:13px; color:#9ca3af;">— ${escapeHtml(params.teamName ?? "BazaarPrinting Team")}</p>`,
  ].join("");

  return buildBrandedEmailLayout({
    contextLabel: `Order #${params.orderNumber}`,
    bodyHtml,
    emailTitle: readyToShipSubject(params.orderNumber),
  });
}

/** Short SMS body for ready-to-ship notifications. */
export function buildReadyToShipSmsBody(params: {
  customerName?: string | null;
  orderNumber: string;
  staffNote?: string | null;
  brandName?: string;
}) {
  return `Hi, this is Bazaar Printing. Your order ${params.orderNumber} is ready at 306 Boyd St, LA. Available for pickup: Mon-Fri 9:30 AM - 5:30 PM, and Sat until 4:00 PM. (No-Reply Automated Text)`;
}

export function shippingPortalSubject(orderNumber: string) {
  return `Your order ${orderNumber} is ready — choose delivery or pickup`;
}

/** Plain-text shipping portal email. */
export function buildShippingPortalEmailBody(params: {
  customerName: string;
  orderNumber: string;
  portalUrl: string;
  teamName?: string;
}) {
  const team = params.teamName ?? "BazaarPrinting Team";
  return [
    `Hi ${params.customerName},`,
    `Your order ${params.orderNumber} is ready to ship!`,
    `Please open this link to choose self pickup or delivery:`,
    params.portalUrl,
    `This link expires in 7 days.`,
    `— ${team}`,
  ].join("\n\n");
}

/** HTML shipping portal email with CTA button. */
export function buildShippingPortalEmailHtml(params: {
  customerName: string;
  orderNumber: string;
  portalUrl: string;
  teamName?: string;
}) {
  const name = escapeHtml(params.customerName);
  const orderNum = escapeHtml(params.orderNumber);
  const url = escapeHtml(params.portalUrl);
  const bodyHtml = [
    `<p style="margin:0 0 12px; font-size:14px; color:#374151; line-height:1.7;">Hi ${name},</p>`,
    `<p style="margin:0 0 20px; font-size:14px; color:#374151; line-height:1.7;">Your order <strong>${orderNum}</strong> is ready to ship!</p>`,
    `<p style="margin:0 0 20px; font-size:14px; color:#374151; line-height:1.7;">Please click the button below to choose how you'd like to receive it:</p>`,
    `<p style="margin:0 0 24px;"><a href="${url}" style="background:#1a1f2e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-size:14px;font-weight:600;">Choose Pickup or Delivery →</a></p>`,
    `<p style="margin:0 0 20px; font-size:13px; color:#6b7280; line-height:1.6;">Or paste this link into your browser:<br /><a href="${url}" style="color:#2563eb;word-break:break-all;">${url}</a></p>`,
    `<p style="margin:0 0 20px; font-size:13px; color:#9ca3af;">This link expires in 7 days.</p>`,
    `<hr style="border:none; border-top:1px solid #f3f4f6; margin:0 0 16px;" />`,
    `<p style="margin:0; font-size:13px; color:#9ca3af;">— ${escapeHtml(params.teamName ?? "BazaarPrinting Team")}</p>`,
  ].join("");

  return buildBrandedEmailLayout({
    contextLabel: `Order #${params.orderNumber}`,
    bodyHtml,
    emailTitle: shippingPortalSubject(params.orderNumber),
  });
}

/** SMS with portal link for shipping choice. */
export function buildShippingPortalSmsBody(params: {
  customerName?: string | null;
  orderNumber: string;
  portalUrl: string;
}) {
  const name = params.customerName?.trim() || "there";
  return `Hi ${name}, your order ${params.orderNumber} is ready! Choose pickup or delivery: ${params.portalUrl}`;
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
