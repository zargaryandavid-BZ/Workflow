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
const BASE_HEADER_H = 116;
const PACKAGING_BANNER_H = 24;
const QR_SIZE = 64;

export type MultiitemBoxSlipItem = {
  orderTitle: string;
  itemTitle: string;
  quantity: number;
  skuLines?: {
    page: number;
    label: string;
    quantity: number;
  }[];
};

export type MultiitemBoxSlipInput = {
  boxName: string;
  poNumber: string | null;
  sizeLabel: string | null;
  weightLbs: number | null;
  shipmentBoxNumber?: number | null;
  shipmentBoxCount?: number | null;
  palletNumber?: number | null;
  palletCount?: number | null;
  palletBoxNumber?: number | null;
  palletBoxCount?: number | null;
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

function fitSingleLineFont(
  doc: PdfDoc,
  text: string,
  font: string,
  maxWidth: number,
  preferredSize: number,
  minimumSize: number
): number {
  doc.font(font).fontSize(preferredSize);
  const measured = doc.widthOfString(text);
  if (!Number.isFinite(measured) || measured <= maxWidth) return preferredSize;
  return Math.max(minimumSize, preferredSize * (maxWidth / measured));
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
  const packagingLabel = [
    input.palletNumber && input.palletCount
      ? `PALLET ${input.palletNumber} OF ${input.palletCount}`
      : "",
    input.palletBoxNumber && input.palletBoxCount
      ? `BOX ${input.palletBoxNumber} OF ${input.palletBoxCount} ON PALLET`
      : "",
    input.shipmentBoxNumber && input.shipmentBoxCount
      ? `SHIPMENT BOX ${input.shipmentBoxNumber} OF ${input.shipmentBoxCount}`
      : "",
  ]
    .filter(Boolean)
    .join("  ·  ");
  const tableItems = input.items.flatMap((item, itemIndex) =>
    item.skuLines?.length
      ? item.skuLines.map((line) => ({
          itemIndex,
          orderTitle: `${item.orderTitle} · ${line.label}`,
          itemTitle: item.itemTitle,
          quantity: line.quantity,
        }))
      : [{ ...item, itemIndex }]
  );
  const qrPng = await orderNumberQrPng(boxName);

  // One QR per order. It is repeated only if that order continues on a new page.
  const itemQrPngs = await Promise.all(
    input.items.map((item) =>
      orderNumberQrPng(item.orderTitle).catch(() => null)
    )
  );

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

  const ROW_H = 28;          // taller rows to fit QR
  const QR_ITEM_SIZE = 22;   // per-item QR size in points
  const rowsPerPage = 11;    // fewer rows per page to accommodate taller rows
  const pages = Math.max(1, Math.ceil(tableItems.length / rowsPerPage) || 1);
  const headerHeight =
    BASE_HEADER_H + (packagingLabel ? PACKAGING_BANNER_H : 0);

  for (let pageNum = 0; pageNum < pages; pageNum++) {
    doc.addPage();
    drawHeader(doc, boxName, po, sw, customer, customerEmail, customerPhone, totalQty, input.printedAt, qrPng, pageNum + 1, pages, packagingLabel, headerHeight);

    let y = headerHeight + 14;

    // Column positions — QR | Order # | Item | Qty
    const colQrX = MARGIN + 2;
    const colQrW = QR_ITEM_SIZE + 4;
    const colOrder = colQrX + colQrW + 4;
    const colOrderW = 82;
    const colItem = colOrder + colOrderW + 6;
    const colQtyW = 44;
    const colQty = MARGIN + CONTENT_W - colQtyW;
    const colItemW = colQty - colItem - 6;

    doc.rect(MARGIN, y, CONTENT_W, 18).fill("#e8ebf0");
    doc
      .fillColor("#1a1f2e")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("QR", colQrX, y + 5, { width: colQrW, lineBreak: false })
      .text("Order #", colOrder, y + 5, { width: colOrderW, lineBreak: false })
      .text("Item", colItem, y + 5, { width: colItemW, lineBreak: false })
      .text("Qty", colQty, y + 5, { width: colQtyW, align: "right", lineBreak: false });
    y += 20;

    const slice = tableItems.slice(
      pageNum * rowsPerPage,
      (pageNum + 1) * rowsPerPage
    );
    const sliceOffset = pageNum * rowsPerPage;
    slice.forEach((item, i) => {
      const globalIdx = sliceOffset + i;
      if (i % 2 === 1) {
        doc.rect(MARGIN, y - 2, CONTENT_W, ROW_H).fill("#f8f9fb");
      }
      // Draw once for this order on each page where it appears.
      const startsOrderOnPage =
        i === 0 ||
        tableItems[globalIdx - 1]?.itemIndex !== item.itemIndex;
      const itemQr = itemQrPngs[item.itemIndex];
      if (startsOrderOnPage && itemQr) {
        const qrY = y + (ROW_H - QR_ITEM_SIZE) / 2 - 2;
        doc.image(itemQr, colQrX, qrY, { width: QR_ITEM_SIZE, height: QR_ITEM_SIZE });
      }
      const orderText = pdfWinAnsiText(item.orderTitle) || "—";
      const orderFontSize = fitSingleLineFont(
        doc,
        orderText,
        "Helvetica-Bold",
        colOrderW,
        9,
        6.5
      );
      doc
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(orderFontSize)
        .text(orderText, colOrder, y + (ROW_H - orderFontSize) / 2 - 2, {
          width: colOrderW,
          height: orderFontSize + 2,
          lineBreak: false,
          ellipsis: true,
        });
      const itemText = pdfWinAnsiText(item.itemTitle) || "—";
      const itemFontSize = fitSingleLineFont(
        doc,
        itemText,
        "Helvetica",
        colItemW,
        9,
        7
      );
      doc
        .font("Helvetica")
        .fillColor("#4b5563")
        .fontSize(itemFontSize)
        .text(itemText, colItem, y + (ROW_H - itemFontSize) / 2 - 2, {
          width: colItemW,
          height: itemFontSize + 2,
          lineBreak: false,
          ellipsis: true,
        });
      doc
        .fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(String(item.quantity), colQty, y + (ROW_H - 9) / 2 - 2, {
          width: colQtyW,
          align: "right",
          lineBreak: false,
        });
      y += ROW_H;
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
  totalPages: number,
  packagingLabel: string,
  headerHeight: number
) {
  const qrSize = qrPng ? QR_SIZE : 0;
  const labelText = `MULTI-ITEM BOX SLIP  ·  ${fmtDateTime(printedAt)}`;
  const colW = (CONTENT_W - (qrPng ? qrSize + 12 : 0)) / 2;
  const leftX = MARGIN;
  const midX = MARGIN + colW;
  const qrX = PAGE_W - MARGIN - qrSize;
  const topY = packagingLabel ? PACKAGING_BANNER_H + 8 : 8;

  doc.rect(0, 0, PAGE_W, headerHeight).fill("#ffffff");
  if (packagingLabel) {
    const packagingFontSize = fitSingleLineFont(
      doc,
      packagingLabel,
      "Helvetica-Bold",
      PAGE_W - 20,
      12,
      8
    );
    doc.rect(0, 0, PAGE_W, PACKAGING_BANNER_H).fill("#111827");
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(packagingFontSize)
      .text(packagingLabel, 10, (PACKAGING_BANNER_H - packagingFontSize) / 2 - 1, {
        width: PAGE_W - 20,
        height: packagingFontSize + 2,
        lineBreak: false,
        align: "center",
      });
  }
  doc
    .moveTo(0, headerHeight)
    .lineTo(PAGE_W, headerHeight)
    .strokeColor("#1a1f2e")
    .lineWidth(2.5)
    .stroke();

  // — Label constrained to left column so it doesn't overlap the customer name —
  doc
    .fillColor("#9aa4b5")
    .fontSize(7)
    .font("Helvetica")
    .text(labelText + (totalPages > 1 ? `  (${pageNum}/${totalPages})` : ""), leftX, topY, {
      width: colW - 6,
      lineBreak: false,
    });

  const boxNameFontSize = fitSingleLineFont(
    doc,
    boxName,
    "Helvetica-Bold",
    colW - 6,
    16,
    10
  );
  doc
    .fillColor("#1a1f2e")
    .fontSize(boxNameFontSize)
    .font("Helvetica-Bold")
    .text(boxName, leftX, topY + 13, {
      width: colW - 6,
      height: boxNameFontSize + 2,
      lineBreak: false,
      ellipsis: true,
    });

  let leftY = topY + 33;
  if (po) {
    const poText = `PO: ${po}`;
    const poFontSize = fitSingleLineFont(
      doc,
      poText,
      "Helvetica",
      colW - 6,
      9,
      7
    );
    doc
      .fillColor("#4b5563")
      .fontSize(poFontSize)
      .font("Helvetica")
      .text(poText, leftX, leftY, {
        width: colW - 6,
        height: poFontSize + 2,
        lineBreak: false,
        ellipsis: true,
      });
    leftY += 13;
  }
  if (sizeWeight) {
    const sizeWeightFontSize = fitSingleLineFont(
      doc,
      sizeWeight,
      "Helvetica-Bold",
      colW - 6,
      9,
      7
    );
    doc
      .fillColor("#1a1f2e")
      .fontSize(sizeWeightFontSize)
      .font("Helvetica-Bold")
      .text(sizeWeight, leftX, leftY, {
        width: colW - 6,
        height: sizeWeightFontSize + 2,
        lineBreak: false,
        ellipsis: true,
      });
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
  const customerText = customer || "—";
  const customerFontSize = fitSingleLineFont(
    doc,
    customerText,
    "Helvetica-Bold",
    colW - 8,
    13,
    9
  );
  doc
    .fillColor("#1a1f2e")
    .fontSize(customerFontSize)
    .font("Helvetica-Bold")
    .text(customerText, midX, topY, {
      width: colW - 8,
      height: customerFontSize + 2,
      lineBreak: false,
      ellipsis: true,
    });

  let custY = topY + 18;
  if (customerEmail) {
    const emailFontSize = fitSingleLineFont(
      doc,
      customerEmail,
      "Helvetica",
      colW - 8,
      8,
      6
    );
    doc
      .fillColor("#4b5563")
      .fontSize(emailFontSize)
      .font("Helvetica")
      .text(customerEmail, midX, custY, {
        width: colW - 8,
        height: emailFontSize + 2,
        lineBreak: false,
        ellipsis: true,
      });
    custY += 12;
  }
  if (customerPhone) {
    const phoneFontSize = fitSingleLineFont(
      doc,
      customerPhone,
      "Helvetica",
      colW - 8,
      8,
      6
    );
    doc
      .fillColor("#4b5563")
      .fontSize(phoneFontSize)
      .font("Helvetica")
      .text(customerPhone, midX, custY, {
        width: colW - 8,
        height: phoneFontSize + 2,
        lineBreak: false,
        ellipsis: true,
      });
  }

  // — QR code —
  if (qrPng) {
    const qrY = topY + 18;
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
