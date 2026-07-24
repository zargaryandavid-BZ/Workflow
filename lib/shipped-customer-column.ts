/** Detect the Shipped Customer board column (name variants). */
export function isShippedCustomerColumn(
  name: string | null | undefined
): boolean {
  if (!name?.trim()) return false;
  const n = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    n.includes("shipped customer") ||
    n.includes("ship to customer") ||
    n.includes("shipped to customer") ||
    // Fallback: any stage whose name starts with "shipped"
    n.startsWith("shipped")
  );
}
