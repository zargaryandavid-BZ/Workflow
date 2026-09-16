"use client";

import { useEffect, useState } from "react";

export type PdfCheckResult = {
  checked: boolean;
  valid: boolean;
  hasLayers: boolean;
  isLinearized: boolean;
  fileName?: string | null;
};

const DEFAULT: PdfCheckResult = {
  checked: false,
  valid: true,
  hasLayers: true,
  isLinearized: true,
};

const resultCache = new Map<string, PdfCheckResult>();
const inFlight = new Map<string, Promise<PdfCheckResult>>();
const listeners = new Map<string, Set<() => void>>();

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

async function fetchCheck(orderId: string): Promise<PdfCheckResult> {
  const res = await fetch(`/api/orders/${orderId}/pdf-check`);
  if (!res.ok) return DEFAULT;
  const json = (await res.json()) as Partial<PdfCheckResult>;
  return {
    checked: Boolean(json.checked),
    valid: json.valid !== false,
    hasLayers: json.hasLayers !== false,
    isLinearized: json.isLinearized !== false,
    fileName: json.fileName ?? null,
  };
}

function fetchCheckDeduped(orderId: string): Promise<PdfCheckResult> {
  const existing = inFlight.get(orderId);
  if (existing) return existing;

  const promise = enqueueCheck(() =>
    fetchCheck(orderId)
      .then((next) => {
        resultCache.set(orderId, next);
        return next;
      })
      .catch(() => {
        resultCache.set(orderId, DEFAULT);
        return DEFAULT;
      })
  ).finally(() => {
    inFlight.delete(orderId);
  });

  inFlight.set(orderId, promise);
  return promise;
}

export function clearOrderPdfCheckCache(orderId?: string) {
  if (orderId) {
    resultCache.delete(orderId);
    inFlight.delete(orderId);
    notify(orderId);
  } else {
    resultCache.clear();
    inFlight.clear();
  }
}

/**
 * Background print-spec check for a Final-folder PDF.
 * Defaults to valid so the card never shows a false alarm while loading.
 */
export function useOrderPdfCheck(
  orderId: string | null | undefined,
  hasFinalPdf: boolean
): PdfCheckResult {
  const [result, setResult] = useState<PdfCheckResult>(() => {
    if (!orderId || !hasFinalPdf) return DEFAULT;
    return resultCache.get(orderId) ?? DEFAULT;
  });
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!orderId) return;
    return subscribe(orderId, () => setEpoch((n) => n + 1));
  }, [orderId]);

  useEffect(() => {
    if (!orderId || !hasFinalPdf) {
      setResult(DEFAULT);
      return;
    }

    const cached = resultCache.get(orderId);
    if (cached !== undefined) {
      setResult(cached);
      return;
    }

    let cancelled = false;
    void fetchCheckDeduped(orderId).then((next) => {
      if (!cancelled) setResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [orderId, hasFinalPdf, epoch]);

  return result;
}
