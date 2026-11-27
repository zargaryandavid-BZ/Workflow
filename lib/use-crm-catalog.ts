"use client";
import { useEffect, useState } from "react";
import { normalizeOptionKey } from "@/lib/field-links";
import type { CatalogProductInfo } from "@/lib/product-field-rules";

export type CrmCatalog = {
  categories: string[];
  productsByCategory: Record<string, string[]>;
  materialsByProduct: Record<string, string[]>;
  fieldOptionsByProduct: Record<string, Record<string, unknown>>;
  optionTogglesByProduct?: Record<string, { key: string; label: string }[]>;
  /** Per-product Finishing names from the CRM catalog (absent on old caches). */
  finishingByProduct?: Record<string, string[]>;
  /** Per-product Special effects names from the CRM catalog. */
  specialEffectsByProduct?: Record<string, string[]>;
  /** Per-product question rules (fields, hidden, labels, order). v2+ only. */
  products?: CatalogProductInfo[];
};

export type CrmCatalogStatus = "loading" | "ready" | "error";

let cached: CrmCatalog | null = null;
let inflight: Promise<CrmCatalog | null> | null = null;
/** Last load failed (network / 500 / bad payload). Cleared on retry. */
let lastError: string | null = null;

export function invalidateCrmCatalog() {
  cached = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("workflow:catalog-updated"));
  }
}

async function loadCatalog(): Promise<CrmCatalog | null> {
  if (inflight) return inflight;
  inflight = fetch("/api/crm-catalog", { cache: "no-store" })
    .then(async (r) => {
      const j = (await r.json().catch(() => null)) as
        | (CrmCatalog & { error?: string })
        | null;
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      return j;
    })
    .then((j: CrmCatalog | null) => {
      if (j && Array.isArray(j.categories)) {
        cached = j;
        lastError = null;
      } else {
        lastError = "The CRM catalog came back empty.";
      }
      return cached;
    })
    .catch((err: unknown) => {
      lastError = err instanceof Error ? err.message : "Request failed";
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Live CRM catalog (single source of truth) for cascading order-card options. */
export function useCrmCatalog(): CrmCatalog | null {
  const [catalog, setCatalog] = useState<CrmCatalog | null>(cached);
  useEffect(() => {
    let active = true;
    function apply(c: CrmCatalog | null) {
      if (active && c) setCatalog(c);
    }
    loadCatalog().then(apply);
    function onUpdate() {
      cached = null;
      loadCatalog().then(apply);
    }
    window.addEventListener("workflow:catalog-updated", onUpdate);
    return () => {
      active = false;
      window.removeEventListener("workflow:catalog-updated", onUpdate);
    };
  }, []);
  return catalog;
}

/**
 * Same catalog with a load status, so the card can say "Loading options…" or
 * show an error + Retry instead of silently falling back to unfiltered lists.
 */
export function useCrmCatalogState(): {
  catalog: CrmCatalog | null;
  status: CrmCatalogStatus;
  error: string | null;
  retry: () => void;
} {
  const [catalog, setCatalog] = useState<CrmCatalog | null>(cached);
  const [status, setStatus] = useState<CrmCatalogStatus>(
    cached ? "ready" : "loading"
  );
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    function apply(c: CrmCatalog | null) {
      if (!active) return;
      if (c) {
        setCatalog(c);
        setStatus("ready");
        setError(null);
      } else {
        setStatus("error");
        setError(lastError);
      }
    }
    if (!cached) setStatus("loading");
    loadCatalog().then(apply);
    function onUpdate() {
      cached = null;
      loadCatalog().then(apply);
    }
    window.addEventListener("workflow:catalog-updated", onUpdate);
    return () => {
      active = false;
      window.removeEventListener("workflow:catalog-updated", onUpdate);
    };
  }, [attempt]);
  return {
    catalog,
    status,
    error,
    retry: () => {
      lastError = null;
      setStatus("loading");
      setAttempt((n) => n + 1);
    },
  };
}

/** Case-insensitive lookup in a name→list map (handles emoji/space drift). */
export function catalogLookup(
  map: Record<string, string[]> | undefined,
  key: string,
): string[] | null {
  if (!map || !key) return null;
  if (map[key]) return map[key];
  const norm = normalizeOptionKey(key);
  if (!norm) return null;
  for (const k of Object.keys(map)) {
    if (normalizeOptionKey(k) === norm) return map[k];
  }
  return null;
}
