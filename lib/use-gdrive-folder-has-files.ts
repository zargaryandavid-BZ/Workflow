"use client";

import { useEffect, useState } from "react";

type FolderDriveStatus = { hasFiles: boolean; hasPdf: boolean };

const EMPTY: FolderDriveStatus = { hasFiles: false, hasPdf: false };

/** Avoid re-hitting Drive for the same order while browsing the board. */
const statusCache = new Map<string, FolderDriveStatus>();

/** One in-flight request per order so remounts share a single call. */
const inFlight = new Map<string, Promise<FolderDriveStatus>>();

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

async function fetchStatus(orderId: string): Promise<FolderDriveStatus> {
  const res = await fetch(`/api/orders/${orderId}/gdrive-status`);
  if (!res.ok) return EMPTY;
  const json = (await res.json()) as {
    hasFiles?: boolean;
    hasPdf?: boolean;
  };
  return {
    hasFiles: Boolean(json.hasFiles),
    hasPdf: Boolean(json.hasPdf),
  };
}

function fetchStatusDeduped(orderId: string): Promise<FolderDriveStatus> {
  const existing = inFlight.get(orderId);
  if (existing) return existing;

  const promise = enqueueCheck(() =>
    fetchStatus(orderId)
      .then((next) => {
        statusCache.set(orderId, next);
        return next;
      })
      .catch(() => {
        statusCache.set(orderId, EMPTY);
        return EMPTY;
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
    statusCache.delete(orderId);
    inFlight.delete(orderId);
    notify(orderId);
  } else {
    statusCache.clear();
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
  statusCache.delete(orderId);
  inFlight.delete(orderId);
  try {
    const next = await fetchStatusDeduped(orderId);
    notify(orderId);
    return next.hasFiles;
  } catch {
    statusCache.set(orderId, EMPTY);
    notify(orderId);
    return false;
  }
}

export function useGdriveFolderStatus(
  orderId: string | null | undefined,
  artworkUrl: string | null | undefined
): FolderDriveStatus {
  const url = artworkUrl?.trim() ?? "";
  const hasUrl = Boolean(url && /^https?:\/\//i.test(url));
  const [status, setStatus] = useState<FolderDriveStatus>(() => {
    if (!orderId || !hasUrl) return EMPTY;
    return statusCache.get(orderId) ?? EMPTY;
  });
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!orderId) return;
    return subscribe(orderId, () => setEpoch((n) => n + 1));
  }, [orderId]);

  useEffect(() => {
    if (!orderId || !hasUrl) {
      setStatus(EMPTY);
      return;
    }

    const cached = statusCache.get(orderId);
    if (cached !== undefined) {
      setStatus(cached);
      return;
    }

    let cancelled = false;
    const delayMs = epoch === 0 ? 800 : 50;
    const timer = window.setTimeout(() => {
      void fetchStatusDeduped(orderId).then((next) => {
        if (!cancelled) setStatus(next);
      });
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [orderId, hasUrl, url, epoch]);

  return status;
}

/**
 * Green order # / Copy Link when Artwork / Final production Drive folder has files.
 */
export function useGdriveFolderHasFiles(
  orderId: string | null | undefined,
  artworkUrl: string | null | undefined
): boolean {
  return useGdriveFolderStatus(orderId, artworkUrl).hasFiles;
}

/** True when a PDF exists in Artwork / Final production (Show Artwork on the card). */
export function useGdriveFolderHasPdf(
  orderId: string | null | undefined,
  artworkUrl: string | null | undefined
): boolean {
  return useGdriveFolderStatus(orderId, artworkUrl).hasPdf;
}
