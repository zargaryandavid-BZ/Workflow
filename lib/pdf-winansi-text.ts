/**
 * Job-ticket PDFs use Helvetica (WinAnsi). Emoji such as 🏷️ are stored as
 * UTF-16 surrogates; PDFKit then draws those units as Latin junk (Ø<ß÷þ).
 */
export function pdfWinAnsiText(input: string): string {
  // Do not use \p{Emoji}: it matches ASCII 0-9, #, and * (emoji keycaps),
  // which wiped order numbers, qty, sizes, and dates on job tickets.
  const noEmoji = input.replace(
    /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu,
    ""
  );
  const compact = noEmoji.replace(/[ \t]+/g, " ").trim();
  let out = "";
  for (const ch of compact) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x0a || code === 0x0d) {
      out += ch;
      continue;
    }
    if (code < 0x20 || code > 0xff) continue;
    out += ch;
  }
  return out;
}
