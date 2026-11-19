type PdfDoc = InstanceType<typeof import("pdfkit")>;

export const POWERED_BY_FOOTER_TEXT =
  "Powered by pulseprintautomation.com — print shop automation software.";

/**
 * Centered "Powered by" line at the bottom of every page of a packing slip /
 * box label PDF. The doc must be created with `bufferPages: true`; call this
 * right before `doc.end()`.
 */
export function stampPoweredByFooter(
  doc: PdfDoc,
  opts: { fontSize?: number; bottomOffset?: number } = {}
): void {
  const fontSize = opts.fontSize ?? 8;
  // ~2 blank lines under the footer so printers don't clip it.
  const bottomOffset = opts.bottomOffset ?? 40;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const { width, height, margins } = doc.page;
    // Drawing inside the bottom margin would make PDFKit add a new page.
    const savedBottom = margins.bottom;
    margins.bottom = 0;
    doc
      .font("Helvetica")
      .fontSize(fontSize)
      .fillColor("#6b7280")
      .text(POWERED_BY_FOOTER_TEXT, 0, height - bottomOffset, {
        width,
        align: "center",
        lineBreak: false,
      });
    margins.bottom = savedBottom;
  }
}
