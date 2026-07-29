"use client";

import { useEffect, useState } from "react";

/** Avoid re-hitting Drive for the same order while browsing the board. */
const hasFilesCache = new Map<string, boolean>();

/** Subscribers notified when an order's cached status is invalidated/refreshed. */
const listeners = new Map<string, Set<() => void>>();
const globalListeners = new Set<() => void>();

function notify(orderId: string) {
  listeners.get(orderId)?.forEach((fn) => fn());
  globalListeners.forEach((fn) => fn());
}

function subscribe(orderId: string, fn: () => void) {
  let set = listeners.get(orderId);
  if (!set) {
    set = new Set();
    listeners.set(orderId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(orderId);
  };
}

async function fetchHasFiles(orderId: string): Promise<boolean> {
  const res = await fetch(`/api/orders/${orderId}/gdrive-status`);
  if (!res.ok) return false;
  const json = (await res.json()) as { hasFiles?: boolean };
  return Boolean(json.hasFiles);
}

/** Drop cached status so the next hook render / refresh re-checks Drive. */
export function clearGdriveFolderHasFilesCache(orderId?: string) {
  if (orderId) {
    hasFilesCache.delete(orderId);
    notify(orderId);
  } else {
    hasFilesCache.clear();
    globalListeners.forEach((fn) => fn());
  }
}

/**
 * Re-check Drive now (e.g. after Copy Link, Final production click, or column move).
 * Updates cache and notifies mounted cards/forms.
 */
export async function refreshGdriveFolderHasFiles(
  orderId: string
): Promise<boolean> {
  hasFilesCache.delete(orderId);
  try {
    const next = await fetchHasFiles(orderId);
    hasFilesCache.set(orderId, next);
    notify(orderId);
    return next;
  } catch {
    hasFilesCache.set(orderId, false);
    notify(orderId);
    return false;
  }
}

/**
 * Whether the order's Artwork / Final production Google Drive folder has files.
 * Fetches once when artwork URL exists; refreshes when cache is invalidated.
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
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!orderId) return;
    return subscribe(orderId, () => setEpoch((n) => n + 1));
  }, [orderId]);

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
        const next = await fetchHasFiles(orderId);
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
  }, [orderId, hasUrl, url, epoch]);

  return hasFiles;
}
