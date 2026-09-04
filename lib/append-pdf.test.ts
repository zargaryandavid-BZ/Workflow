import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { appendPdfDocuments, pdfPageCount } from "./append-pdf.ts";

async function onePagePdf(label: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(label, { x: 20, y: 100, size: 12, font });
  return Buffer.from(await doc.save());
}

test("appendPdfDocuments puts Final PDF pages after the job ticket", async () => {
  const ticket = await onePagePdf("ticket");
  const twoPage = await PDFDocument.create();
  const f = await twoPage.embedFont(StandardFonts.Helvetica);
  for (const label of ["A", "B"]) {
    const page = twoPage.addPage([200, 200]);
    page.drawText(label, { x: 20, y: 100, size: 12, font: f });
  }
  const finalBytes = Buffer.from(await twoPage.save());
  assert.equal(await pdfPageCount([finalBytes]), 2);
  const merged = await appendPdfDocuments(ticket, [finalBytes]);
  const out = await PDFDocument.load(merged);
  assert.equal(out.getPageCount(), 3);
});
