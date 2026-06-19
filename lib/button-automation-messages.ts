import "server-only";

import {
  parseEmailConfig,
  renderButtonAutomationTemplate,
  type ButtonAutomationTemplateContext,
} from "@/lib/button-automations";
import type { OrderExportData } from "@/lib/button-automation-order-data";
import type { ButtonAutomationEmailConfig } from "@/lib/types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function templateContext(data: OrderExportData): ButtonAutomationTemplateContext {
  return {
    orderNumber: data.orderNumber,
    customerName: data.customerName,
    dueDate: data.dueDateFormatted,
    product: data.product,
    assignedTo: data.assignedToName,
  };
}

function specSectionHtml(data: OrderExportData): string {
  const lines = data.specRows
    .map(
      (row) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b778c;white-space:nowrap;vertical-align:top;">${escapeHtml(row.label)}</td><td style="padding:4px 0;color:#172b4d;">${escapeHtml(row.value)}</td></tr>`
    )
    .join("");

  const extras: string[] = [];
  if (data.artworkLink) {
    extras.push(
      `<tr><td style="padding:4px 12px 4px 0;color:#6b778c;">Artwork GDrive</td><td style="padding:4px 0;"><a href="${escapeHtml(data.artworkLink)}" style="color:#0c66e4;">${escapeHtml(data.artworkLink)}</a></td></tr>`
    );
  }
  if (data.designTask) {
    extras.push(
      `<tr><td style="padding:4px 12px 4px 0;color:#6b778c;">Design task</td><td style="padding:4px 0;color:#172b4d;">${escapeHtml(data.designTask)}</td></tr>`
    );
  }

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.6;">${lines}${extras.join("")}</table>`;
}

function skuSectionHtml(data: OrderExportData): string {
  if (data.skuRows.length === 0) {
    return `<p style="margin:0;font-size:14px;color:#6b778c;">No SKUs listed.</p>`;
  }

  const items = data.skuRows
    .map((sku) => {
      const qty =
        sku.qty != null ? sku.qty.toLocaleString("en-US") : "—";
      const links =
        sku.imageLinks.length > 0
          ? sku.imageLinks
              .map(
                (url, i) =>
                  `<a href="${escapeHtml(url)}" style="color:#0c66e4;margin-right:8px;">Image ${i + 1}</a>`
              )
              .join("")
          : `<span style="color:#6b778c;">No artwork uploaded.</span>`;
      return `<li style="margin:0 0 10px;font-size:14px;color:#172b4d;"><strong>${sku.index}. ${escapeHtml(sku.name)}</strong> — Qty: ${qty}<br/><span style="color:#6b778c;">Images:</span> ${links}</li>`;
    })
    .join("");

  const total =
    data.totalQty != null
      ? `<p style="margin:12px 0 0;font-size:14px;font-weight:600;color:#172b4d;">Total Qty: ${data.totalQty.toLocaleString("en-US")}</p>`
      : "";

  return `<ol style="margin:0;padding-left:20px;">${items}</ol>${total}`;
}

export function buildButtonAutomationEmailSubject(
  data: OrderExportData,
  config: ButtonAutomationEmailConfig
): string {
  const parsed = parseEmailConfig(config);
  return renderButtonAutomationTemplate(
    parsed.subject_template,
    templateContext(data)
  );
}

export function buildButtonAutomationEmailHtml(data: OrderExportData): string {
  const ownerLine =
    data.ownerName || data.ownerEmail
      ? `${escapeHtml(data.ownerName ?? "—")}${data.ownerEmail ? ` (${escapeHtml(data.ownerEmail)})` : ""}`
      : "—";
  const assignedLine =
    data.assignedToName || data.assignedToEmail
      ? `${escapeHtml(data.assignedToName)}${data.assignedToEmail ? ` (${escapeHtml(data.assignedToEmail)})` : ""}`
      : "—";

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e4e9;border-radius:8px;padding:24px;">
    <h1 style="margin:0 0 20px;font-size:20px;color:#172b4d;">Order Details</h1>
    <hr style="border:none;border-top:1px solid #e2e4e9;margin:16px 0;" />
    <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.7;width:100%;">
      <tr><td style="padding:4px 12px 4px 0;color:#6b778c;width:140px;">Order #</td><td style="padding:4px 0;color:#172b4d;font-weight:600;">${escapeHtml(data.orderNumber)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b778c;">Customer</td><td style="padding:4px 0;color:#172b4d;">${escapeHtml(data.customerName)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b778c;">Contact</td><td style="padding:4px 0;color:#172b4d;">${escapeHtml(data.customerContact || "—")}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b778c;">Due Date</td><td style="padding:4px 0;color:#172b4d;">${escapeHtml(data.dueDateFormatted)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b778c;">Priority</td><td style="padding:4px 0;color:#172b4d;text-transform:capitalize;">${escapeHtml(data.priority)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b778c;">Owner</td><td style="padding:4px 0;color:#172b4d;">${ownerLine}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b778c;">Assigned To</td><td style="padding:4px 0;color:#172b4d;">${assignedLine}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b778c;">Column / Stage</td><td style="padding:4px 0;color:#172b4d;">${escapeHtml(data.columnName)}</td></tr>
      ${data.categoryName ? `<tr><td style="padding:4px 12px 4px 0;color:#6b778c;">Category</td><td style="padding:4px 0;color:#172b4d;">${escapeHtml(data.categoryName)}</td></tr>` : ""}
    </table>
    <h2 style="margin:24px 0 12px;font-size:16px;color:#172b4d;">Specifications</h2>
    <hr style="border:none;border-top:1px solid #e2e4e9;margin:0 0 12px;" />
    ${specSectionHtml(data)}
    <h2 style="margin:24px 0 12px;font-size:16px;color:#172b4d;">SKUs</h2>
    <hr style="border:none;border-top:1px solid #e2e4e9;margin:0 0 12px;" />
    ${skuSectionHtml(data)}
    <p style="margin:24px 0 0;font-size:12px;color:#6b778c;">Generated by ${escapeHtml(data.tenantName)} Workflow</p>
  </div>
</body>
</html>`;
}

export function buildButtonAutomationEmailText(data: OrderExportData): string {
  const lines: string[] = [
    "ORDER DETAILS",
    "─────────────────────────────────────",
    `Order #:        ${data.orderNumber}`,
    `Customer:       ${data.customerName}`,
    `Contact:        ${data.customerContact || "—"}`,
    `Due Date:       ${data.dueDateFormatted}`,
    `Priority:       ${data.priority}`,
    `Owner:          ${data.ownerName ?? "—"}${data.ownerEmail ? ` (${data.ownerEmail})` : ""}`,
    `Assigned To:    ${data.assignedToName}${data.assignedToEmail ? ` (${data.assignedToEmail})` : ""}`,
    `Column / Stage: ${data.columnName}`,
    "",
    "SPECIFICATIONS",
    "─────────────────────────────────────",
    ...data.specRows.map((row) => `${row.label}: ${row.value}`),
  ];

  if (data.artworkLink) lines.push(`Artwork GDrive: ${data.artworkLink}`);
  if (data.designTask) lines.push(`Design task: ${data.designTask}`);

  lines.push("", "SKUS", "─────────────────────────────────────");
  if (data.skuRows.length === 0) {
    lines.push("No SKUs listed.");
  } else {
    for (const sku of data.skuRows) {
      const qty = sku.qty != null ? sku.qty.toLocaleString("en-US") : "—";
      lines.push(`${sku.index}. ${sku.name} — Qty: ${qty}`);
      lines.push(
        sku.imageLinks.length > 0
          ? `   Images: ${sku.imageLinks.join(", ")}`
          : "   Images: No artwork uploaded."
      );
    }
    if (data.totalQty != null) {
      lines.push("", `Total Qty: ${data.totalQty.toLocaleString("en-US")}`);
    }
  }

  lines.push("", "─────────────────────────────────────");
  lines.push(`Generated by ${data.tenantName} Workflow`);
  return lines.join("\n");
}

export function resolveEmailRecipients(
  data: OrderExportData,
  config: ButtonAutomationEmailConfig
): string[] {
  const parsed = parseEmailConfig(config);
  const emails = new Set<string>();

  if (parsed.recipient === "customer" || parsed.recipient === "both") {
    if (data.customerEmail) emails.add(data.customerEmail);
  }
  if (parsed.recipient === "staff" || parsed.recipient === "both") {
    if (data.assignedToEmail) emails.add(data.assignedToEmail);
  }
  if (parsed.recipient === "custom" && parsed.custom_email) {
    emails.add(parsed.custom_email);
  }

  return [...emails];
}
