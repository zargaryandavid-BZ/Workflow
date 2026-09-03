import { DIE_REQUEST_TAG_NAME } from "./tags.ts";

/**
 * Match a Settings tag when its name appears as a whole word/phrase
 * in a line-item title (not a substring of a longer word).
 * Longer tag names win so "DIE REQUEST" beats "DIE" if both exist.
 * "Cutting" maps to DIE REQUEST (CRM Die (Cutting) lines).
 */
export function tagNameAsExactPhrase(
  haystack: string,
  tagName: string
): boolean {
  const text = haystack.trim();
  const name = tagName.trim();
  if (!text || !name || name.length < 3) return false;
  const escaped = name
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i").test(
    text
  );
}

export function firstMatchingTagId(
  haystacks: Array<string | null | undefined>,
  tags: Array<{ id: string; name: string }>
): string | null {
  const combined = haystacks
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join("\n");
  if (!combined || tags.length === 0) return null;
  const dieRequest = tags.find(
    (t) => t.name.trim().toLowerCase() === DIE_REQUEST_TAG_NAME.toLowerCase()
  );
  if (dieRequest && tagNameAsExactPhrase(combined, "Cutting")) {
    return dieRequest.id;
  }
  const sorted = [...tags].sort((a, b) => b.name.length - a.name.length);
  for (const tag of sorted) {
    if (tag.name.trim().toLowerCase() === "cutting") continue;
    if (tagNameAsExactPhrase(combined, tag.name)) return tag.id;
  }
  return null;
}

export function webhookItemTagHaystack(item: {
  title?: string | null;
  product?: string | null;
  category?: string | null;
  category_name?: string | null;
  product_category?: string | null;
}, jobTitle?: string | null): Array<string | null | undefined> {
  return [
    jobTitle,
    item.title,
    item.product,
    item.category,
    item.category_name,
    item.product_category,
  ];
}
