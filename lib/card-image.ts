/** Which gallery picture is shown on the Kanban card (`orders.specs.card_image`). */

export type CardImageSource = "sku_image" | "asset";

export type CardImageRef = {
  source: CardImageSource;
  id: string;
};

export type BoardThumbnail = CardImageRef & {
  url: string;
};

export function parseCardImageRef(specs: unknown): CardImageRef | null {
  if (!specs || typeof specs !== "object") return null;
  const raw = (specs as { card_image?: unknown }).card_image;
  if (!raw || typeof raw !== "object") return null;
  const source = (raw as { source?: unknown }).source;
  const id = (raw as { id?: unknown }).id;
  if (
    (source === "sku_image" || source === "asset") &&
    typeof id === "string" &&
    id.trim()
  ) {
    return { source, id: id.trim() };
  }
  return null;
}

export function preferCardImage<T extends CardImageRef>(
  items: T[],
  preferred: CardImageRef | null
): T[] {
  if (!preferred || items.length === 0) return items;
  const i = items.findIndex(
    (t) => t.id === preferred.id && t.source === preferred.source
  );
  if (i <= 0) return items;
  const next = [...items];
  const [picked] = next.splice(i, 1);
  next.unshift(picked);
  return next;
}

/** Keep a saved card picture when a specs patch omits it. */
export function preserveCardImage(
  existing: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  const prev = parseCardImageRef(existing);
  if (!prev) return next;
  if (Object.prototype.hasOwnProperty.call(next, "card_image")) {
    return next;
  }
  return { ...next, card_image: prev };
}

export function firstThumbnailUrl(
  thumbs: BoardThumbnail[] | undefined
): string | undefined {
  return thumbs?.[0]?.url;
}

export const CARD_IMAGE_CHANGED_EVENT = "workflow:card-image";
