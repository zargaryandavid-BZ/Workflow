import "server-only";

import { createRequire } from "node:module";
import type { OrderExportData } from "@/lib/button-automation-order-data";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

type PdfDoc = InstanceType<typeof PDFDocument>;

const MARGIN = 40;
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const COL_WIDTH = (PAGE_WIDTH - MARGIN * 2) / 2;

function yesNo(value: string): string {
  const lower = value.trim().toLowerCase();
  if (lower === "yes" || lower === "true") return "YES";
  if (lower === "no" || lower === "false") return "NO";
  return value;
}

function fmtQty(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

function capitalize(s: string): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return Buffer.from(buf);
  } catch {
    return null;
  }
}

function drawHeader(
  doc: PdfDoc,
  tenantName: string,
  orderNumber: string
) {
  doc.rect(0, 0, PAGE_WIDTH, 44).fill("#1a1a2e");
  doc
    .fillColor("#ffffff")
    .fontSize(11)
    .font("Helvetica-Bold")
    .text(tenantName.toUpperCase(), MARGIN, 14);
  doc
    .fontSize(9)
    .font("Helvetica")
    .text("JOB TICKET", PAGE_WIDTH - MARGIN - 60, 14, {
      width: 60,
      align: "right",
    });
  doc
    .fontSize(9)
    .text(orderNumber, MARGIN, 28)
    .text(
      new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      PAGE_WIDTH - MARGIN - 100,
      28,
      { width: 100, align: "right" }
    );
  doc.fillColor("#000000");
}

function drawFooter(doc: PdfDoc, pageNum: number, totalPages: number) {
  doc
    .fontSize(8)
    .fillColor("#888888")
    .text(`Page ${pageNum} of ${totalPages}`, MARGIN, PAGE_HEIGHT - 24, {
      width: PAGE_WIDTH - MARGIN * 2,
      align: "center",
    });
  doc.fillColor("#000000");
}

function drawSectionTitle(doc: PdfDoc, title: string, y: number): number {
  doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 20).fill("#f3f4f6");
  doc
    .fillColor("#374151")
    .fontSize(9)
    .font("Helvetica-Bold")
    .text(title, MARGIN + 6, y + 6);
  doc.fillColor("#000000").font("Helvetica");
  return y + 24;
}

function drawSpecRow(
  doc: PdfDoc,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  options?: {
    valueFontSize?: number;
    valueFont?: "Helvetica" | "Helvetica-Bold";
  }
): number {
  doc
    .fontSize(9)
    .font("Helvetica-Bold")
    .fillColor("#6b7280")
    .text(label, x, y, { width: width * 0.28 });
  doc
    .fontSize(options?.valueFontSize ?? 9)
    .font(options?.valueFont ?? "Helvetica")
    .fillColor("#111827")
    .text(value || "—", x + width * 0.28, y, { width: width * 0.72 });
  return y + 16;
}

function rowHeight(doc: PdfDoc, value: string, colW: number, minH = 18): number {
  doc.fontSize(11).font("Helvetica-Bold");
  const h = doc.heightOfString(value || "—", { width: colW * 0.5 });
  return Math.max(minH, h + 6);
}

function drawSpecs(doc: PdfDoc, data: OrderExportData, startY: number): number {
  const x = MARGIN;
  const w = PAGE_WIDTH - MARGIN * 2;
  const innerX = x + 10;
  const innerW = w - 20;

  const specRows = data.specRows.map((row) => ({
    label: row.label,
    value: yesNo(row.value),
    link: undefined as string | undefined,
  }));

  if (data.artworkLink) {
    specRows.push({ label: "Artwork GDrive", value: "Link", link: data.artworkLink });
  }

  if (!specRows.length) return startY;

  const description = data.order.description?.trim() ?? "";

  const headerH = 26;
  const midpoint = Math.ceil(specRows.length / 2);
  const leftSpecs = specRows.slice(0, midpoint);
  const rightSpecs = specRows.slice(midpoint);
  const maxRows = Math.max(leftSpecs.length, rightSpecs.length);

  // Pre-compute per-row heights based on actual text content
  const rowHeights: number[] = [];
  for (let i = 0; i < maxRows; i++) {
    const lh = leftSpecs[i] ? rowHeight(doc, leftSpecs[i].value, COL_WIDTH) : 0;
    const rh = rightSpecs[i] ? rowHeight(doc, rightSpecs[i].value, COL_WIDTH) : 0;
    rowHeights.push(Math.max(lh, rh, 18));
  }
  const specsH = rowHeights.reduce((s, h) => s + h, 0);

  // Height for designer notes (if present)
  let notesH = 0;
  if (data.designTask) {
    doc.fontSize(10).font("Helvetica-Bold");
    const taskH = doc.heightOfString(data.designTask, { width: innerW * 0.65 });
    notesH = Math.max(20, taskH + 8);
  }

  // Height for order description block (if present)
  let descH = 0;
  if (description) {
    doc.fontSize(10).font("Helvetica");
    const textH = doc.heightOfString(description, { width: innerW - 12 });
    descH = 18 + textH + 6;
  }

  const boxH = headerH + specsH + notesH + descH + 10;

  // Highlighted background box
  doc.rect(x, startY, w, boxH).fill("#fff7ed");
  // Amber left accent bar
  doc.rect(x, startY, 4, boxH).fill("#f59e0b");
  // Border
  doc.rect(x, startY, w, boxH).strokeColor("#fcd34d").lineWidth(0.5).stroke();

  // Section title inside box
  doc
    .fillColor("#92400e")
    .fontSize(9)
    .font("Helvetica-Bold")
    .text("PRODUCT SPECIFICATIONS", innerX + 6, startY + 8);
  doc.fillColor("#000000").font("Helvetica");

  let y = startY + headerH;

  // Two-column spec rows with dynamic heights
  for (let i = 0; i < maxRows; i++) {
    const rowY = y;
    if (leftSpecs[i]) {
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor("#78350f")
        .text(leftSpecs[i].label, innerX + 6, rowY, { width: COL_WIDTH * 0.45 });
      const lv = leftSpecs[i];
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor(lv.link ? "#1d4ed8" : "#111827")
        .text(lv.value || "—", innerX + 6 + COL_WIDTH * 0.45, rowY, {
          width: COL_WIDTH * 0.5,
          ...(lv.link ? { link: lv.link, underline: true } : {}),
        });
    }
    if (rightSpecs[i]) {
      const rx = innerX + COL_WIDTH + 6;
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor("#78350f")
        .text(rightSpecs[i].label, rx, rowY, { width: COL_WIDTH * 0.45 });
      const rv = rightSpecs[i];
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor(rv.link ? "#1d4ed8" : "#111827")
        .text(rv.value || "—", rx + COL_WIDTH * 0.45, rowY, {
          width: COL_WIDTH * 0.5,
          ...(rv.link ? { link: rv.link, underline: true } : {}),
        });
    }
    y += rowHeights[i];
  }

  y += 4;

  if (data.designTask) {
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor("#78350f")
      .text("Designer Notes", innerX + 6, y);
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .fillColor("#111827")
      .text(data.designTask, innerX + 6 + innerW * 0.32, y, { width: innerW * 0.65 });
    y += notesH;
  }

  if (description) {
    // Thin divider
    doc.moveTo(innerX + 6, y + 2).lineTo(x + w - 10, y + 2).strokeColor("#fcd34d").lineWidth(0.5).stroke();
    y += 10;
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor("#78350f")
      .text("Order Description", innerX + 6, y);
    y += 14;
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#111827")
      .text(description, innerX + 6, y, { width: innerW - 12 });
  }

  doc.fillColor("#000000").font("Helvetica");
  return startY + boxH + 8;
}

function drawDescription(doc: PdfDoc, description: string, startY: number): number {
  const x = MARGIN;
  const w = PAGE_WIDTH - MARGIN * 2;
  const innerX = x + 6;
  const innerW = w - 12;

  const textHeight = doc.heightOfString(description, {
    width: innerW - 8,
  });
  const boxH = 22 + textHeight + 8;

  doc.rect(x, startY, w, boxH).fill("#f0f9ff");
  doc.rect(x, startY, 4, boxH).fill("#0ea5e9");
  doc.rect(x, startY, w, boxH).strokeColor("#bae6fd").lineWidth(0.5).stroke();

  doc
    .fillColor("#0c4a6e")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text("DESCRIPTION / COMMENTS", innerX + 6, startY + 7);

  doc
    .fontSize(8.5)
    .font("Helvetica")
    .fillColor("#111827")
    .text(description, innerX + 6, startY + 22, { width: innerW - 8 });

  doc.fillColor("#000000").font("Helvetica");
  return startY + boxH + 8;
}

function drawPage1(
  doc: PdfDoc,
  data: OrderExportData,
  totalPages: number
) {
  drawHeader(doc, data.tenantName, data.orderNumberDisplay);

  let y = 56;
  const w = PAGE_WIDTH - MARGIN * 2 - 12;

  y = drawSectionTitle(doc, "CUSTOMER", y);
  y = drawSpecRow(
    doc,
    "Name",
    data.customerName,
    MARGIN + 6,
    y,
    PAGE_WIDTH - MARGIN * 2 - 12,
    { valueFontSize: 11, valueFont: "Helvetica-Bold" }
  );
  y += 8;

  y = drawSectionTitle(doc, "ORDER", y);
  const x = MARGIN + 6;
  y = drawSpecRow(doc, "Due Date", data.dueDateFormatted, x, y, COL_WIDTH - 6);
  drawSpecRow(
    doc,
    "Priority",
    capitalize(data.priority),
    x + COL_WIDTH,
    y - 14,
    COL_WIDTH - 6
  );
  y = drawSpecRow(doc, "Assigned To", data.assignedToName, x, y, COL_WIDTH - 6);
  drawSpecRow(doc, "Stage", data.columnName, x + COL_WIDTH, y - 14, COL_WIDTH - 6);
  y = drawSpecRow(doc, "Total QTY", fmtQty(data.totalQty), x, y, COL_WIDTH - 6);
  y += 8;

  y = drawSpecs(doc, data, y);

  const skuCount = data.skuRows.length;
  const skuHeader = `SKUs — ${skuCount} SKU${skuCount !== 1 ? "s" : ""} · ${fmtQty(data.totalQty)} pcs`;
  y = drawSectionTitle(doc, skuHeader, y);

  for (const sku of data.skuRows) {
    const rowX = MARGIN + 6;
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .fillColor("#9ca3af")
      .text(`${sku.index}`, rowX, y, { width: 20 });
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#111827")
      .text(sku.name, rowX + 24, y, { width: w - 90 });
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .fillColor("#374151")
      .text(fmtQty(sku.qty), rowX + w - 60, y, { width: 60, align: "right" });
    y += 18;
  }

  drawFooter(doc, 1, totalPages);
}

function drawNoArtworkPlaceholder(
  doc: PdfDoc,
  top: number,
  height: number,
  message: string
) {
  doc
    .rect(MARGIN, top + 20, PAGE_WIDTH - MARGIN * 2, height - 40)
    .strokeColor("#e5e7eb")
    .lineWidth(1)
    .dash(4, { space: 4 })
    .stroke();
  doc.undash();
  doc
    .fontSize(11)
    .fillColor("#9ca3af")
    .text(message, MARGIN, top + height / 2 - 8, {
      width: PAGE_WIDTH - MARGIN * 2,
      align: "center",
    });
}

function drawArtworkPage(
  doc: PdfDoc,
  data: OrderExportData,
  skuIndex: number,
  totalSkus: number,
  skuName: string,
  skuQty: number | null,
  imageIndex: number,
  totalImagesForSku: number,
  pageNum: number,
  totalPages: number,
  imageBuffer: Buffer | null
) {
  doc.rect(0, 0, PAGE_WIDTH, 44).fill("#1a1a2e");
  doc
    .fillColor("#ffffff")
    .fontSize(11)
    .font("Helvetica-Bold")
    .text(data.tenantName.toUpperCase(), MARGIN, 14);
  doc
    .fontSize(9)
    .font("Helvetica")
    .text("JOB TICKET", PAGE_WIDTH - MARGIN - 60, 14, {
      width: 60,
      align: "right",
    });
  doc.fontSize(9).text(data.orderNumberDisplay, MARGIN, 28);

  const skuLabel =
    totalImagesForSku > 1
      ? `SKU ${skuIndex + 1}/${totalSkus}: ${skuName}  ·  Image ${imageIndex + 1}/${totalImagesForSku}  ·  Qty: ${fmtQty(skuQty)}`
      : `SKU ${skuIndex + 1}/${totalSkus}: ${skuName}  ·  Qty: ${fmtQty(skuQty)}`;

  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor("#d1d5db")
    .text(skuLabel, MARGIN + 100, 28, {
      width: PAGE_WIDTH - MARGIN * 2 - 100,
      align: "right",
    });

  doc.fillColor("#000000");

  const imageTop = 52;
  const imageBottom = PAGE_HEIGHT - 24;
  const imageAreaH = imageBottom - imageTop;
  const imageAreaW = PAGE_WIDTH;

  if (imageBuffer) {
    try {
      doc.image(imageBuffer, 0, imageTop, {
        width: imageAreaW,
        height: imageAreaH,
        fit: [imageAreaW, imageAreaH],
        align: "center",
        valign: "center",
      });
    } catch {
      drawNoArtworkPlaceholder(doc, imageTop, imageAreaH, "Image could not be loaded");
    }
  } else {
    drawNoArtworkPlaceholder(doc, imageTop, imageAreaH, "No artwork uploaded");
  }

  drawFooter(doc, pageNum, totalPages);
}

function totalArtworkPages(data: OrderExportData): number {
  return data.skuRows.reduce(
    (sum, sku) => sum + Math.max(1, sku.imageLinks.length),
    0
  );
}

export async function generateJobTicketPdf(
  data: OrderExportData
): Promise<Buffer> {
  const artworkPages = totalArtworkPages(data);
  const totalPages = 1 + artworkPages;

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    autoFirstPage: false,
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  doc.addPage();
  drawPage1(doc, data, totalPages);

  let pageNum = 2;
  for (let skuIdx = 0; skuIdx < data.skuRows.length; skuIdx++) {
    const sku = data.skuRows[skuIdx];
    const images = sku.imageLinks;

    if (images.length === 0) {
      doc.addPage();
      drawArtworkPage(
        doc,
        data,
        skuIdx,
        data.skuRows.length,
        sku.name,
        sku.qty,
        0,
        0,
        pageNum,
        totalPages,
        null
      );
      pageNum++;
    } else {
      for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
        const buf = await fetchImageBuffer(images[imgIdx]);
        doc.addPage();
        drawArtworkPage(
          doc,
          data,
          skuIdx,
          data.skuRows.length,
          sku.name,
          sku.qty,
          imgIdx,
          images.length,
          pageNum,
          totalPages,
          buf
        );
        pageNum++;
      }
    }
  }

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}
