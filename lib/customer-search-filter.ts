/**
 * One search box for customers: name, company, email or phone.
 * Phones are stored in many shapes ("+13235551234", "(323) 555-1234"), so a
 * query with 4+ digits also matches the digits in order with anything between
 * them. Returns a PostgREST `.or()` filter string, or null for an empty query.
 */
function clean(raw: string): string {
  return raw
    .trim()
    .replace(/[,()"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeLike(s: string): string {
  return s.replace(/[%_]/g, (ch) => `\\${ch}`);
}

export function customerSearchOrFilter(
  raw: string,
  columns: { name?: string; company?: string; email?: string; phone?: string } = {}
): string | null {
  const name = columns.name ?? "name";
  const company = columns.company ?? "company";
  const email = columns.email ?? "email";
  const phone = columns.phone ?? "phone";
  const q = clean(raw);
  if (!q) return null;
  const contains = `%${escapeLike(q)}%`;
  const parts = [
    `${name}.ilike."${contains}"`,
    `${company}.ilike."${contains}"`,
    `${email}.ilike."${contains}"`,
    `${phone}.ilike."${contains}"`,
  ];
  const digits = raw.replace(/\D/g, "");
  // Only when the query is mostly a phone number (not "Unit 12 Bakery").
  if (digits.length >= 4 && digits.length >= raw.replace(/\s/g, "").length * 0.6) {
    // Drop a leading US country code so "1 323…" still matches "(323)…".
    const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    parts.push(`${phone}.ilike."%${d.split("").join("%")}%"`);
  }
  return parts.join(",");
}
