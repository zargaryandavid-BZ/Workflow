export type SharedPdfPage = {
  fileId: string;
  fileName: string;
  page?: number;
};

/**
 * One Final PDF for a card with multiple SKUs: SKU 1 → page 1, SKU 2 → page 2.
 */
export function sharedPdfPagesForSkus(
  skus: { id: string }[],
  file: { id: string; name: string }
): Record<string, SharedPdfPage> {
  const out: Record<string, SharedPdfPage> = {};
  const split = skus.length >= 2;
  for (let i = 0; i < skus.length; i++) {
    out[skus[i]!.id] = {
      fileId: file.id,
      fileName: file.name,
      ...(split ? { page: i + 1 } : {}),
    };
  }
  return out;
}
