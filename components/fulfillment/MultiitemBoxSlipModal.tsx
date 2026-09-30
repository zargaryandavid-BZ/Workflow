"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Printer, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";
import { formatShortOrderNumber } from "@/lib/order-number-tokens";
import {
  boxesForSavedMultiitemDay,
  localDayLabel,
  savedMultiitemDayKeys,
} from "@/lib/fulfillment-day";
import type { MultiitemBoxOrderRow, MultiitemBoxRow } from "@/lib/multiitem-box-lookup";

const SIZE_PRESETS = [
  "8×6×4 in",
  "10×8×6 in",
  "12×10×8 in",
  "16×12×10 in",
  "20×16×12 in",
  "24×18×12 in",
] as const;

const CUSTOM_SIZE = "__custom__";

const chipOn =
  "rounded-md px-3 py-2 text-sm font-medium bg-slate-900 text-white";
const chipOff =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";
const dateTab =
  "-mb-px border-b-2 px-1 pb-2 pt-1 text-sm font-medium transition-colors";
const dateTabOn = `${dateTab} border-slate-900 text-slate-900`;
const dateTabOff = `${dateTab} border-transparent text-slate-500 hover:text-slate-900`;
const fieldLabel = "mb-1 block text-sm text-slate-600";
const fieldControl =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-[#1a1f2e] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#2d3550] disabled:opacity-50";
const btnGhost =
  "rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100";

interface BoxItem {
  id: string;
  orderId: string;
  orderTitle: string;
  itemTitle: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  quantity: number;
}

interface BoxState {
  id: string;
  name: string;
  poNumber: string;
  sizeLabel: string;
  sizeCustom: boolean;
  sizeL: string;
  sizeW: string;
  sizeH: string;
  weightLbs: string;
  customer: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  items: BoxItem[];
  status: "open" | "saved";
  savedAt: string | null;
  boxDate: string;
}

interface PendingScan {
  query: string;
  orderId: string;
  orderTitle: string;
  customerName: string;
}

function rowsToItems(rows: MultiitemBoxOrderRow[] | null | undefined): BoxItem[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    orderId: row.order_id,
    orderTitle: row.order_title,
    itemTitle: row.item_title ?? "",
    customerName: row.customer_name ?? "",
    customerEmail: row.customer_email ?? "",
    customerPhone: row.customer_phone ?? "",
    quantity: row.quantity,
  }));
}

function isPresetSize(sizeLabel: string): boolean {
  return (SIZE_PRESETS as readonly string[]).includes(sizeLabel);
}

function parseCustomDims(sizeLabel: string): { l: string; w: string; h: string } {
  const m = sizeLabel
    .replace(/×/g, "x")
    .match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (!m) return { l: "", w: "", h: "" };
  return { l: m[1], w: m[2], h: m[3] };
}

function formatCustomSize(l: string, w: string, h: string): string {
  const a = l.trim();
  const b = w.trim();
  const c = h.trim();
  if (!a || !b || !c) return "";
  return `${a}×${b}×${c} in`;
}

function compactSizeLabel(sizeLabel: string): string {
  return sizeLabel
    .trim()
    .replace(/\s*in$/i, "")
    .replace(/×/g, "x")
    .replace(/\s+/g, "");
}

function sizeWeightLine(sizeLabel: string, weightLbs: string): string {
  const parts: string[] = [];
  const size = compactSizeLabel(sizeLabel);
  if (size) parts.push(`S:${size}`);
  const w = weightLbs.trim();
  if (w) parts.push(`W:${w}lb`);
  return parts.join(" ");
}

function BoxQrImage({
  boxName,
  className,
}: {
  boxName: string;
  className: string;
}) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(boxName, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 192,
      color: { dark: "#111827", light: "#ffffff" },
    }).then((next) => {
      if (!cancelled) setUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [boxName]);

  if (!url) return <div className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={`QR code for ${boxName}`} className={className} />;
}

function HistoryBoxCard({
  box,
  onPrint,
  onRemove,
}: {
  box: BoxState;
  onPrint: (boxId: string) => void;
  onRemove: (boxId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white">
      <div className="border-b border-slate-200 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Box
            </p>
            <p className="truncate text-base font-semibold text-slate-900">
              {box.name}
            </p>
            <p className="truncate text-xs text-slate-500">
              PO: {box.poNumber || "—"}
            </p>
            <p className="truncate text-xs font-medium text-slate-700">
              {sizeWeightLine(box.sizeLabel, box.weightLbs) || "No size/weight"}
            </p>
          </div>
          <BoxQrImage
            boxName={box.name}
            className="h-16 w-16 shrink-0 rounded border border-slate-200 bg-white p-1"
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Items in box
          </p>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium">
            {box.items.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPrint(box.id)}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            <Printer className="h-3.5 w-3.5" />
            Print
          </button>
          {confirming ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onRemove(box.id)}
                className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-red-700"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
              aria-label={`Remove box ${box.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 px-3 py-1">
        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <span>Order</span>
          <span>Title</span>
          <span>Qty</span>
        </div>
        {box.items.map((item) => (
          <div
            key={item.id}
            className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-2 border-t border-slate-100 py-1.5 text-xs"
          >
            <span className="truncate font-mono font-medium">
              {formatShortOrderNumber(item.orderTitle)}
            </span>
            <span className="truncate text-slate-500">
              {item.orderTitle || "—"}
            </span>
            <span className="tabular-nums">{item.quantity}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function boxFromApi(row: MultiitemBoxRow): BoxState {
  const items = rowsToItems(row.multiitem_box_orders);
  const sizeLabel = row.size_label ?? "";
  const preset = isPresetSize(sizeLabel);
  const dims = preset ? { l: "", w: "", h: "" } : parseCustomDims(sizeLabel);
  return {
    id: row.id,
    name: row.box_name,
    poNumber: row.po_number ?? "",
    sizeLabel,
    sizeCustom: Boolean(sizeLabel) && !preset,
    sizeL: dims.l,
    sizeW: dims.w,
    sizeH: dims.h,
    weightLbs: row.weight_lbs == null ? "" : String(row.weight_lbs),
    customer: row.customer_name || items[0]?.customerName || null,
    customerEmail: row.customer_email || items[0]?.customerEmail || null,
    customerPhone: row.customer_phone || items[0]?.customerPhone || null,
    items,
    status: row.status === "saved" ? "saved" : "open",
    savedAt: row.saved_at ?? null,
    boxDate: row.box_date,
  };
}

function sizeSelectValue(box: BoxState): string {
  if (box.sizeCustom) return CUSTOM_SIZE;
  if (!box.sizeLabel) return "";
  return isPresetSize(box.sizeLabel) ? box.sizeLabel : CUSTOM_SIZE;
}

export function MultiitemBoxSlipModal({
  open = true,
  onClose,
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  const [boxes, setBoxes] = useState<BoxState[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedSavedDay, setSelectedSavedDay] = useState<string | null>(null);
  const [scan, setScan] = useState("");
  const [hint, setHint] = useState<{ kind: "error" | "amber"; text: string } | null>(
    null
  );
  const [shake, setShake] = useState(false);
  const [pending, setPending] = useState<PendingScan | null>(null);
  const [zeroError, setZeroError] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const hintTimer = useRef<number | null>(null);
  const router = useRouter();

  const savedDayKeys = useMemo(() => savedMultiitemDayKeys(boxes), [boxes]);
  const viewBoxes = useMemo(
    () => boxesForSavedMultiitemDay(boxes, selectedSavedDay),
    [boxes, selectedSavedDay]
  );
  const active = viewBoxes.find((b) => b.id === activeId) ?? viewBoxes[0] ?? null;
  const viewingHistory = Boolean(selectedSavedDay);
  const readOnly = viewingHistory || active?.status === "saved";

  useEffect(() => {
    let cancelled = false;
    const boxName = active?.name.trim() ?? "";
    if (!boxName) {
      setQrDataUrl("");
      return;
    }
    void QRCode.toDataURL(boxName, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 192,
      color: { dark: "#111827", light: "#ffffff" },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [active?.name]);

  function goToScan() {
    if (onClose) {
      onClose();
      return;
    }
    router.push("/fulfillment/scan");
  }

  const focusScan = useCallback(() => {
    window.setTimeout(() => scanRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    if (open && active?.id && !readOnly) focusScan();
  }, [active?.id, focusScan, open, readOnly]);

  function showHint(kind: "error" | "amber", text: string, ms: number) {
    setHint({ kind, text });
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), ms);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadLists(preferId?: string | null) {
      setLoadError("");
      setBusy(true);
      try {
        const [openRes, savedRes] = await Promise.all([
          fetch("/api/multiitem-boxes?status=open", { cache: "no-store" }),
          fetch("/api/multiitem-boxes?status=saved", { cache: "no-store" }),
        ]);
        const openJson = (await openRes.json()) as {
          boxes?: MultiitemBoxRow[];
          error?: string;
        };
        const savedJson = (await savedRes.json()) as {
          boxes?: MultiitemBoxRow[];
          error?: string;
        };
        if (!openRes.ok) throw new Error(openJson.error ?? "Failed to load boxes");
        if (!savedRes.ok) {
          throw new Error(savedJson.error ?? "Failed to load saved boxes");
        }
        let openList = (openJson.boxes ?? []).map(boxFromApi);
        const savedList = (savedJson.boxes ?? []).map(boxFromApi);
        if (openList.length === 0) {
          const createdRes = await fetch("/api/multiitem-boxes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          const createdJson = (await createdRes.json()) as {
            box?: MultiitemBoxRow;
            error?: string;
          };
          if (!createdRes.ok || !createdJson.box) {
            throw new Error(createdJson.error ?? "Failed to create box");
          }
          openList = [boxFromApi(createdJson.box)];
        }
        if (cancelled) return;
        const list = [...openList, ...savedList];
        setBoxes(list);
        const nextId =
          (preferId && list.some((b) => b.id === preferId) ? preferId : null) ??
          openList[0]?.id ??
          list[0]?.id ??
          null;
        setActiveId(nextId);
        setSelectedSavedDay(null);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
          window.setTimeout(() => scanRef.current?.focus(), 50);
        }
      }
    }
    void loadLists();
    return () => {
      cancelled = true;
      if (hintTimer.current) window.clearTimeout(hintTimer.current);
    };
  }, [open]);

  async function createBox(): Promise<BoxState | null> {
    const res = await fetch("/api/multiitem-boxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = (await res.json()) as { box?: MultiitemBoxRow; error?: string };
    if (!res.ok || !json.box) throw new Error(json.error ?? "Failed to create box");
    return boxFromApi(json.box);
  }

  async function addBoxTab() {
    setBusy(true);
    try {
      const created = await createBox();
      if (!created) return;
      setBoxes((prev) => [...prev, created]);
      setSelectedSavedDay(null);
      setActiveId(created.id);
      setPending(null);
      setScan("");
      focusScan();
    } catch (err) {
      showHint("error", err instanceof Error ? err.message : "Failed", 1800);
    } finally {
      setBusy(false);
    }
  }

  async function confirmAndRemoveBox(boxId?: string) {
    const id = boxId ?? active?.id;
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/multiitem-boxes/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        showHint("error", json.error ?? "Failed to remove box", 1800);
        setConfirmRemove(false);
        return;
      }
      setActiveId((prev) => (prev === id ? null : prev));
      setBoxes((prev) => prev.filter((box) => box.id !== id));
      setPending(null);
      setConfirmRemove(false);
      setScan("");

      const [openRes, savedRes] = await Promise.all([
        fetch("/api/multiitem-boxes?status=open", { cache: "no-store" }),
        fetch("/api/multiitem-boxes?status=saved", { cache: "no-store" }),
      ]);
      const [openJson, savedJson] = (await Promise.all([
        openRes.json(),
        savedRes.json(),
      ])) as [
        { boxes?: MultiitemBoxRow[]; error?: string },
        { boxes?: MultiitemBoxRow[]; error?: string },
      ];
      if (!openRes.ok || !savedRes.ok) {
        showHint(
          "error",
          openJson.error ?? savedJson.error ?? "Failed to refresh boxes",
          1800
        );
        return;
      }
      const openBoxes = (openJson.boxes ?? []).map(boxFromApi);
      const savedBoxes = (savedJson.boxes ?? []).map(boxFromApi);
      const list = [...openBoxes, ...savedBoxes];
      setBoxes(list);
      if (selectedSavedDay) {
        const remaining = boxesForSavedMultiitemDay(list, selectedSavedDay);
        if (remaining.length === 0) setSelectedSavedDay(null);
        setActiveId(remaining[0]?.id ?? openBoxes[0]?.id ?? null);
      } else {
        setActiveId(openBoxes[0]?.id ?? null);
      }
    } finally {
      setBusy(false);
    }
  }

  function patchBoxLocal(id: string, next: Partial<BoxState>) {
    setBoxes((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...next } : b))
    );
  }

  function patchCustomDim(
    id: string,
    dim: "sizeL" | "sizeW" | "sizeH",
    value: string
  ) {
    setBoxes((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const next = { ...b, [dim]: value, sizeCustom: true };
        next.sizeLabel = formatCustomSize(next.sizeL, next.sizeW, next.sizeH);
        return next;
      })
    );
  }

  function persistCustomSize(
    id: string,
    dims: { sizeL: string; sizeW: string; sizeH: string }
  ) {
    void saveBoxFields(id, {
      size_label: formatCustomSize(dims.sizeL, dims.sizeW, dims.sizeH) || null,
    });
  }

  async function saveBoxFields(id: string, patch: Record<string, unknown>) {
    await fetch(`/api/multiitem-boxes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function addOrderToActive(args: {
    orderId: string;
    query?: string;
  }) {
    if (!active || active.status === "saved") return;
    const res = await fetch(`/api/multiitem-boxes/${active.id}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: args.orderId,
        query: args.query,
      }),
    });
    const json = (await res.json()) as {
      order?: MultiitemBoxOrderRow;
      already?: boolean;
      error?: string;
    };
    if (res.status === 404) {
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
      showHint("error", "Order not found", 1800);
      return;
    }
    if (!res.ok || !json.order) {
      showHint("error", json.error ?? "Failed to add", 1800);
      return;
    }
    if (json.already) {
      showHint("amber", "Already in this box", 1400);
      setScan("");
      focusScan();
      return;
    }
    const item: BoxItem = {
      id: json.order.id,
      orderId: json.order.order_id,
      orderTitle: json.order.order_title,
      itemTitle: json.order.item_title ?? "",
      customerName: json.order.customer_name ?? "",
      customerEmail: json.order.customer_email ?? "",
      customerPhone: json.order.customer_phone ?? "",
      quantity: json.order.quantity,
    };
    patchBoxLocal(active.id, {
      items: [...active.items, item],
      customer: active.customer || item.customerName || active.customer,
      customerEmail: active.customerEmail || item.customerEmail || null,
      customerPhone: active.customerPhone || item.customerPhone || null,
    });
    setZeroError(false);
    setScan("");
    setPending(null);
    focusScan();
  }

  async function handleScanSubmit() {
    const q = scan.trim();
    if (!q || !active || active.status === "saved") return;
    if (active.items.some((it) => it.orderTitle === q || it.orderId === q)) {
      showHint("amber", "Already in this box", 1400);
      return;
    }
    const lookup = await fetch(
      `/api/fulfillment/scan?q=${encodeURIComponent(q)}`
    );
    if (lookup.status === 404) {
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
      showHint("error", "Order not found", 1800);
      return;
    }
    const json = (await lookup.json()) as {
      id?: string;
      title?: string;
      customer?: {
        id?: string | null;
        name?: string | null;
        email?: string | null;
        phone?: string | null;
      } | null;
      error?: string;
    };
    if (!lookup.ok || !json.id) {
      showHint("error", json.error ?? "Lookup failed", 1800);
      return;
    }
    if (active.items.some((it) => it.orderId === json.id)) {
      showHint("amber", "Already in this box", 1400);
      setScan("");
      focusScan();
      return;
    }
    const customerName = json.customer?.name?.trim() || "";
    if (
      active.customer &&
      customerName &&
      customerName.toLowerCase() !== active.customer.toLowerCase()
    ) {
      setPending({
        query: q,
        orderId: json.id,
        orderTitle: json.title ?? q,
        customerName,
      });
      return;
    }
    await addOrderToActive({ orderId: json.id, query: q });
  }

  async function removeItem(orderId: string) {
    if (!active || active.status === "saved") return;
    const res = await fetch(
      `/api/multiitem-boxes/${active.id}/orders/${orderId}`,
      { method: "DELETE" }
    );
    if (!res.ok) return;
    const nextItems = active.items.filter((it) => it.orderId !== orderId);
    patchBoxLocal(active.id, {
      items: nextItems,
    });
  }

  async function saveQty(orderId: string, quantity: number) {
    if (!active || active.status === "saved") return;
    const qty = Math.min(999, Math.max(1, Math.floor(quantity) || 1));
    patchBoxLocal(active.id, {
      items: active.items.map((it) =>
        it.orderId === orderId ? { ...it, quantity: qty } : it
      ),
    });
    await fetch(`/api/multiitem-boxes/${active.id}/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: qty }),
    });
  }

  async function printSlip(boxId: string | undefined = active?.id) {
    if (!boxId) return;
    const res = await fetch(`/api/multiitem-boxes/${boxId}/slip-pdf`, {
      method: "POST",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      showHint("error", json.error ?? "PDF failed", 1800);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  }

  async function saveAndClose() {
    if (!active) return;
    if (active.items.length === 0) {
      setZeroError(true);
      return;
    }
    setBusy(true);
    try {
      await saveBoxFields(active.id, {
        box_name: active.name,
        po_number: active.poNumber,
        size_label: active.sizeCustom
          ? formatCustomSize(active.sizeL, active.sizeW, active.sizeH) || null
          : active.sizeLabel || null,
        weight_lbs: active.weightLbs,
        status: "saved",
      });
      const savedAt = new Date().toISOString();
      patchBoxLocal(active.id, { status: "saved", savedAt });
      const created = await createBox();
      if (created) {
        setBoxes((prev) => {
          const without = prev.filter((b) => b.id !== created.id);
          return [...without, created];
        });
        setSelectedSavedDay(null);
        setActiveId(created.id);
        setPending(null);
        setScan("");
        focusScan();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const sizeValue = active ? sizeSelectValue(active) : "";
  const isCustom = Boolean(active?.sizeCustom) || sizeValue === CUSTOM_SIZE;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        {loadError ? (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-5 border-b border-slate-200">
          <button
            type="button"
            onClick={() => {
              setSelectedSavedDay(null);
              setPending(null);
              const firstOpen = boxes.find((b) => b.status === "open");
              setActiveId(firstOpen?.id ?? null);
              focusScan();
            }}
            className={!selectedSavedDay ? dateTabOn : dateTabOff}
          >
            Current
          </button>
          {savedDayKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setSelectedSavedDay(key);
                setPending(null);
                const first = boxesForSavedMultiitemDay(boxes, key)[0];
                setActiveId(first?.id ?? null);
              }}
              className={
                selectedSavedDay === key
                  ? `${dateTabOn} tabular-nums`
                  : `${dateTabOff} tabular-nums`
              }
            >
              {localDayLabel(key)}
            </button>
          ))}
        </div>

        <div className="mt-[10px]">
        {!viewingHistory ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {viewBoxes.map((box) => (
            <button
              key={box.id}
              type="button"
              onClick={() => {
                setActiveId(box.id);
                setPending(null);
                setConfirmRemove(false);
                if (!viewingHistory) focusScan();
              }}
              className={box.id === active?.id ? chipOn : chipOff}
            >
              {box.name}
            </button>
          ))}
          {!viewingHistory ? (
            <>
              <button
                type="button"
                onClick={() => void addBoxTab()}
                disabled={busy}
                className={btnPrimary}
              >
                + Add box
              </button>
              {active?.status === "open" ? (
                confirmRemove ? (
                  <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900">
                    <span className="font-medium">Remove {active.name}?</span>
                    <button
                      type="button"
                      onClick={() => void confirmAndRemoveBox()}
                      disabled={busy}
                      className="rounded bg-[#1a1f2e] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#2d3550] disabled:opacity-50"
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(false)}
                      className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove box
                  </button>
                )
              ) : null}
            </>
          ) : null}
        </div>
        ) : null}

        {viewingHistory ? (
          viewBoxes.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {viewBoxes.map((box) => (
                <HistoryBoxCard
                  key={box.id}
                  box={box}
                  onPrint={(boxId) => void printSlip(boxId)}
                  onRemove={(boxId) => void confirmAndRemoveBox(boxId)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
              Nothing was saved on this day.
            </div>
          )
        ) : active ? (
          <div className="grid min-h-0 grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex min-h-0 flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={fieldLabel}>Box name</span>
                  <input
                      value={active.name}
                      onChange={(e) =>
                        patchBoxLocal(active.id, { name: e.target.value })
                      }
                      onBlur={() =>
                        void saveBoxFields(active.id, { box_name: active.name })
                      }
                    className={cn(fieldControl, readOnly && "bg-slate-50")}
                    disabled={readOnly}
                    />
                  </label>
                  <label className="block">
                  <span className={fieldLabel}>PO number</span>
                    <input
                      value={active.poNumber}
                      onChange={(e) =>
                        patchBoxLocal(active.id, { poNumber: e.target.value })
                      }
                      onBlur={() =>
                        void saveBoxFields(active.id, {
                          po_number: active.poNumber,
                        })
                      }
                    className={cn(fieldControl, readOnly && "bg-slate-50")}
                    disabled={readOnly}
                    />
                  </label>
                  <label className="block">
                  <span className={fieldLabel}>Size</span>
                    <select
                      value={sizeValue}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === CUSTOM_SIZE) {
                          patchBoxLocal(active.id, {
                            sizeCustom: true,
                            sizeLabel: "",
                            sizeL: "",
                            sizeW: "",
                            sizeH: "",
                          });
                          void saveBoxFields(active.id, { size_label: null });
                          return;
                        }
                        patchBoxLocal(active.id, {
                          sizeCustom: false,
                          sizeLabel: v,
                          sizeL: "",
                          sizeW: "",
                          sizeH: "",
                        });
                        void saveBoxFields(active.id, {
                          size_label: v || null,
                        });
                      }}
                    className={cn(fieldControl, readOnly && "bg-slate-50")}
                    disabled={readOnly}
                    >
                      <option value="">Select size</option>
                      {SIZE_PRESETS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                      <option value={CUSTOM_SIZE}>Custom…</option>
                    </select>
                  </label>
                  <label className="block">
                  <span className={fieldLabel}>Weight (lbs)</span>
                    <input
                      inputMode="decimal"
                      value={active.weightLbs}
                      onChange={(e) =>
                        patchBoxLocal(active.id, { weightLbs: e.target.value })
                      }
                      onBlur={() =>
                        void saveBoxFields(active.id, {
                          weight_lbs: active.weightLbs,
                        })
                      }
                    className={cn(fieldControl, readOnly && "bg-slate-50")}
                    disabled={readOnly}
                    />
                  </label>
                  {isCustom ? (
                    <div className="col-span-2 grid grid-cols-3 gap-3">
                      {(
                        [
                          ["sizeL", "Length (in)", active.sizeL],
                          ["sizeW", "Width (in)", active.sizeW],
                          ["sizeH", "Height (in)", active.sizeH],
                        ] as const
                      ).map(([key, label, value]) => (
                        <label key={key} className="block">
                          <span className={fieldLabel}>{label}</span>
                          <input
                            inputMode="decimal"
                            placeholder="0"
                            value={value}
                            onChange={(e) =>
                              patchCustomDim(active.id, key, e.target.value)
                            }
                            onBlur={(e) =>
                              persistCustomSize(active.id, {
                                sizeL: key === "sizeL" ? e.target.value : active.sizeL,
                                sizeW: key === "sizeW" ? e.target.value : active.sizeW,
                                sizeH: key === "sizeH" ? e.target.value : active.sizeH,
                              })
                            }
                          className={cn(fieldControl, readOnly && "bg-slate-50")}
                    disabled={readOnly}
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>

                {pending ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <p className="font-semibold">Different customer detected</p>
                    <p className="mt-1 text-slate-700">
                      #{pending.orderTitle} → {pending.customerName}
                    </p>
                    <p className="text-slate-700">Box has: {active.customer}</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void addOrderToActive({
                            orderId: pending.orderId,
                            query: pending.query,
                          })
                        }
                        className={btnPrimary}
                      >
                        Add anyway
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPending(null);
                          setScan("");
                          focusScan();
                        }}
                        className={btnGhost}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}

                {!readOnly ? (
                <div>
                  <div className="mb-1">
                    <span className="text-base font-semibold text-slate-800">
                      Scan order QR
                    </span>
                  </div>
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleScanSubmit();
                    }}
                  >
                    <input
                      ref={scanRef}
                      autoFocus
                      value={scan}
                      onChange={(e) => setScan(e.target.value)}
                      inputMode="none"
                      autoComplete="off"
                      placeholder="Scan or type order #"
                      className={cn(
                        "w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-[#1a1f2e] focus:outline-none focus:ring-2 focus:ring-[#1a1f2e]/20 min-w-0 flex-1",
                        shake && "animate-scan-shake border-red-500"
                      )}
                    />
                    <button type="submit" className={cn(btnPrimary, "shrink-0 py-2.5 px-5 text-base")}>
                      Add
                    </button>
                  </form>
                  {hint ? (
                    <p
                      className={cn(
                        "mt-2 text-sm",
                        hint.kind === "error" ? "text-red-600" : "text-amber-700"
                      )}
                    >
                      {hint.text}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">
                      Enter or scan, then Add
                    </p>
                  )}
                </div>
                ) : null}
              </div>

              <div className="flex flex-col overflow-hidden rounded-lg border border-slate-300 bg-white md:-mt-[3.25rem]">
                <div className="border-b border-slate-200 px-4 pb-3 pt-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Box
                      </p>
                      <p className="truncate text-lg font-semibold text-slate-900">
                        {active.name || "Unnamed box"}
                      </p>
                      {active.poNumber ? (
                        <p className="mt-0.5 text-sm text-slate-500">
                          PO: {active.poNumber}
                        </p>
                      ) : null}
                      {sizeWeightLine(active.sizeLabel, active.weightLbs) ? (
                        <p className="mt-0.5 text-sm font-medium tabular-nums text-slate-700">
                          {sizeWeightLine(active.sizeLabel, active.weightLbs)}
                        </p>
                      ) : null}
                    </div>
                    {qrDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={qrDataUrl}
                        alt={`QR code for ${active.name}`}
                        className="h-20 w-20 shrink-0 rounded-md border border-slate-200 bg-white p-1"
                      />
                    ) : (
                      <div className="h-20 w-20 shrink-0" />
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Items in box
                  </p>
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {active.items.length}
                  </span>
                  {zeroError ? (
                    <span className="text-sm text-red-600">
                      Add at least one order
                    </span>
                  ) : null}
                </div>
                {active.items.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm text-slate-400">
                    <Package className="h-8 w-8 opacity-40" />
                    <p>Scan orders to add them here</p>
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
                    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto_auto] gap-x-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <span>Order</span>
                      <span>Item</span>
                      <span className="text-right">Qty</span>
                      <span className="w-7" />
                    </div>
                    <ul>
                      {active.items.map((item) => (
                        <li
                          key={item.id}
                          className="border-b border-slate-100 py-1.5"
                        >
                          <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto_auto] items-center gap-x-3">
                            <p className="truncate font-mono text-sm font-medium tabular-nums text-slate-900">
                              {formatShortOrderNumber(item.orderTitle)}
                            </p>
                            <p className="min-w-0 truncate text-sm text-slate-500">
                              {item.orderTitle || "—"}
                            </p>
                            <input
                              type="number"
                              min={1}
                              max={999}
                              value={item.quantity}
                              onChange={(e) =>
                                patchBoxLocal(active.id, {
                                  items: active.items.map((it) =>
                                    it.id === item.id
                                      ? {
                                          ...it,
                                          quantity: Number(e.target.value) || 1,
                                        }
                                      : it
                                  ),
                                })
                              }
                              onBlur={(e) =>
                                void saveQty(
                                  item.orderId,
                                  Number(e.currentTarget.value)
                                )
                              }
                              className="w-14 rounded border border-slate-300 px-1 py-0.5 text-right font-mono text-sm tabular-nums focus:border-blue-500 focus:outline-none disabled:bg-slate-50"
                              disabled={readOnly}
                            />
                            {readOnly ? (
                              <span className="w-7" />
                            ) : (
                            <button
                              type="button"
                              onClick={() => void removeItem(item.orderId)}
                              className="rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-red-600"
                              aria-label={`Remove order ${item.orderTitle} from box`}
                              title="Remove item from box"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
              {viewingHistory
                ? "Nothing was saved on this day."
                : "Click Add box to start a packing slip."}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-slate-200 px-4 py-3">
        <button type="button" onClick={goToScan}
          className="rounded-md px-4 py-2.5 text-base text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
        <div className="flex gap-3">
          {!viewingHistory ? (
          <button
            type="button"
            onClick={() => void printSlip()}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-base font-medium text-slate-700 hover:bg-slate-50"
          >
            <Printer className="h-5 w-5" />
            Print slip
          </button>
          ) : null}
          {!readOnly ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveAndClose()}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[#1a1f2e] px-5 py-2.5 text-base font-semibold text-white hover:bg-[#2d3550] disabled:opacity-50"
          >
            Save
          </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
