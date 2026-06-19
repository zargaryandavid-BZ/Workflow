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

function detailRow(label: string, value: string, bold = false): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") return "";
  return `<tr>
    <td style="padding:2px 10px 2px 0;color:#6b778c;font-size:13px;white-space:nowrap;vertical-align:top;width:1%;">${escapeHtml(label)}</td>
    <td style="padding:2px 0;color:#172b4d;font-size:13px;line-height:1.45;${bold ? "font-weight:600;" : ""}">${value}</td>
  </tr>`;
}

function sectionHeading(title: string): string {
  return `<p style="margin:14px 0 6px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b778c;">${escapeHtml(title)}</p>`;
}

function summaryTable(rows: string): string {
  const content = rows.trim();
  if (!content) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${content}</table>`;
}

function twoColumnSummary(left: string, right: string): string {
  if (!left.trim() && !right.trim()) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="width:50%;padding:0 8px 0 0;vertical-align:top;">${left || "&nbsp;"}</td>
      <td style="width:50%;padding:0 0 0 8px;vertical-align:top;border-left:1px solid #e8eaef;">${right || "&nbsp;"}</td>
    </tr>
  </table>`;
}

function personValue(
  name: string | null | undefined,
  email: string | null | undefined
): string {
  const n = name?.trim();
  const e = email?.trim();
  if (n && e) {
    return `${escapeHtml(n)}<br/><a href="mailto:${escapeHtml(e)}" style="color:#0c66e4;text-decoration:none;">${escapeHtml(e)}</a>`;
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
  if (parts.length > 0) return parts.join("<br/>");
  const fallback = data.customerContact.trim();
  return fallback ? escapeHtml(fallback) : "";
}

function specSectionHtml(data: OrderExportData): string {
  const lines = data.specRows
    .map(
      (row) =>
        detailRow(row.label, escapeHtml(row.value))
    )
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

  const body = `${lines}${extras.join("")}`;
  if (!body.trim()) {
    return `<p style="margin:0;font-size:13px;color:#6b778c;">No specifications listed.</p>`;
  }
  return summaryTable(body);
}

function skuSectionHtml(data: OrderExportData): string {
  if (data.skuRows.length === 0) {
    return `<p style="margin:0;font-size:13px;color:#6b778c;">No SKUs listed.</p>`;
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
                  `<a href="${escapeHtml(url)}" style="color:#0c66e4;text-decoration:none;margin-right:6px;">Img ${i + 1}</a>`
              )
              .join("")
          : `<span style="color:#6b778c;">No artwork</span>`;
      return `<tr style="border-top:1px solid #eef0f4;">
        <td style="padding:6px 8px 6px 0;color:#6b778c;font-size:12px;white-space:nowrap;vertical-align:top;width:1%;">${sku.index}.</td>
        <td style="padding:6px 0;font-size:13px;color:#172b4d;line-height:1.45;">
          <strong>${escapeHtml(sku.name)}</strong>
          <span style="color:#6b778c;"> · Qty ${qty}</span><br/>
          <span style="font-size:12px;color:#6b778c;">${links}</span>
        </td>
      </tr>`;
    })
    .join("");

  const total =
    data.totalQty != null
      ? `<tr><td colspan="2" style="padding:8px 0 0;font-size:13px;font-weight:600;color:#172b4d;border-top:1px solid #eef0f4;">Total qty: ${data.totalQty.toLocaleString("en-US")}</td></tr>`
      : "";

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}${total}</table>`;
}

function orderSummaryHtml(data: OrderExportData): string {
  const leftCol = summaryTable(
    [
      detailRow("Customer", escapeHtml(data.customerName)),
      detailRow("Contact", contactValue(data)),
    ].join("")
  );

  const rightCol = summaryTable(
    [
      detailRow("Due date", escapeHtml(data.dueDateFormatted)),
      detailRow(
        "Priority",
        `<span style="text-transform:capitalize;">${escapeHtml(data.priority)}</span>`
      ),
      detailRow("Stage", escapeHtml(data.columnName)),
      data.categoryName
        ? detailRow("Category", escapeHtml(data.categoryName))
        : "",
      detailRow(
        "Assigned to",
        personValue(data.designerName, data.designerEmail)
      ),
      personValue(data.ownerName, data.ownerEmail)
        ? detailRow(
            "Owner",
            personValue(data.ownerName, data.ownerEmail)
          )
        : "",
    ].join("")
  );

  return twoColumnSummary(leftCol, rightCol);
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
  const specsBlock = hasSpecs ? specSectionHtml(data) : "";
  const skuBlock = skuSectionHtml(data);

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:12px;background:#f4f5f7;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e4e9;border-radius:8px;overflow:hidden;">
    <div style="padding:14px 16px 12px;background:#172b4d;">
      <p style="margin:0 0 2px;font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:#9fadbc;">Order details</p>
      <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;line-height:1.3;">${escapeHtml(data.orderNumber)}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#c7d2df;">${escapeHtml(data.customerName)}${data.dueDateFormatted !== "—" ? ` · Due ${escapeHtml(data.dueDateFormatted)}` : ""}</p>
    </div>
    <div style="padding:12px 16px 14px;">
      ${orderSummaryHtml(data)}
      ${specsBlock ? `${sectionHeading("Specifications")}${specsBlock}` : ""}
      ${sectionHeading("SKUs")}${skuBlock}
      <p style="margin:12px 0 0;padding-top:10px;border-top:1px solid #eef0f4;font-size:11px;color:#9fadbc;">${escapeHtml(data.tenantName)} Workflow</p>
    </div>
  </div>
</body>
</html>`;
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

  if (data.categoryName) lines.push(`Category:     ${data.categoryName}`);
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

  lines.push("", "SPECIFICATIONS", "─".repeat(36));
  if (data.specRows.length === 0 && !data.artworkLink && !data.designTask) {
    lines.push("No specifications listed.");
  } else {
    lines.push(...data.specRows.map((row) => `${row.label}: ${row.value}`));
  }

  if (data.artworkLink) lines.push(`Artwork GDrive: ${data.artworkLink}`);
  if (data.designTask) lines.push(`Design task: ${data.designTask}`);

  lines.push("", "SKUS", "─".repeat(36));
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

  lines.push("", "─".repeat(36));
  lines.push(`${data.tenantName} Workflow`);
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
