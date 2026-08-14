"use client";
import { useEffect, useState } from "react";

export type CrmCatalog = {
  categories: string[];
  productsByCategory: Record<string, string[]>;
  materialsByProduct: Record<string, string[]>;
  fieldOptionsByProduct: Record<string, Record<string, unknown>>;
  optionTogglesByProduct?: Record<string, { key: string; label: string }[]>;
};

let cached: CrmCatalog | null = null;
let inflight: Promise<CrmCatalog | null> | null = null;

async function loadCatalog(): Promise<CrmCatalog | null> {
  if (cached) return cached;
  if (!inflight) {
    inflight = fetch("/api/crm-catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: CrmCatalog | null) => {
        if (j && Array.isArray(j.categories)) cached = j;
        return cached;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Live CRM catalog (single source of truth) for cascading order-card options. */
export function useCrmCatalog(): CrmCatalog | null {
  const [catalog, setCatalog] = useState<CrmCatalog | null>(cached);
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

/** Case-insensitive lookup in a name→list map (handles emoji/space drift). */
export function catalogLookup(
  map: Record<string, string[]> | undefined,
  key: string,
): string[] | null {
  if (!map || !key) return null;
  if (map[key]) return map[key];
  const norm = key.trim().toLowerCase();
  for (const k of Object.keys(map)) {
    if (k.trim().toLowerCase() === norm) return map[k];
  }
  return null;
}
