import { alignSkusToPdfPages, pdfPageLocksFromFinalPdfs } from "./shared-pdf-pages.ts";
import type { SkuItem } from "./skus.ts";

/**
 * Customer approval artwork comes only from the production Final PDF.
 *
 * - Each PDF page is one SKU (page 1 = SKU 1).
 * - Named print layers on that page are extra pictures, toggled with SEE LAYERS.
 * - Ticket screenshots, gallery images, and other uploads are not used.
 */
export const APPROVAL_PROOF_SOURCE = "production_pdf" as const;

export function approvalSkusFromPdfPages(
  ticketSkus: SkuItem[],
  pageCount: number
): SkuItem[] {
  return alignSkusToPdfPages(ticketSkus, pageCount);
}

export function approvalPdfPageBySku(
  pdfs: Record<string, { page?: number }>
): Record<string, number> {
  return pdfPageLocksFromFinalPdfs(pdfs);
}

export function ticketUploadsAreApprovalArtwork(): boolean {
  return false;
}
