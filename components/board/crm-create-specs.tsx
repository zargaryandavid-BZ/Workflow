"use client";

import { useMemo, useState } from "react";
import { Input, Label } from "@/components/ui/input";
import {
  ConnectedSpecInputs,
  type SpecEditValue,
} from "@/components/board/connected-spec-inputs";
import { useCrmCatalogState } from "@/lib/use-crm-catalog";
import {
  filterPickerProducts,
  type CatalogProductInfo,
} from "@/lib/product-field-rules";
import { catalogV2ProductFromInfo } from "@/lib/crm-create-product";
import type { CatalogV2Product } from "@/lib/crm-catalog-v2";
import { cn } from "@/lib/utils";

/**
 * Admin "+ New card": Category → Product (with search) → only that product's
 * questions, from the same live CRM catalog the card editor uses
 * (/api/crm-catalog), not the 10-22 catalog_cache snapshot.
 */
export function CrmCreateSpecs({
  productId,
  onProductChange,
  values,
  onValuesChange,
}: {
  productId: string;
  /** Selected product (null when cleared), already in v2 snapshot shape. */
  onProductChange: (product: CatalogV2Product | null) => void;
  values: Record<string, SpecEditValue>;
  onValuesChange: (next: Record<string, SpecEditValue>) => void;
}) {
  const { catalog, status, error, retry } = useCrmCatalogState();
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");

  const products = useMemo<CatalogProductInfo[]>(
    () => catalog?.products ?? [],
    [catalog]
  );
  const categories = useMemo(
    () =>
      (catalog?.categories ?? []).filter((c) =>
        products.some((p) => p.category === c)
      ),
    [catalog, products]
  );
  const selectedInfo =
    products.find((p) => (p.id || p.name) === productId) ?? null;
  const selected = useMemo(
    () => (selectedInfo ? catalogV2ProductFromInfo(selectedInfo) : null),
    [selectedInfo]
  );
  const list = filterPickerProducts(products, {
    category: search.trim() ? null : category,
    search,
  });

  function pick(p: CatalogProductInfo) {
    setSearch("");
    setCategory(p.category ?? "");
    onProductChange(catalogV2ProductFromInfo(p));
  }

  if (!catalog) {
    return status === "error" ? (
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        <span>
          Couldn&apos;t load products from the CRM{error ? ` (${error})` : ""}.
        </span>
        <button
          type="button"
          onClick={retry}
          className="rounded border border-red-300 bg-white px-2 py-0.5 text-xs font-medium hover:bg-red-100"
        >
          Retry
        </button>
      </div>
    ) : (
      <p className="text-sm text-slate-500">Loading options…</p>
    );
  }
  if (products.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        The CRM catalog has no products. Check Settings → Fields.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">{selectedInfo?.category}</p>
            <p className="truncate text-sm font-semibold text-slate-800">
              {selected.name}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onProductChange(null)}
            className="shrink-0 text-xs font-medium text-[var(--primary)] hover:underline"
          >
            Change product
          </button>
        </div>
      ) : (
        <>
          <div>
            <Label htmlFor="create-product-search">Product</Label>
            <Input
              id="create-product-search"
              value={search}
              placeholder="Search all products…"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {!search.trim() ? (
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c === category ? "" : c)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium",
                    c === category
                      ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          ) : null}
          {category || search.trim() ? (
            <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {list.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-500">
                  No products match.
                </p>
              ) : (
                list.map((p) => (
                  <button
                    key={p.id || p.name}
                    type="button"
                    onClick={() => pick(p)}
                    className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50"
                  >
                    <span className="text-slate-800">{p.name}</span>
                    {search.trim() ? (
                      <span className="text-xs text-slate-400">
                        {p.category}
                      </span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Pick a category, or search.
            </p>
          )}
        </>
      )}

      {selected ? (
        selected.specifications.length === 0 ? (
          <p className="text-xs text-slate-500">
            This product has no extra questions in the CRM.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {selected.specifications.map((def) => (
              <ConnectedSpecInputs
                key={def.key}
                specType={def.type}
                label={def.label}
                options={def.options}
                value={values[def.key]?.value ?? null}
                onChange={(next) =>
                  onValuesChange({ ...values, [def.key]: next })
                }
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
