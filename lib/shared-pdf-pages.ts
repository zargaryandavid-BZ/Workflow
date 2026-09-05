export type SharedPdfPage = {
  fileId: string;
  fileName: string;
  page?: number;
};

/**
 * One Final PDF for a card with multiple SKUs: SKU 1 → page 1, SKU 2 → page 2.
 */
export function uniqueSharedPdfFile(
  files: { id: string; name: string }[]
): { id: string; name: string } | null {
  if (files.length === 0) return null;
  const ids = new Set(files.map((f) => f.id));
  if (ids.size === 1) return files[0]!;
  const names = new Set(files.map((f) => f.name.trim().toLowerCase()));
  if (names.size === 1) return files[0]!;
  return null;
}

export function pdfPageLocksFromFinalPdfs(
  pdfs: Record<string, { page?: number }>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, pdf] of Object.entries(pdfs)) {
    if (pdf.page != null) out[id] = pdf.page;
  }
  return out;
}

/**
 * Final production PDF for the card. Ignore file names: page 1 = SKU 1, page 2 = SKU 2.
 * If several PDFs are listed, one unique file wins; otherwise the first file is used.
 */
export function pickFinalArtworkPdf(
  files: { id: string; name: string }[]
): { id: string; name: string } | null {
  if (files.length === 0) return null;
  return uniqueSharedPdfFile(files) ?? files[0]!;
}

/**
 * SKU index → PDF page. Names are ignored.
 */
export function sharedPdfPagesForSkus(
  skus: { id: string }[],
  file: { id: string; name: string }
): Record<string, SharedPdfPage> {
  const out: Record<string, SharedPdfPage> = {};
  for (let i = 0; i < skus.length; i++) {
    out[skus[i]!.id] = {
      fileId: file.id,
      fileName: file.name,
      page: i + 1,
    };
  }
  return out;
}

/** Locked PDF page for that SKU (page N of the file). */
export function finalPdfOcgView(pdf: {
  page?: number | null;
}): { layout: "single" | "grid"; page?: number } {
  if (pdf.page != null) {
    return { layout: "single", page: pdf.page };
  }
  return { layout: "grid" };
}
