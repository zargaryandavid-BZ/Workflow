import { createRequire } from "node:module";
import { orderNumberQrPng } from "./order-qr.ts";
import { pdfWinAnsiText } from "./pdf-winansi-text.ts";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

type PdfDoc = InstanceType<typeof PDFDocument>;

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_H = 80;
const QR_SIZE = 64;
const ROW_H = 30;
const THUMB = 22;
const THUMB_GAP = 8;

export type FulfillmentBoxSlipItem = {
  orderNumber: string;
  qty: number;
  image?: Buffer | null;
};

export type FulfillmentBoxSlipInput = {
  boxId: string;
  boxLabel: string;
  deliveryDate: string;
  items: FulfillmentBoxSlipItem[];
};

function drawHRule(doc: PdfDoc, y: number) {
  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + CONTENT_W, y)
    .strokeColor("#e5e7eb")
    .lineWidth(0.5)
    .stroke();
}

export async function generateFulfillmentBoxSlipPdf(
  input: FulfillmentBoxSlipInput
): Promise<Buffer> {
  const boxLabel = pdfWinAnsiText(input.boxLabel) || "Box";
  const deliveryDate = pdfWinAnsiText(input.deliveryDate) || "—";
  const qrPng = await orderNumberQrPng(input.boxId.trim());

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

  const rowsPerPage = 18;
  const pages = Math.max(1, Math.ceil(input.items.length / rowsPerPage));

  for (let pageNum = 0; pageNum < pages; pageNum++) {
    doc.addPage();
    doc.rect(0, 0, PAGE_W, HEADER_H).fill("#1a1f2e");
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(boxLabel, MARGIN, 18, { width: CONTENT_W - QR_SIZE - 16, lineBreak: false });
    doc
      .fontSize(11)
      .font("Helvetica")
      .text("BOX PACKING SLIP", MARGIN, 44, {
        width: CONTENT_W - QR_SIZE - 16,
        lineBreak: false,
      });

    if (qrPng) {
      const qrX = PAGE_W - MARGIN - QR_SIZE;
      const qrY = (HEADER_H - QR_SIZE) / 2;
      doc.image(qrPng, qrX, qrY, { width: QR_SIZE, height: QR_SIZE });
    }

    let y = HEADER_H + 20;
    doc
      .fillColor("#374151")
      .font("Helvetica")
      .fontSize(10)
      .text("Delivered", MARGIN, y);
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text(deliveryDate, MARGIN + 72, y - 1);
    y += 28;
    drawHRule(doc, y);
    y += 10;

    doc.rect(MARGIN, y, CONTENT_W, 18).fill("#f3f4f6");
    doc
      .fillColor("#374151")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text("ORDER NUMBER", MARGIN + 8 + THUMB + THUMB_GAP, y + 5)
      .text("QTY", MARGIN + CONTENT_W - 56, y + 5, { width: 48, align: "right" });
    y += 20;

    const slice = input.items.slice(
      pageNum * rowsPerPage,
      (pageNum + 1) * rowsPerPage
    );
    let ttl = 0;
    for (const item of input.items) ttl += item.qty;

    for (const item of slice) {
      const thumbX = MARGIN + 8;
      const thumbY = y + 4;
      if (item.image && item.image.length > 0) {
        try {
          doc.image(item.image, thumbX, thumbY, {
            fit: [THUMB, THUMB],
            align: "center",
            valign: "center",
          });
        } catch {
          doc
            .rect(thumbX, thumbY, THUMB, THUMB)
            .fillColor("#e5e7eb")
            .fill();
        }
      } else {
        doc
          .rect(thumbX, thumbY, THUMB, THUMB)
          .fillColor("#e5e7eb")
          .fill();
      }
      doc
        .fillColor("#111827")
        .font("Helvetica")
        .fontSize(11)
        .text(
          pdfWinAnsiText(item.orderNumber),
          MARGIN + 8 + THUMB + THUMB_GAP,
          y + 8,
          {
            width: CONTENT_W - 80 - THUMB - THUMB_GAP,
            lineBreak: false,
          }
        )
        .font("Helvetica-Bold")
        .text(String(item.qty), MARGIN + CONTENT_W - 56, y + 8, {
          width: 48,
          align: "right",
        });
      y += ROW_H;
      drawHRule(doc, y);
    }

    if (pageNum === pages - 1) {
      y += 16;
      doc
        .fillColor("#6b7280")
        .font("Helvetica-Bold")
        .fontSize(10)
        .text("TTL QTY", MARGIN + 8, y)
        .fillColor("#111827")
        .text(String(ttl), MARGIN + CONTENT_W - 56, y, {
          width: 48,
          align: "right",
        });
    }

    doc
      .fillColor("#9ca3af")
      .font("Helvetica")
      .fontSize(8)
      .text(
        pages > 1 ? `Page ${pageNum + 1} of ${pages}` : "",
        MARGIN,
        PAGE_H - 28,
        { width: CONTENT_W, align: "center" }
      );
  }

  doc.end();
  return done;
}
