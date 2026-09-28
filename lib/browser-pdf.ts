/** Client-only helpers for PDF blob download / print (Scan, box slips). */

export function filenameFromDisposition(
  header: string | null,
  fallback: string
): string {
  if (!header) return fallback;
  const quoted = header.match(/filename="([^"]+)"/i);
  if (quoted?.[1]) return quoted[1];
  const plain = header.match(/filename=([^;]+)/i);
  return plain?.[1]?.trim() || fallback;
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export function printPdfBlob(blob: Blob, fallbackFilename: string) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    triggerBlobDownload(blob, fallbackFilename);
    return;
  }
  const printWhenReady = () => {
    try {
      w.focus();
      w.print();
    } catch {
      /* browser may block print until the PDF viewer is ready */
    }
  };
  w.addEventListener("load", printWhenReady);
  window.setTimeout(printWhenReady, 800);
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
