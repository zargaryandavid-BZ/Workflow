import { createRequire } from "node:module";
import { orderNumberQrPng } from "./order-qr.ts";
import { pdfWinAnsiText } from "./pdf-winansi-text.ts";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

type PdfDoc = InstanceType<typeof PDFDocument>;

export type ThermalSlipLine = {
  skuId: string;
  /** Quantity of this SKU placed in the box. */
  qty: number;
  /** Product-specification quantity this box amount was taken from. */
  fromQty?: number;
};

/** "From 5,205 / 1,735 In box" — spec quantity, then the amount in this box. */
export function thermalInBoxQtyLabel(
  qty: number,
  fromQty?: number | null
): string {
  const inBox = fmtQty(qty);
  if (fromQty == null || !Number.isFinite(fromQty) || fromQty <= 0) return inBox;
  return `From ${fmtQty(fromQty)} / ${inBox} In box`;
}

export type ThermalSlipBox = {
  boxNumber: number;
  sizeLabel?: string;
  weightLbs?: number;
  lines: ThermalSlipLine[];
};

export type ThermalSlipSku = {
  id: string;
  name: string;
  imageUrl?: string | null;
  /** Printed "SKU N" number. Defaults to the position in `skus` (1-based). */
  number?: number;
};

const THERMAL_W = 288;
const THERMAL_H = 432;
const THERMAL_ROWS = 6;

function fmtQty(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
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

function thermalChunks<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

export function thermalBoxBannerLabel(
  box: ThermalSlipBox,
  boxCount: number,
  pageInBox: number,
  pagesInBox: number
): string {
  const continued = pagesInBox > 1 ? `  ·  ${pageInBox}/${pagesInBox}` : "";
  return `PACKING BOX SLIP  ·  BOX ${box.boxNumber} OF ${boxCount}${continued}`;
}

export function thermalBoxDetailLabels(box: ThermalSlipBox): {
  size: string;
  weight: string;
} {
  const size = box.sizeLabel?.trim() || "—";
  const weight =
    box.weightLbs != null && Number.isFinite(box.weightLbs) && box.weightLbs > 0
      ? `${box.weightLbs.toLocaleString("en-US", {
          maximumFractionDigits: 2,
        })} lb`
      : "—";
  return { size, weight };
}

function drawThermalBanner(
  doc: PdfDoc,
  box: ThermalSlipBox,
  boxCount: number,
  pageInBox: number,
  pagesInBox: number
) {
  doc.rect(0, 0, THERMAL_W, 28).fill("#111827");
  const label = thermalBoxBannerLabel(
    box,
    boxCount,
    pageInBox,
    pagesInBox
  );
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(label, 8, 8, {
      width: THERMAL_W - 16,
      align: "center",
      lineBreak: false,
      ellipsis: true,
    });
}

function drawThermalIdentity(
  doc: PdfDoc,
  orderLabel: string,
  customerName: string,
  box: ThermalSlipBox,
  qrPng: Buffer | null
) {
  const qrSize = 46;
  const qrX = THERMAL_W - 8 - qrSize;
  const leftX = 8;
  const leftW = 112;
  const detailsX = leftX + leftW + 8;
  const detailsW = qrX - detailsX - 8;
  const details = thermalBoxDetailLabels(box);
  doc
    .fillColor("#6b7280")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("ORDER", leftX, 36, { width: leftW, lineBreak: false });
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(pdfWinAnsiText(orderLabel || "Order"), leftX, 48, {
      width: leftW,
      height: 16,
      ellipsis: true,
    });
  doc
    .fillColor("#374151")
    .font("Helvetica")
    .fontSize(8)
    .text(
      pdfWinAnsiText(`CUSTOMER · ${customerName || "—"}`),
      leftX,
      67,
      {
      width: leftW,
      height: 12,
      ellipsis: true,
      }
    );
  doc
    .fillColor("#6b7280")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("SIZE / WEIGHT", detailsX, 36, {
      width: detailsW,
      lineBreak: false,
    });
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(pdfWinAnsiText(details.size), detailsX, 49, {
      width: detailsW,
      height: 13,
      ellipsis: true,
    });
  doc
    .fillColor("#374151")
    .font("Helvetica")
    .fontSize(9)
    .text(pdfWinAnsiText(details.weight), detailsX, 66, {
      width: detailsW,
      height: 12,
      ellipsis: true,
    });
  if (qrPng) {
    try {
      doc.image(qrPng, qrX, 34, {
        width: qrSize,
        height: qrSize,
      });
    } catch {
      /* skip a bad QR */
    }
  }
  doc
    .moveTo(8, 84)
    .lineTo(THERMAL_W - 8, 84)
    .strokeColor("#111827")
    .lineWidth(1)
    .stroke();
}

/** Default for the "Pallet slip" checkbox: on when the order ships in 2+ boxes. */
export function defaultPalletSlip(boxCount: number): boolean {
  return boxCount > 1;
}

export type PalletSlipRow = {
  itemNumber: number;
  name: string;
  qty: number;
  boxNumber: number;
};

/** One row per SKU per box, in box order then SKU order. */
export function palletSlipRows(
  skus: ThermalSlipSku[],
  boxes: ThermalSlipBox[]
): PalletSlipRow[] {
  const indexById = new Map(skus.map((sku, i) => [sku.id, sku.number ?? i + 1]));
  const nameById = new Map(skus.map((sku) => [sku.id, sku.name?.trim() || sku.id]));
  const rows: PalletSlipRow[] = [];
  for (const box of boxes) {
    const lines = box.lines
      .filter((line) => line.qty > 0)
      .sort(
        (a, b) =>
          (indexById.get(a.skuId) ?? 9999) - (indexById.get(b.skuId) ?? 9999)
      );
    for (const line of lines) {
      rows.push({
        itemNumber: indexById.get(line.skuId) ?? 0,
        name: nameById.get(line.skuId) ?? line.skuId,
        qty: line.qty,
        boxNumber: box.boxNumber,
      });
    }
  }
  return rows;
}

function packedTimeLabel(now: Date): string {
  return now.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Pick a layout that fits every row on ONE 4×6 page: one column with roomy
 * rows, then tighter rows, then two columns. Only very large orders (90+ box
 * lines) spill onto a second page.
 */
function palletLayout(rowCount: number, areaH: number) {
  const n = Math.max(1, rowCount);
  const oneColH = areaH / n;
  if (oneColH >= 10) {
    return { cols: 1, rowH: Math.min(18, oneColH), perPage: n };
  }
  const twoColH = areaH / Math.ceil(n / 2);
  if (twoColH >= 6.5) {
    return { cols: 2, rowH: Math.min(14, twoColH), perPage: n };
  }
  const rowH = 6.5;
  return { cols: 2, rowH, perPage: Math.floor(areaH / rowH) * 2 };
}

function drawPalletSlip(
  doc: PdfDoc,
  input: {
    orderLabel: string;
    skus: ThermalSlipSku[];
    boxes: ThermalSlipBox[];
    qrPng: Buffer | null;
    packedAt: Date;
  }
) {
  const rows = palletSlipRows(input.skus, input.boxes);
  const totalQty = rows.reduce((sum, row) => sum + row.qty, 0);

  const tableTop = 98;
  const headH = 13;
  const footH = 20;
  const areaH = THERMAL_H - 6 - footH - (tableTop + headH);
  const layout = palletLayout(rows.length, areaH);
  const pages = thermalChunks(rows, layout.perPage);
  const tableW = THERMAL_W - 16;
  const gap = layout.cols === 2 ? 6 : 0;
  const colW = (tableW - gap * (layout.cols - 1)) / layout.cols;
  const font = Math.max(5.5, Math.min(8, layout.rowH * 0.7));

  pages.forEach((pageRows, pageIndex) => {
    doc.addPage({ size: [THERMAL_W, THERMAL_H], margin: 0 });

    // Banner
    doc.rect(0, 0, THERMAL_W, 28).fill("#111827");
    const continued =
      pages.length > 1 ? `  ·  ${pageIndex + 1}/${pages.length}` : "";
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(`PACKING PALLET SLIP${continued}`, 8, 8, {
        width: THERMAL_W - 16,
        align: "center",
        lineBreak: false,
      });

    // Identity + QR
    const qrSize = 58;
    const qrX = THERMAL_W - 8 - qrSize;
    const leftW = qrX - 16;
    doc.fillColor("#6b7280").font("Helvetica-Bold").fontSize(8);
    doc.text("ORDER", 8, 36, { width: leftW, lineBreak: false });
    doc
      .fillColor("#111827")
      .fontSize(13)
      .text(pdfWinAnsiText(input.orderLabel || "Order"), 8, 46, {
        width: leftW,
        height: 16,
        ellipsis: true,
      });
    doc
      .font("Helvetica")
      .fontSize(9)
      .text(`Total boxes: ${input.boxes.length}`, 8, 66, {
        width: leftW,
        lineBreak: false,
      })
      .text(`Packed: ${packedTimeLabel(input.packedAt)}`, 8, 79, {
        width: leftW,
        lineBreak: false,
      });
    if (input.qrPng) {
      try {
        doc.image(input.qrPng, qrX, 34, { width: qrSize, height: qrSize });
      } catch {
        /* skip a bad QR */
      }
    }

    const perCol = Math.ceil(pageRows.length / layout.cols);
    for (let c = 0; c < layout.cols; c++) {
      const x0 = 8 + c * (colW + gap);
      const itemW = layout.cols === 2 ? 16 : 30;
      const boxW = layout.cols === 2 ? 18 : 40;
      const qtyW = layout.cols === 2 ? 30 : 50;
      const nameX = x0 + itemW + 2;
      const boxX = x0 + colW - boxW;
      const qtyX = boxX - qtyW - 2;
      const nameW = qtyX - nameX - 3;

      // Column header
      doc.rect(x0, tableTop, colW, headH).fill("#111827");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(layout.cols === 2 ? 6.5 : 8);
      const hy = tableTop + 3.5;
      doc.text(layout.cols === 2 ? "#" : "Item N.", x0 + 2, hy, { width: itemW, lineBreak: false });
      doc.text("Item SKU", nameX, hy, { width: nameW, lineBreak: false });
      doc.text("QTY", qtyX, hy, { width: qtyW, align: "right", lineBreak: false });
      doc.text("Box", boxX, hy, { width: boxW, align: "center", lineBreak: false });

      const colRows = pageRows.slice(c * perCol, (c + 1) * perCol);
      colRows.forEach((row, i) => {
        const y = tableTop + headH + i * layout.rowH;
        if (i % 2 === 1) doc.rect(x0, y, colW, layout.rowH).fill("#f3f4f6");
        // New box starts → thin divider so each box reads as a group.
        const prev = colRows[i - 1];
        if (prev && prev.boxNumber !== row.boxNumber) {
          doc
            .moveTo(x0, y)
            .lineTo(x0 + colW, y)
            .strokeColor("#111827")
            .lineWidth(0.6)
            .stroke();
        }
        const ty = y + (layout.rowH - font) / 2;
        doc.fillColor("#111827").font("Helvetica").fontSize(font);
        doc.text(row.itemNumber ? String(row.itemNumber) : "—", x0 + 2, ty, {
          width: itemW,
          lineBreak: false,
        });
        doc.font("Helvetica-Bold").text(pdfWinAnsiText(row.name), nameX, ty, {
          width: nameW,
          height: font + 2,
          ellipsis: true,
          lineBreak: false,
        });
        doc.font("Helvetica").text(fmtQty(row.qty), qtyX, ty, {
          width: qtyW,
          align: "right",
          lineBreak: false,
        });
        doc.font("Helvetica-Bold").text(String(row.boxNumber), boxX, ty, {
          width: boxW,
          align: "center",
          lineBreak: false,
        });
      });
    }

    // Total on the last page, pinned to the bottom.
    if (pageIndex === pages.length - 1) {
      const y = THERMAL_H - 6 - footH + 2;
      doc.rect(8, y, tableW, footH - 4).fill("#111827");
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9);
      doc.text(
        `TOTAL  ${fmtQty(totalQty)} pcs  ·  ${input.boxes.length} boxes  ·  ${rows.length} lines`,
        12,
        y + 4,
        { width: tableW - 8, align: "center", lineBreak: false }
      );
    }
  });
}

/**
 * 4×6 in thermal label. One page per box, or one page per SKU when requested.
 * `palletSlip` adds one Packing Pallet Slip (all boxes) as the last page;
 * when omitted it follows defaultPalletSlip(boxes).
 */
export async function generateThermalBoxSlipPdf(input: {
  orderLabel: string;
  customerName: string;
  skus: ThermalSlipSku[];
  boxes: ThermalSlipBox[];
  layout: "multiple" | "one_per_slip";
  palletSlip?: boolean;
}): Promise<Buffer> {
  const skuById = new Map(input.skus.map((sku) => [sku.id, sku]));
  const skuIndexById = new Map(
    input.skus.map((sku, i) => [sku.id, sku.number ?? i + 1])
  );
  const boxes =
    input.boxes.length > 0 ? input.boxes : [{ boxNumber: 1, lines: [] }];
  const boxCount = boxes.length;

  const urls = [
    ...new Set(
      input.skus
        .map((sku) => sku.imageUrl)
        .filter((url): url is string => Boolean(url))
    ),
  ];
  const imageBuffers = new Map<string, Buffer | null>();
  await Promise.all(
    urls.map(async (url) => {
      imageBuffers.set(url, await fetchImageBuffer(url));
    })
  );

  const qrPng = input.orderLabel
    ? await orderNumberQrPng(input.orderLabel)
    : null;
  const doc = new PDFDocument({
    size: [THERMAL_W, THERMAL_H],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    autoFirstPage: false,
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const resolved = (line: ThermalSlipLine) => {
    const sku = skuById.get(line.skuId);
    const skuNum = skuIndexById.get(line.skuId);
    const baseName = sku?.name?.trim() || line.skuId;
    const name = skuNum != null ? `SKU ${skuNum}: ${baseName}` : baseName;
    return {
      name,
      qtyLabel: thermalInBoxQtyLabel(line.qty, line.fromQty),
      image: sku?.imageUrl ? (imageBuffers.get(sku.imageUrl) ?? null) : null,
    };
  };

  try {
    for (const box of boxes) {
      const lines = box.lines.filter((line) => line.qty > 0);
      if (input.layout === "one_per_slip") {
        const pages = lines.length > 0 ? lines : [null];
        pages.forEach((line, index) => {
          doc.addPage({ size: [THERMAL_W, THERMAL_H], margin: 0 });
          drawThermalBanner(
            doc,
            box,
            boxCount,
            index + 1,
            pages.length
          );
          drawThermalIdentity(
            doc,
            input.orderLabel,
            input.customerName,
            box,
            qrPng
          );
          if (!line) {
            doc
              .fontSize(10)
              .fillColor("#9ca3af")
              .text("No SKUs in this box", 8, 180, {
                width: THERMAL_W - 16,
                align: "center",
              });
            return;
          }
          const item = resolved(line);
          const img = 168;
          const imgX = (THERMAL_W - img) / 2;
          const imgY = 100;
          if (item.image) {
            try {
              doc.image(item.image, imgX, imgY, {
                fit: [img, img],
                align: "center",
                valign: "center",
              });
            } catch {
              drawDashedPlaceholder(doc, imgX, imgY, img, img);
            }
          } else {
            drawDashedPlaceholder(doc, imgX, imgY, img, img);
          }
          doc
            .fillColor("#111827")
            .font("Helvetica-Bold")
            .fontSize(12)
            .text(pdfWinAnsiText(item.name), 12, 280, {
              width: THERMAL_W - 24,
              align: "center",
              height: 32,
              ellipsis: true,
            });
          doc.fontSize(14).text(item.qtyLabel, 12, 318, {
            width: THERMAL_W - 24,
            align: "center",
          });
        });
        continue;
      }

      const pages = thermalChunks(lines, THERMAL_ROWS);
      pages.forEach((pageLines, index) => {
        doc.addPage({ size: [THERMAL_W, THERMAL_H], margin: 0 });
        drawThermalBanner(doc, box, boxCount, index + 1, pages.length);
        drawThermalIdentity(
          doc,
          input.orderLabel,
          input.customerName,
          box,
          qrPng
        );
        if (pageLines.length === 0) {
          doc
            .fontSize(10)
            .fillColor("#9ca3af")
            .text("No SKUs in this box", 8, 160, {
              width: THERMAL_W - 16,
              align: "center",
            });
          return;
        }
        pageLines.forEach((line, row) => {
          const item = resolved(line);
          const y = 94 + row * 54;
          doc
            .rect(8, y, THERMAL_W - 16, 50)
            .strokeColor("#e5e7eb")
            .lineWidth(0.6)
            .stroke();
          if (item.image) {
            try {
              doc.image(item.image, 12, y + 5, {
                fit: [40, 40],
                align: "center",
                valign: "center",
              });
            } catch {
              drawDashedPlaceholder(doc, 12, y + 5, 40, 40);
            }
          } else {
            drawDashedPlaceholder(doc, 12, y + 5, 40, 40);
          }
          doc
            .fillColor("#111827")
            .font("Helvetica-Bold")
            .fontSize(9)
            .text(pdfWinAnsiText(item.name), 58, y + 6, {
              width: THERMAL_W - 74,
              height: 18,
              ellipsis: true,
            });
          doc.font("Helvetica").fontSize(8).text(item.qtyLabel, 58, y + 26, {
            width: THERMAL_W - 74,
            height: 18,
            ellipsis: true,
          });
        });
      });
    }
    if (input.palletSlip ?? defaultPalletSlip(input.boxes.length)) {
      drawPalletSlip(doc, {
        orderLabel: input.orderLabel,
        skus: input.skus,
        boxes,
        qrPng,
        packedAt: new Date(),
      });
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
