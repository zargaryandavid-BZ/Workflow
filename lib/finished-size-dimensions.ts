/**
 * "1.875\" x .7\" in" / "2 x 3" / "2.5in × 4in" → { width: "1.875", height: "0.7" }.
 * Used only when the sender left Width/Height blank but sent a finished size —
 * the board has Width + Height fields (no Finished Size), so the size was lost
 * (CRM ORD-2026-15611, Nov 2026). Returns null when it isn't "A x B".
 */
export function dimensionsFromFinishedSize(
  raw: string | null | undefined
): { width: string; height: string } | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[\u201C\u201D\u2033"]/g, "")
    .replace(/(inches|inch|in)\b\.?/gi, "")
    .trim();
  const m = cleaned.match(/^(\d*\.?\d+)\s*[x×X*]\s*(\d*\.?\d+)(?:\s*[x×X*]\s*\d*\.?\d+)?\s*$/);
  if (!m) return null;
  const norm = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? String(n) : null;
  };
  const width = norm(m[1]);
  const height = norm(m[2]);
  return width && height ? { width, height } : null;
}
