/**
 * Send a PDF blob to the browser print dialog (OS default printer).
 * Browsers cannot pick a named printer from the web; print() uses the default.
 */
export function printPdfBlob(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.src = url;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      iframe.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      resolve();
    };

    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) {
        iframe.remove();
        URL.revokeObjectURL(url);
        reject(new Error("Could not open the print dialog"));
        return;
      }
      win.addEventListener("afterprint", finish, { once: true });
      window.setTimeout(finish, 120_000);
      window.setTimeout(() => {
        try {
          win.focus();
          win.print();
        } catch (err) {
          iframe.remove();
          URL.revokeObjectURL(url);
          reject(err instanceof Error ? err : new Error("Print failed"));
        }
      }, 250);
    };

    iframe.onerror = () => {
      iframe.remove();
      URL.revokeObjectURL(url);
      reject(new Error("Could not load the shipping slip for print"));
    };

    document.body.appendChild(iframe);
  });
}
