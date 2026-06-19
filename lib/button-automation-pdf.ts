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
  const lower = value.toLowerCase();
  if (lower === "yes" || lower === "true") return "✓";
  if (lower === "no" || lower === "false") return "✗";
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
  doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 18).fill("#f3f4f6");
  doc
    .fillColor("#374151")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text(title, MARGIN + 6, y + 5);
  doc.fillColor("#000000").font("Helvetica");
  return y + 22;
}

function drawSpecRow(
  doc: PdfDoc,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number
): number {
  doc
    .fontSize(8)
    .font("Helvetica-Bold")
    .fillColor("#6b7280")
    .text(label, x, y, { width: width * 0.42 });
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor("#111827")
    .text(value || "—", x + width * 0.42, y, { width: width * 0.58 });
  return y + 14;
}

function drawSpecs(doc: PdfDoc, data: OrderExportData, startY: number): number {
  let y = drawSectionTitle(doc, "SPECIFICATIONS", startY);
  const x = MARGIN + 6;
  const w = PAGE_WIDTH - MARGIN * 2 - 12;

  const specRows = data.specRows.map((row) => ({
    label: row.label,
    value: yesNo(row.value),
  }));

  if (data.artworkLink) {
    specRows.push({ label: "Artwork GDrive", value: data.artworkLink });
  }

  const midpoint = Math.ceil(specRows.length / 2);
  const leftSpecs = specRows.slice(0, midpoint);
  const rightSpecs = specRows.slice(midpoint);
  const maxRows = Math.max(leftSpecs.length, rightSpecs.length);

  for (let i = 0; i < maxRows; i++) {
    const rowY = y + i * 14;
    if (leftSpecs[i]) {
      drawSpecRow(doc, leftSpecs[i].label, leftSpecs[i].value, x, rowY, COL_WIDTH - 6);
    }
    if (rightSpecs[i]) {
      drawSpecRow(
        doc,
        rightSpecs[i].label,
        rightSpecs[i].value,
        x + COL_WIDTH,
        rowY,
        COL_WIDTH - 6
      );
    }
  }

  y += maxRows * 14 + 4;

  if (data.designTask) {
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor("#6b7280")
      .text("Designer Notes", x, y);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#111827")
      .text(data.designTask, x + w * 0.3, y, { width: w * 0.7 });
    y += 14;
  }

  return y + 8;
}

function drawPage1(
  doc: PdfDoc,
  data: OrderExportData,
  totalPages: number
) {
  drawHeader(doc, data.tenantName, data.orderNumber);

  let y = 56;
  const w = PAGE_WIDTH - MARGIN * 2 - 12;

  y = drawSectionTitle(doc, "CUSTOMER", y);
  y = drawSpecRow(
    doc,
    "Name",
    data.customerName,
    MARGIN + 6,
    y,
    PAGE_WIDTH - MARGIN * 2 - 12
  );
  const contactLine = [data.customerEmail, data.customerPhone]
    .filter(Boolean)
    .join("   ·   ");
  y = drawSpecRow(
    doc,
    "Contact",
    contactLine || data.customerContact || "—",
    MARGIN + 6,
    y,
    PAGE_WIDTH - MARGIN * 2 - 12
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
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor("#9ca3af")
      .text(`${sku.index}`, rowX, y, { width: 16 });
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#111827")
      .text(sku.name, rowX + 20, y, { width: w - 80 });
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor("#374151")
      .text(fmtQty(sku.qty), rowX + w - 60, y, { width: 60, align: "right" });
    y += 14;
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
  doc.fontSize(9).text(data.orderNumber, MARGIN, 28);

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
