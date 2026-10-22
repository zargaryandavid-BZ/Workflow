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
  return `PACKING SLIP  ·  BOX ${box.boxNumber} OF ${boxCount}${continued}`;
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

/** Pallet slip is added as the last page(s) when an order ships in more than this many boxes. */
export const PALLET_SLIP_MIN_BOXES = 3;
const PALLET_ROWS_PER_PAGE = 16;

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
  const indexById = new Map(skus.map((sku, i) => [sku.id, i + 1]));
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
  const pages = thermalChunks(rows, PALLET_ROWS_PER_PAGE);
  const totalQty = rows.reduce((sum, row) => sum + row.qty, 0);
  const cols = { item: 8, name: 40, qty: 186, box: 240, end: THERMAL_W - 8 };

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
      .fillColor("#111827")
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

    // Table header
    const headerY = 98;
    doc.rect(8, headerY, THERMAL_W - 16, 16).fill("#111827");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
    doc.text("Item N.", cols.item + 2, headerY + 4, { width: 32, lineBreak: false });
    doc.text("Item SKU", cols.name, headerY + 4, { width: cols.qty - cols.name, lineBreak: false });
    doc.text("QTY", cols.qty, headerY + 4, { width: cols.box - cols.qty - 6, align: "right", lineBreak: false });
    doc.text("Box N", cols.box, headerY + 4, { width: cols.end - cols.box, align: "center", lineBreak: false });

    // Rows
    const rowH = 18;
    pageRows.forEach((row, i) => {
      const y = headerY + 16 + i * rowH;
      if (i % 2 === 1) doc.rect(8, y, THERMAL_W - 16, rowH).fill("#f3f4f6");
      doc.fillColor("#111827").font("Helvetica").fontSize(8);
      doc.text(row.itemNumber ? String(row.itemNumber) : "—", cols.item + 2, y + 5, {
        width: 30,
        lineBreak: false,
      });
      doc.font("Helvetica-Bold").text(pdfWinAnsiText(row.name), cols.name, y + 5, {
        width: cols.qty - cols.name - 4,
        height: 10,
        ellipsis: true,
        lineBreak: false,
      });
      doc.font("Helvetica").text(fmtQty(row.qty), cols.qty, y + 5, {
        width: cols.box - cols.qty - 6,
        align: "right",
        lineBreak: false,
      });
      doc.font("Helvetica-Bold").text(String(row.boxNumber), cols.box, y + 5, {
        width: cols.end - cols.box,
        align: "center",
        lineBreak: false,
      });
    });

    // Total on the last page
    if (pageIndex === pages.length - 1) {
      const y = headerY + 16 + pageRows.length * rowH + 4;
      doc
        .moveTo(8, y)
        .lineTo(THERMAL_W - 8, y)
        .strokeColor("#111827")
        .lineWidth(1)
        .stroke();
      doc.fillColor("#111827").font("Helvetica-Bold").fontSize(9);
      doc.text("TOTAL", cols.name, y + 5, { width: 80, lineBreak: false });
      doc.text(fmtQty(totalQty), cols.qty, y + 5, {
        width: cols.box - cols.qty - 6,
        align: "right",
        lineBreak: false,
      });
      doc.text(`${input.boxes.length} boxes`, cols.box - 10, y + 5, {
        width: cols.end - cols.box + 10,
        align: "center",
        lineBreak: false,
      });
    }
  });
}

/**
 * 4×6 in thermal label. One page per box, or one page per SKU when requested.
 * Orders with PALLET_SLIP_MIN_BOXES+ boxes get a pallet slip as the last page.
 */
export async function generateThermalBoxSlipPdf(input: {
  orderLabel: string;
  customerName: string;
  skus: ThermalSlipSku[];
  boxes: ThermalSlipBox[];
  layout: "multiple" | "one_per_slip";
}): Promise<Buffer> {
  const skuById = new Map(input.skus.map((sku) => [sku.id, sku]));
  const skuIndexById = new Map(input.skus.map((sku, i) => [sku.id, i + 1]));
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
    if (boxes.length >= PALLET_SLIP_MIN_BOXES) {
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
