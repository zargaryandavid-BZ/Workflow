"use client";
import { useEffect, useState } from "react";
import { normalizeOptionKey } from "@/lib/field-links";

export type CrmCatalog = {
  categories: string[];
  productsByCategory: Record<string, string[]>;
  materialsByProduct: Record<string, string[]>;
  fieldOptionsByProduct: Record<string, Record<string, unknown>>;
  optionTogglesByProduct?: Record<string, { key: string; label: string }[]>;
};

let cached: CrmCatalog | null = null;
let inflight: Promise<CrmCatalog | null> | null = null;

export function invalidateCrmCatalog() {
  cached = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("workflow:catalog-updated"));
  }
}

async function loadCatalog(): Promise<CrmCatalog | null> {
  if (inflight) return inflight;
  inflight = fetch("/api/crm-catalog", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: CrmCatalog | null) => {
      if (j && Array.isArray(j.categories)) cached = j;
      return cached;
    })
    .catch(() => null)
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
