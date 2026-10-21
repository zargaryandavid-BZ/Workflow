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

/** 4×6 in thermal label. One page per box, or one page per SKU when requested. */
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
