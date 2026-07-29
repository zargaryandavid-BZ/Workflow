"use client";

import { useEffect, useState } from "react";

/** Avoid re-hitting Drive for the same order while browsing the board. */
const hasFilesCache = new Map<string, boolean>();

/**
 * Whether the order's Artwork / Final production Google Drive folder has files.
 * Only fetches when `artworkUrl` looks like an http(s) link.
 */
export function useGdriveFolderHasFiles(
  orderId: string | null | undefined,
  artworkUrl: string | null | undefined
): boolean {
  const url = artworkUrl?.trim() ?? "";
  const hasUrl = /^https?:\/\//i.test(url);
  const [hasFiles, setHasFiles] = useState(() => {
    if (!orderId || !hasUrl) return false;
    return hasFilesCache.get(orderId) ?? false;
  });

  useEffect(() => {
    if (!orderId || !hasUrl) {
      setHasFiles(false);
      return;
    }

    const cached = hasFilesCache.get(orderId);
    if (cached !== undefined) {
      setHasFiles(cached);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/gdrive-status`);
        if (!res.ok) {
          if (!cancelled) setHasFiles(false);
          return;
        }
        const json = (await res.json()) as { hasFiles?: boolean };
        const next = Boolean(json.hasFiles);
        hasFilesCache.set(orderId, next);
        if (!cancelled) setHasFiles(next);
      } catch {
        if (!cancelled) setHasFiles(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [orderId, hasUrl, url]);

  return hasFiles;
}

/** Clear cached status after uploads / folder changes (optional). */
export function clearGdriveFolderHasFilesCache(orderId?: string) {
  if (orderId) hasFilesCache.delete(orderId);
  else hasFilesCache.clear();
}
