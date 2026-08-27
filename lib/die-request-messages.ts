import { buildBrandedEmailLayout } from "@/lib/notification-messages";
import { PORTAL_PRODUCT_NAME } from "@/lib/portal-branding";

export function dieQuoteSubject(orderNumber: string): string {
  return `Die quote request — Order ${orderNumber}`;
}

export function buildDieQuoteEmailBody(params: {
  orderNumber: string;
  size: string;
  requiredDate: string;
  quoteUrl: string;
  comment?: string | null;
  contactName?: string | null;
  productName?: string | null;
}): string {
  const lines = [
    params.contactName?.trim()
      ? `Hi ${params.contactName.trim()},`
      : null,
    `Please review this die request for order ${params.orderNumber}.`,
    params.productName?.trim()
      ? `Product: ${params.productName.trim()}`
      : null,
    `Size: ${params.size}`,
    `Required date: ${params.requiredDate}`,
  ];
  if (params.comment?.trim()) {
    lines.push(`Comment: ${params.comment.trim()}`);
  }
  lines.push(
    `Open this link to send price, time estimate, and confirm the due date:`,
    params.quoteUrl,
    `— ${PORTAL_PRODUCT_NAME}`
  );
  return lines.filter((line): line is string => Boolean(line)).join("\n\n");
}

export function dieOrderConfirmSubject(orderNumber: string): string {
  return `Die order confirmed — Order ${orderNumber}`;
}

export function buildDieOrderConfirmEmailBody(params: {
  orderNumber: string;
  size: string;
  confirmedDueDate: string;
  price: string;
  timeEstimate: string;
  orderUrl: string;
  comment?: string | null;
  contactName?: string | null;
  productName?: string | null;
}): string {
  const lines = [
    params.contactName?.trim()
      ? `Hi ${params.contactName.trim()},`
      : null,
    `Please proceed with this die for order ${params.orderNumber}.`,
    params.productName?.trim()
      ? `Product: ${params.productName.trim()}`
      : null,
    `Size: ${params.size}`,
    `Confirmed due date: ${params.confirmedDueDate}`,
    `Agreed price: ${params.price}`,
    `Time: ${params.timeEstimate}`,
  ];
  if (params.comment?.trim()) {
    lines.push(`Comment: ${params.comment.trim()}`);
  }
  lines.push(
    `Open this link for files and what to manufacture:`,
    params.orderUrl,
    `This is the final order confirmation.`,
    `— ${PORTAL_PRODUCT_NAME}`
  );
  return lines.filter((line): line is string => Boolean(line)).join("\n\n");
}

export function buildDieOrderConfirmSmsBody(params: {
  orderNumber: string;
  confirmedDueDate: string;
  price: string;
  orderUrl: string;
}): string {
  return `Die order confirmed — order ${params.orderNumber}. Due ${params.confirmedDueDate}. Price ${params.price}. Files: ${params.orderUrl}`;
}

export function buildDieOrderConfirmEmailHtml(params: {
  orderNumber: string;
  size: string;
  confirmedDueDate: string;
  price: string;
  timeEstimate: string;
  orderUrl: string;
  comment?: string | null;
  contactName?: string | null;
  productName?: string | null;
}): string {
  const extra = [
    params.comment?.trim() ? row("Comment", params.comment.trim()) : "",
  ].join("");
  const greeting = params.contactName?.trim()
    ? `<div style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.5;">Hi ${escapeHtml(params.contactName.trim())},</div>`
    : "";
  const bodyHtml = [
    greeting,
    `<div style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.5;">Please proceed with this die for order <strong>${escapeHtml(params.orderNumber)}</strong>.</div>`,
    `<table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 16px;">`,
    params.productName?.trim()
      ? row("Product", params.productName.trim())
      : "",
    row("Size", params.size),
    row("Confirmed due date", params.confirmedDueDate),
    row("Agreed price", params.price),
    row("Time", params.timeEstimate),
    extra,
    `</table>`,
    `<div style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.5;">Open the link below for files and what to manufacture.</div>`,
    `<div style="margin:0 0 8px;"><a href="${escapeHtml(params.orderUrl)}" style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px;">View die files &amp; details</a></div>`,
    `<div style="margin:0 0 16px;font-size:12px;color:#94a3b8;word-break:break-all;">${escapeHtml(params.orderUrl)}</div>`,
    `<div style="margin:0;font-size:14px;color:#374151;line-height:1.5;">This is the final order confirmation.</div>`,
  ].join("");

  return buildBrandedEmailLayout({
    contextLabel: params.orderNumber,
    emailTitle: dieOrderConfirmSubject(params.orderNumber),
    bodyHtml,
  });
}

export function buildDieQuoteSmsBody(params: {
  orderNumber: string;
  requiredDate: string;
  quoteUrl: string;
}): string {
  return `Die quote request — order ${params.orderNumber}. Required ${params.requiredDate}. ${params.quoteUrl}`;
}

export function buildDieQuoteEmailHtml(params: {
  orderNumber: string;
  size: string;
  requiredDate: string;
  quoteUrl: string;
  comment?: string | null;
  contactName?: string | null;
  productName?: string | null;
}): string {
  const extra = [
    params.comment?.trim() ? row("Comment", params.comment.trim()) : "",
  ].join("");
  const greeting = params.contactName?.trim()
    ? `<div style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.5;">Hi ${escapeHtml(params.contactName.trim())},</div>`
    : "";
  const bodyHtml = [
    greeting,
    `<div style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.5;">Please review this die request for order <strong>${escapeHtml(params.orderNumber)}</strong>.</div>`,
    `<table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 16px;">`,
    params.productName?.trim()
      ? row("Product", params.productName.trim())
      : "",
    row("Size", params.size),
    row("Required date", params.requiredDate),
    extra,
    `</table>`,
    `<div style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.5;">Use the button below to send price, time estimate, and confirm the due date.</div>`,
    `<div style="margin:0 0 8px;"><a href="${escapeHtml(params.quoteUrl)}" style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px;">Open die request</a></div>`,
    `<div style="margin:0;font-size:12px;color:#94a3b8;word-break:break-all;">${escapeHtml(params.quoteUrl)}</div>`,
  ].join("");

  return buildBrandedEmailLayout({
    contextLabel: params.orderNumber,
    emailTitle: dieQuoteSubject(params.orderNumber),
    bodyHtml,
  });
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 14px;font-size:13px;color:#6b7280;width:40%;">${escapeHtml(label)}</td>
    <td style="padding:8px 14px;font-size:13px;color:#111827;font-weight:600;">${escapeHtml(value)}</td>
  </tr>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
