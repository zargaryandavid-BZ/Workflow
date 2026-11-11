/**
 * Products Bazaar buys from a vendor instead of printing in-house.
 * After the customer approves the proof, these cards go to the "Outsource"
 * column (when the tenant has one) instead of the usual approved column.
 * Hayk 2026-11-08 (#28): gift bags, wrapping paper, custom gift wrap rolls.
 */
const OUTSOURCE_PRODUCT_PATTERNS: RegExp[] = [
  /\bgift\s*bags?\b/i,
  /\bwrapping\s*papers?\b/i,
  /\bgift\s*wrap(ping)?\b/i,
  /\bwrap(ping)?\s*(paper\s*)?rolls?\b/i,
];

/** True when any product/category/title text names an outsourced product. */
export function isOutsourceAfterApprovalProduct(
  texts: Array<string | null | undefined>
): boolean {
  return texts.some(
    (t) =>
      typeof t === "string" &&
      t.trim() !== "" &&
      OUTSOURCE_PRODUCT_PATTERNS.some((re) => re.test(t))
  );
}

/** Column name match is case/space-insensitive ("Outsource", "OUTSOURCE "). */
export function isOutsourceColumnName(name: string | null | undefined): boolean {
  return typeof name === "string" && name.trim().toLowerCase() === "outsource";
}
