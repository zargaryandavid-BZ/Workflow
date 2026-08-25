/**
 * Helpers for the multi-recipient (CC) approval/notification flow.
 *
 * A single input box lets staff type several addresses separated by commas,
 * semicolons, spaces, or newlines. We parse that into a clean, de-duplicated,
 * lower-cased list and keep the invalid entries so the UI can flag them.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True for a single well-formed email address. */
export function isEmailAddress(value: string): boolean {
  return EMAIL_RE.test(value.trim().toLowerCase());
}

export interface ParsedEmailList {
  /** Valid, lower-cased, de-duplicated addresses (order preserved). */
  valid: string[];
  /** Raw tokens that were not valid email addresses. */
  invalid: string[];
}

/**
 * Split a free-text field into valid / invalid email addresses.
 * Separators: comma, semicolon, whitespace, newline.
 */
export function parseEmailList(raw: string | null | undefined): ParsedEmailList {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  if (!raw) return { valid, invalid };

  for (const token of raw.split(/[\s,;]+/)) {
    const t = token.trim();
    if (!t) continue;
    const lower = t.toLowerCase();
    if (isEmailAddress(lower)) {
      if (!seen.has(lower)) {
        seen.add(lower);
        valid.push(lower);
      }
    } else {
      invalid.push(t);
    }
  }
  return { valid, invalid };
}

/**
 * Merge several sources of addresses into one clean, de-duplicated list.
 * Later sources never override earlier ones; earlier order wins.
 */
export function mergeEmailLists(
  ...lists: Array<Iterable<string> | null | undefined>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    if (!list) continue;
    for (const item of list) {
      const lower = (item ?? "").trim().toLowerCase();
      if (!lower || seen.has(lower)) continue;
      if (!isEmailAddress(lower)) continue;
      seen.add(lower);
      out.push(lower);
    }
  }
  return out;
}

/** Comma-joined string for display in an input box. */
export function formatEmailList(emails: Iterable<string>): string {
  return Array.from(emails).join(", ");
}
