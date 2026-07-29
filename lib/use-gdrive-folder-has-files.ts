"use client";

import { useEffect, useState } from "react";

/** Avoid re-hitting Drive for the same order while browsing the board. */
const hasFilesCache = new Map<string, boolean>();

/** One in-flight request per order so remounts share a single call. */
const inFlight = new Map<string, Promise<boolean>>();

/** Subscribers notified when an order's cached status is invalidated/refreshed. */
const listeners = new Map<string, Set<() => void>>();

function notify(orderId: string) {
  listeners.get(orderId)?.forEach((fn) => fn());
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

function fetchHasFilesDeduped(orderId: string): Promise<boolean> {
  const existing = inFlight.get(orderId);
  if (existing) return existing;

  const promise = fetchHasFiles(orderId)
    .then((next) => {
      hasFilesCache.set(orderId, next);
      return next;
    })
    .catch(() => {
      hasFilesCache.set(orderId, false);
      return false;
    })
    .finally(() => {
      inFlight.delete(orderId);
    });

  inFlight.set(orderId, promise);
  return promise;
}

/** Drop cached status so subscribers re-check Drive. */
export function clearGdriveFolderHasFilesCache(orderId?: string) {
  if (orderId) {
    hasFilesCache.delete(orderId);
    inFlight.delete(orderId);
    notify(orderId);
  } else {
    hasFilesCache.clear();
    inFlight.clear();
  }
}

/**
 * Re-check Drive now (Copy Link, Final production click, column move).
 * Updates cache and notifies mounted cards/forms.
 */
export async function refreshGdriveFolderHasFiles(
  orderId: string
): Promise<boolean> {
  hasFilesCache.delete(orderId);
  inFlight.delete(orderId);
  try {
    const next = await fetchHasFilesDeduped(orderId);
    notify(orderId);
    return next;
  } catch {
    hasFilesCache.set(orderId, false);
    notify(orderId);
    return false;
  }
}

/**
 * Green order # / Copy Link from cache only.
 * Does **not** call Drive on mount (that made the board / cards feel stuck).
 * Checks run on move / Copy Link / Final production via refreshGdriveFolderHasFiles.
 */
export function useGdriveFolderHasFiles(
  orderId: string | null | undefined,
  artworkUrl: string | null | undefined
): boolean {
  const url = artworkUrl?.trim() ?? "";
  const hasUrl = Boolean(url && /^https?:\/\//i.test(url));
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

    // Cache miss: only fetch after an explicit refresh bumped epoch.
    if (epoch === 0) {
      setHasFiles(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await fetchHasFilesDeduped(orderId);
        if (!cancelled) setHasFiles(next);
      } catch {
        if (!cancelled) setHasFiles(false);
      }
    }, 100);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [orderId, hasUrl, url, epoch]);

  return hasFiles;
}
