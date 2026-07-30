"use client";

import { useEffect, useState } from "react";

/** Avoid re-hitting Drive for the same order while browsing the board. */
const hasFilesCache = new Map<string, boolean>();

/** One in-flight request per order so remounts share a single call. */
const inFlight = new Map<string, Promise<boolean>>();

/** Subscribers notified when an order's cached status is invalidated/refreshed. */
const listeners = new Map<string, Set<() => void>>();

/**
 * Cap concurrent Drive checks so opening the board doesn't spawn dozens of
 * /gdrive-status calls at once (that made the board feel stuck).
 */
const MAX_CONCURRENT = 2;
let activeChecks = 0;
const waitQueue: Array<() => void> = [];

function runNextQueued() {
  while (activeChecks < MAX_CONCURRENT && waitQueue.length > 0) {
    const next = waitQueue.shift();
    if (next) next();
  }
}

function enqueueCheck<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      activeChecks += 1;
      work()
        .then(resolve, reject)
        .finally(() => {
          activeChecks -= 1;
          runNextQueued();
        });
    };
    if (activeChecks < MAX_CONCURRENT) start();
    else waitQueue.push(start);
  });
}

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

  const promise = enqueueCheck(() =>
    fetchHasFiles(orderId)
      .then((next) => {
        hasFilesCache.set(orderId, next);
        return next;
      })
      .catch(() => {
        hasFilesCache.set(orderId, false);
        return false;
      })
  ).finally(() => {
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
 * Green order # / Copy Link when Artwork / Final production Drive folder has files.
 *
 * Uses cache when present. On cache miss (with a Drive URL), schedules a
 * deferred, concurrency-limited Drive check so the board can paint first.
 * Explicit refresh still runs immediately via refreshGdriveFolderHasFiles.
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

    let cancelled = false;
    // Let the board paint / column fetches settle, then check Drive.
    // Explicit refresh (epoch bump with empty cache) uses a shorter delay.
    const delayMs = epoch === 0 ? 800 : 50;
    const timer = window.setTimeout(() => {
      void fetchHasFilesDeduped(orderId).then((next) => {
        if (!cancelled) setHasFiles(next);
      });
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [orderId, hasUrl, url, epoch]);

  return hasFiles;
}
