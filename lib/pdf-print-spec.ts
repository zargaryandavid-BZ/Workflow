/** Bytes scanned for `/Linearized` (always at the start of a linearized PDF). */
export const PDF_LINEARIZED_HEAD_BYTES = 1024;

/**
 * Catalog / OCG tokens live in the early xref for linearized files. Combined
 * with a Range download this is the max we inspect.
 */
export const PDF_PRINT_SPEC_SCAN_BYTES = 65536;

export type PdfPrintSpecInspect = {
  hasLayers: boolean;
  isLinearized: boolean;
};

/**
 * Print-spec flags from a PDF prefix (typically the first 64KB).
 * Layers: `/OCProperties` or `/OCGs`. Fast Web View: `/Linearized` in the header.
 */
export function inspectPdf(buffer: ArrayBuffer | Uint8Array): PdfPrintSpecInspect {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const decoder = new TextDecoder("latin1");
  const headLen = Math.min(PDF_LINEARIZED_HEAD_BYTES, bytes.length);
  const head = decoder.decode(bytes.subarray(0, headLen));
  const isLinearized = /\/Linearized\s/.test(head);

  const scanLen = Math.min(PDF_PRINT_SPEC_SCAN_BYTES, bytes.length);
  const scan = decoder.decode(bytes.subarray(0, scanLen));
  const hasLayers =
    scan.includes("/OCProperties") || scan.includes("/OCGs");

  return { hasLayers, isLinearized };
}

export function pdfPrintSpecValid(inspect: PdfPrintSpecInspect): boolean {
  return inspect.hasLayers && inspect.isLinearized;
}
