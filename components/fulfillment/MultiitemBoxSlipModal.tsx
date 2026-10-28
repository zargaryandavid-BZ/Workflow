"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  CopyPlus,
  GripVertical,
  Loader2,
  Minus,
  Package,
  PackagePlus,
  Plus,
  Printer,
  Trash2,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { ScanNumberKeypad } from "@/components/fulfillment/ScanNumberKeypad";
import {
  CUSTOM_BOX_SIZE_VALUE,
  READY_TO_SHIP_BOX_SIZE_PRESETS,
  formatCustomBoxSize,
} from "@/lib/box-size-presets";
import { focusNextInputOnEnter } from "@/lib/focus-next-input";
import { cn } from "@/lib/utils";
import { formatShortOrderNumber } from "@/lib/order-number-tokens";
import {
  buildBoxSlipAssignments,
  buildBoxSlipAssignmentsFromPallets,
  distributeBoxIdsAcrossPallets,
  partitionBoxesForSlip,
} from "@/lib/multiitem-box-print";
import {
  boxesForSavedMultiitemDay,
  localDayKey,
  localDayLabel,
  savedMultiitemDayKeys,
} from "@/lib/fulfillment-day";
import {
  multiitemBoxSkuLinesFromTicket,
  remainingSkuLines,
  type MultiitemBoxOrderRow,
  type MultiitemBoxRow,
  type MultiitemBoxSkuLine,
} from "@/lib/multiitem-box-lookup";

/** Small inline QR code for a single order item (encodes the order title). */
function ItemQrCode({ value, size = 48 }: { value: string; size?: number }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: size * 2, // 2× for retina
      color: { dark: "#111827", light: "#ffffff" },
    }).then((next) => { if (!cancelled) setUrl(next); });
    return () => { cancelled = true; };
  }, [value, size]);
  if (!url) return <span className="inline-block" style={{ width: size, height: size }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={`QR ${value}`} width={size} height={size} className="shrink-0 rounded" />;
}

// Same sizes as the Ready to Ship popup so packers and customers see one list.
const SIZE_PRESETS = READY_TO_SHIP_BOX_SIZE_PRESETS;

const CUSTOM_SIZE = CUSTOM_BOX_SIZE_VALUE;

const dateTab =
  "-mb-px border-b-2 px-1 pb-2 pt-1 text-sm font-medium transition-colors";
const dateTabOn = `${dateTab} border-slate-900 text-slate-900`;
const dateTabOff = `${dateTab} border-transparent text-slate-500 hover:text-slate-900`;
const fieldLabel = "mb-1 block text-sm text-slate-600";
const fieldControl =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-[#1a1f2e] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#2d3550] disabled:opacity-50";

interface BoxItem {
  id: string;
  orderId: string;
  orderTitle: string;
  itemTitle: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  quantity: number;
  skuLines: MultiitemBoxSkuLine[];
  thumbnailUrl: string | null;
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

type ScanSkuPreviewLine = MultiitemBoxSkuLine & {
  checked: boolean;
  /** Full quantity on the job ticket for this SKU. */
  ticketQty: number;
  /** Still to pack (ticket minus other boxes); the most this box can take. */
  left: number;
};

interface ScanSkuPreview {
  query: string;
  lines: ScanSkuPreviewLine[];
}

/** Per-SKU quantities of an order already packed in other boxes. */
async function fetchPackedByPage(
  orderId: string,
  excludeBoxId: string | null | undefined,
  signal?: AbortSignal
): Promise<Map<number, number>> {
  const params = new URLSearchParams({ order_id: orderId });
  if (excludeBoxId) params.set("exclude_box_id", excludeBoxId);
  const res = await fetch(`/api/multiitem-boxes/packed?${params}`, { signal });
  if (!res.ok) return new Map();
  const json = (await res.json()) as {
    packed?: { page: number; quantity: number }[];
  };
  return new Map((json.packed ?? []).map((row) => [row.page, row.quantity]));
}

/** Ticket SKU lines offered for this box: what's left, unchecked when none is. */
function previewLinesLeft(
  ticket: MultiitemBoxSkuLine[],
  packedByPage: Map<number, number>
): ScanSkuPreviewLine[] {
  const left = remainingSkuLines(ticket, packedByPage);
  return ticket.map((line, index) => ({
    ...line,
    quantity: left[index]?.quantity ?? line.quantity,
    ticketQty: line.quantity,
    left: left[index]?.quantity ?? line.quantity,
    checked: (left[index]?.quantity ?? line.quantity) > 0,
  }));
}

interface BoxDragPayload {
  fromBoxId: string;
  orderId: string;
  skuPage?: number;
}

const BOX_DRAG_TYPE = "application/x-workflow-box-item";

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
    skuLines: Array.isArray(row.sku_lines) ? row.sku_lines : [],
    thumbnailUrl: row.thumbnail_url ?? null,
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

function boxCreationDateLabel(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value || "—";
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function BoxArtworkThumb({
  orderId,
  url,
  size,
  orderNumber,
}: {
  orderId: string;
  url: string | null;
  size: number;
  orderNumber: string;
}) {
  const [src, setSrc] = useState(url);
  useEffect(() => {
    setSrc(url);
    if (url) return;
    let cancelled = false;
    void fetch(`/api/orders/${orderId}/card-image`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { url?: string } | null) => {
        const next = json?.url?.trim();
        if (!cancelled && next) setSrc(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orderId, url]);
  return (
    <span
      className="shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-100"
      style={{ width: size, height: size }}
      title={src ? `Artwork ${orderNumber}` : undefined}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Artwork ${orderNumber}`}
          className="h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}

function compactSizeLabel(sizeLabel: string): string {
  return sizeLabel
    .trim()
    .replace(/\s*in$/i, "")
    .replace(/×/g, "x")
    .replace(/\s+/g, "");
}

const WEIGHT_STEP_LBS = 1;
const WEIGHT_MAX_LBS = 9999.99;

function bumpWeightLbs(current: string, delta: number): string {
  const parsed = Number.parseFloat(current.trim());
  const base = Number.isFinite(parsed) ? parsed : 0;
  const next = Math.min(
    WEIGHT_MAX_LBS,
    Math.max(0, Math.round((base + delta) * 100) / 100)
  );
  return Number.isInteger(next) ? String(next) : next.toFixed(2);
}

function sizeWeightLine(sizeLabel: string, weightLbs: string): string {
  const parts: string[] = [];
  const size = compactSizeLabel(sizeLabel);
  if (size) parts.push(`Size: ${size}`);
  const w = weightLbs.trim();
  if (w) parts.push(`Weight: ${w} lbs`);
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
  onSelect,
  selectedForPrint,
  onTogglePrintSelection,
  onDragItem,
  onChooseMove,
}: {
  box: BoxState;
  onPrint: (boxId: string) => void;
  onRemove: (boxId: string) => void;
  onSelect?: (boxId: string) => void;
  selectedForPrint?: boolean;
  onTogglePrintSelection?: (boxId: string) => void;
  onDragItem?: (
    event: DragEvent<HTMLElement>,
    payload: BoxDragPayload
  ) => void;
  onChooseMove?: (payload: BoxDragPayload) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <article
      className={`flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-white ${
        selectedForPrint
          ? "border-blue-500 ring-2 ring-blue-100"
          : "border-slate-300"
      }`}
    >
      <div className="border-b border-slate-200 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-2">
            {onTogglePrintSelection ? (
              <input
                type="checkbox"
                checked={Boolean(selectedForPrint)}
                onChange={() => onTogglePrintSelection(box.id)}
                aria-label={`Select ${box.name} for printing`}
                className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
            ) : null}
            <div className="min-w-0">
            <p className="truncate text-base font-semibold text-slate-900">
              {box.name}
            </p>
            <p className="truncate text-xs text-slate-500">
              PO Number: {box.poNumber || "—"}
            </p>
            <p className="truncate text-xs font-medium text-slate-700">
              {sizeWeightLine(box.sizeLabel, box.weightLbs) ||
                "No size/weight"}
            </p>
            </div>
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
          {box.items.length > 0 && (
            <span className="text-[10px] text-slate-500">
              · <span className="font-semibold text-slate-800">{box.items.reduce((s, it) => s + it.quantity, 0).toLocaleString()}</span> units
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onSelect ? (
            <button
              type="button"
              onClick={() => onSelect(box.id)}
              className="inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 hover:text-blue-900"
            >
              Edit
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onPrint(box.id)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            title="Print box"
            aria-label={`Print ${box.name}`}
          >
            <Printer className="h-4 w-4" />
          </button>
          {confirming ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onRemove(box.id)}
                className="min-h-10 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="min-h-10 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700"
              title="Remove box"
              aria-label={`Remove box ${box.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 px-3 py-1">
        <div className="grid grid-cols-[3.5rem_5.5rem_2.5rem_minmax(0,1fr)_auto] gap-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          <span />
          <span>Order</span>
          <span>Art</span>
          <span>Title</span>
          <span>Qty</span>
        </div>
        {box.items.map((item) => (
          <div
            key={item.id}
            className="border-t border-slate-100 py-1.5 text-xs"
          >
            <div className="grid grid-cols-[3.5rem_5.5rem_2.5rem_minmax(0,1fr)_auto] items-start gap-2">
              <ItemQrCode value={item.orderTitle} size={56} />
              <span className="flex min-w-0 items-center gap-0.5">
                {onDragItem ? (
                  <span
                    draggable
                    onDragStart={(event) =>
                      onDragItem(event, {
                        fromBoxId: box.id,
                        orderId: item.orderId,
                      })
                    }
                    onClick={() =>
                      onChooseMove?.({
                        fromBoxId: box.id,
                        orderId: item.orderId,
                      })
                    }
                    className="inline-flex h-10 w-10 shrink-0 cursor-grab items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing"
                    title="Move order to another box"
                    aria-label="Move order to another box"
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </span>
                ) : null}
                <span className="truncate font-mono font-medium">
                  {formatShortOrderNumber(item.orderTitle)}
                </span>
              </span>
              <BoxArtworkThumb
                orderId={item.orderId}
                url={item.thumbnailUrl}
                size={40}
                orderNumber={formatShortOrderNumber(item.orderTitle)}
              />
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-800">
                  {item.itemTitle || item.orderTitle || "—"}
                </span>
                {item.customerName ? (
                  <span className="block truncate text-[10px] text-slate-500">
                    {item.customerName}
                  </span>
                ) : null}
              </span>
              <span className="tabular-nums">{item.quantity}</span>
            </div>
            {item.skuLines.length > 0 ? (
              <div className="mt-1 grid grid-cols-1 gap-1 text-[11px] text-slate-600">
                {item.skuLines.map((line) => (
                  <div
                    key={line.page}
                    draggable={Boolean(onDragItem)}
                    onDragStart={(event) =>
                      onDragItem?.(event, {
                        fromBoxId: box.id,
                        orderId: item.orderId,
                        skuPage: line.page,
                      })
                    }
                    onClick={() =>
                      onChooseMove?.({
                        fromBoxId: box.id,
                        orderId: item.orderId,
                        skuPage: line.page,
                      })
                    }
                    className={cn(
                      "flex min-h-10 items-center gap-2 rounded bg-slate-50 px-3",
                      onDragItem &&
                        "cursor-grab hover:bg-slate-100 active:cursor-grabbing"
                    )}
                    title={
                      onDragItem
                        ? `Drag ${line.label} to another box`
                        : undefined
                    }
                  >
                    {onDragItem ? (
                      <GripVertical className="h-4 w-4 shrink-0" />
                    ) : null}
                    <span className="font-medium">{line.label}</span>
                    <span className="ml-auto tabular-nums">
                      QTY {line.quantity.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
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
  const [scanSkuPreview, setScanSkuPreview] = useState<ScanSkuPreview | null>(
    null
  );
  const [scanPreviewLoading, setScanPreviewLoading] = useState(false);
  const [zeroError, setZeroError] = useState(false);
  const [headerActionsEl, setHeaderActionsEl] = useState<HTMLElement | null>(
    null
  );
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [printWarning, setPrintWarning] = useState<{
    emptyNames: string[];
    printableIds: string[];
    saveAfterPrint: boolean;
  } | null>(null);
  const [selectedPrintBoxIds, setSelectedPrintBoxIds] = useState<Set<string>>(
    () => new Set()
  );
  const [printSetup, setPrintSetup] = useState<{
    boxIds: string[];
    saveAfterPrint: boolean;
    usePallets: boolean;
    palletCount: string;
    palletBoxIds: string[][];
  } | null>(null);
  const [draggedPalletBoxId, setDraggedPalletBoxId] = useState<string | null>(
    null
  );
  const [dragOverPalletIndex, setDragOverPalletIndex] = useState<number | null>(
    null
  );
  const [dragOverBoxId, setDragOverBoxId] = useState<string | null>(null);
  const [movePicker, setMovePicker] = useState<BoxDragPayload | null>(null);
  const [scanKeypadOpen, setScanKeypadOpen] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraScannerRef = useRef<any>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const replaceNextScan = useRef(false);
  const customLengthRef = useRef<HTMLInputElement>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  const pendingCustomFocus = useRef(false);
  const hintTimer = useRef<number | null>(null);
  const skuEditPrevious = useRef(
    new Map<string, MultiitemBoxSkuLine[]>()
  );
  const router = useRouter();

  const savedDayKeys = useMemo(() => savedMultiitemDayKeys(boxes), [boxes]);
  const viewBoxes = useMemo(
    () => boxesForSavedMultiitemDay(boxes, selectedSavedDay),
    [boxes, selectedSavedDay]
  );
  const selectedPrintBoxes = useMemo(
    () => viewBoxes.filter((box) => selectedPrintBoxIds.has(box.id)),
    [selectedPrintBoxIds, viewBoxes]
  );
  const printSetupBoxes = useMemo(
    () =>
      printSetup
        ? printSetup.boxIds
            .map((id) => boxes.find((box) => box.id === id))
            .filter((box): box is BoxState => Boolean(box))
        : [],
    [boxes, printSetup]
  );
  const configuredPalletCount = printSetup?.usePallets
    ? Math.max(
        1,
        Math.min(
          printSetupBoxes.length,
          Number.parseInt(printSetup.palletCount, 10) || 1
        )
      )
    : null;
  const palletPreview = useMemo(() => {
    if (!configuredPalletCount || printSetupBoxes.length === 0) return [];
    const boxById = new Map(printSetupBoxes.map((box) => [box.id, box]));
    return printSetup!.palletBoxIds.map((boxIds, index) => ({
      palletNumber: index + 1,
      boxes: boxIds
        .map((boxId) => boxById.get(boxId))
        .filter((box): box is BoxState => Boolean(box)),
    }));
  }, [configuredPalletCount, printSetup, printSetupBoxes]);
  const active = viewBoxes.find((b) => b.id === activeId) ?? viewBoxes[0] ?? null;
  // Read by the scan preview so it can skip this box when counting what's left.
  const activeBoxIdRef = useRef<string | null>(null);
  activeBoxIdRef.current = active?.id ?? null;
  const activeIndex = active
    ? viewBoxes.findIndex((box) => box.id === active.id)
    : -1;
  const viewingHistory = Boolean(selectedSavedDay);
  const readOnly = viewingHistory || active?.status === "saved";
  const sizeValue = active ? sizeSelectValue(active) : "";
  const isCustom = Boolean(active?.sizeCustom) || sizeValue === CUSTOM_SIZE;

  useEffect(() => {
    setSelectedPrintBoxIds(new Set());
  }, [selectedSavedDay]);

  useEffect(() => {
    if (!open) {
      setHeaderActionsEl(null);
      return;
    }
    setHeaderActionsEl(
      document.getElementById("multiitem-box-header-actions")
    );
  }, [open]);

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
    window.setTimeout(() => {
      scanRef.current?.focus();
      if (replaceNextScan.current) scanRef.current?.select();
    }, 50);
  }, []);

  // QrScanner lifecycle for inline camera
  useEffect(() => {
    if (!cameraOpen) return;
    let destroyed = false;
    void (async () => {
      const { default: QrScanner } = await import("qr-scanner");
      if (destroyed || !cameraVideoRef.current) return;
      const scanner = new QrScanner(
        cameraVideoRef.current,
        (result: { data: string }) => {
          const code = result.data.trim();
          if (!code) return;
          scanner.stop(); scanner.destroy(); cameraScannerRef.current = null;
          setCameraOpen(false);
          applyScanField(code);
          void handleScanSubmit();
        },
        { returnDetailedScanResult: true, highlightScanRegion: true, highlightCodeOutline: true, preferredCamera: "environment" }
      );
      cameraScannerRef.current = scanner;
      await scanner.start();
    })();
    return () => {
      destroyed = true;
      if (cameraScannerRef.current) { cameraScannerRef.current.stop(); cameraScannerRef.current.destroy(); cameraScannerRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen]);

  function applyScanField(next: string) {
    setScanSkuPreview(null);
    if (replaceNextScan.current) {
      replaceNextScan.current = false;
      const prev = scan;
      setScan(next.startsWith(prev) ? next.slice(prev.length) : next);
      return;
    }
    setScan(next);
  }

  useEffect(() => {
    const query = scan.trim();
    if (!query || readOnly) {
      setScanPreviewLoading(false);
      setScanSkuPreview(null);
      return;
    }
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      setScanPreviewLoading(true);
      void fetch(`/api/fulfillment/scan?q=${encodeURIComponent(query)}`, {
        signal: ac.signal,
      })
        .then(async (res) => {
          if (!res.ok) return null;
          return (await res.json()) as {
            id?: string;
            title?: string;
            qty?: number | null;
            final_artwork_sku_count?: number | null;
            qty_per_sku?: number | null;
            sku_images?: {
              sku_name?: string | null;
              qty?: number | null;
            }[];
          };
        })
        .then(async (json) => {
          if (!json?.id) return;
          const totalQty =
            json.qty != null && Number.isFinite(Number(json.qty))
              ? Math.floor(Number(json.qty))
              : null;
          const ticket = multiitemBoxSkuLinesFromTicket({
            skus: (json.sku_images ?? []).map((sku) => ({
              name: sku.sku_name,
              qty: sku.qty,
            })),
            totalQty,
            qtyPerSku: json.qty_per_sku,
            skuCount: json.final_artwork_sku_count,
          });
          const packed = await fetchPackedByPage(
            json.id,
            activeBoxIdRef.current,
            ac.signal
          );
          setScanSkuPreview({ query, lines: previewLinesLeft(ticket, packed) });
        })
        .catch((err: unknown) => {
          if (!(err instanceof Error) || err.name !== "AbortError") {
            setScanSkuPreview(null);
          }
        })
        .finally(() => {
          if (!ac.signal.aborted) setScanPreviewLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [readOnly, scan]);

  useEffect(() => {
    if (open && active?.id && !readOnly) focusScan();
  }, [active?.id, focusScan, open, readOnly]);

  useEffect(() => {
    if (!pendingCustomFocus.current || !isCustom || readOnly) return;
    pendingCustomFocus.current = false;
    window.setTimeout(() => {
      customLengthRef.current?.focus();
      customLengthRef.current?.select();
    }, 0);
  }, [isCustom, readOnly, active?.id]);

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
        const boxDate = localDayKey(new Date());
        const [openRes, savedRes] = await Promise.all([
          fetch(
            `/api/multiitem-boxes?status=open&box_date=${encodeURIComponent(
              boxDate
            )}`,
            { cache: "no-store" }
          ),
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
        const openList = (openJson.boxes ?? []).map(boxFromApi);
        const savedList = (savedJson.boxes ?? []).map(boxFromApi);
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

  async function createBox(
    fields: {
      poNumber?: string;
      sizeLabel?: string;
      weightLbs?: string;
    } = {}
  ): Promise<BoxState | null> {
    const res = await fetch("/api/multiitem-boxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        box_date: localDayKey(new Date()),
        po_number: fields.poNumber?.trim() || undefined,
        size_label: fields.sizeLabel?.trim() || undefined,
        weight_lbs: fields.weightLbs?.trim() || undefined,
      }),
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
      setScan("");
      focusScan();
    } catch (err) {
      showHint("error", err instanceof Error ? err.message : "Failed", 1800);
    } finally {
      setBusy(false);
    }
  }

  async function duplicateActiveBox() {
    if (!active || active.status !== "open") return;
    setBusy(true);
    try {
      const created = await createBox({
        poNumber: active.poNumber,
        sizeLabel: active.sizeLabel,
        weightLbs: active.weightLbs,
      });
      if (!created) return;
      setBoxes((prev) => [...prev, created]);
      setSelectedSavedDay(null);
      setActiveId(created.id);
      setScanSkuPreview(null);
      setScan("");
      focusScan();
    } catch (err) {
      showHint(
        "error",
        err instanceof Error ? err.message : "Failed to duplicate box",
        1800
      );
    } finally {
      setBusy(false);
    }
  }

  async function reopenSavedBox(boxId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/multiitem-boxes/${boxId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "open" }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        showHint("error", json.error ?? "Could not edit saved box", 2200);
        return;
      }
      setBoxes((current) =>
        current.map((box) =>
          box.id === boxId
            ? { ...box, status: "open", savedAt: null }
            : box
        )
      );
      setSelectedSavedDay(null);
      setActiveId(boxId);
      setConfirmRemove(false);
      focusScan();
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
      setConfirmRemove(false);
      setScan("");

      const [openRes, savedRes] = await Promise.all([
        fetch(
          `/api/multiitem-boxes?status=open&box_date=${encodeURIComponent(
            localDayKey(new Date())
          )}`,
          { cache: "no-store" }
        ),
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
        next.sizeLabel = formatCustomBoxSize(next.sizeL, next.sizeW, next.sizeH);
        return next;
      })
    );
  }

  function persistCustomSize(
    id: string,
    dims: { sizeL: string; sizeW: string; sizeH: string }
  ) {
    void saveBoxFields(id, {
      size_label:
        formatCustomBoxSize(dims.sizeL, dims.sizeW, dims.sizeH) || null,
    });
  }

  async function saveBoxFields(id: string, patch: Record<string, unknown>) {
    await fetch(`/api/multiitem-boxes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function addOrderToBox(box: BoxState, args: {
    orderId: string;
    query?: string;
    skuLines?: MultiitemBoxSkuLine[];
  }) {
    if (box.status === "saved") return;
    const res = await fetch(`/api/multiitem-boxes/${box.id}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_id: args.orderId,
        query: args.query,
        ...(args.skuLines ? { sku_lines: args.skuLines } : {}),
      }),
    });
    const json = (await res.json()) as {
      order?: MultiitemBoxOrderRow;
      already?: boolean;
      error?: string;
      ticket_qty?: number;
      packed_elsewhere?: number;
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
      skuLines: Array.isArray(json.order.sku_lines)
        ? json.order.sku_lines
        : [],
      thumbnailUrl: json.order.thumbnail_url ?? null,
    };
    patchBoxLocal(box.id, {
      items: [...box.items, item],
      customer: box.customer || item.customerName || null,
      customerEmail: box.customerEmail || item.customerEmail || null,
      customerPhone: box.customerPhone || item.customerPhone || null,
    });
    setZeroError(false);
    replaceNextScan.current = false;
    setScan("");
    setScanSkuPreview(null);
    const ticketQty = json.ticket_qty ?? 0;
    const packedElsewhere = json.packed_elsewhere ?? 0;
    if (ticketQty > 0 && packedElsewhere > 0) {
      showHint(
        "amber",
        `Added remaining ${item.quantity} of ${ticketQty}`,
        1800
      );
    }
    focusScan();
  }

  async function handleScanSubmit() {
    const q = scan.trim();
    if (!q || active?.status === "saved") return;
    let targetBox = active;
    const matchingPreview =
      scanSkuPreview?.query === q ? scanSkuPreview : null;
    const selectedSkuLines = matchingPreview?.lines
      .filter((line) => line.checked && line.quantity > 0)
      .map(({ page, label, quantity }) => ({ page, label, quantity }));
    if (
      matchingPreview &&
      matchingPreview.lines.length > 0 &&
      selectedSkuLines?.length === 0
    ) {
      showHint(
        "error",
        matchingPreview.lines.every((line) => line.left === 0)
          ? "This order is already fully boxed"
          : "Select at least one SKU with a quantity",
        2000
      );
      return;
    }
    replaceNextScan.current = true;
    if (
      targetBox?.items.some(
        (it) => it.orderTitle === q || it.orderId === q
      )
    ) {
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
      qty?: number | null;
      final_artwork_sku_count?: number | null;
      qty_per_sku?: number | null;
      sku_images?: {
        sku_name?: string | null;
        qty?: number | null;
      }[];
      error?: string;
    };
    if (!lookup.ok || !json.id) {
      showHint("error", json.error ?? "Lookup failed", 1800);
      return;
    }
    if (targetBox?.items.some((it) => it.orderId === json.id)) {
      showHint("amber", "Already in this box", 1400);
      replaceNextScan.current = true;
      focusScan();
      return;
    }
    // No preview yet (fast wedge scan): offer what other boxes left over.
    const lookupSkuLines =
      selectedSkuLines ??
      previewLinesLeft(
        multiitemBoxSkuLinesFromTicket({
          skus: (json.sku_images ?? []).map((sku) => ({
            name: sku.sku_name,
            qty: sku.qty,
          })),
          totalQty:
            json.qty != null && Number.isFinite(Number(json.qty))
              ? Math.floor(Number(json.qty))
              : null,
          qtyPerSku: json.qty_per_sku,
          skuCount: json.final_artwork_sku_count,
        }),
        await fetchPackedByPage(json.id, targetBox?.id)
      )
        .filter((line) => line.quantity > 0)
        .map(({ page, label, quantity }) => ({ page, label, quantity }));
    if (!targetBox) {
      setBusy(true);
      try {
        const created = await createBox();
        if (!created) return;
        setBoxes((current) => [...current, created]);
        setSelectedSavedDay(null);
        setActiveId(created.id);
        targetBox = created;
      } catch (err) {
        showHint(
          "error",
          err instanceof Error ? err.message : "Failed to create box",
          2200
        );
        return;
      } finally {
        setBusy(false);
      }
    }
    // Orders from any customer can share a box; the box keeps its first
    // customer for the slip header.
    await addOrderToBox(targetBox, {
      orderId: json.id,
      query: q,
      skuLines: lookupSkuLines.length > 0 ? lookupSkuLines : undefined,
    });
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
    const previous =
      active.items.find((it) => it.orderId === orderId)?.quantity ?? 1;
    const qty = Math.max(1, Math.floor(quantity) || 1);
    patchBoxLocal(active.id, {
      items: active.items.map((it) =>
        it.orderId === orderId ? { ...it, quantity: qty } : it
      ),
    });
    const res = await fetch(
      `/api/multiitem-boxes/${active.id}/orders/${orderId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: qty }),
      }
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      showHint("error", json.error ?? "Could not save qty", 2200);
      patchBoxLocal(active.id, {
        items: active.items.map((it) =>
          it.orderId === orderId ? { ...it, quantity: previous } : it
        ),
      });
    }
  }

  function patchSkuLinesLocal(
    orderId: string,
    skuLines: MultiitemBoxSkuLine[]
  ) {
    if (!active) return;
    patchBoxLocal(active.id, {
      items: active.items.map((item) =>
        item.orderId === orderId
          ? {
              ...item,
              skuLines,
              quantity: skuLines.reduce(
                (sum, line) => sum + line.quantity,
                0
              ),
            }
          : item
      ),
    });
  }

  async function saveSkuLines(
    orderId: string,
    skuLines: MultiitemBoxSkuLine[],
    previous: MultiitemBoxSkuLine[]
  ) {
    if (!active || active.status === "saved" || skuLines.length === 0) return;
    patchSkuLinesLocal(orderId, skuLines);
    const res = await fetch(
      `/api/multiitem-boxes/${active.id}/orders/${orderId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku_lines: skuLines }),
      }
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      showHint("error", json.error ?? "Could not save SKU quantities", 2200);
      patchSkuLinesLocal(orderId, previous);
    }
  }

  async function removeSkuLine(item: BoxItem, page: number) {
    const next = item.skuLines.filter((line) => line.page !== page);
    if (next.length === 0) {
      await removeItem(item.orderId);
      return;
    }
    await saveSkuLines(item.orderId, next, item.skuLines);
  }

  function beginBoxItemDrag(
    event: DragEvent<HTMLElement>,
    payload: BoxDragPayload
  ) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(BOX_DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", payload.orderId);
    event.currentTarget.addEventListener(
      "dragend",
      () => setDragOverBoxId(null),
      { once: true }
    );
  }

  async function dropBoxItem(
    event: DragEvent<HTMLElement>,
    toBoxId: string
  ) {
    event.preventDefault();
    setDragOverBoxId(null);
    const raw = event.dataTransfer.getData(BOX_DRAG_TYPE);
    if (!raw) return;

    let payload: BoxDragPayload;
    try {
      payload = JSON.parse(raw) as BoxDragPayload;
    } catch {
      return;
    }
    await moveBoxItem(payload, toBoxId);
  }

  async function moveBoxItem(
    payload: BoxDragPayload,
    toBoxId: string
  ) {
    setMovePicker(null);
    if (
      !payload.fromBoxId ||
      !payload.orderId ||
      payload.fromBoxId === toBoxId
    ) {
      return;
    }

    const sourceBox = boxes.find((box) => box.id === payload.fromBoxId);
    const sourceItem = sourceBox?.items.find(
      (item) => item.orderId === payload.orderId
    );
    if (!sourceBox || !sourceItem) return;

    setBusy(true);
    try {
      const res = await fetch(
        `/api/multiitem-boxes/${payload.fromBoxId}/orders/${payload.orderId}/move`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to_box_id: toBoxId,
            ...(payload.skuPage != null
              ? { sku_page: payload.skuPage }
              : {}),
          }),
        }
      );
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showHint("error", json.error ?? "Move failed", 2200);
        return;
      }

      const movedLine =
        payload.skuPage == null
          ? null
          : sourceItem.skuLines.find(
              (line) => line.page === payload.skuPage
            ) ?? null;
      const localItemId = `${sourceItem.id}:${toBoxId}`;
      setBoxes((current) =>
        current.map((box) => {
          if (box.id === payload.fromBoxId) {
            if (!movedLine) {
              return {
                ...box,
                items: box.items.filter(
                  (item) => item.orderId !== payload.orderId
                ),
              };
            }
            const items = box.items.flatMap((item) => {
              if (item.orderId !== payload.orderId) return [item];
              const skuLines = item.skuLines.filter(
                (line) => line.page !== movedLine.page
              );
              if (skuLines.length === 0) return [];
              return [
                {
                  ...item,
                  skuLines,
                  quantity: skuLines.reduce(
                    (sum, line) => sum + line.quantity,
                    0
                  ),
                },
              ];
            });
            return { ...box, items };
          }

          if (box.id === toBoxId) {
            if (!movedLine) {
              return {
                ...box,
                customer: box.customer || sourceBox.customer,
                customerEmail:
                  box.customerEmail || sourceBox.customerEmail,
                customerPhone:
                  box.customerPhone || sourceBox.customerPhone,
                items: [...box.items, { ...sourceItem, id: localItemId }],
              };
            }
            const existing = box.items.find(
              (item) => item.orderId === payload.orderId
            );
            if (existing) {
              return {
                ...box,
                items: box.items.map((item) => {
                  if (item.orderId !== payload.orderId) return item;
                  const skuLines = [...item.skuLines, movedLine].sort(
                    (a, b) => a.page - b.page
                  );
                  return {
                    ...item,
                    skuLines,
                    quantity: skuLines.reduce(
                      (sum, line) => sum + line.quantity,
                      0
                    ),
                  };
                }),
              };
            }
            return {
              ...box,
              customer: box.customer || sourceBox.customer,
              customerEmail: box.customerEmail || sourceBox.customerEmail,
              customerPhone: box.customerPhone || sourceBox.customerPhone,
              items: [
                ...box.items,
                {
                  ...sourceItem,
                  id: localItemId,
                  quantity: movedLine.quantity,
                  skuLines: [movedLine],
                },
              ],
            };
          }
          return box;
        })
      );
      setActiveId(toBoxId);
      showHint(
        "amber",
        movedLine ? `${movedLine.label} moved` : "Order moved",
        1400
      );
    } finally {
      setBusy(false);
    }
  }

  async function savePrintedBoxes(boxesToSave: BoxState[]) {
    const savedAt = new Date().toISOString();
    await Promise.all(
      boxesToSave.map(async (box) => {
        const res = await fetch(`/api/multiitem-boxes/${box.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            po_number: box.poNumber,
            size_label: box.sizeCustom
              ? formatCustomBoxSize(box.sizeL, box.sizeW, box.sizeH) || null
              : box.sizeLabel || null,
            weight_lbs: box.weightLbs,
            status: "saved",
          }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(json.error ?? `Failed to save ${box.name}`);
        }
      })
    );

    const savedIds = new Set(boxesToSave.map((box) => box.id));
    setBoxes((prev) =>
      prev.map((box) =>
        savedIds.has(box.id)
          ? { ...box, status: "saved" as const, savedAt }
          : box
      )
    );

    const remainingOpen = boxes.filter(
      (box) => box.status === "open" && !savedIds.has(box.id)
    );
    if (remainingOpen.length > 0) {
      setActiveId(remainingOpen[0]!.id);
    } else {
      const created = await createBox();
      if (created) {
        setBoxes((prev) => [...prev, created]);
        setActiveId(created.id);
      }
    }
    setSelectedSavedDay(null);
    setScan("");
    focusScan();
  }

  async function generateBoxSlips(
    boxesToPrint: BoxState[],
    options?: {
      saveAfterPrint?: boolean;
      palletCount?: number | null;
      palletBoxIds?: string[][];
      includeNumbering?: boolean;
    }
  ) {
    if (boxesToPrint.length === 0 || printBusy) return;
    setPrintBusy(true);
    try {
      const assignments = options?.includeNumbering
        ? new Map(
            (options.palletBoxIds
              ? buildBoxSlipAssignmentsFromPallets(options.palletBoxIds)
              : buildBoxSlipAssignments(
                  boxesToPrint.map((box) => box.id),
                  options.palletCount ?? null
                )
            ).map((assignment) => [assignment.boxId, assignment])
          )
        : new Map();
      const pdfBytes = await Promise.all(
        boxesToPrint.map(async (box) => {
          const assignment = assignments.get(box.id);
          const res = await fetch(`/api/multiitem-boxes/${box.id}/slip-pdf`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(assignment ?? {}),
          });
          if (!res.ok) {
            const json = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(json.error ?? `PDF failed for ${box.name}`);
          }
          return new Uint8Array(await res.arrayBuffer());
        })
      );

      let output: Uint8Array;
      if (pdfBytes.length === 1) {
        output = pdfBytes[0]!;
      } else {
        const { PDFDocument } = await import("pdf-lib");
        const merged = await PDFDocument.create();
        for (const bytes of pdfBytes) {
          const source = await PDFDocument.load(bytes);
          const pages = await merged.copyPages(
            source,
            source.getPageIndices()
          );
          for (const page of pages) merged.addPage(page);
        }
        output = await merged.save();
      }

      const blob = new Blob([new Uint8Array(output)], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
      if (options?.saveAfterPrint) {
        await savePrintedBoxes(boxesToPrint);
        showHint(
          "amber",
          `${boxesToPrint.length} ${boxesToPrint.length === 1 ? "box" : "boxes"} printed and saved`,
          1800
        );
      }
    } catch (err) {
      showHint(
        "error",
        err instanceof Error ? err.message : "PDF failed",
        2200
      );
    } finally {
      setPrintBusy(false);
    }
  }

  function prepareBoxSlipPrint(
    boxesToPrint: BoxState[],
    saveAfterPrint: boolean
  ) {
    if (boxesToPrint.length > 1) {
      setPrintSetup({
        boxIds: boxesToPrint.map((box) => box.id),
        saveAfterPrint,
        usePallets: false,
        palletCount: "1",
        palletBoxIds: [boxesToPrint.map((box) => box.id)],
      });
      return;
    }
    void generateBoxSlips(boxesToPrint, { saveAfterPrint });
  }

  function changePalletCount(change: number) {
    setPrintSetup((current) => {
      if (!current) return current;
      const count = Math.max(
        1,
        Math.min(
          current.boxIds.length,
          (Number.parseInt(current.palletCount, 10) || 1) + change
        )
      );
      return {
        ...current,
        usePallets: true,
        palletCount: String(count),
        palletBoxIds: distributeBoxIdsAcrossPallets(current.boxIds, count),
      };
    });
    setDraggedPalletBoxId(null);
    setDragOverPalletIndex(null);
  }

  function moveBoxToPallet(boxId: string, targetPalletIndex: number) {
    setPrintSetup((current) => {
      if (!current) return current;
      const sourcePalletIndex = current.palletBoxIds.findIndex((group) =>
        group.includes(boxId)
      );
      if (
        sourcePalletIndex < 0 ||
        sourcePalletIndex === targetPalletIndex ||
        current.palletBoxIds[sourcePalletIndex]!.length <= 1
      ) {
        return current;
      }
      const palletBoxIds = current.palletBoxIds.map((group) =>
        group.filter((id) => id !== boxId)
      );
      palletBoxIds[targetPalletIndex] = [
        ...palletBoxIds[targetPalletIndex]!,
        boxId,
      ];
      return { ...current, palletBoxIds };
    });
    setDraggedPalletBoxId(null);
    setDragOverPalletIndex(null);
  }

  function requestBoxSlipPrint(
    requested: BoxState[],
    saveAfterPrint: boolean
  ) {
    if (printBusy) return;
    const { printable, empty } = partitionBoxesForSlip(requested);

    if (printable.length === 0) {
      showHint(
        "error",
        empty.length === 1
          ? `${empty[0]!.name} is empty. Add an order before printing.`
          : "All boxes are empty. Add an order before printing.",
        2400
      );
      return;
    }

    if (empty.length > 0) {
      setPrintWarning({
        emptyNames: empty.map((box) => box.name),
        printableIds: printable.map((box) => box.id),
        saveAfterPrint,
      });
      return;
    }

    prepareBoxSlipPrint(printable, saveAfterPrint);
  }

  function printSlip(boxId?: string) {
    requestBoxSlipPrint(
      boxId ? boxes.filter((box) => box.id === boxId) : viewBoxes,
      !boxId
    );
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
        po_number: active.poNumber,
        size_label: active.sizeCustom
          ? formatCustomBoxSize(active.sizeL, active.sizeW, active.sizeH) || null
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
        setScan("");
        focusScan();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const scanHeaderControls = !readOnly ? (
    <div className="flex min-w-0 items-center gap-2 pl-3">
      <form
        className="flex min-w-0 flex-1 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleScanSubmit();
        }}
      >
        <input
          ref={scanRef}
          autoFocus
          value={scan}
          onChange={(e) => applyScanField(e.target.value)}
          onClick={() => setScanKeypadOpen(true)}
          inputMode="none"
          autoComplete="off"
          placeholder="Scan or type order #"
          className={cn(
            "h-[52px] min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900 focus:border-[#1a1f2e] focus:outline-none focus:ring-2 focus:ring-[#1a1f2e]/20",
            shake && "animate-scan-shake border-red-500"
          )}
        />
        <button
          type="button"
          onClick={() => {
            setScanKeypadOpen(false);
            setCameraOpen((v) => !v);
          }}
          title={cameraOpen ? "Close camera" : "Open camera"}
          aria-label={cameraOpen ? "Close camera" : "Scan with camera"}
          className={cn(
            "inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border text-slate-500",
            cameraOpen
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-300 bg-white hover:bg-slate-50 hover:text-slate-800"
          )}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => {
            replaceNextScan.current = false;
            setScan("");
            scanRef.current?.focus();
          }}
          disabled={!scan}
          title="Clear"
          aria-label="Clear scan text"
          className="inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-30"
        >
          <X className="h-5 w-5" />
        </button>
        <button
          type="submit"
          className={cn(btnPrimary, "h-[52px] shrink-0 px-5 text-base")}
        >
          Add
        </button>
      </form>
    </div>
  ) : null;

  const renderInactiveBox = (box: BoxState) => (
    <div
      key={box.id}
      className={cn(
        "relative cursor-pointer rounded-lg transition",
        dragOverBoxId === box.id && "ring-2 ring-blue-500 ring-offset-2"
      )}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest(
            "button, input, select, a, [draggable='true']"
          )
        ) {
          return;
        }
        setActiveId(box.id);
        setConfirmRemove(false);
        focusScan();
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(BOX_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOverBoxId(box.id);
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setDragOverBoxId((current) => (current === box.id ? null : current));
      }}
      onDrop={(event) => void dropBoxItem(event, box.id)}
    >
      <HistoryBoxCard
        box={box}
        onPrint={(boxId) => void printSlip(boxId)}
        onRemove={(boxId) => void confirmAndRemoveBox(boxId)}
        onDragItem={beginBoxItemDrag}
        onChooseMove={setMovePicker}
        onSelect={(boxId) => {
          setActiveId(boxId);
          setConfirmRemove(false);
          focusScan();
        }}
      />
      {dragOverBoxId === box.id ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-blue-50/80 text-sm font-semibold text-blue-800">
          Drop order or SKU here
        </div>
      ) : null}
    </div>
  );

  return (
    <>
    {printWarning ? (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="empty-box-warning-title"
      >
        <div className="w-full max-w-md rounded-xl border-2 border-amber-300 bg-amber-50 p-5 shadow-2xl">
          <h2
            id="empty-box-warning-title"
            className="text-lg font-semibold text-slate-900"
          >
            Attention
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {printWarning.emptyNames.length === 1
              ? `${printWarning.emptyNames[0]} has no orders.`
              : `${printWarning.emptyNames.length} boxes have no orders:`}
          </p>
          {printWarning.emptyNames.length > 1 ? (
            <p className="mt-1 text-sm font-medium text-slate-800">
              {printWarning.emptyNames.join(", ")}
            </p>
          ) : null}
          <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950">
            Empty boxes will not be included in the packing slip.
          </p>
          <p className="mt-3 text-sm text-slate-700">
            {printWarning.saveAfterPrint
              ? "Would you like to print and save the non-empty boxes?"
              : "Would you like to continue with the non-empty boxes?"}
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setPrintWarning(null)}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Go back
            </button>
            <button
              type="button"
              onClick={() => {
                const printable = viewBoxes.filter((box) =>
                  printWarning.printableIds.includes(box.id)
                );
                const saveAfterPrint = printWarning.saveAfterPrint;
                setPrintWarning(null);
                prepareBoxSlipPrint(printable, saveAfterPrint);
              }}
              className="rounded-md bg-[#1a1f2e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2d3550]"
            >
              {printWarning.saveAfterPrint
                ? "Print and save"
                : "Continue"}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {printSetup ? (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipping-setup-title"
      >
        <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-2xl">
          <h2
            id="shipping-setup-title"
            className="text-lg font-semibold text-slate-900"
          >
            Shipping setup
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            You are printing {printSetupBoxes.length} box slips. Will these
            boxes ship on pallets?
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() =>
                setPrintSetup((current) =>
                  current ? { ...current, usePallets: false } : current
                )
              }
              className={`rounded-lg border px-3 py-3 text-sm font-semibold ${
                !printSetup.usePallets
                  ? "border-blue-600 bg-blue-50 text-blue-800"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              No pallet
            </button>
            <div
              className={`rounded-lg border px-3 py-3 text-sm font-semibold ${
                printSetup.usePallets
                  ? "border-blue-600 bg-blue-50 text-blue-800"
                  : "border-slate-300 text-slate-700"
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  setPrintSetup((current) =>
                    current ? { ...current, usePallets: true } : current
                  )
                }
                className="min-h-10 w-full text-center text-sm font-semibold"
              >
                Yes, use pallets
              </button>
              <div className="mt-2 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => changePalletCount(-1)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-xl text-slate-800"
                  aria-label="Decrease pallet quantity"
                >
                  −
                </button>
                <span className="min-w-20 text-center text-base font-semibold tabular-nums">
                  {configuredPalletCount ?? 1}{" "}
                  {(configuredPalletCount ?? 1) === 1 ? "pallet" : "pallets"}
                </span>
                <button
                  type="button"
                  onClick={() => changePalletCount(1)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-xl text-slate-800"
                  aria-label="Increase pallet quantity"
                >
                  +
                </button>
              </div>
            </div>
          </div>
          {printSetup.usePallets ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-semibold text-slate-800">
                Box assignment
              </p>
              <p className="text-xs text-slate-500">
                Drag a box to another pallet, or tap the box and then tap its
                destination. Each pallet must keep at least one box.
              </p>
              {palletPreview.map((group, palletIndex) => (
                <div
                  key={group.palletNumber}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOverPalletIndex(palletIndex);
                  }}
                  onDragLeave={(event) => {
                    const next = event.relatedTarget;
                    if (
                      next instanceof Node &&
                      event.currentTarget.contains(next)
                    ) {
                      return;
                    }
                    setDragOverPalletIndex((current) =>
                      current === palletIndex ? null : current
                    );
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const boxId =
                      event.dataTransfer.getData(
                        "application/x-multiitem-pallet-box"
                      ) || draggedPalletBoxId;
                    if (boxId) moveBoxToPallet(boxId, palletIndex);
                  }}
                  onClick={() => {
                    if (draggedPalletBoxId) {
                      moveBoxToPallet(draggedPalletBoxId, palletIndex);
                    }
                  }}
                  className={`min-h-20 rounded-lg border px-3 py-2 transition-colors ${
                    dragOverPalletIndex === palletIndex
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-900">
                    Pallet {group.palletNumber}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {group.boxes.map((box) => (
                      <button
                        key={box.id}
                        type="button"
                        draggable
                        onDragStart={(event) => {
                          event.stopPropagation();
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            "application/x-multiitem-pallet-box",
                            box.id
                          );
                          setDraggedPalletBoxId(box.id);
                        }}
                        onDragEnd={() => {
                          setDraggedPalletBoxId(null);
                          setDragOverPalletIndex(null);
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setDraggedPalletBoxId((current) =>
                            current === box.id ? null : box.id
                          );
                        }}
                        className={`inline-flex min-h-10 items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-left text-sm font-medium shadow-sm ${
                          draggedPalletBoxId === box.id
                            ? "border-blue-500 text-blue-800 ring-2 ring-blue-100"
                            : "border-slate-300 text-slate-700 hover:border-blue-400"
                        }`}
                        aria-pressed={draggedPalletBoxId === box.id}
                        title={`Move ${box.name}`}
                      >
                        <GripVertical className="h-4 w-4 shrink-0 text-slate-400" />
                        {box.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              No pallets. Boxes will ship loose and slips will be numbered Box
              1 of {printSetupBoxes.length}, Box 2 of {printSetupBoxes.length},
              and so on.
            </p>
          )}
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setPrintSetup(null);
                setDraggedPalletBoxId(null);
                setDragOverPalletIndex(null);
              }}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={printSetupBoxes.length === 0 || printBusy}
              onClick={() => {
                const boxById = new Map(
                  printSetupBoxes.map((box) => [box.id, box])
                );
                const palletBoxIds = printSetup.usePallets
                  ? printSetup.palletBoxIds
                  : undefined;
                const boxesToPrint = palletBoxIds
                  ? palletBoxIds
                      .flat()
                      .map((boxId) => boxById.get(boxId))
                      .filter((box): box is BoxState => Boolean(box))
                  : printSetupBoxes;
                const saveAfterPrint = printSetup.saveAfterPrint;
                const palletCount = printSetup.usePallets
                  ? configuredPalletCount
                  : null;
                setPrintSetup(null);
                setDraggedPalletBoxId(null);
                setDragOverPalletIndex(null);
                void generateBoxSlips(boxesToPrint, {
                  saveAfterPrint,
                  palletCount,
                  palletBoxIds,
                  includeNumbering: true,
                });
              }}
              className="rounded-md bg-[#1a1f2e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2d3550] disabled:opacity-50"
            >
              Continue to print
            </button>
          </div>
        </div>
      </div>
    ) : null}
    {headerActionsEl && scanHeaderControls
      ? createPortal(scanHeaderControls, headerActionsEl)
      : null}
    <div className="flex h-full min-h-0 flex-col bg-slate-100">
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

        {viewingHistory ? (
          viewBoxes.length > 0 ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-sm font-medium text-slate-700">
                  {selectedPrintBoxes.length} of {viewBoxes.length} selected
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPrintBoxIds(
                        new Set(viewBoxes.map((box) => box.id))
                      )
                    }
                    className="rounded-md px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPrintBoxIds(new Set())}
                    disabled={selectedPrintBoxes.length === 0}
                    className="rounded-md px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {viewBoxes.map((box) => (
                  <HistoryBoxCard
                    key={box.id}
                    box={box}
                    onPrint={(boxId) => void printSlip(boxId)}
                    onRemove={(boxId) => void confirmAndRemoveBox(boxId)}
                    onSelect={(boxId) => void reopenSavedBox(boxId)}
                    selectedForPrint={selectedPrintBoxIds.has(box.id)}
                    onTogglePrintSelection={(boxId) =>
                      setSelectedPrintBoxIds((current) => {
                        const next = new Set(current);
                        if (next.has(boxId)) next.delete(boxId);
                        else next.add(boxId);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
              Nothing was saved on this day.
            </div>
          )
        ) : active ? (
          <div className="flex min-h-0 flex-col gap-4">
            <div className="flex min-h-0 flex-col gap-4">
                {!readOnly ? (
                <div>
                  {!headerActionsEl ? (
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
                      onChange={(e) => applyScanField(e.target.value)}
                      inputMode="none"
                      autoComplete="off"
                      placeholder="Scan or type order #"
                      className={cn(
                        "w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-[#1a1f2e] focus:outline-none focus:ring-2 focus:ring-[#1a1f2e]/20 min-w-0 flex-1",
                        shake && "animate-scan-shake border-red-500"
                      )}
                    />
                    {/* Camera button */}
                    <button
                      type="button"
                      onClick={() => setCameraOpen((v) => !v)}
                      title={cameraOpen ? "Close camera" : "Open camera"}
                      aria-label={cameraOpen ? "Close camera" : "Scan with camera"}
                      className={cn(
                        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-slate-500",
                        cameraOpen
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-300 bg-white hover:bg-slate-50 hover:text-slate-800"
                      )}
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                        <circle cx="12" cy="13" r="4"/>
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        replaceNextScan.current = false;
                        setScan("");
                        scanRef.current?.focus();
                      }}
                      disabled={!scan}
                      title="Clear"
                      aria-label="Clear scan text"
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-30"
                    >
                      <X className="h-5 w-5" />
                    </button>
                    <button type="submit" className={cn(btnPrimary, "shrink-0 py-2.5 px-5 text-base")}>
                      Add
                    </button>
                  </form>
                  ) : null}
                  {/* Inline camera */}
                  {cameraOpen && (
                    <div className="relative mt-3 flex h-56 w-full overflow-hidden rounded-xl bg-black">
                      <video ref={cameraVideoRef} className="h-full w-full object-cover" muted playsInline />
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="rounded-xl border-2 border-white/80" style={{ width: 160, height: 160, boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }} />
                      </div>
                      <p className="absolute bottom-3 left-0 right-0 text-center text-xs font-medium text-white/70">Point at order QR code</p>
                      <button type="button" onClick={() => setCameraOpen(false)} className="absolute right-2 top-2 rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  {hint ? (
                    <p
                      className={cn(
                        "mt-2 text-sm",
                        hint.kind === "error" ? "text-red-600" : "text-amber-700"
                      )}
                    >
                      {hint.text}
                    </p>
                  ) : !headerActionsEl ? (
                    <p className="mt-2 text-sm text-slate-500">
                      Enter or scan, then Add
                    </p>
                  ) : null}
                </div>
                ) : null}
              </div>

              <div className="grid min-h-0 grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {viewBoxes.slice(0, activeIndex).map(renderInactiveBox)}
              <div
                className={cn(
                  "relative mr-12 flex flex-col overflow-visible rounded-lg border-[3px] border-blue-600 bg-white shadow-sm ring-2 ring-blue-100 transition",
                  dragOverBoxId === active.id &&
                    "ring-blue-500 ring-offset-2"
                )}
                style={{ borderColor: "#2563eb" }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(BOX_DRAG_TYPE)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverBoxId(active.id);
                }}
                onDragLeave={(event) => {
                  const next = event.relatedTarget;
                  if (
                    next instanceof Node &&
                    event.currentTarget.contains(next)
                  ) {
                    return;
                  }
                  setDragOverBoxId((current) =>
                    current === active.id ? null : current
                  );
                }}
                onDrop={(event) => void dropBoxItem(event, active.id)}
              >
                <div className="border-b border-slate-200 px-4 pb-3 pt-2">
                  <div className="flex items-start justify-between gap-3">
                    {/* @container: lay the fields out by the card's width, not the window's. */}
                    <div className="@container min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <p className="break-words text-base font-semibold text-slate-900">
                          {active.name || "Unnamed box"}
                        </p>
                        <p className="shrink-0 text-sm font-medium tabular-nums text-slate-500">
                          {boxCreationDateLabel(active.boxDate)}
                        </p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div className="col-span-2 grid grid-cols-1 gap-3 @3xs:grid-cols-2 @xs:grid-cols-[minmax(0,0.8fr)_minmax(0,1.15fr)_minmax(0,1.15fr)]">
                          <label className="block">
                            <span className={fieldLabel}>PO number</span>
                            <input
                              value={active.poNumber}
                              onChange={(e) =>
                                patchBoxLocal(active.id, {
                                  poNumber: e.target.value,
                                })
                              }
                              onBlur={() =>
                                void saveBoxFields(active.id, {
                                  po_number: active.poNumber,
                                })
                              }
                              className={cn(
                                fieldControl,
                                readOnly && "bg-slate-50"
                              )}
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
                                  pendingCustomFocus.current = true;
                                  patchBoxLocal(active.id, {
                                    sizeCustom: true,
                                    sizeLabel: "",
                                    sizeL: "",
                                    sizeW: "",
                                    sizeH: "",
                                  });
                                  void saveBoxFields(active.id, {
                                    size_label: null,
                                  });
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
                              className={cn(
                                fieldControl,
                                readOnly && "bg-slate-50"
                              )}
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
                          <label className="block min-w-0 @3xs:col-span-2 @xs:col-span-1">
                            <span className={fieldLabel}>Weight (lbs)</span>
                            <div className="flex items-stretch gap-1">
                              <button
                                type="button"
                                aria-label="Decrease weight"
                                title="Decrease weight"
                                disabled={readOnly}
                                onClick={() => {
                                  const next = bumpWeightLbs(
                                    active.weightLbs,
                                    -WEIGHT_STEP_LBS
                                  );
                                  patchBoxLocal(active.id, { weightLbs: next });
                                  void saveBoxFields(active.id, {
                                    weight_lbs: next,
                                  });
                                }}
                                className="inline-flex w-10 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <input
                                ref={weightRef}
                                inputMode="decimal"
                                value={active.weightLbs}
                                onChange={(e) =>
                                  patchBoxLocal(active.id, {
                                    weightLbs: e.target.value,
                                  })
                                }
                                onBlur={() =>
                                  void saveBoxFields(active.id, {
                                    weight_lbs: active.weightLbs,
                                  })
                                }
                                className={cn(
                                  fieldControl,
                                  readOnly && "bg-slate-50"
                                )}
                                disabled={readOnly}
                              />
                              <button
                                type="button"
                                aria-label="Increase weight"
                                title="Increase weight"
                                disabled={readOnly}
                                onClick={() => {
                                  const next = bumpWeightLbs(
                                    active.weightLbs,
                                    WEIGHT_STEP_LBS
                                  );
                                  patchBoxLocal(active.id, { weightLbs: next });
                                  void saveBoxFields(active.id, {
                                    weight_lbs: next,
                                  });
                                }}
                                className="inline-flex w-10 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </label>
                        </div>
                        {isCustom ? (
                          <div
                            className="col-span-2 grid grid-cols-3 gap-3"
                            data-enter-focus-sequence
                          >
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
                                  ref={key === "sizeL" ? customLengthRef : undefined}
                                  inputMode="decimal"
                                  placeholder="0"
                                  data-enter-focus-next
                                  value={value}
                                  onChange={(e) =>
                                    patchCustomDim(active.id, key, e.target.value)
                                  }
                                  onBlur={(e) =>
                                    persistCustomSize(active.id, {
                                      sizeL:
                                        key === "sizeL"
                                          ? e.target.value
                                          : active.sizeL,
                                      sizeW:
                                        key === "sizeW"
                                          ? e.target.value
                                          : active.sizeW,
                                      sizeH:
                                        key === "sizeH"
                                          ? e.target.value
                                          : active.sizeH,
                                    })
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key !== "Enter") return;
                                    if (key === "sizeH") {
                                      e.preventDefault();
                                      persistCustomSize(active.id, {
                                        sizeL: active.sizeL,
                                        sizeW: active.sizeW,
                                        sizeH: e.currentTarget.value,
                                      });
                                      weightRef.current?.focus();
                                      weightRef.current?.select();
                                      return;
                                    }
                                    focusNextInputOnEnter(e);
                                  }}
                                  className={cn(
                                    fieldControl,
                                    readOnly && "bg-slate-50"
                                  )}
                                  disabled={readOnly}
                                />
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-start gap-2">
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
                      {active.status === "open" ? (
                        <div className="absolute -right-[50px] top-2 flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => void addBoxTab()}
                            disabled={busy}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            title="New box"
                            aria-label="New box"
                          >
                            <PackagePlus className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void duplicateActiveBox()}
                            disabled={busy}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            title={`Duplicate ${active.name}`}
                            aria-label={`Duplicate ${active.name}`}
                          >
                            <CopyPlus className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRemove(true)}
                            disabled={busy}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:opacity-50"
                            title={`Remove ${active.name}`}
                            aria-label={`Remove ${active.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {active.status === "open" && confirmRemove ? (
                    <div className="mt-3 flex items-center justify-end gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      <span className="mr-auto font-medium">
                        Remove {active.name}?
                      </span>
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
                  ) : null}
                </div>

                {scanPreviewLoading ? (
                  <p className="px-3 py-2 text-sm text-slate-500">Reading Final Production artwork…</p>
                ) : scanSkuPreview && scanSkuPreview.lines.length > 0 ? (
                  <div className="border-b border-slate-200 px-3 py-3">
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-semibold text-slate-800">
                      <span>
                        Total QTY{" "}
                        <span className="tabular-nums">
                          {scanSkuPreview.lines
                            .filter((line) => line.checked)
                            .reduce((sum, line) => sum + line.quantity, 0)
                            .toLocaleString()}
                        </span>
                      </span>
                      <span>
                        SKU QTY{" "}
                        <span className="tabular-nums">
                          {scanSkuPreview.lines.filter((line) => line.checked).length}
                        </span>
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Set how many of each SKU go in this box. The rest stays
                      available for the next box.
                    </p>
                    <div className="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto">
                      {scanSkuPreview.lines.map((line, lineIndex) => {
                        const fullyBoxed = line.left === 0;
                        const setLine = (patch: Partial<ScanSkuPreviewLine>) =>
                          setScanSkuPreview((current) =>
                            current
                              ? {
                                  ...current,
                                  lines: current.lines.map((row) =>
                                    row.page === line.page
                                      ? { ...row, ...patch }
                                      : row
                                  ),
                                }
                              : current
                          );
                        return (
                          // Same row layout as the SKU lines inside a box.
                          <div
                            key={line.page}
                            className={cn(
                              "flex items-center gap-3 rounded px-2 py-1 text-sm text-slate-700",
                              fullyBoxed
                                ? "bg-slate-50 text-slate-400"
                                : line.checked
                                  ? "bg-blue-50/70"
                                  : "bg-slate-50"
                            )}
                          >
                            <span className="w-5 shrink-0 font-semibold tabular-nums text-slate-500">
                              {lineIndex + 1}.
                            </span>
                            <span
                              className="min-w-0 flex-1 break-words font-medium"
                              title={line.label}
                            >
                              {line.label}
                            </span>
                            {fullyBoxed || line.left < line.ticketQty ? (
                              <span className="shrink-0 text-xs text-slate-500">
                                {fullyBoxed
                                  ? `All ${line.ticketQty.toLocaleString()} boxed`
                                  : `${line.left.toLocaleString()} left of ${line.ticketQty.toLocaleString()}`}
                              </span>
                            ) : null}
                            <span className="shrink-0 text-[10px] font-semibold uppercase text-slate-500">
                              Qty
                            </span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={line.left}
                              value={fullyBoxed ? 0 : line.quantity}
                              disabled={fullyBoxed}
                              onChange={(e) => {
                                const quantity = Math.min(
                                  line.left,
                                  Math.max(0, Math.floor(Number(e.target.value)) || 0)
                                );
                                setLine({ quantity, checked: quantity > 0 });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void handleScanSubmit();
                                }
                              }}
                              aria-label={`${line.label} quantity for this box`}
                              className="h-10 w-20 shrink-0 rounded border border-slate-300 bg-white px-2 text-right text-base tabular-nums focus:border-blue-500 focus:outline-none disabled:bg-slate-100"
                            />
                            <input
                              type="checkbox"
                              checked={line.checked && !fullyBoxed}
                              disabled={fullyBoxed}
                              onChange={() =>
                                setLine({
                                  checked: !line.checked,
                                  quantity:
                                    !line.checked && line.quantity < 1
                                      ? line.left
                                      : line.quantity,
                                })
                              }
                              aria-label={`Include ${line.label}`}
                              className="h-5 w-5 shrink-0 rounded border-slate-300 text-slate-900"
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleScanSubmit()}
                        disabled={
                          !scanSkuPreview.lines.some(
                            (line) => line.checked && line.quantity > 0
                          )
                        }
                        className="inline-flex h-10 items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
                      >
                        Add to box
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center gap-3 border-b border-slate-200 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Items in box
                  </p>
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {active.items.length}
                  </span>
                  {active.items.length > 0 && (
                    <span className="text-[11px] text-slate-500">
                      · <span className="font-semibold text-slate-800">{active.items.reduce((s, it) => s + it.quantity, 0).toLocaleString()}</span> units
                    </span>
                  )}
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
                  <div className="@container min-h-0 flex-1 overflow-y-auto px-3 py-1">
                    <div className="grid grid-cols-[1.5rem_auto_3.5rem_minmax(0,1fr)_auto_auto] @lg:grid-cols-[4.5rem_auto_4rem_minmax(0,1fr)_auto_auto] gap-x-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <span />
                      <span>Order</span>
                      <span>Artwork</span>
                      <span>Item</span>
                      <span className="text-right">Qty</span>
                      <span className="w-7" />
                    </div>
                    <ul>
                      {active.items.map((item, itemIndex) => (
                        <li
                          key={item.id}
                          className="border-b border-slate-100 py-1.5"
                        >
                          <div className="grid grid-cols-[1.5rem_auto_3.5rem_minmax(0,1fr)_auto_auto] @lg:grid-cols-[4.5rem_auto_4rem_minmax(0,1fr)_auto_auto] items-center gap-x-3">
                            <div className="flex items-center gap-1">
                              <span className="w-5 shrink-0 font-semibold tabular-nums text-slate-500">
                                {itemIndex + 1}.
                              </span>
                              <span className="hidden @lg:inline-flex">
                                <ItemQrCode value={item.orderTitle} size={44} />
                              </span>
                            </div>
                            <div className="flex min-w-0 items-center gap-1">
                              {!readOnly && viewBoxes.length > 1 ? (
                                <span
                                  draggable
                                  onDragStart={(event) =>
                                    beginBoxItemDrag(event, {
                                      fromBoxId: active.id,
                                      orderId: item.orderId,
                                    })
                                  }
                                  onDragEnd={() => setDragOverBoxId(null)}
                                  onClick={() =>
                                    setMovePicker({
                                      fromBoxId: active.id,
                                      orderId: item.orderId,
                                    })
                                  }
                                  className="inline-flex h-10 w-10 shrink-0 cursor-grab items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing"
                                  title="Move order to another box"
                                  aria-label="Move order to another box"
                                >
                                  <GripVertical className="h-4 w-4" />
                                </span>
                              ) : null}
                              <p className="truncate font-mono text-sm font-medium tabular-nums text-slate-900">
                                {formatShortOrderNumber(item.orderTitle)}
                              </p>
                            </div>
                            <BoxArtworkThumb
                              orderId={item.orderId}
                              url={item.thumbnailUrl}
                              size={56}
                              orderNumber={formatShortOrderNumber(item.orderTitle)}
                            />
                            <div className="min-w-0">
                              <p
                                className="line-clamp-2 break-words text-sm font-medium text-slate-800"
                                title={item.itemTitle || item.orderTitle || undefined}
                              >
                                {item.itemTitle || item.orderTitle || "—"}
                              </p>
                              {item.customerName ? (
                                <p className="truncate text-xs text-slate-500">
                                  {item.customerName}
                                </p>
                              ) : null}
                            </div>
                            <input
                              type="number"
                              min={1}
                              max={99999999}
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
                              className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-right font-mono text-base tabular-nums focus:border-blue-500 focus:outline-none disabled:bg-slate-50"
                              disabled={readOnly || item.skuLines.length > 0}
                              title={
                                item.skuLines.length > 0
                                  ? "Total is calculated from the selected SKUs"
                                  : undefined
                              }
                            />
                            {readOnly ? (
                              <span className="w-7" />
                            ) : (
                            <button
                              type="button"
                              onClick={() => void removeItem(item.orderId)}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-red-600"
                              aria-label={`Remove order ${item.orderTitle} from box`}
                              title="Remove item from box"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                            )}
                          </div>
                          {item.skuLines.length > 0 ? (
                            <div className="mt-1 grid grid-cols-1 gap-1 pb-1">
                              {item.skuLines.map((line, index) => (
                                <div
                                  key={line.page}
                                  className="flex items-center justify-between gap-3 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700"
                                >
                                  <span className="w-5 shrink-0 font-semibold tabular-nums text-slate-500">
                                    {index + 1}.
                                  </span>
                                  {!readOnly && viewBoxes.length > 1 ? (
                                    <span
                                      draggable
                                      onDragStart={(event) =>
                                        beginBoxItemDrag(event, {
                                          fromBoxId: active.id,
                                          orderId: item.orderId,
                                          skuPage: line.page,
                                        })
                                      }
                                      onDragEnd={() => setDragOverBoxId(null)}
                                      onClick={() =>
                                        setMovePicker({
                                          fromBoxId: active.id,
                                          orderId: item.orderId,
                                          skuPage: line.page,
                                        })
                                      }
                                      className="inline-flex h-10 w-10 shrink-0 cursor-grab items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-700 active:cursor-grabbing"
                                      title={`Move ${line.label} to another box`}
                                      aria-label={`Move ${line.label} to another box`}
                                    >
                                      <GripVertical className="h-4 w-4" />
                                    </span>
                                  ) : null}
                                  <span className="font-medium">{line.label}</span>
                                  <label className="ml-auto flex items-center gap-1">
                                    <span className="text-[10px] font-semibold uppercase text-slate-500">
                                      Qty
                                    </span>
                                    <input
                                      type="number"
                                      min={1}
                                      value={line.quantity}
                                      disabled={readOnly}
                                      onFocus={() =>
                                        skuEditPrevious.current.set(
                                          `${item.orderId}:${line.page}`,
                                          item.skuLines.map((row) => ({ ...row }))
                                        )
                                      }
                                      onChange={(e) => {
                                        const quantity = Math.max(
                                          1,
                                          Math.floor(Number(e.target.value)) || 1
                                        );
                                        patchSkuLinesLocal(
                                          item.orderId,
                                          item.skuLines.map((row) =>
                                            row.page === line.page
                                              ? { ...row, quantity }
                                              : row
                                          )
                                        );
                                      }}
                                      onBlur={(e) => {
                                        const quantity = Math.max(
                                          1,
                                          Math.floor(Number(e.currentTarget.value)) || 1
                                        );
                                        const next = item.skuLines.map((row) =>
                                          row.page === line.page
                                            ? { ...row, quantity }
                                            : row
                                        );
                                        const key = `${item.orderId}:${line.page}`;
                                        const previous =
                                          skuEditPrevious.current.get(key) ??
                                          item.skuLines;
                                        skuEditPrevious.current.delete(key);
                                        void saveSkuLines(
                                          item.orderId,
                                          next,
                                          previous
                                        );
                                      }}
                                      className="h-10 w-20 rounded border border-slate-300 bg-white px-2 text-right text-base tabular-nums focus:border-blue-500 focus:outline-none disabled:bg-slate-100"
                                    />
                                  </label>
                                  {readOnly ? (
                                    <span className="font-semibold text-emerald-700">
                                      ✓
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void removeSkuLine(item, line.page)
                                      }
                                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700"
                                      title={`Remove ${line.label}`}
                                      aria-label={`Remove ${line.label}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {viewBoxes.slice(activeIndex + 1).map(renderInactiveBox)}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-slate-200 bg-white px-4 py-12 text-center">
              {viewingHistory ? (
                <p className="text-sm text-slate-400">Nothing was saved on this day.</p>
              ) : (
                <>
                  <p className="text-sm text-slate-400">No boxes yet. Start your first packing slip.</p>
                  <button
                    type="button"
                    onClick={() => void addBoxTab()}
                    disabled={busy}
                    className="inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-4 text-base font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    <span className="text-lg leading-none">+</span> Add box
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 py-3">
        <button type="button" onClick={goToScan}
          className="ml-8 rounded-xl border border-slate-200 px-5 py-2.5 text-base font-medium text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
        <div className="flex gap-3">
          {!viewingHistory ? (
          <button
            type="button"
            disabled={printBusy}
            onClick={() => void printSlip()}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-base font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {printBusy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Printer className="h-5 w-5" />
            )}
            Print slip and Save
          </button>
          ) : (
          <button
            type="button"
            disabled={printBusy || selectedPrintBoxes.length === 0}
            onClick={() => requestBoxSlipPrint(selectedPrintBoxes, false)}
            className="inline-flex items-center gap-2 rounded-md bg-[#1a1f2e] px-4 py-2.5 text-base font-semibold text-white hover:bg-[#2d3550] disabled:opacity-50"
          >
            {printBusy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Printer className="h-5 w-5" />
            )}
            Print selected
            {selectedPrintBoxes.length > 0
              ? ` (${selectedPrintBoxes.length})`
              : ""}
          </button>
          )}
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
    {scanKeypadOpen && !readOnly ? (
      <ScanNumberKeypad
        value={scan}
        onInsert={(character) => {
          if (replaceNextScan.current) {
            replaceNextScan.current = false;
            setScan(character);
            return;
          }
          setScan((current) => current + character);
        }}
        onBackspace={() => {
          replaceNextScan.current = false;
          setScan((current) => current.slice(0, -1));
        }}
        onSubmit={() => {
          setScanKeypadOpen(false);
          void handleScanSubmit();
        }}
        onClose={() => {
          setScanKeypadOpen(false);
          scanRef.current?.focus();
        }}
      />
    ) : null}
    {movePicker ? (
      <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
        <button
          type="button"
          aria-label="Close move box picker"
          className="absolute inset-0 bg-slate-900/40"
          onClick={() => setMovePicker(null)}
        />
        <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-slate-900">
                Move {movePicker.skuPage != null ? "SKU" : "order"}
              </p>
              <p className="text-sm text-slate-500">
                Select the destination box
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMovePicker(null)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="grid gap-3">
            {viewBoxes
              .filter(
                (box) =>
                  box.id !== movePicker.fromBoxId && box.status === "open"
              )
              .map((box) => (
                <button
                  key={box.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void moveBoxItem(movePicker, box.id)}
                  className="flex min-h-14 items-center justify-between rounded-xl border border-slate-300 bg-white px-4 text-left text-base font-semibold text-slate-900 hover:border-blue-500 hover:bg-blue-50 disabled:opacity-50"
                >
                  <span>{box.name}</span>
                  <span className="text-sm font-medium text-slate-500">
                    {box.items.length} items
                  </span>
                </button>
              ))}
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
