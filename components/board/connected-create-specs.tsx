"use client";

import { Label, Select } from "@/components/ui/input";
import { ConnectedSpecInputs, type SpecEditValue } from "@/components/board/connected-spec-inputs";
import type { CatalogV2, CatalogV2Product } from "@/lib/crm-catalog-v2";

export function ConnectedCreateSpecs({
  catalog,
  productId,
  onProductIdChange,
  values,
  onValuesChange,
}: {
  catalog: CatalogV2 | null;
  productId: string;
  onProductIdChange: (id: string) => void;
  values: Record<string, SpecEditValue>;
  onValuesChange: (next: Record<string, SpecEditValue>) => void;
}) {
  const products = catalog?.products ?? [];
  const product: CatalogV2Product | undefined = products.find(
    (p) => p.id === productId
  );

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-slate-700">
        Product Specifications — from CRM
      </p>
      {!catalog ? (
        <p className="text-sm text-slate-500">
          Loading CRM catalog… If this stays empty, refresh the catalog in
          Settings → Fields.
        </p>
      ) : products.length === 0 ? (
        <p className="text-sm text-slate-500">
          No products in the cached catalog.
        </p>
      ) : (
        <>
          <div>
            <Label htmlFor="connected-product">Product</Label>
            <Select
              id="connected-product"
              value={productId}
              onChange={(e) => onProductIdChange(e.target.value)}
            >
              <option value="">Select a product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          {product ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {product.specifications.map((def) => (
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
          ) : null}
        </>
      )}
    </div>
  );
}
