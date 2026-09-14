"use client";

import { useEffect, useState } from "react";
import type { CatalogV2 } from "@/lib/crm-catalog-v2";
import { parseCatalogV2 } from "@/lib/crm-catalog-v2";

let cached: { at: string; catalog: CatalogV2 } | null = null;
let inflight: Promise<CatalogV2 | null> | null = null;

export function invalidateCatalogCache() {
  cached = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("workflow:catalog-updated"));
  }
}

async function loadCatalog(): Promise<CatalogV2 | null> {
  if (inflight) return inflight;
  inflight = fetch("/api/catalog-cache", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { payload?: unknown; cached_at?: string } | null) => {
      if (!j?.payload) return null;
      const at = String(j.cached_at ?? "");
      if (cached && cached.at === at) return cached.catalog;
      try {
        const catalog = parseCatalogV2(j.payload);
        cached = { at, catalog };
        return catalog;
      } catch {
        return null;
      }
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Cached CRM v2 catalog for Connected mode (manual create + spec editors). */
export function useCatalogCache(): CatalogV2 | null {
  const [catalog, setCatalog] = useState<CatalogV2 | null>(
    cached?.catalog ?? null
  );
  useEffect(() => {
    let active = true;
    function apply(c: CatalogV2 | null) {
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
