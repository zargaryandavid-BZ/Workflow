"use client";

import type { FieldLink } from "@/lib/types";

let cachedLinks: FieldLink[] | null = null;
let inflight: Promise<FieldLink[]> | null = null;

/** Session-cached field links — avoids refetch on every card open. */
export async function getFieldLinksCached(): Promise<FieldLink[]> {
  if (cachedLinks) return cachedLinks;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("/api/field-links");
      if (!res.ok) return [];
      const json = (await res.json()) as FieldLink[];
      cachedLinks = json ?? [];
      return cachedLinks;
    } catch {
      return [];
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function clearFieldLinksCache() {
  cachedLinks = null;
}
