"use client";

import { useState } from "react";
import { Loader2, Package, Printer, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type PackingSlipLayout = "multiple" | "one_per_slip";

export interface SkuSlipConfig {
  skuId: string;
  skuName: string;
  artworkUrl: string | null;
  qty: number | null;
  copyQty: number | null;
  enabled: boolean;
}

export interface PackingSlipConfig {
  skus: SkuSlipConfig[];
  layout: PackingSlipLayout;
  boxCount: number | null;
}

interface Props {
  orderId: string;
  orderNumber: string;
  groupSize: number;
  /** SKU images from the scan result — each has id, name, artwork URL. */
  skuImages?: { sku_id: string; sku_name: string; url: string }[];
  totalQty?: number | null;
  qtyPerSku?: number | null;
  onClose: () => void;
}

function deriveQty(
  totalQty: number | null | undefined,
  qtyPerSku: number | null | undefined,
  skuCount: number
): number | null {
  if (qtyPerSku && qtyPerSku > 0) return qtyPerSku;
  if (totalQty && totalQty > 0 && skuCount > 0) {
    return Math.round(totalQty / skuCount);
  }
  return null;
}

export function PackingSlipConfigModal({
  orderId,
  orderNumber,
  groupSize,
  skuImages,
  totalQty,
  qtyPerSku,
  onClose,
}: Props) {
  const skuList = skuImages ?? [];
  const perQty = deriveQty(totalQty, qtyPerSku, skuList.length);

  const [skus, setSkus] = useState<SkuSlipConfig[]>(() =>
    skuList.length > 0
      ? skuList.map((img) => ({
          skuId: img.sku_id,
          skuName: img.sku_name,
          artworkUrl: img.url,
          qty: perQty,
          copyQty: perQty,
          enabled: true,
        }))
      : [
          {
            skuId: "__all__",
            skuName: "All items",
            artworkUrl: null,
            qty: totalQty ?? null,
            copyQty: totalQty ?? null,
            enabled: true,
          },
        ]
  );
  const [layout, setLayout] = useState<PackingSlipLayout>("multiple");
  const [boxCount, setBoxCount] = useState<string>("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleSku(id: string) {
    setSkus((prev) =>
      prev.map((s) => (s.skuId === id ? { ...s, enabled: !s.enabled } : s))
    );
  }

  function updateCopyQty(id: string, raw: string) {
    const n = raw === "" ? null : Math.max(0, parseInt(raw, 10) || 0);
    setSkus((prev) =>
      prev.map((s) => (s.skuId === id ? { ...s, copyQty: raw === "" ? null : n } : s))
    );
  }

  const enabledSkus = skus.filter((s) => s.enabled);

  function partFromOrderNumber(on: string): number {
    const m = on.trim().match(/-(\d+)$/);
    if (!m) return 1;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }

  async function handlePrint() {
    if (enabledSkus.length === 0) {
      setError("Select at least one SKU to print.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const totalParts = Math.max(1, groupSize);
      const part = Math.min(partFromOrderNumber(orderNumber), totalParts);

      const selectedSkuIds =
        skus[0]?.skuId === "__all__" ? null : enabledSkus.map((s) => s.skuId);

      const copyQties: Record<string, number> = {};
      for (const s of enabledSkus) {
        if (s.copyQty != null && s.skuId !== "__all__") {
          copyQties[s.skuId] = s.copyQty;
        }
      }

      const boxNum = boxCount.trim() ? parseInt(boxCount, 10) : null;

      const res = await fetch(
        `/api/orders/${orderId}/actions/generate-packing-slip?part=${part}&totalParts=${totalParts}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            part,
            totalParts,
            selectedSkuIds,
            copyQties: Object.keys(copyQties).length > 0 ? copyQties : undefined,
            layout,
            boxCount: boxNum,
          }),
          signal: AbortSignal.timeout(170_000),
        }
      );

      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Failed to generate packing slip");
      }

      const blob = await res.blob();
      if (!blob.size) throw new Error("Packing slip was empty");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `packing-slip-${orderNumber.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      // Also open print dialog
      const w = window.open(url);
      w?.addEventListener("load", () => w.print());

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate slip");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Printer className="h-4 w-4 text-slate-500" />
            <h2 className="text-[15px] font-semibold text-slate-900">
              Print Packing Slip
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Layout + Box Count — compact single row at the top */}
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
            {/* Layout toggle */}
            <div className="flex flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setLayout("multiple")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-[13px] font-medium transition-colors",
                  layout === "multiple"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <span className="text-sm leading-none">⊞</span>
                Multi-SKU
              </button>
              <button
                type="button"
                onClick={() => setLayout("one_per_slip")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 border-l border-slate-200 px-3 py-2.5 text-[13px] font-medium transition-colors",
                  layout === "one_per_slip"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <span className="text-sm leading-none">☐</span>
                1 per slip
              </button>
            </div>

            {/* Box count */}
            <div className="flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap text-[12px] text-slate-400">Boxes</span>
              <input
                type="number"
                min="1"
                value={boxCount}
                onChange={(e) => setBoxCount(e.target.value)}
                placeholder="—"
                className="h-10 w-20 rounded-xl border border-slate-200 bg-white px-3 text-center text-[14px] font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
          </div>

          {/* SKU list */}
          <div className="px-5 pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              SKU Selection
            </p>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              {/* Column headers */}
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <div className="w-5 shrink-0" />
                <div className="flex-1">SKU / Part</div>
                <div className="w-14 shrink-0 text-right">QTY</div>
                <div className="w-20 shrink-0 text-right">Copy QTY</div>
              </div>

              {skus.map((sku) => (
                <div
                  key={sku.skuId}
                  onClick={() => toggleSku(sku.skuId)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 border-t border-slate-100 px-3 py-2 transition-colors first:border-t-0 hover:bg-slate-50",
                    !sku.enabled && "opacity-40"
                  )}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={sku.enabled}
                    onChange={(e) => { e.stopPropagation(); toggleSku(sku.skuId); }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-5 w-5 shrink-0 cursor-pointer rounded border-slate-300 accent-slate-900"
                  />

                  {/* Artwork + SKU name */}
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    {sku.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={sku.artworkUrl}
                        alt={sku.skuName}
                        className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 bg-slate-50 object-contain p-0.5"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                        <Package className="h-4 w-4 text-slate-300" />
                      </div>
                    )}
                    <span className="min-w-0 truncate text-[13px] font-medium text-slate-800">
                      {sku.skuName || "—"}
                    </span>
                  </div>

                  {/* QTY (read-only) */}
                  <div className="w-14 shrink-0 text-right text-[13px] text-slate-400">
                    {sku.qty != null ? sku.qty.toLocaleString("en-US") : "—"}
                  </div>

                  {/* Copy QTY (editable) */}
                  <div className="w-20 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="number"
                      min="0"
                      value={sku.copyQty ?? ""}
                      onChange={(e) => updateCopyQty(sku.skuId, e.target.value)}
                      disabled={!sku.enabled}
                      placeholder="—"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-right text-[13px] font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:bg-slate-50 disabled:text-slate-300"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pb-4" />
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-100 px-5 py-4">
          {error && (
            <p className="mb-3 text-[13px] text-red-600">{error}</p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-xl border border-slate-200 py-3 text-[14px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handlePrint()}
              disabled={busy || enabledSkus.length === 0}
              className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-[14px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Printer className="h-4 w-4 shrink-0" />
              )}
              {busy ? "Generating…" : "Print"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
