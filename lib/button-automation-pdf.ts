import "server-only";

import PDFDocument from "pdfkit";
import type { OrderExportData } from "@/lib/button-automation-order-data";

function yesNo(value: string): string {
  const lower = value.toLowerCase();
  if (lower === "yes" || lower === "true") return "✓";
  if (lower === "no" || lower === "false") return "✗";
  return value;
}

export async function generateJobTicketPdf(
  data: OrderExportData
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "LETTER" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const printed = new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .text(data.tenantName.toUpperCase(), { continued: true })
      .font("Helvetica")
      .fontSize(18)
      .text("                    JOB TICKET", { align: "right" });

    doc
      .moveDown(0.3)
      .fontSize(10)
      .fillColor("#555555")
      .text(`job-ticket-${data.orderNumber}`, { continued: true })
      .text(`         Printed: ${printed}`, { align: "right" });

    doc.moveDown(1).strokeColor("#cccccc").lineWidth(1);
    doc.moveTo(48, doc.y).lineTo(564, doc.y).stroke();
    doc.moveDown(0.8).fillColor("#000000");

    const detailRows: [string, string][] = [
      ["ORDER", data.orderNumber],
      [
        "Customer",
        `${data.customerName}${data.customerContact ? ` · ${data.customerContact}` : ""}`,
      ],
      [
        "Due Date",
        `${data.dueDateFormatted}    Priority: ${data.priority}`,
      ],
      ["Assigned To", data.assignedToName],
      ["Stage", data.columnName],
    ];

    doc.fontSize(11).font("Helvetica");
    for (const [label, value] of detailRows) {
      doc
        .font("Helvetica-Bold")
        .text(`${label.padEnd(14)}`, { continued: true })
        .font("Helvetica")
        .text(value);
    }

    doc.moveDown(0.8).strokeColor("#cccccc").lineWidth(1);
    doc.moveTo(48, doc.y).lineTo(564, doc.y).stroke();
    doc.moveDown(0.8);

    doc.font("Helvetica-Bold").fontSize(12).text("SPECIFICATIONS");
    doc.moveDown(0.4).font("Helvetica").fontSize(10);

    for (const row of data.specRows.slice(0, 12)) {
      doc
        .font("Helvetica-Bold")
        .text(`${row.label.padEnd(16)}`, { continued: true })
        .font("Helvetica")
        .text(yesNo(row.value));
    }

    if (data.artworkLink) {
      doc
        .font("Helvetica-Bold")
        .text("Artwork GDrive".padEnd(16), { continued: true })
        .font("Helvetica")
        .text(data.artworkLink, { link: data.artworkLink, underline: true });
    }
    if (data.designTask) {
      doc
        .font("Helvetica-Bold")
        .text("Design task".padEnd(16), { continued: true })
        .font("Helvetica")
        .text(data.designTask);
    }

    doc.moveDown(0.8).strokeColor("#cccccc").lineWidth(1);
    doc.moveTo(48, doc.y).lineTo(564, doc.y).stroke();
    doc.moveDown(0.8);

    const totalLabel =
      data.totalQty != null
        ? `Total Qty: ${data.totalQty.toLocaleString("en-US")}`
        : "";
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("SKUs", { continued: Boolean(totalLabel) });
    if (totalLabel) {
      doc.font("Helvetica").fontSize(10).text(`              ${totalLabel}`, {
        align: "right",
      });
    } else {
      doc.moveDown(0.2);
    }

    doc.moveDown(0.4).font("Helvetica").fontSize(10);
    if (data.skuRows.length === 0) {
      doc.text("No SKUs listed.");
    } else {
      for (const sku of data.skuRows) {
        const qty =
          sku.qty != null ? sku.qty.toLocaleString("en-US") : "—";
        const link = sku.imageLinks[0];
        doc
          .font("Helvetica-Bold")
          .text(`${sku.name.padEnd(22)}`, { continued: true })
          .font("Helvetica")
          .text(`${qty.padStart(8)}`, { continued: Boolean(link) });
        if (link) {
          doc.text("  artwork", { link, underline: true });
        } else {
          doc.text("");
        }
      }
    }

    doc.end();
  });
}
