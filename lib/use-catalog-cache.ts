"use client";

import { useEffect, useState } from "react";
import type { CatalogV2 } from "@/lib/crm-catalog-v2";
import { parseCatalogV2 } from "@/lib/crm-catalog-v2";

let cached: CatalogV2 | null = null;
let inflight: Promise<CatalogV2 | null> | null = null;

async function loadCatalog(): Promise<CatalogV2 | null> {
  if (cached) return cached;
  if (!inflight) {
    inflight = fetch("/api/catalog-cache")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { payload?: unknown } | null) => {
        if (!j?.payload) return null;
        try {
          cached = parseCatalogV2(j.payload);
          return cached;
        } catch {
          return null;
        }
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Cached CRM v2 catalog for Connected mode (manual create + spec editors). */
export function useCatalogCache(): CatalogV2 | null {
  const [catalog, setCatalog] = useState<CatalogV2 | null>(cached);
  useEffect(() => {
    let active = true;
    loadCatalog().then((c) => {
      if (active && c) setCatalog(c);
    });
    return () => {
      active = false;
    };
  }, []);
  return catalog;
}
