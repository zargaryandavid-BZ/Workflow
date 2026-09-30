import { createRequire } from "node:module";
import { orderNumberQrPng } from "./order-qr.ts";
import { pdfWinAnsiText } from "./pdf-winansi-text.ts";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

type PdfDoc = InstanceType<typeof PDFDocument>;

const PAGE_W = 420;   // A5 width in points
const PAGE_H = 595;   // A5 height in points
const MARGIN = 28;
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_H = 100;
const QR_SIZE = 44;

export type MultiitemBoxSlipItem = {
  orderTitle: string;
  itemTitle: string;
  quantity: number;
};

export type MultiitemBoxSlipInput = {
  boxName: string;
  poNumber: string | null;
  sizeLabel: string | null;
  weightLbs: number | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  printedAt: Date;
  items: MultiitemBoxSlipItem[];
};

function compactSizeLabel(sizeLabel: string): string {
  return sizeLabel
    .trim()
    .replace(/\s*in$/i, "")
    .replace(/×/g, "x")
    .replace(/\s+/g, "");
}

function sizeWeightLine(
  sizeLabel: string | null,
  weightLbs: number | null
): string {
  const parts: string[] = [];
  const size = compactSizeLabel(sizeLabel ?? "");
  if (size) parts.push(`S:${size}`);
  if (weightLbs != null && Number.isFinite(weightLbs)) {
    parts.push(`W:${weightLbs}lb`);
  }
  return parts.join(" ");
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function generateMultiitemBoxSlipPdf(
  input: MultiitemBoxSlipInput
): Promise<Buffer> {
  const boxName = pdfWinAnsiText(input.boxName) || "Box";
  const po = pdfWinAnsiText(input.poNumber ?? "") || "";
  const customer = pdfWinAnsiText(input.customerName ?? "") || "";
  const customerEmail = pdfWinAnsiText(input.customerEmail ?? "") || "";
  const customerPhone = pdfWinAnsiText(input.customerPhone ?? "") || "";
  const sw = sizeWeightLine(input.sizeLabel, input.weightLbs);
  const dateStr = fmtDate(input.printedAt);
  const totalQty = input.items.reduce((s, r) => s + r.quantity, 0);
  const qrPng = await orderNumberQrPng(boxName);

  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    autoFirstPage: false,
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const rowsPerPage = 14;
  const pages = Math.max(1, Math.ceil(input.items.length / rowsPerPage) || 1);

  for (let pageNum = 0; pageNum < pages; pageNum++) {
    doc.addPage();
    drawHeader(doc, boxName, po, sw, customer, customerEmail, customerPhone, totalQty, input.printedAt, qrPng, pageNum + 1, pages);

    let y = HEADER_H + 14;

    // Column positions tuned for A5 width
    const colOrder = MARGIN + 4;
    const colOrderW = 72;
    const colItem = colOrder + colOrderW + 8;
    const colQtyW = 44;
    const colQty = MARGIN + CONTENT_W - colQtyW;
    const colItemW = colQty - colItem - 6;

    doc.rect(MARGIN, y, CONTENT_W, 18).fill("#e8ebf0");
    doc
      .fillColor("#1a1f2e")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("Order #", colOrder, y + 5, { width: colOrderW, lineBreak: false })
      .text("Item", colItem, y + 5, { width: colItemW, lineBreak: false })
      .text("Qty", colQty, y + 5, { width: colQtyW, align: "right", lineBreak: false });
    y += 20;

    const slice = input.items.slice(
      pageNum * rowsPerPage,
      (pageNum + 1) * rowsPerPage
    );
    slice.forEach((item, i) => {
      if (i % 2 === 1) {
        doc.rect(MARGIN, y - 2, CONTENT_W, 20).fill("#f8f9fb");
      }
      doc
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(pdfWinAnsiText(item.orderTitle) || "—", colOrder, y + 2, {
          width: colOrderW,
          lineBreak: false,
          ellipsis: true,
        });
      doc
        .font("Helvetica")
        .fillColor("#4b5563")
        .fontSize(9)
        .text(pdfWinAnsiText(item.itemTitle) || "—", colItem, y + 2, {
          width: colItemW,
          lineBreak: false,
          ellipsis: true,
        });
      doc
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(String(item.quantity), colQty, y + 2, {
          width: colQtyW,
          align: "right",
          lineBreak: false,
        });
      y += 20;
    });

    doc
      .fillColor("#9aa4b5")
      .font("Helvetica")
      .fontSize(8)
      .text(`Printed ${dateStr}`, MARGIN, PAGE_H - 22, {
        width: CONTENT_W,
        align: "center",
      });
  }

  doc.end();
  return done;
}

function drawHeader(
  doc: PdfDoc,
  boxName: string,
  po: string,
  sizeWeight: string,
  customer: string,
  customerEmail: string,
  customerPhone: string,
  totalQty: number,
  printedAt: Date,
  qrPng: Buffer | null,
  pageNum: number,
  totalPages: number
) {
  const qrSize = qrPng ? QR_SIZE : 0;
  const labelText = `MULTI-ITEM BOX SLIP  ·  ${fmtDateTime(printedAt)}`;
  const colW = (CONTENT_W - (qrPng ? qrSize + 12 : 0)) / 2;
  const leftX = MARGIN;
  const midX = MARGIN + colW;
  const qrX = PAGE_W - MARGIN - qrSize;
  const topY = 8;

  doc.rect(0, 0, PAGE_W, HEADER_H).fill("#ffffff");
  doc
    .moveTo(0, HEADER_H)
    .lineTo(PAGE_W, HEADER_H)
    .strokeColor("#1a1f2e")
    .lineWidth(2.5)
    .stroke();

  // — Full-width label spanning both text columns —
  const labelW = PAGE_W - MARGIN * 2 - (qrPng ? qrSize + 12 : 0);
  doc
    .fillColor("#9aa4b5")
    .fontSize(7)
    .font("Helvetica")
    .text(labelText + (totalPages > 1 ? `  (${pageNum}/${totalPages})` : ""), leftX, topY, {
      width: labelW,
      lineBreak: false,
    });

  doc
    .fillColor("#1a1f2e")
    .fontSize(16)
    .font("Helvetica-Bold")
    .text(boxName, leftX, topY + 13, { width: colW - 4, lineBreak: false });

  let leftY = topY + 33;
  if (po) {
    doc
      .fillColor("#4b5563")
      .fontSize(9)
      .font("Helvetica")
      .text(`PO: ${po}`, leftX, leftY, { width: colW - 4, lineBreak: false });
    leftY += 13;
  }
  if (sizeWeight) {
    doc
      .fillColor("#1a1f2e")
      .fontSize(9)
      .font("Helvetica-Bold")
      .text(sizeWeight, leftX, leftY, { width: colW - 4, lineBreak: false });
    leftY += 13;
  }
  if (totalQty > 0) {
    doc
      .fillColor("#4b5563")
      .fontSize(9)
      .font("Helvetica")
      .text(`Total qty: ${totalQty.toLocaleString()}`, leftX, leftY, {
        width: colW - 4,
        lineBreak: false,
      });
  }

  // — Center column: customer name, email, phone —
  doc
    .fillColor("#9aa4b5")
    .fontSize(7)
    .font("Helvetica")
    .text("CUSTOMER", midX, topY, { width: colW - 8, lineBreak: false });
  doc
    .fillColor("#1a1f2e")
    .fontSize(13)
    .font("Helvetica-Bold")
    .text(customer || "—", midX, topY + 13, { width: colW - 8, lineBreak: false });

  let custY = topY + 31;
  if (customerEmail) {
    doc
      .fillColor("#4b5563")
      .fontSize(8)
      .font("Helvetica")
      .text(customerEmail, midX, custY, { width: colW - 8, lineBreak: false });
    custY += 12;
  }
  if (customerPhone) {
    doc
      .fillColor("#4b5563")
      .fontSize(8)
      .font("Helvetica")
      .text(customerPhone, midX, custY, { width: colW - 8, lineBreak: false });
  }

  // — QR code —
  if (qrPng) {
    const qrY = (HEADER_H - qrSize) / 2;
    doc.save();
    doc
      .rect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4)
      .strokeColor("#dde2ea")
      .lineWidth(0.75)
      .fillAndStroke("#f9fafb", "#dde2ea");
    doc.restore();
    doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
  }
}
