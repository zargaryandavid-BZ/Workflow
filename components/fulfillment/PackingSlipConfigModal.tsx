"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Box, LayoutGrid, Loader2, Package, Printer, Square, X } from "lucide-react";
import { ScanNumberKeypad } from "@/components/fulfillment/ScanNumberKeypad";
import {
  CUSTOM_BOX_SIZE_VALUE,
  FULFILLMENT_BOX_SIZE_PRESETS,
  formatCustomBoxSize,
} from "@/lib/box-size-presets";
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
  // Each Final Production page is one SKU. "3,200 QTY each" applies to every
  // page. A single specs.skus row often stores the order total, so it must
  // not replace the other pages.
  const ownQtyCount = skuList.filter(
    (img) => typeof img.qty === "number" && img.qty > 0
  ).length;
  const eachQty =
    qtyPerSku && qtyPerSku > 0
      ? qtyPerSku
      : ownQtyCount === skuList.length
        ? null
        : deriveQty(totalQty, null, skuList.length);
  const skus: SkuSlipConfig[] =
    skuList.length > 0
      ? skuList.map((img) => {
          const qty =
            ownQtyCount === skuList.length &&
            typeof img.qty === "number" &&
            img.qty > 0
              ? img.qty
              : eachQty;
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
  const [boxes, setBoxes] = useState<SlipLine[][]>([]);
  const [boxDetails, setBoxDetails] = useState<SlipBoxDetails[]>([]);
  const [boxKeypadTarget, setBoxKeypadTarget] = useState<{
    boxIndex: number;
    field: BoxKeypadField;
  } | null>(null);
  const [picked, setPicked] = useState<{
    skuId: string;
    fromBox: number | null;
    key?: string;
  } | null>(null);
  const [boxMenu, setBoxMenu] = useState<{
    skuId: string;
    fromBox: number | null;
    key?: string;
    x: number;
    y: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pressRef = useRef<{
    timer: number;
    x: number;
    y: number;
  } | null>(null);
  const ignoreClickRef = useRef(false);

  useEffect(() => {
    return () => {
      if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    };
  }, []);

  function cancelPress() {
    if (!pressRef.current) return;
    window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  }

  function startBoxPress(
    event: ReactPointerEvent<HTMLElement>,
    target: { skuId: string; fromBox: number | null; key?: string }
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.pointerType !== "mouse") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    cancelPress();
    const x = event.clientX;
    const y = event.clientY;
    const timer = window.setTimeout(() => {
      ignoreClickRef.current = true;
      pressRef.current = null;
      setPicked(null);
      setBoxMenu({ ...target, x, y });
    }, 450);
    pressRef.current = { timer, x, y };
  }

  function moveBoxPress(event: ReactPointerEvent<HTMLElement>) {
    const press = pressRef.current;
    if (!press) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) {
      cancelPress();
    }
  }

  function chooseBox(boxIndex: number) {
    if (!boxMenu) return;
    if (boxMenu.fromBox == null) placeFromPool(boxIndex, boxMenu.skuId);
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
    setPicked(null);
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

  function placeFromPool(boxIndex: number, skuId: string) {
    setBoxes((prev) => {
      const left = remaining(skuId, prev);
      const next = prev.map((lines) => lines.map((line) => ({ ...line })));
      const existing = next[boxIndex]?.find((line) => line.skuId === skuId);
      const quantityToAdd = left > 0 ? left : 1;
      if (existing) existing.qty += quantityToAdd;
      else {
        next[boxIndex] = [
          ...(next[boxIndex] ?? []),
          newLine(skuId, quantityToAdd),
        ];
      }
      return next;
    });
    setPicked(null);
  }

  function moveLine(fromBox: number, key: string, toBox: number) {
    if (fromBox === toBox) {
      setPicked(null);
      return;
    }
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
    setPicked(null);
  }

  function onBoxDrop(boxIndex: number, raw: string) {
    let payload: { skuId?: string; fromBox?: number | null; key?: string } = {};
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      return;
    }
    if (!payload.skuId) return;
    if (payload.fromBox == null) placeFromPool(boxIndex, payload.skuId);
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
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `packing-slip-${orderNumber.replace(/[^a-zA-Z0-9._-]/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      const w = window.open(objectUrl);
      w?.addEventListener("load", () => w.print());
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
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
      onClick={onClose}
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
                type="number"
                min="1"
                inputMode="numeric"
                value={boxCount}
                onChange={(e) => setBoxCount(e.target.value)}
                className="h-14 w-28 rounded-xl border border-slate-200 text-center text-[20px] font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
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
                      className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 object-contain"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                      <Package className="h-4 w-4 text-slate-300" />
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
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              SKU list
            </p>
            <div className="mb-4 grid grid-cols-2 gap-2">
              {skus.map((sku) => {
                const left = remaining(sku.skuId);
                const active = picked?.skuId === sku.skuId && picked.fromBox == null;
                return (
                  <button
                    key={sku.skuId}
                    type="button"
                    draggable
                    onContextMenu={(e) => e.preventDefault()}
                    onPointerDown={(e) => {
                      if (e.pointerType !== "mouse") e.currentTarget.draggable = false;
                      startBoxPress(e, { skuId: sku.skuId, fromBox: null });
                    }}
                    onPointerMove={moveBoxPress}
                    onPointerUp={cancelPress}
                    onPointerCancel={cancelPress}
                    onDragStart={(e) => {
                      cancelPress();
                      const payload = JSON.stringify({
                        skuId: sku.skuId,
                        fromBox: null,
                      });
                      e.dataTransfer.setData("text/plain", payload);
                      e.dataTransfer.setData("application/json", payload);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => {
                      if (ignoreClickRef.current) {
                        ignoreClickRef.current = false;
                        return;
                      }
                      setBoxMenu(null);
                      setPicked(
                        active ? null : { skuId: sku.skuId, fromBox: null }
                      );
                    }}
                    className={cn(
                      "flex min-h-14 min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left",
                      active
                        ? "border-blue-500 bg-blue-50"
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
                        left < 0
                          ? "text-blue-700"
                          : left === 0
                            ? "text-emerald-600"
                            : "text-amber-700"
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

            <div
              className={cn(
                "grid gap-3",
                boxes.length > 1 ? "sm:grid-cols-2" : "grid-cols-1"
              )}
            >
              {boxes.map((lines, boxIndex) => (
                <div
                  key={boxIndex}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    onBoxDrop(
                      boxIndex,
                      e.dataTransfer.getData("text/plain") ||
                        e.dataTransfer.getData("application/json")
                    );
                  }}
                  onClick={() => {
                    if (!picked) return;
                    if (picked.fromBox == null) placeFromPool(boxIndex, picked.skuId);
                    else if (picked.key) moveLine(picked.fromBox, picked.key, boxIndex);
                  }}
                  className={cn(
                    "min-h-36 rounded-xl border-2 border-dashed p-3",
                    picked ? "border-blue-400 bg-blue-50/40" : "border-slate-200"
                  )}
                >
                  <p className="mb-2 text-[13px] font-semibold text-slate-700">
                    Box {boxIndex + 1}
                  </p>
                  <div
                    className="mb-3 grid grid-cols-2 gap-2"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <label className="min-w-0">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Box size
                      </span>
                      <select
                        value={boxDetails[boxIndex]?.sizeLabel ?? ""}
                        onChange={(event) =>
                          updateBoxDetails(boxIndex, {
                            sizeLabel: event.target.value,
                          })
                        }
                        className="h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] font-medium text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      >
                        <option value="">Select size</option>
                        {FULFILLMENT_BOX_SIZE_PRESETS.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                        <option value={CUSTOM_BOX_SIZE_VALUE}>Custom…</option>
                      </select>
                    </label>
                    <label className="min-w-0">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Weight (lbs)
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        readOnly
                        value={boxDetails[boxIndex]?.weightLbs ?? ""}
                        placeholder="Tap to enter"
                        onFocus={() =>
                          setBoxKeypadTarget({
                            boxIndex,
                            field: "weightLbs",
                          })
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          setBoxKeypadTarget({
                            boxIndex,
                            field: "weightLbs",
                          });
                        }}
                        className="h-11 w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-2 text-right text-[14px] font-semibold text-slate-800 placeholder:text-left placeholder:font-normal placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      />
                    </label>
                    {boxDetails[boxIndex]?.sizeLabel ===
                    CUSTOM_BOX_SIZE_VALUE ? (
                      <div className="col-span-2 grid grid-cols-3 gap-2">
                        {(
                          [
                            ["sizeL", "Length"],
                            ["sizeW", "Width"],
                            ["sizeH", "Height"],
                          ] as const
                        ).map(([field, label]) => (
                          <label key={field} className="min-w-0">
                            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              {label} (in)
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              readOnly
                              value={boxDetails[boxIndex]?.[field] ?? ""}
                              placeholder="Tap"
                              onFocus={() =>
                                setBoxKeypadTarget({ boxIndex, field })
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                setBoxKeypadTarget({ boxIndex, field });
                              }}
                              className="h-10 w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-2 text-right text-[13px] font-semibold text-slate-800 placeholder:text-left placeholder:font-normal placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {lines.length === 0 ? (
                    <p className="py-6 text-center text-[13px] text-slate-400">
                      {picked ? "Tap to place" : "Drop a SKU here"}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {lines.map((line) => {
                        const sku = skuById.get(line.skuId);
                        const active = picked?.key === line.key;
                        return (
                          <div
                            key={line.key}
                            draggable
                            onContextMenu={(e) => e.preventDefault()}
                            onPointerDown={(e) => {
                              if (e.pointerType !== "mouse") e.currentTarget.draggable = false;
                              startBoxPress(e, {
                                skuId: line.skuId,
                                fromBox: boxIndex,
                                key: line.key,
                              });
                            }}
                            onPointerMove={moveBoxPress}
                            onPointerUp={cancelPress}
                            onPointerCancel={cancelPress}
                            onDragStart={(e) => {
                              e.stopPropagation();
                              cancelPress();
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
                              if (ignoreClickRef.current) {
                                ignoreClickRef.current = false;
                                return;
                              }
                              setBoxMenu(null);
                              setPicked(
                                active
                                  ? null
                                  : {
                                      skuId: line.skuId,
                                      fromBox: boxIndex,
                                      key: line.key,
                                    }
                              );
                            }}
                            className={cn(
                              "flex min-h-12 items-center gap-2 rounded-lg border bg-white px-2 py-1.5",
                              active ? "border-blue-500" : "border-slate-200"
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">
                              {sku?.skuName || "SKU"}
                            </span>
                            <input
                              type="number"
                              min="1"
                              inputMode="numeric"
                              value={line.qty}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                setLineQty(boxIndex, line.key, e.target.value)
                              }
                              className="h-10 w-24 rounded-lg border border-slate-200 text-right text-[14px] font-semibold"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {boxMenu ? (
          <div
            className="fixed inset-0 z-[80]"
            onClick={() => {
              if (ignoreClickRef.current) {
                ignoreClickRef.current = false;
                return;
              }
              setBoxMenu(null);
            }}
          >
            <div
              role="menu"
              aria-label="Move to box"
              className="absolute min-w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
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
                Move to
              </p>
              {boxes.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  role="menuitem"
                  disabled={boxMenu.fromBox === index}
                  onClick={() => {
                    if (ignoreClickRef.current) {
                      ignoreClickRef.current = false;
                      return;
                    }
                    chooseBox(index);
                  }}
                  className="flex min-h-11 w-full items-center px-3 text-left text-[14px] font-medium text-slate-800 hover:bg-slate-50 disabled:text-slate-300"
                >
                  Box {index + 1}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="shrink-0 border-t border-slate-100 px-5 py-4">
          {(error || (step === 2 && issues.length > 0)) && (
            <p className="mb-3 text-[13px] text-amber-700">
              {error || issues[0]}
            </p>
          )}
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
    {boxKeypadTarget ? (
      <ScanNumberKeypad
        variant="decimal"
        value={
          boxDetails[boxKeypadTarget.boxIndex]?.[boxKeypadTarget.field] ?? ""
        }
        onInsert={(character) => {
          const current =
            boxDetails[boxKeypadTarget.boxIndex]?.[boxKeypadTarget.field] ?? "";
          if (character === "." && current.includes(".")) return;
          updateBoxDetails(boxKeypadTarget.boxIndex, {
            [boxKeypadTarget.field]: `${current}${character}`,
          });
        }}
        onBackspace={() => {
          const current =
            boxDetails[boxKeypadTarget.boxIndex]?.[boxKeypadTarget.field] ?? "";
          updateBoxDetails(boxKeypadTarget.boxIndex, {
            [boxKeypadTarget.field]: current.slice(0, -1),
          });
        }}
        onSubmit={() => setBoxKeypadTarget(null)}
        onClose={() => setBoxKeypadTarget(null)}
      />
    ) : null}
    </>
  );
}

export function PackingSlipConfigModal(props: Props) {
  if (props.sender) return <SenderPackingSlipWizard {...props} />;
  return <PackingSlipConfigForm {...props} />;
}
