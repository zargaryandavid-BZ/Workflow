import "server-only";

import { createRequire } from "node:module";
import type { OrderExportData, OrderExportSkuRow } from "@/lib/button-automation-order-data";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

type PdfDoc = InstanceType<typeof PDFDocument>;

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2; // 540
const HEADER_H = 44;
const SKU_PER_PAGE = 6;
const COLS = 2;
const ROW_GAP = 16;

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function fmtQty(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

function capitalize(s: string): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fieldByName(data: OrderExportData, name: string): string {
  const field = data.customFields.find(
    (f) => f.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (!field) return "";
  const raw = data.fieldValues[field.id];
  if (raw == null || raw === "") return "";
  return String(raw).trim();
}

function skuSpecLine(data: OrderExportData): string {
  return [data.product, fieldByName(data, "Finished Size"), fieldByName(data, "Materials")]
    .filter(Boolean)
    .join(" · ");
}

/** Base order label without group-size suffix, then append dialog totalParts. */
export function packingSlipOrderLabel(
  orderNumberDisplay: string,
  orderNumber: string,
  totalParts: number
): string {
  const base = (orderNumberDisplay || orderNumber)
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim();
  return `${base} (${totalParts})`;
}

function drawUnderline(
  doc: PdfDoc,
  x: number,
  y: number,
  width: number
) {
  doc
    .moveTo(x, y)
    .lineTo(x + width, y)
    .strokeColor("#aaaaaa")
    .lineWidth(0.5)
    .stroke();
}

function drawCheckbox(doc: PdfDoc, x: number, y: number) {
  doc
    .rect(x, y, 13, 13)
    .strokeColor("#374151")
    .lineWidth(1)
    .stroke();
}

function drawSectionBar(doc: PdfDoc, y: number, label: string): number {
  doc.rect(MARGIN, y, CONTENT_W, 16).fill("#f3f4f6");
  doc
    .fillColor("#374151")
    .fontSize(9)
    .font("Helvetica-Bold")
    .text(label, MARGIN + 6, y + 4);
  doc.fillColor("#000000").font("Helvetica");
  return y + 16;
}

function drawHRule(doc: PdfDoc, y: number, color = "#e5e7eb") {
  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + CONTENT_W, y)
    .strokeColor(color)
    .lineWidth(0.5)
    .stroke();
}

function drawPageHeader(
  doc: PdfDoc,
  tenantName: string,
  orderLabel: string,
  pageNum: number,
  totalPages: number
) {
  doc.rect(0, 0, PAGE_W, HEADER_H).fill("#1a1f2e");

  doc
    .fillColor("#ffffff")
    .fontSize(14)
    .font("Helvetica-Bold")
    .text(tenantName.replace(/\s+/g, "").toUpperCase() || "WORKFLOW", MARGIN, 10, {
      width: CONTENT_W * 0.45,
    });

  doc
    .fontSize(14)
    .font("Helvetica-Bold")
    .text("PACKING SLIP", MARGIN, 10, {
      width: CONTENT_W,
      align: "right",
    });

  doc
    .fontSize(9)
    .font("Helvetica")
    .text(orderLabel, MARGIN, 28, { width: CONTENT_W * 0.35 });

  if (totalPages > 1) {
    doc
      .fontSize(8)
      .text(`Page ${pageNum} of ${totalPages}`, MARGIN, 28, {
        width: CONTENT_W,
        align: "center",
      });
  }

  doc.fontSize(9).text(
    new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    MARGIN,
    28,
    { width: CONTENT_W, align: "right" }
  );

  doc.fillColor("#000000").font("Helvetica");
}

function drawLabeledValue(
  doc: PdfDoc,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  opts?: { extraLabel?: string; extraValue?: string; extraW?: number }
) {
  doc
    .fontSize(8)
    .font("Helvetica-Bold")
    .fillColor("#6b7280")
    .text(label, x, y, { width: 52, height: 12 });
  const valueX = x + 52;
  const mainW = opts?.extraLabel
    ? width - 52 - (opts.extraW ?? 90)
    : width - 52;
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor("#111827")
    .text(value || "—", valueX, y, {
      width: Math.max(40, mainW),
      height: 12,
      ellipsis: true,
    });

  if (opts?.extraLabel) {
    const exX = x + width - (opts.extraW ?? 90);
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor("#6b7280")
      .text(opts.extraLabel, exX, y, { width: 48, height: 12 });
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#111827")
      .text(opts.extraValue || "—", exX + 48, y, {
        width: (opts.extraW ?? 90) - 48,
        height: 12,
        ellipsis: true,
      });
  }
}

function drawCustomerSection(doc: PdfDoc, data: OrderExportData, startY: number): number {
  let y = drawSectionBar(doc, startY, "CUSTOMER");
  const bodyTop = y;
  const bodyH = 52;
  const col1W = CONTENT_W * 0.32;
  const col2W = CONTENT_W * 0.38;
  const col3W = CONTENT_W - col1W - col2W;
  const col1X = MARGIN;
  const col2X = MARGIN + col1W;
  const col3X = MARGIN + col1W + col2W;
  const pad = 8;
  const rowH = 13;

  doc
    .rect(MARGIN, bodyTop, CONTENT_W, bodyH)
    .strokeColor("#e5e7eb")
    .lineWidth(0.5)
    .stroke();

  // Vertical dividers
  doc
    .moveTo(col2X, bodyTop)
    .lineTo(col2X, bodyTop + bodyH)
    .strokeColor("#d1d5db")
    .lineWidth(0.5)
    .stroke();
  doc
    .moveTo(col3X, bodyTop)
    .lineTo(col3X, bodyTop + bodyH)
    .strokeColor("#d1d5db")
    .lineWidth(0.5)
    .stroke();

  let rowY = bodyTop + 8;
  drawLabeledValue(
    doc,
    "Name",
    data.customerName,
    col1X + pad,
    rowY,
    col1W - pad * 2
  );
  drawLabeledValue(
    doc,
    "Due Date",
    data.dueDateFormatted,
    col2X + pad,
    rowY,
    col2W - pad * 2
  );

  // BOX column
  doc
    .fontSize(18)
    .font("Helvetica-Bold")
    .fillColor("#1a1f2e")
    .text("BOX", col3X + pad, bodyTop + 8, {
      width: col3W - pad * 2,
      align: "center",
    });
  const boxLineY = bodyTop + 36;
  const underlineW = 48;
  const gap = 14;
  const unitW = underlineW * 2 + gap;
  const boxStartX = col3X + (col3W - unitW) / 2;
  drawUnderline(doc, boxStartX, boxLineY, underlineW);
  doc
    .fontSize(12)
    .font("Helvetica")
    .fillColor("#6b7280")
    .text("/", boxStartX + underlineW, boxLineY - 10, {
      width: gap,
      align: "center",
    });
  drawUnderline(doc, boxStartX + underlineW + gap, boxLineY, underlineW);

  rowY += rowH;
  drawLabeledValue(
    doc,
    "Phone",
    data.customerPhone ?? "—",
    col1X + pad,
    rowY,
    col1W - pad * 2
  );
  drawLabeledValue(
    doc,
    "Priority",
    capitalize(data.priority),
    col2X + pad,
    rowY,
    col2W - pad * 2,
    {
      extraLabel: "QTY",
      extraValue: fmtQty(data.totalQty),
      extraW: 80,
    }
  );

  rowY += rowH;
  drawLabeledValue(
    doc,
    "Email",
    data.customerEmail ?? "—",
    col1X + pad,
    rowY,
    col1W - pad * 2
  );
  drawLabeledValue(
    doc,
    "Owner",
    data.ownerName || data.assignedToName || "—",
    col2X + pad,
    rowY,
    col2W - pad * 2
  );

  doc.fillColor("#000000").font("Helvetica");
  return bodyTop + bodyH;
}

function drawDashedPlaceholder(
  doc: PdfDoc,
  x: number,
  y: number,
  w: number,
  h: number
) {
  doc
    .rect(x, y, w, h)
    .strokeColor("#d1d5db")
    .lineWidth(0.75)
    .dash(3, { space: 3 })
    .stroke();
  doc.undash();
  doc
    .fontSize(8)
    .fillColor("#9ca3af")
    .text("No image", x, y + h / 2 - 4, { width: w, align: "center" });
}

function drawSkuCell(
  doc: PdfDoc,
  sku: OrderExportSkuRow,
  imageBuf: Buffer | null,
  specLine: string,
  cellX: number,
  cellTop: number,
  cellW: number,
  cellH: number
) {
  doc
    .rect(cellX, cellTop, cellW, cellH)
    .strokeColor("#e2e5e8")
    .lineWidth(0.5)
    .stroke();

  const pad = 6;
  // Leave room for larger name + spec + qty fill-in at the bottom.
  const footerH = 78;
  const imgH = Math.max(40, cellH - footerH);
  const imgW = cellW - 12;
  const imgX = cellX + 6;
  const imgY = cellTop + 4;

  if (imageBuf) {
    try {
      doc.image(imageBuf, imgX, imgY, {
        fit: [imgW, imgH],
        align: "center",
        valign: "center",
      });
    } catch {
      drawDashedPlaceholder(doc, imgX, imgY, imgW, imgH);
    }
  } else {
    drawDashedPlaceholder(doc, imgX, imgY, imgW, imgH);
  }

  // Checkbox on top of image so it stays visible for marker use.
  drawCheckbox(doc, cellX + 6, cellTop + 5);

  const nameY = imgY + imgH + 8;
  doc
    .fontSize(13)
    .font("Helvetica-Bold")
    .fillColor("#111827")
    .text(sku.name, cellX + pad, nameY, {
      width: cellW - pad * 2,
      align: "center",
      height: 18,
      ellipsis: true,
    });

  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor("#4b5563")
    .text(specLine || " ", cellX + pad, nameY + 18, {
      width: cellW - pad * 2,
      align: "center",
      height: 14,
      ellipsis: true,
    });

  // Qty: underline / NNN — large for marker use
  const qtyBottom = cellTop + cellH - 12;
  const qtyStr = fmtQty(sku.qty);
  const underlineW = 100;
  const slashGap = 10;
  doc.fontSize(20).font("Helvetica-Bold");
  const qtyNumW = doc.widthOfString(`/ ${qtyStr}`);
  const unitW = underlineW + slashGap + qtyNumW;
  const unitX = cellX + (cellW - unitW) / 2;
  drawUnderline(doc, unitX, qtyBottom, underlineW);
  doc
    .fillColor("#111827")
    .text(`/ ${qtyStr}`, unitX + underlineW + slashGap, qtyBottom - 16, {
      width: qtyNumW + 6,
      lineBreak: false,
    });

  doc.fillColor("#000000").font("Helvetica");
}

function drawItemsGrid(
  doc: PdfDoc,
  data: OrderExportData,
  pageSkus: OrderExportSkuRow[],
  imageBuffers: Map<string, Buffer | null>,
  startY: number
) {
  let y = drawSectionBar(doc, startY, "ITEMS");
  y += 6;

  const n = pageSkus.length;
  if (n === 0) {
    doc
      .fontSize(10)
      .fillColor("#9ca3af")
      .text("No SKUs on this order", MARGIN, y + 24, {
        width: CONTENT_W,
        align: "center",
      });
    doc.fillColor("#000000");
    return;
  }

  const availableH = PAGE_H - MARGIN - y;
  // Fixed 2 columns; row count from SKU count. Single SKU uses full width.
  const cols = n === 1 ? 1 : COLS;
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellH = Math.max(
    80,
    (availableH - ROW_GAP * Math.max(0, rows - 1)) / rows
  );
  const cellW = CONTENT_W / cols;
  const spec = skuSpecLine(data);

  for (let i = 0; i < n; i++) {
    const sku = pageSkus[i];
    const row = Math.floor(i / cols);
    const col = i % cols;
    const cellX = MARGIN + col * cellW;
    const cellTop = y + row * (cellH + ROW_GAP);
    const buf = sku.imageLinks[0]
      ? (imageBuffers.get(sku.imageLinks[0]) ?? null)
      : null;
    drawSkuCell(doc, sku, buf, spec, cellX, cellTop, cellW, cellH);
  }
}

export async function generatePackingSlipPdf(
  data: OrderExportData,
  opts: { part: number; totalParts: number }
): Promise<Buffer> {
  const orderLabel = packingSlipOrderLabel(
    data.orderNumberDisplay || data.orderNumber,
    data.orderNumber,
    opts.totalParts
  );

  const skus = data.skuRows ?? [];
  const pages: OrderExportSkuRow[][] = [];
  if (skus.length === 0) {
    pages.push([]);
  } else {
    for (let i = 0; i < skus.length; i += SKU_PER_PAGE) {
      pages.push(skus.slice(i, i + SKU_PER_PAGE));
    }
  }

  // Prefetch first image per SKU
  const urls = [
    ...new Set(
      skus
        .map((s) => s.imageLinks[0])
        .filter((u): u is string => Boolean(u))
    ),
  ];
  const imageBuffers = new Map<string, Buffer | null>();
  await Promise.all(
    urls.map(async (url) => {
      imageBuffers.set(url, await fetchImageBuffer(url));
    })
  );

  const doc = new PDFDocument({
    size: "LETTER",
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

  try {
    for (let pageNum = 0; pageNum < pages.length; pageNum++) {
      doc.addPage();
      drawPageHeader(
        doc,
        data.tenantName || "Workflow",
        orderLabel,
        pageNum + 1,
        pages.length
      );
      drawHRule(doc, HEADER_H, "#1a1f2e");
      const afterCustomer = drawCustomerSection(doc, data, HEADER_H + 8);
      drawItemsGrid(
        doc,
        data,
        pages[pageNum],
        imageBuffers,
        afterCustomer + 8
      );
    }
    doc.end();
  } catch (err) {
    try {
      doc.end();
    } catch {
      /* ignore */
    }
    throw err;
  }

  return done;
}
