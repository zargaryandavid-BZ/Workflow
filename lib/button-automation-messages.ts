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

function detailRow(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return "";
  return `<tr><td width="140" style="padding:2px 12px 2px 14px;color:#6b778c;font-size:12px;white-space:nowrap;vertical-align:top;font-family:Arial,Helvetica,sans-serif;line-height:16px;">${escapeHtml(label)}</td><td style="padding:2px 14px 2px 0;color:#172b4d;font-size:12px;vertical-align:top;font-family:Arial,Helvetica,sans-serif;line-height:16px;">${value}</td></tr>`;
}

function sectionHeaderRow(title: string): string {
  return `<tr><td colspan="2" style="padding:10px 14px 4px;color:#6b778c;font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;line-height:14px;border-top:1px solid #eef0f4;">${escapeHtml(title)}</td></tr>`;
}

function fullWidthRow(html: string): string {
  return `<tr><td colspan="2" style="padding:2px 14px;color:#172b4d;font-size:12px;vertical-align:top;font-family:Arial,Helvetica,sans-serif;line-height:16px;">${html}</td></tr>`;
}

/** Collapse whitespace between tags — Yahoo renders those gaps as blank lines. */
function compactEmailHtml(html: string): string {
  return html.replace(/>\s+</g, "><").replace(/\n/g, "").trim();
}

function personValue(
  name: string | null | undefined,
  email: string | null | undefined
): string {
  const n = name?.trim();
  const e = email?.trim();
  if (n && e) {
    return `${escapeHtml(n)} (<a href="mailto:${escapeHtml(e)}" style="color:#0c66e4;text-decoration:none;">${escapeHtml(e)}</a>)`;
  }
  if (n) return escapeHtml(n);
  if (e) {
    return `<a href="mailto:${escapeHtml(e)}" style="color:#0c66e4;text-decoration:none;">${escapeHtml(e)}</a>`;
  }
  return "";
}

function contactValue(data: OrderExportData): string {
  const parts: string[] = [];
  if (data.customerEmail) {
    parts.push(
      `<a href="mailto:${escapeHtml(data.customerEmail)}" style="color:#0c66e4;text-decoration:none;">${escapeHtml(data.customerEmail)}</a>`
    );
  }
  if (data.customerPhone) {
    parts.push(escapeHtml(data.customerPhone));
  }
  if (parts.length > 0) return parts.join(" · ");
  const fallback = data.customerContact.trim();
  return fallback ? escapeHtml(fallback) : "";
}

function specSectionRows(data: OrderExportData): string {
  const rows = data.specRows
    .map((row) => detailRow(row.label, escapeHtml(row.value)))
    .filter(Boolean)
    .join("");

  const extras: string[] = [];
  if (data.artworkLink) {
    extras.push(
      detailRow(
        "Artwork GDrive",
        `<a href="${escapeHtml(data.artworkLink)}" style="color:#0c66e4;text-decoration:none;word-break:break-all;">${escapeHtml(data.artworkLink)}</a>`
      )
    );
  }
  if (data.designTask) {
    extras.push(detailRow("Design task", escapeHtml(data.designTask)));
  }

  const body = `${rows}${extras.join("")}`;
  if (!body.trim()) {
    return fullWidthRow(
      `<span style="color:#6b778c;">No specifications listed.</span>`
    );
  }
  return body;
}

function skuSectionRows(data: OrderExportData): string {
  if (data.skuRows.length === 0) {
    return fullWidthRow(`<span style="color:#6b778c;">No SKUs listed.</span>`);
  }

  const rows = data.skuRows
    .map((sku) => {
      const qty =
        sku.qty != null ? sku.qty.toLocaleString("en-US") : "—";
      const links =
        sku.imageLinks.length > 0
          ? sku.imageLinks
              .map(
                (url, i) =>
                  `<a href="${escapeHtml(url)}" style="color:#0c66e4;text-decoration:none;">Img ${i + 1}</a>`
              )
              .join(" · ")
          : `<span style="color:#6b778c;">No artwork</span>`;
      return fullWidthRow(
        `<strong>${sku.index}. ${escapeHtml(sku.name)}</strong><span style="color:#6b778c;"> · Qty ${qty} · ${links}</span>`
      );
    })
    .join("");

  const total =
    data.totalQty != null
      ? fullWidthRow(
          `<strong>Total qty: ${data.totalQty.toLocaleString("en-US")}</strong>`
        )
      : "";

  return `${rows}${total}`;
}

function orderSummaryRows(data: OrderExportData): string {
  const assigned = personValue(data.designerName, data.designerEmail);
  const owner = personValue(data.ownerName, data.ownerEmail);
  const priority = `<span style="text-transform:capitalize;">${escapeHtml(data.priority)}</span>`;

  return [
    `<tr><td colspan="2" style="height:16px;padding:0;font-size:0;line-height:16px;mso-line-height-rule:exactly;">&nbsp;</td></tr>`,
    detailRow("Customer", escapeHtml(data.customerName)),
    detailRow("Contact", contactValue(data)),
    detailRow("Due date", escapeHtml(data.dueDateFormatted)),
    detailRow("Priority", priority),
    detailRow("Stage", escapeHtml(data.columnName)),
    data.tagName
      ? detailRow("Tag", escapeHtml(data.tagName))
      : "",
    assigned ? detailRow("Assigned to", assigned) : "",
    owner ? detailRow("Owner", owner) : "",
  ].join("");
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
  const hasSpecs =
    data.specRows.length > 0 || Boolean(data.artworkLink) || Boolean(data.designTask);
  const subtitle = `${escapeHtml(data.customerName)}${data.dueDateFormatted !== "—" ? ` · Due ${escapeHtml(data.dueDateFormatted)}` : ""}`;
  const headerCell =
    "padding:12px 14px;background-color:#172b4d;color:#ffffff;font-family:Arial,Helvetica,sans-serif;";

  const rows = [
    `<tr><td colspan="2" style="${headerCell}font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#9fadbc;line-height:14px;">Order details</td></tr>`,
    `<tr><td colspan="2" style="${headerCell}font-size:18px;font-weight:bold;line-height:22px;">${escapeHtml(data.orderNumber)}</td></tr>`,
    `<tr><td colspan="2" style="${headerCell}font-size:12px;color:#c7d2df;line-height:16px;">${subtitle}</td></tr>`,
    orderSummaryRows(data),
    hasSpecs ? sectionHeaderRow("Specifications") : "",
    hasSpecs ? specSectionRows(data) : "",
    sectionHeaderRow("SKUs"),
    skuSectionRows(data),
    `<tr><td colspan="2" style="padding:10px 14px 12px;color:#9fadbc;font-size:10px;font-family:Arial,Helvetica,sans-serif;line-height:14px;border-top:1px solid #eef0f4;">${escapeHtml(data.tenantName)} Workflow</td></tr>`,
  ].join("");

  return compactEmailHtml(
    `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${escapeHtml(data.orderNumber)}</title></head><body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" align="center" style="width:560px;max-width:100%;background-color:#ffffff;border:1px solid #e2e4e9;border-collapse:collapse;table-layout:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt;">${rows}</table></body></html>`
  );
}

export function buildButtonAutomationEmailText(data: OrderExportData): string {
  const contactParts = [
    data.customerEmail,
    data.customerPhone,
  ].filter(Boolean);
  const contact =
    contactParts.length > 0
      ? contactParts.join(" · ")
      : data.customerContact || "—";

  const lines: string[] = [
    data.orderNumber,
    `${data.customerName}${data.dueDateFormatted !== "—" ? ` · Due ${data.dueDateFormatted}` : ""}`,
    "",
    `Customer:     ${data.customerName}`,
    `Contact:      ${contact}`,
    `Due date:     ${data.dueDateFormatted}`,
    `Priority:     ${data.priority}`,
    `Stage:        ${data.columnName}`,
  ];

  if (data.tagName) lines.push(`Tag:          ${data.tagName}`);
  if (data.designerName || data.designerEmail) {
    lines.push(
      `Assigned to:  ${data.designerName ?? "—"}${data.designerEmail ? ` (${data.designerEmail})` : ""}`
    );
  }
  if (data.ownerName || data.ownerEmail) {
    lines.push(
      `Owner:        ${data.ownerName ?? "—"}${data.ownerEmail ? ` (${data.ownerEmail})` : ""}`
    );
  }

  lines.push("", "SPECIFICATIONS");
  if (data.specRows.length === 0 && !data.artworkLink && !data.designTask) {
    lines.push("No specifications listed.");
  } else {
    lines.push(...data.specRows.map((row) => `${row.label}: ${row.value}`));
  }

  if (data.artworkLink) lines.push(`Artwork GDrive: ${data.artworkLink}`);
  if (data.designTask) lines.push(`Design task: ${data.designTask}`);

  lines.push("", "SKUS");
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

  lines.push("", `${data.tenantName} Workflow`);
  return lines.join("\n");
}

export function resolveEmailRecipients(
  data: OrderExportData,
  config: ButtonAutomationEmailConfig
): string[] {
  const parsed = parseEmailConfig(config);
  const emails = new Set<string>();

  if (parsed.recipient === "customer") {
    if (data.customerEmail) emails.add(data.customerEmail);
  }
  if (parsed.recipient === "designer") {
    if (data.designerEmail) emails.add(data.designerEmail);
  }
  if (parsed.recipient === "custom" && parsed.custom_email) {
    emails.add(parsed.custom_email);
  }

  return [...emails];
}
