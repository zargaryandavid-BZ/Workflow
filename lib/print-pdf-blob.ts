/**
 * Send a PDF blob to the browser print dialog (OS default printer).
 * Browsers cannot pick a named printer from the web; print() uses the default.
 *
 * Chrome often skips iframe `onload` for `blob:` PDFs, so we also print on a
 * short timer. The blob is forced to `application/pdf` so the PDF viewer
 * (not HTML) is what print() sees.
 */
export function printPdfBlob(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!blob.size) {
      reject(new Error("Empty PDF"));
      return;
    }
    const pdf = new Blob([blob], { type: "application/pdf" });
    const url = URL.createObjectURL(pdf);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;left:-10000px;top:0;width:800px;height:1100px;border:0;";
    iframe.src = url;

    let printed = false;
    let finished = false;

    const cleanup = () => {
      iframe.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve();
    };

    const fail = (err: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err instanceof Error ? err : new Error("Print failed"));
    };

    const doPrint = () => {
      if (printed || finished) return;
      printed = true;
      const win = iframe.contentWindow;
      if (!win) {
        fail(new Error("Could not open the print dialog"));
        return;
      }
      win.addEventListener("afterprint", finish, { once: true });
      window.setTimeout(finish, 120_000);
      window.setTimeout(() => {
        try {
          win.focus();
          win.print();
          // Spinner should stop as soon as the OS dialog is requested.
          // Keep the iframe until afterprint so Chrome can still print.
          if (!finished) resolve();
        } catch (err) {
          fail(err);
        }
      }, 400);
    };

    iframe.addEventListener("load", () => window.setTimeout(doPrint, 400));
    iframe.addEventListener("error", () =>
      fail(new Error("Could not load the PDF for print"))
    );
    // Chrome's built-in PDF viewer often never fires iframe onload for blobs.
    window.setTimeout(doPrint, 1500);
    document.body.appendChild(iframe);
  });
}
