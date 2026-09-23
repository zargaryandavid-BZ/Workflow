import type { SkuItem } from "@/lib/skus";

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
  // Only truly one file (possibly listed twice with the SAME id) is a single
  // shared PDF. Two DISTINCT files that merely share a name — e.g. a corrected
  // re-upload sitting next to the old one — are NOT one logical PDF; returning
  // the first-listed there served customers the OLD version. Fall through
  // (null) so pickFinalArtworkPdf picks the most recently modified instead.
  if (ids.size === 1) return files[0]!;
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
 * If several PDFs are listed, one unique file wins; otherwise the most recently
 * modified file wins — a leftover older file left in the folder (staff re-uploaded
 * a new one without deleting the old) must never be the one sent to the customer.
 */
export function pickFinalArtworkPdf(
  files: { id: string; name: string; modifiedTime?: string }[]
): { id: string; name: string } | null {
  if (files.length === 0) return null;
  const unique = uniqueSharedPdfFile(files);
  if (unique) return unique;
  return [...files].sort((a, b) => {
    const at = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
    const bt = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
    return bt - at;
  })[0]!;
}

/**
 * PDF page count is the SKU list. Ticket SKUs only supply names/qty for matching pages.
 */
export function alignSkusToPdfPages(
  ticketSkus: SkuItem[],
  pageCount: number
): SkuItem[] {
  if (pageCount < 1) return ticketSkus;
  const out: SkuItem[] = [];
  for (let i = 0; i < pageCount; i++) {
    const ticket = ticketSkus[i];
    out.push(
      ticket ?? {
        id: `__pdf_page_${i + 1}__`,
        name: "",
        qty: null,
      }
    );
  }
  return out;
}

/**
 * Each SKU is locked to PDF page N (page 1 = first SKU).
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
