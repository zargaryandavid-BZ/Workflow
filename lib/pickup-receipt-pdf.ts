import { createRequire } from "node:module";
import { pdfWinAnsiText } from "./pdf-winansi-text.ts";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

/** 5.5 × 7 in: small enough to read on a phone, prints cleanly. */
const PAGE_W = 396;
const PAGE_H = 504;
const MARGIN = 28;
const CONTENT_W = PAGE_W - MARGIN * 2;

export type PickupReceiptInput = {
  shopName: string;
  /** Every order part this pickup covers, e.g. ["15433-1", "15433-2"]. */
  orderNumbers: string[];
  pickedUpBy: string;
  /** Already formatted for display (shop time zone). */
  pickedUpAt: string;
  /** Last 4 digits only, so the PDF never carries the whole code. */
  codeLast4: string | null;
  /** Staff name when the code was skipped at pickup. */
  codeSkippedBy?: string | null;
  signaturePng: Buffer;
};

export const PICKUP_RECEIPT_FILE_PREFIX = "Pickup signature";

export function pickupReceiptFileName(orderNumber: string): string {
  const safe = orderNumber.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40) || "order";
  return `${PICKUP_RECEIPT_FILE_PREFIX} ${safe}.pdf`;
}

export async function generatePickupReceiptPdf(
  input: PickupReceiptInput
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: [PAGE_W, PAGE_H],
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: { Title: "Pickup confirmation" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const shop = pdfWinAnsiText(input.shopName) || "Shop";
  const orders = input.orderNumbers.map((n) => pdfWinAnsiText(n)).filter(Boolean);

  doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a");
  doc.text("Pickup confirmation", MARGIN, MARGIN, { width: CONTENT_W });
  doc.font("Helvetica").fontSize(10).fillColor("#64748b");
  doc.text(shop, { width: CONTENT_W });

  let y = doc.y + 12;
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor("#e2e8f0").lineWidth(0.75).stroke();
  y += 12;

  const row = (label: string, value: string) => {
    doc.font("Helvetica").fontSize(9).fillColor("#64748b");
    doc.text(label.toUpperCase(), MARGIN, y, { width: CONTENT_W, characterSpacing: 0.5 });
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a");
    doc.text(value || "-", MARGIN, doc.y + 2, { width: CONTENT_W });
    y = doc.y + 10;
  };

  row(orders.length > 1 ? "Orders" : "Order", orders.join(", "));
  row("Picked up by", pdfWinAnsiText(input.pickedUpBy));
  row("Date and time", pdfWinAnsiText(input.pickedUpAt));
  row(
    "Pickup code",
    input.codeSkippedBy
      ? pdfWinAnsiText(`Not checked - skipped by ${input.codeSkippedBy}`)
      : input.codeLast4
        ? `Verified (ends in ${input.codeLast4})`
        : "No code was sent for this order"
  );

  doc.font("Helvetica").fontSize(9).fillColor("#64748b");
  doc.text("SIGNATURE", MARGIN, y, { width: CONTENT_W, characterSpacing: 0.5 });
  const boxY = doc.y + 4;
  const boxH = 150;
  doc.roundedRect(MARGIN, boxY, CONTENT_W, boxH, 6).strokeColor("#cbd5e1").lineWidth(1).stroke();
  doc.image(input.signaturePng, MARGIN + 6, boxY + 6, {
    fit: [CONTENT_W - 12, boxH - 12],
    align: "center",
    valign: "center",
  });

  doc.font("Helvetica").fontSize(8).fillColor("#94a3b8");
  doc.text(
    "Signed on the shop's pickup screen. The person named above confirmed they received the order.",
    MARGIN,
    boxY + boxH + 10,
    { width: CONTENT_W }
  );

  doc.end();
  return done;
}
