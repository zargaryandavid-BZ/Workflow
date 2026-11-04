"use client";

import { useRef, useState } from "react";
import { Box, Check, Copy, LayoutGrid, Loader2, Package, Printer, Settings, Square, Trash2, X } from "lucide-react";
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
  /** Set on the no-login scan page so print does not use the staff API. */
  scanApiBase?: string;
  onClose: () => void;
}

type SlipLine = { key: string; skuId: string; qty: number };

/** Most used box sizes, offered as one-tap buttons next to the size list. */
const QUICK_BOX_SIZES = ["18×12×12 in", "10×10×10 in"] as const;
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

function PackingSlipWizard({
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
  const allSkus: SkuSlipConfig[] =
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

  // Step 1: which SKUs go on this slip. All are ticked by default.
  const [excludedSkuIds, setExcludedSkuIds] = useState<Set<string>>(new Set());
  const skus = allSkus.filter((sku) => !excludedSkuIds.has(sku.skuId));
  /** Printed "SKU N" stays the order's own SKU number when some are unticked. */
  const skuNumber = (skuId: string) =>
    allSkus.findIndex((sku) => sku.skuId === skuId) + 1;

  /** 1 SKUs & box count → 2 box size/weight → 3 SKU distribution per box. */
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [layout, setLayout] = useState<PackingSlipLayout>("multiple");
  const [boxCount, setBoxCount] = useState("1");
  const [boxCountKeypadOpen, setBoxCountKeypadOpen] = useState(false);
  const replaceBoxCountRef = useRef(true);
  const [boxes, setBoxes] = useState<SlipLine[][]>([]);
  // Pallet slip starts unchecked. Picking a new box qty clears a manual choice.
  const [palletOverride, setPalletOverride] = useState<boolean | null>(null);
  const [palletForCount, setPalletForCount] = useState(boxCount);
  if (palletForCount !== boxCount) {
    setPalletForCount(boxCount);
    setPalletOverride(null);
  }
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
    /** Several ticked SKUs: drop all of them, each with its remaining qty. */
    skuIds?: string[];
    x: number;
    y: number;
  } | null>(null);
  /** SKUs ticked for a one-step "drop all into one box". */
  const [selectedSkuIds, setSelectedSkuIds] = useState<Set<string>>(new Set());
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

  function toggleSelectedSku(skuId: string) {
    setSelectedSkuIds((prev) => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId);
      else next.add(skuId);
      return next;
    });
  }

  /** Bulk drop: every SKU goes in with what is left, no qty popup. */
  function placeManyFromPool(boxIndex: number, skuIds: string[]) {
    setBoxes((prev) => {
      const next = prev.map((lines) => lines.map((line) => ({ ...line })));
      for (const skuId of skuIds) {
        const left = remaining(skuId, next);
        if (left <= 0) continue;
        const existing = next[boxIndex]?.find((line) => line.skuId === skuId);
        if (existing) existing.qty += left;
        else next[boxIndex] = [...(next[boxIndex] ?? []), newLine(skuId, left)];
      }
      return next;
    });
    setSelectedSkuIds(new Set());
  }

  function chooseBox(boxIndex: number) {
    if (!boxMenu) return;
    if (boxMenu.skuIds?.length) placeManyFromPool(boxIndex, boxMenu.skuIds);
    else if (boxMenu.fromBox == null) openDropQty(boxIndex, boxMenu.skuId, null);
    else if (boxMenu.key) moveLine(boxMenu.fromBox, boxMenu.key, boxIndex);
    setBoxMenu(null);
  }

  const skuById = new Map(skus.map((sku) => [sku.skuId, sku]));

  /** Box numbers (1-based) that hold some of this SKU. */
  function boxesHolding(skuId: string): number[] {
    return boxes.flatMap((lines, index) =>
      lines.some((line) => line.skuId === skuId && line.qty > 0) ? [index + 1] : []
    );
  }

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
    setSettingsApplyTo("all");
    setSettingsDraft({ sizeLabel: "", sizeL: "", sizeW: "", sizeH: "", weightLbs: "" });
    setStep(2);
  }

  /** Step 2 → 3: keep what is in the form for the chosen boxes. */
  function finishBoxSettings() {
    if (!Array.isArray(settingsApplyTo) || settingsApplyTo.length > 0) {
      applyBoxSettings();
    }
    setStep(3);
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

  /** Take a SKU line out of a box; its qty goes back to "left". */
  function removeLine(boxIndex: number, key: string) {
    setBoxes((prev) =>
      prev.map((lines, index) =>
        index === boxIndex ? lines.filter((line) => line.key !== key) : lines
      )
    );
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
    let payload: {
      skuId?: string;
      skuIds?: string[];
      fromBox?: number | null;
      key?: string;
    } = {};
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      return;
    }
    if (payload.skuIds?.length) {
      placeManyFromPool(boxIndex, payload.skuIds);
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
  const palletSlip = palletOverride ?? false;
  const palletCheckbox = (
    <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-slate-700">
      <input
        type="checkbox"
        checked={palletSlip}
        onChange={(e) => setPalletOverride(e.target.checked)}
        className="h-5 w-5 shrink-0 cursor-pointer rounded border-slate-300 accent-slate-900"
      />
      <span>
        <span className="font-medium text-slate-800">Pallet slip</span>
        <span className="text-slate-400">
          {" "}
          — one extra slip listing every box
        </span>
      </span>
    </label>
  );

  // Print is always allowed — `issues` is only a heads-up shown above the
  // buttons (short SKUs / empty boxes), never a blocker.

  function partFromOrderNumber(on: string): number {
    const m = on.trim().match(/-(\d+)$/);
    if (!m) return 1;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }

  async function handlePrint() {
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
        palletSlip,
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
      // 1. Download the PDF
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `packing-slip-${orderNumber.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 2. Open print dialog via hidden iframe
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:none";
      iframe.src = objectUrl;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
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

  // Same fields in step 2 and in the per-box gear popup on step 3.
  const boxSettingsFields = (
    <>
          {/* Apply to */}
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Apply to
          </p>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setSettingsApplyTo("all")}
              className={cn(
                "h-11 flex-1 rounded-lg border text-[13px] font-medium",
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
                "h-11 flex-1 rounded-lg border text-[13px] font-medium",
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
                    "h-11 rounded-lg border px-4 text-[13px] font-medium",
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

          {/* Box size | Weight (lbs) on one row */}
          <div className="mb-3 flex flex-wrap items-end gap-3">
            {/* Box Size */}
            <label className="block min-w-[10rem] flex-[1.6]">
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
            {/* Most used sizes: one tap */}
            <div className="flex shrink-0 gap-2" role="group" aria-label="Most used box sizes">
              {QUICK_BOX_SIZES.map((size) => {
                const on = settingsDraft.sizeLabel === size;
                return (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setSettingsDraft((d) => ({ ...d, sizeLabel: size, sizeL: "", sizeW: "", sizeH: "" }))
                    }
                    className={cn(
                      "h-11 rounded-lg border px-3 text-[13px] font-semibold tabular-nums",
                      on
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    {size.replace(" in", "")}
                  </button>
                );
              })}
            </div>
            {/* Weight */}
            <label className="block min-w-[7rem] flex-1">
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
          </div>

          {settingsDraft.sizeLabel === CUSTOM_BOX_SIZE_VALUE ? (
            <div className="mb-5 grid grid-cols-3 gap-2">
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
                    className="h-11 w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-2 text-center text-[13px] font-semibold text-slate-800 placeholder:font-normal placeholder:text-slate-400"
                  />
                </label>
              ))}
            </div>
          ) : null}
          {settingsDraft.sizeLabel === CUSTOM_BOX_SIZE_VALUE ? null : <div className="mb-2" />}
    </>
  );

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Printer className="h-4 w-4 text-slate-500" />
            <h2 className="text-[15px] font-semibold text-slate-900">
              {step === 2 ? "Box Settings" : "Print Packing Slip"}
            </h2>
            <span className="text-[12px] font-medium text-slate-400">
              Step {step} of 3
            </span>
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
            <div className="mt-4">{palletCheckbox}</div>
            <label className="mb-2 mt-5 flex w-fit cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <input
                type="checkbox"
                checked={excludedSkuIds.size === 0}
                ref={(el) => {
                  if (el) {
                    el.indeterminate =
                      excludedSkuIds.size > 0 && excludedSkuIds.size < allSkus.length;
                  }
                }}
                onChange={() =>
                  setExcludedSkuIds(
                    excludedSkuIds.size === 0
                      ? new Set(allSkus.map((sku) => sku.skuId))
                      : new Set()
                  )
                }
                className="h-5 w-5 rounded border-slate-300 accent-slate-900 text-slate-900 focus:ring-slate-400"
                aria-label="All SKUs"
              />
              All SKUs
              <span className="font-medium normal-case tracking-normal text-slate-400">
                ({skus.length} of {allSkus.length})
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {allSkus.map((sku) => {
                const included = !excludedSkuIds.has(sku.skuId);
                return (
                <label
                  key={sku.skuId}
                  className={cn(
                    "flex min-w-0 cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2",
                    included
                      ? "border-slate-200 bg-white"
                      : "border-slate-200 bg-slate-50 opacity-60"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={included}
                    onChange={() =>
                      setExcludedSkuIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(sku.skuId)) next.delete(sku.skuId);
                        else next.add(sku.skuId);
                        return next;
                      })
                    }
                    className="h-5 w-5 shrink-0 rounded border-slate-300 accent-slate-900 text-slate-900 focus:ring-slate-400"
                    aria-label={`Include ${sku.skuName || "SKU"}`}
                  />
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
                </label>
                );
              })}
            </div>
          </div>
        ) : step === 2 ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <p className="mb-4 text-[13px] text-slate-500">
              Set the size and weight printed on each box slip. You can change
              a single box later with its gear icon.
            </p>
            {boxSettingsFields}
            {Array.isArray(settingsApplyTo) ? (
              <button
                type="button"
                onClick={() => {
                  applyBoxSettings();
                  setSettingsApplyTo([]);
                }}
                disabled={settingsApplyTo.length === 0}
                className="mb-4 h-11 w-full rounded-lg border border-slate-900 text-[14px] font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-40"
              >
                Apply to selected boxes
              </button>
            ) : null}
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {boxDetails.map((details, i) => {
                const size =
                  details.sizeLabel === CUSTOM_BOX_SIZE_VALUE
                    ? formatCustomBoxSize(details.sizeL, details.sizeW, details.sizeH)
                    : details.sizeLabel;
                return (
                  <li key={i} className="flex h-11 items-center justify-between gap-3 px-3 text-[13px]">
                    <span className="font-medium text-slate-800">Box {i + 1}</span>
                    <span className={size || details.weightLbs ? "text-slate-700" : "text-slate-400"}>
                      {[size, details.weightLbs ? `${details.weightLbs} lbs` : ""]
                        .filter(Boolean)
                        .join(" · ") || "No size / weight yet"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/* Left: SKU list */}
            <div className="panel-scroll w-[40%] shrink-0 border-r border-slate-100 px-3 py-4">
            {(() => {
              const open = skus.filter((sku) => remaining(sku.skuId) > 0);
              const allTicked =
                open.length > 0 && open.every((sku) => selectedSkuIds.has(sku.skuId));
              const ticked = [...selectedSkuIds];
              return (
                <div className="mb-2 flex min-h-9 flex-wrap items-center justify-between gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <input
                      type="checkbox"
                      checked={allTicked}
                      disabled={open.length === 0}
                      onChange={() =>
                        setSelectedSkuIds(
                          allTicked ? new Set() : new Set(open.map((sku) => sku.skuId))
                        )
                      }
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                      aria-label="Select all SKUs with quantity left"
                    />
                    SKUs
                  </label>
                  {ticked.length > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedSkuIds(new Set())}
                        className="h-8 rounded-lg px-2 text-[12px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={(e) =>
                          setBoxMenu({
                            skuId: ticked[0]!,
                            skuIds: ticked,
                            fromBox: null,
                            x: e.clientX,
                            y: e.clientY,
                          })
                        }
                        className="h-8 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white hover:bg-slate-700"
                      >
                        Add {ticked.length} to box
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })()}
            <div className="flex flex-col gap-2">
              {skus.map((sku) => {
                const left = remaining(sku.skuId);
                const inBoxes = boxesHolding(sku.skuId);
                const ticked = selectedSkuIds.has(sku.skuId);
                return (
                  <div
                    key={sku.skuId}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => {
                      // Dragging a ticked SKU carries every ticked SKU along.
                      const many =
                        ticked && selectedSkuIds.size > 1 ? [...selectedSkuIds] : null;
                      const payload = JSON.stringify(
                        many
                          ? { skuId: sku.skuId, skuIds: many, fromBox: null }
                          : { skuId: sku.skuId, fromBox: null }
                      );
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
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setBoxMenu({
                        skuId: sku.skuId,
                        fromBox: null,
                        x: rect.left + rect.width / 2,
                        y: rect.bottom,
                      });
                    }}
                    className={cn(
                      "flex min-h-14 min-w-0 cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 text-left",
                      ticked
                        ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900"
                        : left <= 0
                          ? "border-emerald-400 bg-emerald-50"
                          : "border-slate-200 bg-white"
                    )}
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={ticked}
                      aria-label={`Select ${sku.skuName || "SKU"}`}
                      disabled={left <= 0 && !ticked}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectedSku(sku.skuId);
                      }}
                      className={cn(
                        "-m-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg disabled:opacity-30"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded border",
                          ticked
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-300 bg-white"
                        )}
                      >
                        {ticked ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                    </button>
                    {sku.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={sku.artworkUrl}
                        alt=""
                        className="h-[52px] w-[52px] shrink-0 rounded-lg border border-slate-200 object-contain"
                      />
                    ) : (
                      <Package className="h-6 w-6 shrink-0 text-slate-300" />
                    )}
                    <span
                      className="line-clamp-2 min-w-0 flex-1 break-words text-[14px] font-medium leading-snug text-slate-800"
                      title={sku.skuName || "SKU"}
                    >
                      {sku.skuName || "SKU"}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                      {left !== 0 ? (
                        <span
                          className={cn(
                            "text-[13px] font-semibold",
                            left < 0 ? "text-emerald-600" : "text-amber-700"
                          )}
                        >
                          {left < 0
                            ? `+${Math.abs(left).toLocaleString("en-US")} extra`
                            : `${left.toLocaleString("en-US")} left`}
                        </span>
                      ) : null}
                      {inBoxes.length > 0 ? (
                        <span
                          className={cn(
                            "rounded-md bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-700",
                            left === 0 ? "text-[13px]" : "text-[11px]"
                          )}
                        >
                          {inBoxes.length === 1 ? "Box" : "Boxes"} {inBoxes.join(", ")}
                        </span>
                      ) : null}
                    </span>
                  </div>
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
                                SKU {skuNumber(line.skuId)}:
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
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeLine(boxIndex, line.key);
                              }}
                              title="Remove from box"
                              aria-label={`Remove ${sku?.skuName || "SKU"} from Box ${boxIndex + 1}`}
                              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <X className="h-4 w-4" />
                            </button>
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
              className="absolute w-64 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
              style={(() => {
                const W = 256; // matches w-64
                const itemH = 60; // each box row (name + summary)
                const H = 28 + boxes.length * itemH; // header + rows
                const maxH = Math.min(H, window.innerHeight - 24);
                const left = Math.max(8, Math.min(boxMenu.x, window.innerWidth - W - 8));
                const top = Math.max(8, Math.min(boxMenu.y, window.innerHeight - maxH - 8));
                return { left, top, maxHeight: maxH, overflowY: "auto" };
              })()}
              onClick={(event) => event.stopPropagation()}
            >
              <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {boxMenu.skuIds?.length
                  ? `Add ${boxMenu.skuIds.length} SKUs to box`
                  : boxMenu.fromBox == null
                    ? "Add to box"
                    : "Move to"}
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
          {step === 3 ? <div className="mb-3">{palletCheckbox}</div> : null}
          {!error && step === 3 && issues.length > 0 ? (
            <p className="mb-3 text-[12px] text-slate-500">
              Heads up: {issues[0]}
              {issues.length > 1 ? ` (+${issues.length - 1} more)` : ""} — you
              can still print.
            </p>
          ) : null}
          {error ? (
            <p className="mb-3 text-[13px] text-amber-700">{error}</p>
          ) : null}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                if (step > 1) {
                  setStep(step === 3 ? 2 : 1);
                  setError("");
                  return;
                }
                onClose();
              }}
              disabled={busy}
              className="h-11 flex-1 rounded-xl border border-slate-200 text-[14px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {step > 1 ? "Back" : "Cancel"}
            </button>
            {step === 1 ? (
              <button
                type="button"
                onClick={openBoxes}
                disabled={skus.length === 0}
                className="flex h-11 flex-[2] items-center justify-center rounded-xl bg-slate-900 text-[14px] font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {skus.length === 0 ? "Tick at least one SKU" : "Next"}
              </button>
            ) : step === 2 ? (
              <button
                type="button"
                onClick={finishBoxSettings}
                className="flex h-11 flex-[2] items-center justify-center rounded-xl bg-slate-900 text-[14px] font-semibold text-white hover:bg-slate-700"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handlePrint()}
                disabled={busy}
                className="flex h-11 flex-[2] items-center justify-center gap-2 rounded-xl bg-slate-900 text-[14px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
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
        title="How many boxes"
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
        title={(() => {
          const line = boxes[lineQtyKeypad.boxIndex]?.find(
            (item) => item.key === lineQtyKeypad.key
          );
          const name = line ? skuById.get(line.skuId)?.skuName || "SKU" : "SKU";
          return `${name} · qty in Box ${lineQtyKeypad.boxIndex + 1}`;
        })()}
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
        title={`${skuById.get(dropQtyPending.skuId)?.skuName || "SKU"} · qty in Box ${
          dropQtyPending.boxIndex + 1
        }`}
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

          {boxSettingsFields}

          <button
            type="button"
            onClick={applyBoxSettings}
            disabled={Array.isArray(settingsApplyTo) && settingsApplyTo.length === 0}
            className="h-11 w-full rounded-lg bg-slate-900 text-[14px] font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
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
        title="Weight (lbs)"
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
        title={`${{ sizeL: "Length", sizeW: "Width", sizeH: "Height" }[settingsDimKeypad]} (in)`}
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

/** Receiver and Sender share one flow: boxes → assign SKUs → 4×6 box slips. */
export function PackingSlipConfigModal(props: Props) {
  return <PackingSlipWizard {...props} />;
}
