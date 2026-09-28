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

export function printPdfBlob(blob: Blob, _fallbackFilename: string) {
  // Use a hidden iframe — never blocked by popup blockers unlike window.open().
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;border:none;";
  iframe.src = url;
  document.body.appendChild(iframe);

  let printed = false;

  const doPrint = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      /* some browsers sandbox iframes — print dialog still usually fires */
    }
  };

  // Fire on load, with a 1.2 s fallback in case onload is skipped for PDFs.
  iframe.addEventListener("load", () => window.setTimeout(doPrint, 250));
  window.setTimeout(doPrint, 1200);

  // Cleanup after the user has had time to interact with the print dialog.
  window.setTimeout(() => {
    iframe.remove();
    URL.revokeObjectURL(url);
  }, 120_000);
}
