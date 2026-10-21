"use client";

import { useRef, useState } from "react";
import { Box, Copy, LayoutGrid, Loader2, Package, Printer, Settings, Square, Trash2, X } from "lucide-react";
import { ScanNumberKeypad } from "@/components/fulfillment/ScanNumberKeypad";
import {
  CUSTOM_BOX_SIZE_VALUE,
  FULFILLMENT_BOX_SIZE_PRESETS,
  formatCustomBoxSize,
} from "@/lib/box-size-presets";
import { scanSkuLineQtys } from "@/lib/fulfillment-scan-order";
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
  skuImages?: {
    sku_id: string;
    sku_name: string;
    url: string;
    /** Product-specification quantity for this SKU. Absent on extra artwork pages. */
    qty?: number | null;
  }[];
  totalQty?: number | null;
  qtyPerSku?: number | null;
  /** Sender station uses the box-assignment wizard and 4×6 labels. */
  sender?: boolean;
  /** Set on the no-login scan page so print does not use the staff API. */
  scanApiBase?: string;
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

function PackingSlipConfigForm({
  orderId,
  orderNumber,
  groupSize,
  skuImages,
  totalQty,
  qtyPerSku,
  onClose,
}: Props) {
  const skuList = skuImages ?? [];
  // Fallback qty used only when a specific SKU doesn't carry its own qty.
  const perQty = deriveQty(totalQty, qtyPerSku, skuList.length);

  const [skus, setSkus] = useState<SkuSlipConfig[]>(() =>
    skuList.length > 0
      ? skuList.map((img) => {
          // Prefer the per-SKU qty from specs; fall back to the even-split only
          // when the SKU doesn't have its own quantity defined.
          const skuQty =
            img.qty != null && img.qty > 0 ? img.qty : perQty;
          return {
            skuId: img.sku_id,
            skuName: img.sku_name,
            artworkUrl: img.url,
            qty: skuQty,
            copyQty: skuQty,
            enabled: true,
          };
        })
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
  const [boxCountKeypadOpen, setBoxCountKeypadOpen] = useState(false);
  const replaceBoxCountRef = useRef(true);
  const [copyQtyKeypadId, setCopyQtyKeypadId] = useState<string | null>(null);
  const [copyQtyKeypadStr, setCopyQtyKeypadStr] = useState("");
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
    <>
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
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
                type="text"
                inputMode="numeric"
                readOnly
                value={boxCount}
                placeholder="—"
                onClick={() => {
                  replaceBoxCountRef.current = true;
                  setBoxCountKeypadOpen(true);
                }}
                className="h-10 w-20 cursor-pointer rounded-xl border border-slate-200 bg-white px-3 text-center text-[14px] font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
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

                  {/* Copy QTY (tap to open keypad) */}
                  <div className="w-20 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      inputMode="numeric"
                      readOnly
                      value={sku.copyQty != null ? sku.copyQty.toLocaleString("en-US") : ""}
                      disabled={!sku.enabled}
                      placeholder="—"
                      onClick={() => {
                        if (!sku.enabled) return;
                        setCopyQtyKeypadId(sku.skuId);
                        setCopyQtyKeypadStr(sku.copyQty?.toString() ?? "");
                      }}
                      className="h-9 w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-2 text-right text-[13px] font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-default disabled:bg-slate-50 disabled:text-slate-300"
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
    {boxCountKeypadOpen ? (
      <ScanNumberKeypad
        variant="integer"
        value={boxCount}
        onInsert={(ch) => {
          setBoxCount((prev) => (replaceBoxCountRef.current ? ch : prev + ch));
          replaceBoxCountRef.current = false;
        }}
        onBackspace={() => {
          if (replaceBoxCountRef.current) {
            replaceBoxCountRef.current = false;
            setBoxCount("");
            return;
          }
          setBoxCount((prev) => prev.slice(0, -1) || "");
        }}
        onSubmit={() => setBoxCountKeypadOpen(false)}
        onClose={() => setBoxCountKeypadOpen(false)}
      />
    ) : null}
    {copyQtyKeypadId ? (
      <ScanNumberKeypad
        variant="integer"
        value={copyQtyKeypadStr}
        onInsert={(ch) => setCopyQtyKeypadStr((prev) => prev + ch)}
        onBackspace={() => setCopyQtyKeypadStr((prev) => prev.slice(0, -1))}
        onSubmit={() => {
          if (copyQtyKeypadId) updateCopyQty(copyQtyKeypadId, copyQtyKeypadStr);
          setCopyQtyKeypadId(null);
        }}
        onClose={() => setCopyQtyKeypadId(null)}
      />
    ) : null}
    </>
  );
}

type SlipLine = { key: string; skuId: string; qty: number };
type SlipBoxDetails = {
  sizeLabel: string;
  sizeL: string;
  sizeW: string;
  sizeH: string;
  weightLbs: string;
};
type BoxKeypadField = "sizeL" | "sizeW" | "sizeH" | "weightLbs";

function requiredSkuQty(sku: SkuSlipConfig): number {
  if (sku.qty != null && sku.qty > 0) return sku.qty;
  return 1;
}

function newLine(skuId: string, qty: number): SlipLine {
  const key =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${skuId}-${Date.now()}-${Math.random()}`;
  return { key, skuId, qty };
}

function SenderPackingSlipWizard({
  orderId,
  orderNumber,
  groupSize,
  skuImages,
  totalQty,
  qtyPerSku,
  scanApiBase,
  onClose,
}: Props) {
  const skuList = skuImages ?? [];
  const lineQtys = scanSkuLineQtys({
    skus: skuList.map((img) => ({ qty: img.qty })),
    totalQty,
    qtyPerSku,
  });
  const skus: SkuSlipConfig[] =
    skuList.length > 0
      ? skuList.map((img, index) => {
          const qty = lineQtys[index] ?? null;
          return {
            skuId: img.sku_id,
            skuName: img.sku_name,
            artworkUrl: img.url,
            qty,
            copyQty: qty,
            enabled: true,
          };
        })
      : [
          {
            skuId: "__all__",
            skuName: "All items",
            artworkUrl: null,
            qty: totalQty ?? null,
            copyQty: totalQty ?? null,
            enabled: true,
          },
        ];

  const [step, setStep] = useState<1 | 2>(1);
  const [layout, setLayout] = useState<PackingSlipLayout>("multiple");
  const [boxCount, setBoxCount] = useState("1");
  const [boxCountKeypadOpen, setBoxCountKeypadOpen] = useState(false);
  const replaceBoxCountRef = useRef(true);
  const [boxes, setBoxes] = useState<SlipLine[][]>([]);
  const [boxDetails, setBoxDetails] = useState<SlipBoxDetails[]>([]);
  const [lineQtyKeypad, setLineQtyKeypad] = useState<{
    boxIndex: number;
    key: string;
  } | null>(null);
  const [lineQtyKeypadStr, setLineQtyKeypadStr] = useState("");
  const [lineQtyIsDefault, setLineQtyIsDefault] = useState(false);
  const [dropQtyPending, setDropQtyPending] = useState<{
    boxIndex: number;
    skuId: string;
    fromBox: number | null;
    key?: string;
  } | null>(null);
  const [dropQtyStr, setDropQtyStr] = useState("");
  const [dropQtyIsDefault, setDropQtyIsDefault] = useState(false);
  const [boxSettingsOpen, setBoxSettingsOpen] = useState(false);
  const [settingsApplyTo, setSettingsApplyTo] = useState<"all" | number[]>("all");
  const [settingsDraft, setSettingsDraft] = useState<SlipBoxDetails>({
    sizeLabel: "", sizeL: "", sizeW: "", sizeH: "", weightLbs: "",
  });
  const [settingsWeightKeypad, setSettingsWeightKeypad] = useState(false);
  const [settingsDimKeypad, setSettingsDimKeypad] = useState<"sizeL" | "sizeW" | "sizeH" | null>(null);
  const [boxMenu, setBoxMenu] = useState<{
    skuId: string;
    fromBox: number | null;
    key?: string;
    x: number;
    y: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function openDropQty(boxIndex: number, skuId: string, fromBox: number | null, key?: string) {
    const left = remaining(skuId);
    setDropQtyPending({ boxIndex, skuId, fromBox, key });
    setDropQtyStr(String(left > 0 ? left : 1));
    setDropQtyIsDefault(true);
    setBoxMenu(null);
  }

  function commitDropQty() {
    if (!dropQtyPending) return;
    const { boxIndex, skuId, fromBox, key } = dropQtyPending;
    const qty = Math.max(1, parseInt(dropQtyStr, 10) || 1);
    if (fromBox == null) {
      placeFromPool(boxIndex, skuId, qty);
    } else if (key) {
      moveLine(fromBox, key, boxIndex);
    }
    setDropQtyPending(null);
    setDropQtyStr("");
  }

  function applyBoxSettings() {
    const targets =
      settingsApplyTo === "all"
        ? boxes.map((_, i) => i)
        : settingsApplyTo;
    setBoxDetails((prev) =>
      prev.map((d, i) => (targets.includes(i) ? { ...d, ...settingsDraft } : d))
    );
    setBoxSettingsOpen(false);
  }

  function toggleSettingsBox(i: number) {
    setSettingsApplyTo((prev) => {
      if (prev === "all") return [i];
      return prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i];
    });
  }

  function duplicateBox(boxIndex: number) {
    setBoxes((prev) => {
      const next = [...prev];
      next.splice(boxIndex + 1, 0, []); // empty — copy settings only, not contents
      return next;
    });
    setBoxDetails((prev) => {
      const copy = { ...prev[boxIndex] };
      const next = [...prev];
      next.splice(boxIndex + 1, 0, copy);
      return next;
    });
  }

  function removeBox(boxIndex: number) {
    if (boxes.length <= 1) return;
    setBoxes((prev) => prev.filter((_, i) => i !== boxIndex));
    setBoxDetails((prev) => prev.filter((_, i) => i !== boxIndex));
  }

  function chooseBox(boxIndex: number) {
    if (!boxMenu) return;
    if (boxMenu.fromBox == null) openDropQty(boxIndex, boxMenu.skuId, null);
    else if (boxMenu.key) moveLine(boxMenu.fromBox, boxMenu.key, boxIndex);
    setBoxMenu(null);
  }

  const skuById = new Map(skus.map((sku) => [sku.skuId, sku]));

  function allocated(skuId: string, source = boxes) {
    return source
      .flat()
      .filter((line) => line.skuId === skuId)
      .reduce((sum, line) => sum + line.qty, 0);
  }

  function remaining(skuId: string, source = boxes) {
    const sku = skuById.get(skuId);
    if (!sku) return 0;
    return requiredSkuQty(sku) - allocated(skuId, source);
  }

  function openBoxes() {
    const count = Math.max(1, Math.floor(Number(boxCount)) || 1);
    setBoxCount(String(count));
    if (count === 1) {
      setBoxes([
        skus.map((sku) => newLine(sku.skuId, requiredSkuQty(sku))),
      ]);
    } else {
      setBoxes(Array.from({ length: count }, () => []));
    }
    setBoxDetails(
      Array.from({ length: count }, () => ({
        sizeLabel: "",
        sizeL: "",
        sizeW: "",
        sizeH: "",
        weightLbs: "",
      }))
    );
    setBoxMenu(null);
    setError("");
    setStep(2);
  }

  function updateBoxDetails(
    boxIndex: number,
    patch: Partial<SlipBoxDetails>
  ) {
    setBoxDetails((current) =>
      current.map((details, index) =>
        index === boxIndex ? { ...details, ...patch } : details
      )
    );
  }

  function placeFromPool(boxIndex: number, skuId: string, qty?: number) {
    setBoxes((prev) => {
      const left = remaining(skuId, prev);
      const next = prev.map((lines) => lines.map((line) => ({ ...line })));
      const existing = next[boxIndex]?.find((line) => line.skuId === skuId);
      const quantityToAdd = qty !== undefined ? qty : (left > 0 ? left : 1);
      if (existing) existing.qty += quantityToAdd;
      else {
        next[boxIndex] = [
          ...(next[boxIndex] ?? []),
          newLine(skuId, quantityToAdd),
        ];
      }
      return next;
    });
  }

  function moveLine(fromBox: number, key: string, toBox: number) {
    if (fromBox === toBox) return;
    setBoxes((prev) => {
      const next = prev.map((lines) => lines.map((line) => ({ ...line })));
      const source = next[fromBox] ?? [];
      const index = source.findIndex((line) => line.key === key);
      if (index < 0) return prev;
      const [line] = source.splice(index, 1);
      const dest = next[toBox] ?? [];
      const existing = dest.find((item) => item.skuId === line.skuId);
      if (existing) existing.qty += line.qty;
      else dest.push(line);
      next[toBox] = dest;
      next[fromBox] = source;
      return next;
    });
  }

  function onBoxDrop(boxIndex: number, raw: string) {
    let payload: { skuId?: string; fromBox?: number | null; key?: string } = {};
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      return;
    }
    if (!payload.skuId) return;
    if (payload.fromBox == null) openDropQty(boxIndex, payload.skuId, null);
    else if (payload.key) moveLine(payload.fromBox, payload.key, boxIndex);
  }

  function setLineQty(boxIndex: number, key: string, raw: string) {
    const entered = raw === "" ? 0 : Math.max(0, parseInt(raw, 10) || 0);
    setBoxes((prev) => {
      const line = prev[boxIndex]?.find((item) => item.key === key);
      if (!line) return prev;
      return prev.map((lines, index) =>
        index === boxIndex
          ? lines.map((item) =>
              item.key === key ? { ...item, qty: entered } : item
            )
          : lines
      );
    });
  }

  const issues: string[] = [];
  for (const sku of skus) {
    const left = remaining(sku.skuId);
    if (left > 0) {
      issues.push(
        `${sku.skuName || "SKU"} is short ${left.toLocaleString("en-US")}`
      );
    }
  }
  boxes.forEach((lines, index) => {
    if (!lines.some((line) => line.qty > 0)) {
      issues.push(`Box ${index + 1} is empty`);
    }
  });
  const ready = step === 2 && issues.length === 0;

  function partFromOrderNumber(on: string): number {
    const m = on.trim().match(/-(\d+)$/);
    if (!m) return 1;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }

  async function handlePrint() {
    if (!ready) {
      setError(issues[0] ?? "Assign every SKU before printing.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const totalParts = Math.max(1, groupSize);
      const part = Math.min(partFromOrderNumber(orderNumber), totalParts);
      const payload = {
        order_id: orderId,
        part,
        totalParts,
        layout,
        pageSize: "4x6" as const,
        boxes: boxes.map((lines, index) => ({
          boxNumber: index + 1,
          sizeLabel:
            boxDetails[index]?.sizeLabel === CUSTOM_BOX_SIZE_VALUE
              ? formatCustomBoxSize(
                  boxDetails[index]?.sizeL ?? "",
                  boxDetails[index]?.sizeW ?? "",
                  boxDetails[index]?.sizeH ?? ""
                ) || undefined
              : boxDetails[index]?.sizeLabel || undefined,
          weightLbs:
            Number.parseFloat(boxDetails[index]?.weightLbs ?? "") || undefined,
          lines: lines
            .filter((line) => line.qty > 0)
            .map((line) => {
              const sku = skuById.get(line.skuId);
              return {
                skuId: line.skuId,
                qty: line.qty,
                fromQty: sku ? requiredSkuQty(sku) : line.qty,
              };
            }),
        })),
      };
      const url = scanApiBase?.startsWith("/api/kiosk/")
        ? `${scanApiBase}/packing-slip`
        : scanApiBase?.startsWith("/api/public/")
          ? "/api/public/floor/scan/packing-slip"
          : `/api/orders/${orderId}/actions/generate-packing-slip?part=${part}&totalParts=${totalParts}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(170_000),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Failed to generate packing slip");
      }
      const blob = await res.blob();
      if (!blob.size) throw new Error("Packing slip was empty");
      const objectUrl = URL.createObjectURL(blob);
      // Open print dialog via a hidden iframe — works cross-browser for PDFs
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:none";
      iframe.src = objectUrl;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          // Fallback: open in new tab so user can print manually
          window.open(objectUrl, "_blank");
        }
        setTimeout(() => {
          document.body.removeChild(iframe);
          URL.revokeObjectURL(objectUrl);
        }, 60_000);
      };
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate slip");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
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

        {step === 1 ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="flex overflow-hidden rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setLayout("multiple")}
                className={cn(
                  "flex min-h-14 flex-1 items-center justify-center gap-2 px-3 py-2 text-center text-[14px] font-medium leading-tight",
                  layout === "multiple"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <LayoutGrid className="h-4 w-4 shrink-0" />
                All SKUs in one label
              </button>
              <button
                type="button"
                onClick={() => setLayout("one_per_slip")}
                className={cn(
                  "flex min-h-14 flex-1 items-center justify-center gap-2 border-l border-slate-200 px-3 py-2 text-center text-[14px] font-medium leading-tight",
                  layout === "one_per_slip"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <Square className="h-4 w-4 shrink-0" />
                Each SKU one label
              </button>
            </div>
            <label className="mt-5 flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-2 text-[15px] font-medium text-slate-800">
                <Box className="h-4 w-4 shrink-0 text-slate-500" />
                How many boxes
              </span>
              <input
                type="text"
                inputMode="numeric"
                readOnly
                value={boxCount}
                onClick={() => {
                  replaceBoxCountRef.current = true;
                  setBoxCountKeypadOpen(true);
                }}
                className="h-14 w-28 cursor-pointer rounded-xl border border-slate-200 text-center text-[20px] font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </label>
            <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              SKUs
            </p>
            <div className="grid grid-cols-2 gap-2">
              {skus.map((sku) => (
                <div
                  key={sku.skuId}
                  className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-2"
                >
                  {sku.artworkUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={sku.artworkUrl}
                      alt=""
                      className="h-24 w-24 shrink-0 rounded-lg border border-slate-200 object-contain"
                    />
                  ) : (
                    <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                      <Package className="h-8 w-8 text-slate-300" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-slate-800">
                    {sku.skuName || "SKU"}
                  </span>
                  <span className="shrink-0 text-[14px] font-semibold text-slate-700">
                    {requiredSkuQty(sku).toLocaleString("en-US")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/* Left: SKU list */}
            <div className="panel-scroll w-[40%] shrink-0 border-r border-slate-100 px-3 py-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              SKUs
            </p>
            <div className="flex flex-col gap-2">
              {skus.map((sku) => {
                const left = remaining(sku.skuId);
                return (
                  <button
                    key={sku.skuId}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      const payload = JSON.stringify({ skuId: sku.skuId, fromBox: null });
                      e.dataTransfer.setData("text/plain", payload);
                      e.dataTransfer.setData("application/json", payload);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={(e) => {
                      setBoxMenu({
                        skuId: sku.skuId,
                        fromBox: null,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    className={cn(
                      "flex min-h-14 min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left",
                      left <= 0
                        ? "border-emerald-400 bg-emerald-50"
                        : "border-slate-200 bg-white"
                    )}
                  >
                    {sku.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={sku.artworkUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 object-contain"
                      />
                    ) : (
                      <Package className="h-5 w-5 shrink-0 text-slate-300" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-slate-800">
                      {sku.skuName || "SKU"}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[13px] font-semibold",
                        left <= 0 ? "text-emerald-600" : "text-amber-700"
                      )}
                    >
                      {left < 0
                        ? `+${Math.abs(left).toLocaleString("en-US")} extra`
                        : left === 0
                          ? "Assigned"
                          : `${left.toLocaleString("en-US")} left`}
                    </span>
                  </button>
                );
              })}
            </div>
            </div>{/* end left panel */}
            {/* Right: Boxes */}
            <div className="panel-scroll min-w-0 flex-1 px-4 py-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Boxes
            </p>
            <div className="flex flex-col gap-3">
              {boxes.map((lines, boxIndex) => (
                <div
                  key={boxIndex}
                  data-box-index={boxIndex}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    onBoxDrop(
                      boxIndex,
                      e.dataTransfer.getData("text/plain") ||
                        e.dataTransfer.getData("application/json")
                    );
                  }}
                  className="min-h-36 rounded-xl border-2 border-dashed border-slate-200 p-3"
                >
                  <div className="mb-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <p className="flex-1 text-[13px] font-semibold text-slate-700">
                      Box {boxIndex + 1}
                    </p>
                    {/* Size/weight badge */}
                    {(boxDetails[boxIndex]?.sizeLabel || boxDetails[boxIndex]?.weightLbs) ? (
                      <span className="truncate text-[11px] text-slate-400">
                        {boxDetails[boxIndex]?.sizeLabel === CUSTOM_BOX_SIZE_VALUE
                          ? formatCustomBoxSize(boxDetails[boxIndex]?.sizeL ?? "", boxDetails[boxIndex]?.sizeW ?? "", boxDetails[boxIndex]?.sizeH ?? "") || "Custom"
                          : boxDetails[boxIndex]?.sizeLabel}
                        {boxDetails[boxIndex]?.weightLbs ? ` · ${boxDetails[boxIndex].weightLbs} lbs` : ""}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      title="Box settings"
                      onClick={() => {
                        setSettingsDraft({ ...boxDetails[boxIndex] });
                        setSettingsApplyTo("all");
                        setBoxSettingsOpen(true);
                      }}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Duplicate box"
                      onClick={() => duplicateBox(boxIndex)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    {boxes.length > 1 ? (
                      <button
                        type="button"
                        title="Remove box"
                        onClick={() => removeBox(boxIndex)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  {lines.length === 0 ? (
                    <p className="py-6 text-center text-[13px] text-slate-400">
                      Tap a SKU to add
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {lines.map((line) => {
                        const sku = skuById.get(line.skuId);
                        return (
                          <div
                            key={line.key}
                            draggable
                            onDragStart={(e) => {
                              e.stopPropagation();
                              const payload = JSON.stringify({
                                skuId: line.skuId,
                                fromBox: boxIndex,
                                key: line.key,
                              });
                              e.dataTransfer.setData("text/plain", payload);
                              e.dataTransfer.setData("application/json", payload);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setBoxMenu({
                                skuId: line.skuId,
                                fromBox: boxIndex,
                                key: line.key,
                                x: e.clientX,
                                y: e.clientY,
                              });
                            }}
                            className="flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5"
                          >
                            <span className="min-w-0 flex-1 text-[13px] font-medium text-slate-800">
                              <span className="font-semibold text-slate-400">
                                SKU {skus.findIndex((s) => s.skuId === line.skuId) + 1}:
                              </span>{" "}
                              {sku?.skuName || "SKU"}
                            </span>
                            <input
                              type="text"
                              inputMode="numeric"
                              readOnly
                              value={line.qty.toLocaleString("en-US")}
                              onClick={(e) => {
                                e.stopPropagation();
                                setLineQtyKeypad({ boxIndex, key: line.key });
                                setLineQtyKeypadStr(line.qty.toString());
                                setLineQtyIsDefault(true);
                              }}
                              className="h-10 w-24 cursor-pointer rounded-lg border border-slate-200 text-center text-[14px] font-semibold"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
            </div>{/* end right panel */}
          </div>
        )}

        {boxMenu ? (
          <div
            className="fixed inset-0 z-[80]"
            onClick={() => setBoxMenu(null)}
          >
            <div
              role="menu"
              aria-label="Move to box"
              className="absolute min-w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
              style={{
                left: Math.max(8, Math.min(boxMenu.x, window.innerWidth - 196)),
                top: Math.max(
                  8,
                  Math.min(boxMenu.y, window.innerHeight - (52 + boxes.length * 44))
                ),
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {boxMenu.fromBox == null ? "Add to box" : "Move to"}
              </p>
              {boxes.map((boxLines, index) => {
                const summary = boxLines
                  .filter((l) => l.qty > 0)
                  .map((l) => {
                    const name = skuById.get(l.skuId)?.skuName || "SKU";
                    const short = name.length > 18 ? name.slice(0, 17) + "…" : name;
                    return `${short}: ${l.qty.toLocaleString("en-US")}`;
                  })
                  .join("  ·  ");
                return (
                  <button
                    key={index}
                    type="button"
                    role="menuitem"
                    disabled={boxMenu.fromBox === index}
                    onClick={() => chooseBox(index)}
                    className="flex min-h-11 w-full flex-col items-start justify-center px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-40"
                  >
                    <span className="text-[14px] font-medium text-slate-800">
                      Box {index + 1}
                    </span>
                    {summary ? (
                      <span className="mt-0.5 text-[11px] text-slate-400">
                        {summary}
                      </span>
                    ) : (
                      <span className="mt-0.5 text-[11px] text-slate-300">
                        Empty
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="shrink-0 border-t border-slate-100 px-5 py-4">
          {error ? (
            <p className="mb-3 text-[13px] text-amber-700">{error}</p>
          ) : null}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                if (step === 2) {
                  setStep(1);
                  setError("");
                  return;
                }
                onClose();
              }}
              disabled={busy}
              className="flex-1 rounded-xl border border-slate-200 py-3 text-[14px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {step === 2 ? "Back" : "Cancel"}
            </button>
            {step === 1 ? (
              <button
                type="button"
                onClick={openBoxes}
                className="flex flex-[2] items-center justify-center rounded-xl bg-slate-900 py-3 text-[14px] font-semibold text-white hover:bg-slate-700"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handlePrint()}
                disabled={busy || !ready}
                className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-[14px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4 shrink-0" />
                )}
                {busy ? "Generating…" : "Print"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    {boxCountKeypadOpen ? (
      <ScanNumberKeypad
        variant="integer"
        value={boxCount}
        onInsert={(ch) => {
          const replace = replaceBoxCountRef.current;
          replaceBoxCountRef.current = false;
          setBoxCount((prev) => (replace ? ch : prev + ch));
        }}
        onBackspace={() => {
          if (replaceBoxCountRef.current) {
            replaceBoxCountRef.current = false;
            setBoxCount("");
            return;
          }
          setBoxCount((prev) => prev.slice(0, -1) || "");
        }}
        onSubmit={() => setBoxCountKeypadOpen(false)}
        onClose={() => setBoxCountKeypadOpen(false)}
      />
    ) : null}
    {lineQtyKeypad ? (
      <ScanNumberKeypad
        variant="integer"
        value={lineQtyKeypadStr}
        onInsert={(ch) => {
          if (lineQtyIsDefault) {
            setLineQtyIsDefault(false);
            setLineQtyKeypadStr(ch === "0" ? "" : ch);
          } else {
            setLineQtyKeypadStr((prev) => (ch === "0" && prev === "" ? "" : prev + ch));
          }
        }}
        onBackspace={() => {
          if (lineQtyIsDefault) {
            setLineQtyIsDefault(false);
            setLineQtyKeypadStr("");
          } else {
            setLineQtyKeypadStr((prev) => prev.slice(0, -1));
          }
        }}
        onSubmit={() => {
          if (lineQtyKeypad) {
            setLineQty(lineQtyKeypad.boxIndex, lineQtyKeypad.key, lineQtyKeypadStr || "0");
          }
          setLineQtyKeypad(null);
        }}
        onClose={() => setLineQtyKeypad(null)}
      />
    ) : null}
    {dropQtyPending ? (
      <ScanNumberKeypad
        variant="integer"
        value={dropQtyStr}
        onInsert={(ch) => {
          if (dropQtyIsDefault) {
            setDropQtyIsDefault(false);
            setDropQtyStr(ch === "0" ? "" : ch);
          } else {
            setDropQtyStr((prev) => (ch === "0" && prev === "" ? "" : prev + ch));
          }
        }}
        onBackspace={() => {
          if (dropQtyIsDefault) {
            setDropQtyIsDefault(false);
            setDropQtyStr("");
          } else {
            setDropQtyStr((prev) => prev.slice(0, -1));
          }
        }}
        onSubmit={commitDropQty}
        onClose={() => setDropQtyPending(null)}
      />
    ) : null}

    {/* ── Box Settings Sheet ── */}
    {boxSettingsOpen ? (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Close settings"
          className="absolute inset-0 bg-black/40"
          onClick={() => setBoxSettingsOpen(false)}
        />
        <div className="relative z-10 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-slate-900">Box Settings</h3>
            <button
              type="button"
              onClick={() => setBoxSettingsOpen(false)}
              className="rounded-full p-1 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Apply to */}
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Apply to
          </p>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setSettingsApplyTo("all")}
              className={cn(
                "flex-1 rounded-lg border py-2 text-[13px] font-medium",
                settingsApplyTo === "all"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              All boxes
            </button>
            <button
              type="button"
              onClick={() =>
                setSettingsApplyTo((prev) => (prev === "all" ? [] : prev))
              }
              className={cn(
                "flex-1 rounded-lg border py-2 text-[13px] font-medium",
                Array.isArray(settingsApplyTo)
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              Select boxes
            </button>
          </div>
          {Array.isArray(settingsApplyTo) ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {boxes.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleSettingsBox(i)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-[13px] font-medium",
                    settingsApplyTo.includes(i)
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  )}
                >
                  Box {i + 1}
                </button>
              ))}
            </div>
          ) : null}

          {/* Box Size */}
          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Box size
            </span>
            <select
              value={settingsDraft.sizeLabel}
              onChange={(e) =>
                setSettingsDraft((d) => ({ ...d, sizeLabel: e.target.value, sizeL: "", sizeW: "", sizeH: "" }))
              }
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] font-medium text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Select size</option>
              {FULFILLMENT_BOX_SIZE_PRESETS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
              <option value={CUSTOM_BOX_SIZE_VALUE}>Custom…</option>
            </select>
          </label>

          {settingsDraft.sizeLabel === CUSTOM_BOX_SIZE_VALUE ? (
            <div className="mb-3 grid grid-cols-3 gap-2">
              {(["sizeL", "sizeW", "sizeH"] as const).map((field, idx) => (
                <label key={field} className="min-w-0">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {["Length", "Width", "Height"][idx]} (in)
                  </span>
                  <input
                    type="text"
                    readOnly
                    value={settingsDraft[field]}
                    placeholder="Tap"
                    onClick={() => setSettingsDimKeypad(field)}
                    className="h-10 w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-2 text-center text-[13px] font-semibold text-slate-800 placeholder:font-normal placeholder:text-slate-400"
                  />
                </label>
              ))}
            </div>
          ) : null}

          {/* Weight */}
          <label className="mb-5 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Weight (lbs)
            </span>
            <input
              type="text"
              readOnly
              value={settingsDraft.weightLbs}
              placeholder="Tap to enter"
              onClick={() => setSettingsWeightKeypad(true)}
              className="h-11 w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 text-center text-[14px] font-semibold text-slate-800 placeholder:font-normal placeholder:text-slate-400"
            />
          </label>

          <button
            type="button"
            onClick={applyBoxSettings}
            disabled={Array.isArray(settingsApplyTo) && settingsApplyTo.length === 0}
            className="w-full rounded-xl bg-slate-900 py-3 text-[14px] font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      </div>
    ) : null}

    {settingsWeightKeypad ? (
      <ScanNumberKeypad
        variant="decimal"
        zIndex={70}
        value={settingsDraft.weightLbs}
        onInsert={(ch) =>
          setSettingsDraft((d) => {
            if (ch === "." && d.weightLbs.includes(".")) return d;
            return { ...d, weightLbs: d.weightLbs + ch };
          })
        }
        onBackspace={() =>
          setSettingsDraft((d) => ({ ...d, weightLbs: d.weightLbs.slice(0, -1) }))
        }
        onSubmit={() => setSettingsWeightKeypad(false)}
        onClose={() => setSettingsWeightKeypad(false)}
      />
    ) : null}
    {settingsDimKeypad ? (
      <ScanNumberKeypad
        variant="decimal"
        zIndex={70}
        value={settingsDraft[settingsDimKeypad]}
        onInsert={(ch) =>
          setSettingsDraft((d) => {
            const cur = d[settingsDimKeypad!];
            if (ch === "." && cur.includes(".")) return d;
            return { ...d, [settingsDimKeypad!]: cur + ch };
          })
        }
        onBackspace={() =>
          setSettingsDraft((d) => ({
            ...d,
            [settingsDimKeypad!]: d[settingsDimKeypad!].slice(0, -1),
          }))
        }
        onSubmit={() => setSettingsDimKeypad(null)}
        onClose={() => setSettingsDimKeypad(null)}
      />
    ) : null}
    </>
  );
}

export function PackingSlipConfigModal(props: Props) {
  if (props.sender) return <SenderPackingSlipWizard {...props} />;
  return <PackingSlipConfigForm {...props} />;
}
