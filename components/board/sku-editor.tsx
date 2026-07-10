"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input, Label } from "@/components/ui/input";
import { SkuImageUpload } from "./sku-image-upload";
import type { SkuItem } from "@/lib/skus";
import type { OrderSkuImageWithUrl } from "@/lib/types";

export type { SkuItem } from "@/lib/skus";
export { normalizeSkus, prepareSkusForSave, validateSkus, mergeSkusWithAssets } from "@/lib/skus";

interface SkuEditorProps {
  value: SkuItem[];
  onChange: (next: SkuItem[]) => void;
  /** When set, artwork uploads go to Supabase immediately */
  orderId?: string;
  skuImagesBySkuId?: Record<string, OrderSkuImageWithUrl[]>;
  /** Saves a newly added SKU row before gallery uploads can attach to it. */
  ensureSkuPersisted?: (skuId: string) => Promise<string | null>;
  disabled?: boolean;
}

export function SkuEditor({
  value,
  onChange,
  orderId,
  skuImagesBySkuId = {},
  ensureSkuPersisted,
  disabled = false,
}: SkuEditorProps) {
  function update(index: number, patch: Partial<SkuItem>) {
    onChange(value.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function add() {
    onChange([
      ...value,
      { id: crypto.randomUUID(), name: "", qty: null },
    ]);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">
          SKUs
          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            SKU QTY: {value.length}
          </span>
        </p>
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add SKU
        </button>
      </div>

      {value.length === 0 ? (
        <p className="text-sm text-slate-400">
          No SKUs yet. Add one per distinct item / quantity.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_5.5rem_auto] gap-2">
            <Label className="mb-0">
              SKU name <span className="text-red-500">*</span>
            </Label>
            <Label className="mb-0">
              Quantity <span className="text-red-500">*</span>
            </Label>
            <span />
          </div>
          {value.map((sku, index) => (
            <div key={sku.id} className="space-y-1">
              <div className="grid grid-cols-[1fr_5.5rem_auto] items-start gap-2">
                <Input
                  value={sku.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                  placeholder={`SKU ${index + 1} name`}
                  disabled={disabled}
                  required
                />
                <Input
                  type="number"
                  min={1}
                  value={sku.qty ?? ""}
                  onChange={(e) =>
                    update(index, {
                      qty: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  placeholder="Qty"
                  disabled={disabled}
                  required
                />
                <button
                  type="button"
                  onClick={() => remove(index)}
                  disabled={disabled}
                  className="rounded p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600 disabled:opacity-50"
                  aria-label="Remove SKU"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {orderId ? (
                <SkuImageUpload
                  orderId={orderId}
                  skuId={sku.id}
                  initialImages={skuImagesBySkuId[sku.id] ?? []}
                  ensureSkuPersisted={ensureSkuPersisted}
                  disabled={disabled}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
