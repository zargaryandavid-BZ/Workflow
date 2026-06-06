"use client";

import { Input, Label } from "@/components/ui/input";
import type { SkuItem } from "./sku-editor";

/** Sum of all SKU quantities (ignoring blank/invalid entries). */
export function sumSkuQty(skus: SkuItem[]): number {
  return skus.reduce(
    (acc, s) =>
      acc + (typeof s.qty === "number" && !Number.isNaN(s.qty) ? s.qty : 0),
    0
  );
}

/**
 * Order QTY input. When one or more SKUs exist the value is auto-calculated as
 * the sum of their quantities and the field becomes read-only. With no SKUs the
 * user can type a total manually.
 */
export function OrderQtyField({
  skus,
  value,
  onChange,
  readOnly = false,
}: {
  skus: SkuItem[];
  value: number | null;
  onChange: (value: number | null) => void;
  readOnly?: boolean;
}) {
  const hasSkus = skus.length > 0;
  const display = hasSkus ? sumSkuQty(skus) : value ?? "";
  const isReadOnly = readOnly || hasSkus;

  return (
    <div>
      <Label htmlFor="order-qty">Order QTY</Label>
      <Input
        id="order-qty"
        type="number"
        min={0}
        value={display}
        readOnly={isReadOnly}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : Number(e.target.value))
        }
        placeholder="Total units"
        className={isReadOnly ? "bg-slate-50 text-slate-500" : undefined}
      />
      {hasSkus ? (
        <p className="mt-1 text-xs text-slate-400">
          Auto-calculated from SKU quantities.
        </p>
      ) : null}
    </div>
  );
}
