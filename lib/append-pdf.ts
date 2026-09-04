import { PDFDocument } from "pdf-lib";

/** Count pages in PDF buffers; skip files that cannot be parsed. */
export async function pdfPageCount(buffers: Buffer[]): Promise<number> {
  let n = 0;
  for (const buf of buffers) {
    try {
      const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
      n += doc.getPageCount();
    } catch {
      /* skip */
    }
  }
  return n;
}

/**
 * Append every page of `extras` after `basePdf` (job ticket cover, then Final PDFs).
 */
export async function appendPdfDocuments(
  basePdf: Buffer,
  extras: Buffer[]
): Promise<Buffer> {
  const out = await PDFDocument.create();
  const base = await PDFDocument.load(basePdf, { ignoreEncryption: true });
  for (const page of await out.copyPages(base, base.getPageIndices())) {
    out.addPage(page);
  }
  for (const extra of extras) {
    try {
      const src = await PDFDocument.load(extra, { ignoreEncryption: true });
      for (const page of await out.copyPages(src, src.getPageIndices())) {
        out.addPage(page);
      }
    } catch {
      /* skip unreadable Final PDFs */
    }
  }
  return Buffer.from(await out.save());
}
