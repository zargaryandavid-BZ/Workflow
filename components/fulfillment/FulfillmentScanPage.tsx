"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  CircleCheck,
  GripVertical,
  Loader2,
  MapPinCheck,
  Package,
  PackageCheck,
  Plus,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { formatPhoneDisplay } from "@/lib/sms-phone";
import type { BoardColumn } from "@/lib/types";
import {
  SCAN_CAMERA_EVENT,
  SCAN_CONFIGURE_EVENT,
  SCAN_FOCUS_EVENT,
  SCAN_LOADING_EVENT,
  SCAN_QUERY_EVENT,
} from "@/components/fulfillment/FulfillmentNav";
import {
  MAX_SCAN_BUTTONS,
  newScanButton,
  serializeScanButtons,
  type ScanActionButton,
} from "@/lib/fulfillment-scan-config";
import { ReadyToShipPopup } from "@/components/notify/ReadyToShipPopup";
import {
  SCAN_SHIPPING_ACTION_BTN,
  SCAN_SHIPPING_ACTION_BTN_READY,
  ScanShippingSlipButtons,
} from "@/components/fulfillment/ScanShippingSlipButtons";
import { finishedCustomerSmsKind } from "@/lib/net-terms-fulfill";
import type { CustomField, OrderWithRelations } from "@/lib/types";

function isFinishedReviewRequestColumn(name: string | null | undefined) {
  return finishedCustomerSmsKind(name) === "review";
}

interface OrderResult {
  id: string;
  title: string;
  due_date: string | null;
  due_display?: string | null;
  column_id: string;
  column_name: string | null;
  spec_lines?: { label: string; value: string }[];
  qty?: number | null;
  order_number?: string | null;
  main_item_count?: number | null;
  group_parts?: {
    id: string;
    title: string;
    query: string;
    columnName: string;
  }[];
  specs?: {
    quantity?: unknown;
    stock?: unknown;
    finish?: unknown;
    size?: unknown;
    color?: unknown;
    production_notes?: unknown;
  };
  customer: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  thumbnail_url: string | null;
  sku_images?: { sku_id: string; sku_name: string; url: string }[];
  owner_name: string | null;
  designer_name: string | null;
  billing: { deposit: number | null; balance: number | null } | null;
  shipping_request?: {
    token: string | null;
    client_choice: "pickup" | "delivery" | "uber" | "curri" | null;
    status: string | null;
  } | null;
  last_sms_at?: string | null;
}

const ACTION_ICON_COLORS = [
  "bg-blue-50 text-blue-700",
  "bg-emerald-50 text-emerald-700",
  "bg-amber-50 text-amber-700",
  "bg-slate-100 text-slate-600",
  "bg-violet-50 text-violet-700",
  "bg-rose-50 text-rose-700",
];

function ActionGlyph({ index }: { index: number }) {
  const cls = "h-4 w-4";
  const i = index % 5;
  if (i === 0) return <PackageCheck className={cls} />;
  if (i === 1) return <MapPinCheck className={cls} />;
  if (i === 2) return <Truck className={cls} />;
  if (i === 3) return <CircleCheck className={cls} />;
  return <CheckCircle2 className={cls} />;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function isLate(due: string | null): boolean {
  if (!due) return false;
  return new Date(due) < new Date();
}

function ScanSpecValue({ label, value }: { label: string; value: string }) {
  const isCategory = label.trim().toLowerCase() === "category";
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] md:text-[15px] font-semibold text-slate-900">
      {isCategory ? (
        <Package className="h-3.5 w-3.5 shrink-0 text-slate-500" />
      ) : null}
      <span className="min-w-0 break-words">{value}</span>
    </span>
  );
}

function MainOrderItemsCount({
  count,
  parts,
  currentOrderId,
}: {
  count: number | null | undefined;
  parts: {
    id: string;
    title: string;
    query: string;
    columnName: string;
  }[];
  currentOrderId: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const label = count != null ? String(count) : "—";
  if (parts.length === 0) {
    return (
      <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-blue-600 px-2 py-0.5 text-[13px] font-bold text-white md:text-[15px]">
        {label}
      </span>
    );
  }

  function openPart(part: (typeof parts)[number]) {
    setOpen(false);
    if (part.id === currentOrderId) return;
    window.dispatchEvent(
      new CustomEvent(SCAN_QUERY_EVENT, { detail: { query: part.query } })
    );
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-w-6 items-center justify-center rounded-full bg-blue-600 px-2 py-0.5 text-[13px] font-bold text-white hover:bg-blue-700 md:text-[15px]"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {label}
      </button>
      {open ? (
        <div className="absolute left-0 z-40 mt-1 w-max min-w-[16rem] rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg">
          {parts.map((p) => {
            const isCurrent = p.id === currentOrderId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => openPart(p)}
                className={cn(
                  "flex w-full flex-nowrap items-center gap-4 whitespace-nowrap px-3 py-1.5 text-left text-[13px] md:text-[15px]",
                  isCurrent ? "bg-blue-50" : "hover:bg-slate-50"
                )}
              >
                <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                  {p.title}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-0.5",
                    isFinishedReviewRequestColumn(p.columnName)
                      ? "bg-red-600 font-semibold text-white"
                      : "bg-blue-600 font-semibold text-white"
                  )}
                >
                  {p.columnName}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** 2×N grid spec table — label and value on the same line. */
function ScanSpecTable({
  rows,
}: {
  rows: { label: string; value: string }[];
}) {
  if (rows.length === 0) {
    return <p className="text-[12px] md:text-[14px] text-slate-400">No spec data</p>;
  }
  // Full-width labels (long text fields that shouldn't be squeezed into half a row)
  const FULL_WIDTH_LABELS = new Set(["line item", "designer information", "production notes", "options", "special effects"]);
  const isFullWidth = (label: string) => FULL_WIDTH_LABELS.has(label.toLowerCase());

  // Build display rows: full-width rows stay alone; others pair up
  type DisplayRow = { type: "pair"; left: typeof rows[0]; right: typeof rows[0] | null } | { type: "full"; row: typeof rows[0] };
  const displayRows: DisplayRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (isFullWidth(row.label)) {
      displayRows.push({ type: "full", row });
      i++;
    } else {
      const next = rows[i + 1] && !isFullWidth(rows[i + 1].label) ? rows[i + 1] : null;
      displayRows.push({ type: "pair", left: row, right: next });
      i += next ? 2 : 1;
    }
  }

  return (
    <dl className="bg-white">
      {displayRows.map((dr, idx) =>
        dr.type === "full" ? (
          <div
            key={idx}
            className={cn("flex items-start gap-2 px-4 py-2.5", idx > 0 && "border-t border-slate-100")}
          >
            <dt className="shrink-0 text-[11px] md:text-[13px] text-slate-400">{dr.row.label}:</dt>
            <dd className="min-w-0 flex-1">
              <ScanSpecValue label={dr.row.label} value={dr.row.value} />
            </dd>
          </div>
        ) : (
          <div
            key={idx}
            className={cn("grid grid-cols-2 gap-px", idx > 0 && "border-t border-slate-100")}
          >
            {[dr.left, dr.right].map((row, j) =>
              row ? (
                <div
                  key={j}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5",
                    j === 0 && dr.right && "border-r border-slate-100"
                  )}
                >
                  <dt className="shrink-0 text-[11px] md:text-[13px] text-slate-400">{row.label}:</dt>
                  <dd className="min-w-0 flex-1">
                    <ScanSpecValue label={row.label} value={row.value} />
                  </dd>
                </div>
              ) : (
                <div key={j} />
              )
            )}
          </div>
        )
      )}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Pinned spec table with collapsible "More details"
// ---------------------------------------------------------------------------

function PinnedSpecTable({
  order,
  specsArr,
}: {
  order: OrderResult;
  specsArr: { label: string; value: string }[];
}) {
  const [expanded, setExpanded] = useState(false);

  const PINNED = ["line item", "qty", "sku qty", "category", "product"];
  const getVal = (label: string) =>
    specsArr.find(r => r.label.toLowerCase() === label)?.value ?? null;

  const lineItem = getVal("line item");
  const ttlQty   = getVal("qty") ?? (order.qty != null ? String(order.qty) : "—");
  const skuQty   = order.sku_images?.length ? String(order.sku_images.length) : "—";
  const category = getVal("category");
  const product  = getVal("product");
  const rest     = specsArr.filter(r => !PINNED.includes(r.label.toLowerCase()));

  function PinnedCell({ label, value, border = false }: { label: string; value: string | null; border?: boolean }) {
    return (
      <div className={cn("flex items-baseline gap-2 px-4 py-2.5", border && "border-l border-slate-100")}>
        <span className="shrink-0 text-[11px] md:text-[13px] text-slate-400">{label}:</span>
        <span className="min-w-0 break-words text-[13px] md:text-[15px] font-semibold text-slate-900">{value ?? "—"}</span>
      </div>
    );
  }

  return (
    <div className="relative rounded-xl border border-slate-200 bg-white">
      {/* Row 1: Order Number + Main order items (one cell) | Line Item */}
      <div className="grid grid-cols-2 border-b border-slate-100">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5">
          <span className="inline-flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 text-[11px] md:text-[13px] text-slate-400">Order Number:</span>
            <span className="text-[13px] md:text-[15px] font-semibold text-slate-900">
              {order.order_number?.trim() || order.title}
            </span>
          </span>
          <span className="inline-flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 text-[11px] md:text-[13px] text-slate-400">Main order items:</span>
            <MainOrderItemsCount
              count={order.main_item_count}
              parts={order.group_parts ?? []}
              currentOrderId={order.id}
            />
          </span>
        </div>
        <PinnedCell label="Line Item" value={lineItem} border />
      </div>
      {/* Row 2: SKU Qty | Total Qty */}
      <div className="grid grid-cols-2 border-b border-slate-100">
        <PinnedCell label="SKU Qty" value={skuQty} />
        <PinnedCell label="Total Qty" value={ttlQty} border />
      </div>
      {/* Row 3: Category | Product */}
      <div className={cn("grid grid-cols-2", rest.length > 0 && "border-b border-slate-100")}>
        <PinnedCell label="Category" value={category} />
        <PinnedCell label="Product" value={product} border />
      </div>
      {/* Collapsible "More details" */}
      {rest.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-slate-50"
          >
            <span className="text-[10px] md:text-[12px] font-semibold uppercase tracking-wide text-slate-400">
              More details
            </span>
            <div className="flex-1 border-t border-slate-100" />
            <svg
              className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")}
              viewBox="0 0 20 20" fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06z" clipRule="evenodd" />
            </svg>
          </button>
          {expanded && <ScanSpecTable rows={rest} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shipping reminder section
// ---------------------------------------------------------------------------

const SHIPPING_LABELS: Record<string, { label: string; color: string }> = {
  pickup:   { label: "Pickup",   color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  delivery: { label: "FedEx",    color: "bg-blue-50 text-blue-700 border-blue-200" },
  uber:     { label: "Uber",     color: "bg-slate-800 text-white border-slate-800" },
  curri:    { label: "Curri",    color: "bg-orange-50 text-orange-700 border-orange-200" },
};

const BASE_URL = "https://workflow-rho-one.vercel.app";

function ShippingReminderSection({
  order, onShippingCreated, tenantName, customFields, smsConfigured,
}: {
  order: OrderResult;
  onShippingCreated: () => void;
  tenantName: string;
  customFields: CustomField[];
  smsConfigured: boolean;
}) {
  const [sending, setSending] = useState<"pickup" | "shipping" | null>(null);
  const [sent, setSent]       = useState<"pickup" | "shipping" | null>(null);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [setupOrder, setSetupOrder] = useState<OrderWithRelations | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);

  async function openSetup() {
    setSetupLoading(true);
    try {
      const res = await fetch(`/api/orders/${order.id}`);
      const json = await res.json() as { order?: OrderWithRelations };
      if (json.order) { setSetupOrder(json.order); setShowSetup(true); }
    } finally {
      setSetupLoading(false);
    }
  }

  const sr = order.shipping_request;
  const choice = sr?.client_choice ?? null;
  const token  = sr?.token ?? null;
  const phone  = order.customer?.phone ?? null;
  const slipNumber = order.order_number?.trim() || order.title;
  const groupSize = Math.max(1, order.main_item_count ?? 1);

  const lastSentLabel = order.last_sms_at
    ? new Date(order.last_sms_at).toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit",
      })
    : null;
  const shippingUrl = token ? `${BASE_URL}/shipping/${token}` : null;

  const choiceMeta = choice ? SHIPPING_LABELS[choice] : null;

  async function sendReminder(type: "pickup" | "shipping") {
    if (!phone) return;
    setSending(type);
    setSmsError(null);
    setSent(null);

    let body = "";
    if (type === "pickup") {
      if (choice === "pickup") {
        body = `Hi, this is Bazaar Printing. Kindly reminder your order ${order.title} is ready to pickup.`;
      } else {
        // Awaiting — send the portal link
        body = shippingUrl
          ? `Hi, this is Bazaar Printing. Your order ${order.title} is ready. View order and choose pickup or delivery: ${shippingUrl}`
          : `Hi, this is Bazaar Printing. Your order ${order.title} is ready. Please contact us to arrange pickup or delivery.`;
      }
    } else {
      body = shippingUrl
        ? `Hi, this is Bazaar Printing. Your order ${order.title} is ready. View order and choose pickup or delivery: ${shippingUrl}`
        : `Hi, this is Bazaar Printing. Your order ${order.title} is ready. Please contact us to arrange shipping.`;
    }

    try {
      const res = await fetch(`/api/orders/${order.id}/actions/quick-sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, body }),
      });
      const json = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to send SMS");
      setSent(type);
      setTimeout(() => setSent(null), 4000);
    } catch (err) {
      setSmsError(err instanceof Error ? err.message : "Failed to send SMS");
    } finally {
      setSending(null);
    }
  }

  return (
    <>
      {showSetup && setupOrder && (
        <ReadyToShipPopup
          order={setupOrder}
          columnId={order.column_id}
          tenantName={tenantName}
          customFields={customFields}
          fieldValues={{}}
          smsConfigured={smsConfigured}
          onClose={() => { setShowSetup(false); setSetupOrder(null); }}
          onSent={() => { setShowSetup(false); setSetupOrder(null); onShippingCreated(); }}
        />
      )}
    <div>
      <p className="mb-3 text-[11px] md:text-[12px] font-semibold uppercase tracking-wide text-slate-400">
        Shipping
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50 p-3">
        {/* Delivery method badge */}
        {sr && <div className="mb-3 flex items-center gap-2">
          <span className="text-[12px] md:text-[14px] text-slate-500">Delivery option:</span>
          {choiceMeta ? (
            <span className={cn("rounded-full border px-2.5 py-0.5 text-[11px] md:text-[13px] font-semibold", choiceMeta.color)}>
              {choiceMeta.label}
            </span>
          ) : (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] md:text-[13px] font-semibold text-amber-700">
              Awaiting
            </span>
          )}
          {!phone && (
            <span className="ml-auto text-[11px] md:text-[13px] text-slate-400">No phone on file</span>
          )}
        </div>}

        {/* Extra info for delivery types */}
        {choice === "delivery" && (
          <p className="mb-3 text-[12px] md:text-[14px] text-slate-500">FedEx — print shipping label</p>
        )}

        <div className="flex flex-col gap-2">
          {/* No shipping request yet — primary CTA */}
          {!sr && (
            <button
              type="button"
              onClick={() => void openSetup()}
              disabled={setupLoading}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-[14px] font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {setupLoading ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <PackageCheck className="h-4 w-4 shrink-0" />
              )}
              {setupLoading ? "Loading…" : "Set Up Shipping"}
            </button>
          )}

          {/* SMS reminder — primary CTA after shipping portal sent */}
          {sr && (choice === "pickup" || choice === null) && (
            <button
              type="button"
              disabled={!phone || sending !== null}
              onClick={() => void sendReminder(choice === "pickup" ? "pickup" : "shipping")}
              className={cn(
                "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold transition-colors",
                sent !== null
                  ? "bg-emerald-600 text-white"
                  : phone
                    ? "bg-slate-900 text-white hover:bg-slate-700"
                    : "cursor-not-allowed bg-slate-100 text-slate-400"
              )}
            >
              {sending !== null ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : sent !== null ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : choice === "pickup" ? (
                <Package className="h-4 w-4 shrink-0" />
              ) : (
                <Truck className="h-4 w-4 shrink-0" />
              )}
              {sending !== null
                ? "Sending…"
                : sent !== null
                  ? "Reminder Sent ✓"
                  : choice === "pickup"
                    ? "Send Pickup Reminder"
                    : "Send Shipping Reminder"}
            </button>
          )}

          {/* Print + Download — secondary, side by side */}
          <ScanShippingSlipButtons
            orderId={order.id}
            orderNumber={slipNumber}
            groupSize={groupSize}
            compact
          />
        </div>

        {sr && lastSentLabel && (
          <p className="mt-2 text-[11px] md:text-[13px] text-slate-400">Last sent: {lastSentLabel}</p>
        )}

        {smsError && (
          <p className="mt-2 text-[12px] md:text-[14px] text-red-600">{smsError}</p>
        )}
      </div>
    </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

function SortableActionRow({
  button,
  columns,
  onChange,
  onRemove,
}: {
  button: ScanActionButton;
  columns: BoardColumn[];
  onChange: (next: Partial<ScanActionButton>) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: button.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2",
        isDragging && "bg-white shadow-md"
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-600 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <input
        value={button.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder="Button name"
        className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
      />
      <select
        value={button.columnId ?? ""}
        onChange={(e) => onChange({ columnId: e.target.value || null })}
        className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
      >
        <option value="">— not configured —</option>
        {columns.map((col) => (
          <option key={col.id} value={col.id}>
            {col.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Remove button"
        onClick={onRemove}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-red-600"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function SettingsPanel({
  columns,
  buttons,
  onSave,
  onClose,
}: {
  columns: BoardColumn[];
  buttons: ScanActionButton[];
  onSave: (buttons: ScanActionButton[]) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ScanActionButton[]>(buttons);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  function patch(id: string, next: Partial<ScanActionButton>) {
    setDraft((prev) => prev.map((b) => (b.id === id ? { ...b, ...next } : b)));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraft((prev) => {
      const oldIndex = prev.findIndex((b) => b.id === active.id);
      const newIndex = prev.findIndex((b) => b.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const cleaned = draft.map((b) => ({
        ...b,
        label: b.label.trim() || "Action",
      }));
      await onSave(cleaned);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between px-6 pt-6">
          <h2 className="text-base font-semibold text-slate-900">Scan actions</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>
        <p className="px-6 pt-1 text-[13px] text-slate-500">
          Rename, drag to reorder, or remove buttons. Each one moves the scanned order to the column you pick.
        </p>

        <div className="mt-4 flex min-h-0 flex-col gap-2 overflow-y-auto px-6">
          {draft.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-[13px] text-slate-400">
              No scan buttons yet.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={draft.map((b) => b.id)}
                strategy={verticalListSortingStrategy}
              >
                {draft.map((button) => (
                  <SortableActionRow
                    key={button.id}
                    button={button}
                    columns={columns}
                    onChange={(next) => patch(button.id, next)}
                    onRemove={() =>
                      setDraft((prev) => prev.filter((b) => b.id !== button.id))
                    }
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>

        <div className="px-6 pt-3">
          <button
            type="button"
            disabled={draft.length >= MAX_SCAN_BUTTONS}
            onClick={() => setDraft((prev) => [...prev, newScanButton()])}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-blue-700 hover:text-blue-800 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Add button
          </button>
        </div>

        {error && (
          <p className="px-6 pt-2 text-[12px] md:text-[14px] text-red-600">{error}</p>
        )}

        <div className="flex justify-end gap-2 px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 px-4 py-1.5 text-[13px] hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  columns: BoardColumn[];
  initialButtons: ScanActionButton[];
  tenantName: string;
  customFields: CustomField[];
  smsConfigured: boolean;
  /** Public kiosk: `/api/kiosk/<token>`. Defaults to staff `/api/fulfillment/scan`. */
  scanApiBase?: string;
}

export function FulfillmentScanPage({ columns, initialButtons, tenantName, customFields, smsConfigured, scanApiBase }: Props) {
  const scanBase = scanApiBase ?? "/api/fulfillment/scan";
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ label: string; column: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [scanButtons, setScanButtons] = useState<ScanActionButton[]>(initialButtons);
  const [showSettings, setShowSettings] = useState(false);
  const [readyToShipPopup, setReadyToShipPopup] = useState<{
    order: OrderWithRelations;
    columnId: string;
  } | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    const open = () => setShowSettings(true);
    window.addEventListener(SCAN_CONFIGURE_EVENT, open);
    return () => window.removeEventListener(SCAN_CONFIGURE_EVENT, open);
  }, []);

  // Listen for camera-open event (dispatched by nav or other callers)
  useEffect(() => {
    function onCamera(e: Event) {
      const open = (e as CustomEvent<{ open: boolean }>).detail?.open;
      setCameraOpen(Boolean(open));
    }
    window.addEventListener(SCAN_CAMERA_EVENT, onCamera);
    return () => window.removeEventListener(SCAN_CAMERA_EVENT, onCamera);
  }, []);

  // Auto-open camera on mobile when the page first loads
  useEffect(() => {
    if (/Mobi|Android|iPhone/i.test(navigator.userAgent)) {
      setCameraOpen(true);
    }
  }, []);

  // QrScanner lifecycle — starts when cameraOpen, cleans up on close
  useEffect(() => {
    if (!cameraOpen) return;
    let destroyed = false;
    void (async () => {
      const { default: QrScanner } = await import("qr-scanner");
      if (destroyed || !videoRef.current) return;
      const scanner = new QrScanner(
        videoRef.current,
        (result: { data: string }) => {
          const code = result.data.trim();
          if (!code) return;
          scanner.stop();
          scanner.destroy();
          scannerRef.current = null;
          setCameraOpen(false);
          window.dispatchEvent(new CustomEvent(SCAN_QUERY_EVENT, { detail: { query: code } }));
        },
        {
          returnDetailedScanResult: true,
          highlightScanRegion: true,
          highlightCodeOutline: true,
          preferredCamera: "environment",
        }
      );
      scannerRef.current = scanner;
      await scanner.start();
    })();
    return () => {
      destroyed = true;
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current.destroy();
        scannerRef.current = null;
      }
    };
  }, [cameraOpen]);

  const lookup = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    window.dispatchEvent(new CustomEvent(SCAN_LOADING_EVENT, { detail: { loading: true } }));
    setLookupError(null);
    setOrder(null);
    setActionResult(null);
    setActionError(null);
    try {
      const res = await fetch(`${scanBase}?q=${encodeURIComponent(trimmed)}`);
      const json = await res.json();
      if (!res.ok) {
        setLookupError(json.error ?? "Order not found");
      } else {
        setOrder(json as OrderResult);
      }
    } catch {
      setLookupError("Network error");
    } finally {
      setLoading(false);
      window.dispatchEvent(new CustomEvent(SCAN_LOADING_EVENT, { detail: { loading: false } }));
    }
  }, [scanBase]);

  // Listen for scan query events dispatched from the nav input
  useEffect(() => {
    function onQuery(e: Event) {
      const q = (e as CustomEvent<{ query: string }>).detail?.query;
      if (q) void lookup(q);
    }
    window.addEventListener(SCAN_QUERY_EVENT, onQuery);
    return () => window.removeEventListener(SCAN_QUERY_EVENT, onQuery);
  }, [lookup]);

  async function handleAction(button: ScanActionButton) {
    if (!order || !button.columnId) return;
    setActingOn(button.id);
    setActionResult(null);
    setActionError(null);
    try {
      const targetColumn = columns.find((column) => column.id === button.columnId);
      let popupOrder: OrderWithRelations | null = null;
      if (targetColumn?.kind === "ready_to_ship" && !scanApiBase) {
        const orderRes = await fetch(`/api/orders/${order.id}`);
        const orderJson = await orderRes.json().catch(() => ({})) as {
          error?: string;
          order?: OrderWithRelations;
        };
        if (!orderRes.ok || !orderJson.order) {
          throw new Error(orderJson.error ?? "Could not load shipping details");
        }
        popupOrder = orderJson.order;
      }

      const res = await fetch(`${scanBase}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: order.id, button_id: button.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error ?? "Failed");
      } else {
        setActionResult({
          label: button.label,
          column: json.column_name ?? "",
        });
        if (popupOrder && button.columnId) {
          setReadyToShipPopup({
            order: { ...popupOrder, column_id: button.columnId },
            columnId: button.columnId,
          });
          return;
        }
        // Clear order after short delay so the user can see the confirmation
        setTimeout(() => {
          setOrder(null);
          setQuery("");
          setActionResult(null);
          window.dispatchEvent(new Event(SCAN_FOCUS_EVENT));
        }, 2500);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Network error");
    } finally {
      setActingOn(null);
    }
  }

  async function saveConfig(buttons: ScanActionButton[]) {
    const res = await fetch("/api/fulfillment/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scan_column_config: serializeScanButtons(buttons) }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(j.error ?? "Save failed");
    }
    setScanButtons(buttons);
  }

  const late = isLate(order?.due_date ?? null);
  const dueLabel = order?.due_display?.trim() || formatDate(order?.due_date ?? null);
  const specsArr: { label: string; value: string }[] = order
    ? (order.spec_lines?.length
        ? order.spec_lines
        : [
            { label: "Qty", value: order.specs?.quantity },
            { label: "Stock", value: order.specs?.stock },
            { label: "Finish", value: order.specs?.finish },
            { label: "Size", value: order.specs?.size },
            { label: "Color", value: order.specs?.color },
          ]
            .filter((s) => s.value != null && String(s.value).trim() !== "")
            .map((s) => ({ label: s.label, value: String(s.value) }))
      )
    : [];

  return (
    <>
      {readyToShipPopup ? (
        <ReadyToShipPopup
          order={readyToShipPopup.order}
          columnId={readyToShipPopup.columnId}
          tenantName={tenantName}
          customFields={customFields}
          fieldValues={{}}
          smsConfigured={smsConfigured}
          onClose={() => {
            setReadyToShipPopup(null);
            setOrder(null);
            setQuery("");
            setActionResult(null);
            window.dispatchEvent(new Event(SCAN_FOCUS_EVENT));
          }}
          onSent={() => {
            setReadyToShipPopup(null);
            setOrder(null);
            setQuery("");
            setActionResult(null);
            window.dispatchEvent(new Event(SCAN_FOCUS_EVENT));
          }}
        />
      ) : null}

      {/* Artwork lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Artwork"
            className="max-h-[90dvh] max-w-full rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {showSettings && (
        <SettingsPanel
          columns={columns}
          buttons={scanButtons}
          onSave={saveConfig}
          onClose={() => setShowSettings(false)}
        />
      )}

      <div className="flex flex-col lg:h-full lg:min-h-0 lg:flex-1 lg:flex-row lg:overflow-hidden">
        {/* On small screens `contents` unwraps so identity + shipping sit above artwork. */}
        <div className="max-lg:contents flex min-h-0 min-w-0 w-full flex-col lg:h-full lg:w-[55%] lg:overflow-hidden lg:border-r lg:border-slate-100">
          {lookupError && (
            <div className="order-first mx-4 mt-3 shrink-0 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-[13px] md:text-[15px] text-red-700 lg:mx-5 lg:mt-4">
              {lookupError}
            </div>
          )}

          {order && (
            <div className="order-3 shrink-0 border-b border-slate-100 px-4 py-3">
              <p className="mb-1.5 text-[11px] md:text-[12px] font-semibold uppercase tracking-wide text-slate-400">
                Product specification
              </p>
              <PinnedSpecTable order={order} specsArr={specsArr} />
            </div>
          )}

          {order && (
            <div className="order-4 hidden lg:flex min-h-[9rem] max-h-[28vh] flex-col overflow-hidden border-b border-slate-100 px-4 py-3 lg:max-h-none lg:min-h-0 lg:flex-1 lg:border-b-0">
              <p className="mb-2 shrink-0 text-[11px] md:text-[12px] font-semibold uppercase tracking-wide text-slate-400">
                Artwork
              </p>
              {order.sku_images?.length ? (
                <div
                  className="grid min-h-0 flex-1 gap-3"
                  style={{
                    gridTemplateColumns:
                      order.sku_images.length === 1 ? "1fr" : "1fr 1fr",
                    gridTemplateRows: `repeat(${Math.ceil(order.sku_images.length / (order.sku_images.length === 1 ? 1 : 2))}, minmax(0, 1fr))`,
                  }}
                >
                  {order.sku_images.map((sku) => (
                    <div
                      key={sku.sku_id}
                      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                    >
                      <p className="shrink-0 truncate border-b border-slate-100 px-3 py-1.5 text-[11px] font-medium text-slate-700">
                        {sku.sku_name}
                      </p>
                      <div className="relative min-h-0 flex-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={sku.url}
                          alt={sku.sku_name}
                          className="absolute inset-0 h-full w-full object-contain p-2"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : order.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={order.thumbnail_url}
                  alt="Artwork"
                  className="min-h-0 w-full flex-1 rounded-xl border border-slate-100 object-contain"
                />
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-[12px] md:text-[14px] text-slate-400">
                  No artwork preview
                </div>
              )}
            </div>
          )}

          {!order && !loading && !lookupError && (
            <div className={cn("order-2 flex flex-col text-slate-400", cameraOpen ? "px-4 pt-2 lg:flex-1 lg:px-5" : "flex-1 items-center justify-center")}>
              {cameraOpen ? (
                /* Inline camera — fixed height on mobile, fills container on desktop */
                <div className="relative flex h-[65dvh] w-full overflow-hidden rounded-xl bg-black lg:h-full lg:flex-1">
                  <video
                    ref={videoRef}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                  />
                  {/* Aim guide */}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div
                      className="rounded-xl border-2 border-white/80"
                      style={{ width: 200, height: 200, boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }}
                    />
                  </div>
                  <p className="absolute bottom-4 left-0 right-0 text-center text-xs font-medium text-white/70">
                    Point at a QR code or barcode
                  </p>
                  {/* Close button */}
                  <button
                    type="button"
                    aria-label="Close camera"
                    onClick={() => setCameraOpen(false)}
                    className="absolute right-3 top-3 rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 py-16">
                  <svg className="h-10 w-10 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                    <rect x="8" y="8" width="8" height="8" rx="1" />
                  </svg>
                  <p className="text-[13px] md:text-[15px] font-medium text-slate-500">Scan or enter an order number</p>
                  <p className="text-[12px] md:text-[14px]">Order details will appear here</p>
                  {/* Camera button — shown on mobile only */}
                  <button
                    type="button"
                    onClick={() => setCameraOpen(true)}
                    className="md:hidden mt-2 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm active:bg-slate-700"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                    Tap to scan
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="max-lg:contents flex w-full min-w-0 flex-col gap-4 lg:h-full lg:min-h-0 lg:w-[45%] lg:overflow-y-auto lg:px-5 lg:py-5">
          {/* Two cards: identity, then owner/designer + billing */}
          {order && (
            <div className="order-1 flex shrink-0 flex-col gap-3 px-4 pt-4 lg:px-0 lg:pt-0">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {/* Row 1: order # / customer / artwork + X close */}
                <div className="grid min-w-0 divide-x divide-slate-100" style={{ gridTemplateColumns: (order.thumbnail_url || order.sku_images?.length) ? "1fr 1fr auto" : "1fr 1fr" }}>
                  {/* Order # + stage + due + close */}
                  <div className="relative flex min-w-0 flex-col gap-1 px-3 py-3 pr-9">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] md:text-[13px] font-bold text-blue-700">
                        #{order.title}
                      </span>
                      {order.column_name && (
                        <span className={cn("max-w-full rounded-full border px-2 py-0.5 text-[11px] md:text-[13px] leading-snug",
                          isFinishedReviewRequestColumn(order.column_name)
                            ? "whitespace-normal border-red-600 bg-red-600 font-semibold text-white"
                            : "truncate border-blue-600 bg-blue-600 font-semibold text-white")}>
                          {order.column_name}
                        </span>
                      )}
                    </div>
                    <span className={cn("whitespace-nowrap text-[11px] md:text-[13px] font-medium", late ? "text-red-600" : "text-slate-400")}>
                      Due {dueLabel}{late && " · Late"}
                    </span>
                    <button
                      type="button"
                      aria-label="Close order"
                      onClick={() => {
                        setOrder(null);
                        setQuery("");
                        setActionResult(null);
                        setLookupError(null);
                        setCameraOpen(true);
                        window.dispatchEvent(new Event(SCAN_FOCUS_EVENT));
                      }}
                      className="absolute right-1.5 top-1.5 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  {/* Customer */}
                  <div className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-3">
                    <p className="truncate text-[13px] md:text-[15px] font-semibold text-slate-900">
                      {order.customer?.name ?? "Unknown customer"}
                    </p>
                    {order.customer?.email && (
                      <p className="truncate text-[11px] md:text-[13px] text-slate-500">{order.customer.email}</p>
                    )}
                    {order.customer?.phone && (
                      <p className="truncate text-[11px] md:text-[13px] text-slate-500">{formatPhoneDisplay(order.customer.phone)}</p>
                    )}
                  </div>
                  {/* Artwork thumbnail */}
                  {(order.thumbnail_url || order.sku_images?.length) ? (
                    <button type="button" aria-label="View artwork"
                      onClick={() => setLightboxUrl(order.sku_images?.[0]?.url ?? order.thumbnail_url ?? null)}
                      className="relative w-16 shrink-0 overflow-hidden bg-slate-100 md:w-20" style={{ minHeight: "4rem" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={order.sku_images?.[0]?.url ?? order.thumbnail_url ?? ""} alt="Artwork"
                        className="absolute inset-0 h-full w-full object-contain p-1" />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {/* Owner + Designer */}
                <div className="grid grid-cols-2 divide-x divide-slate-100">
                  <div className="flex min-w-0 items-center gap-1.5 px-4 py-3">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-slate-400"><path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.5 1.5 0 0 0 .41 1.412A6.952 6.952 0 0 0 10 18c2.157 0 4.078-.965 5.373-2.486a1.5 1.5 0 0 0 .12-1.688A8.5 8.5 0 0 0 10 10.5a8.5 8.5 0 0 0-6.535 3.993Z" /></svg>
                    <p className="min-w-0 truncate text-[14px] text-slate-900">
                      <span className="font-medium text-slate-500">Owner:</span>{" "}
                      <span className="font-semibold">{order.owner_name ?? "—"}</span>
                    </p>
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 px-4 py-3">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-slate-400"><path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .205 1.251l-1.18 2.044a1 1 0 0 1-1.186.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.113a7.048 7.048 0 0 1 0-2.228L1.821 8.513a1 1 0 0 1-.205-1.251l1.18-2.044a1 1 0 0 1 1.186-.447l1.598.54A6.993 6.993 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" /></svg>
                    <p className="min-w-0 truncate text-[14px] text-slate-900">
                      <span className="font-medium text-slate-500">Designer:</span>{" "}
                      <span className="font-semibold">{order.designer_name ?? "—"}</span>
                    </p>
                  </div>
                </div>

                {/* Deposit + Balance — only when billing exists */}
                {order.billing && (order.billing.deposit != null || order.billing.balance != null) && (
                  <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50">
                    {order.billing.deposit != null ? (
                      <p className="min-w-0 truncate px-4 py-3 text-[14px]">
                        <span className="font-medium text-slate-500">Deposit:</span>{" "}
                        <span className="font-semibold text-emerald-600">−${Math.abs(order.billing.deposit).toFixed(2)}</span>
                      </p>
                    ) : <div />}
                    {order.billing.balance != null ? (
                      <p className="min-w-0 truncate px-4 py-3 text-[14px]">
                        <span className="font-medium text-slate-500">Balance due:</span>{" "}
                        <span className={cn("font-semibold", order.billing.balance > 0 ? "text-red-600" : "text-slate-900")}>
                          ${order.billing.balance.toFixed(2)}
                        </span>
                      </p>
                    ) : <div />}
                  </div>
                )}
              </div>
            </div>
          )}

          {order && (() => {
            const orderColumn = columns.find((c) => c.id === order.column_id);
            // "Finished…" and "Fulfil…" columns are done-stage regardless of kind
            const isFinishedStage = /fulfil|^\s*finished\b/i.test(orderColumn?.name ?? "");
            const isShippingColumn =
              orderColumn?.kind === "ready_to_ship" ||
              (!isFinishedStage && orderColumn?.kind === "normal" && !!order.shipping_request);
            return (
              <div className="order-3 flex shrink-0 flex-col gap-4 px-4 pt-1 lg:px-0 lg:pt-0">
                {isShippingColumn ? (
                  <ShippingReminderSection
                    order={order}
                    onShippingCreated={() => void lookup(order.title)}
                    tenantName={tenantName}
                    customFields={customFields}
                    smsConfigured={smsConfigured}
                  />
                ) : (
                  <ScanShippingSlipButtons
                    orderId={order.id}
                    orderNumber={order.order_number?.trim() || order.title}
                    groupSize={Math.max(1, order.main_item_count ?? 1)}
                  />
                )}
              </div>
            );
          })()}

          <div className="order-5 flex flex-col gap-4 px-4 pb-4 pt-1 lg:px-0 lg:pb-0 lg:pt-0">

          {/* Action success */}
          {actionResult && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] md:text-[15px] font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {actionResult.label} — moved to <span className="font-semibold">{actionResult.column}</span>
            </div>
          )}

          {/* Action error */}
          {actionError && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[13px] md:text-[15px] text-red-700">
              {actionError}
            </div>
          )}

          {/* Actions */}
          <div>
            <p className="mb-3 text-[11px] md:text-[12px] font-semibold uppercase tracking-wide text-slate-400">
              Actions
            </p>
            <div className="flex flex-col gap-2">
              {scanButtons.map((button, index) => {
                const configured = !!button.columnId;
                const columnName =
                  columns.find((c) => c.id === button.columnId)?.name ?? null;
                return (
                  <button
                    key={button.id}
                    type="button"
                    onClick={() => void handleAction(button)}
                    onMouseDown={(e) => e.preventDefault()}
                    disabled={!order || !configured || actingOn !== null}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-[13px] md:text-[15px] font-medium transition-colors",
                      order && configured
                        ? "border-slate-200 bg-white hover:bg-slate-50 text-slate-800"
                        : "border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                        order && configured
                          ? ACTION_ICON_COLORS[index % ACTION_ICON_COLORS.length]
                          : "bg-slate-100 text-slate-400"
                      )}
                    >
                      <ActionGlyph index={index} />
                    </span>
                    <span className="flex-1">
                      <span className="block">{button.label}</span>
                      <span className="block text-[11px] md:text-[13px] font-normal text-slate-500">
                        {configured
                          ? `Move to ${columnName ?? "column"}`
                          : "Not configured — set column in Configure columns"}
                      </span>
                    </span>
                    {actingOn === button.id ? (
                      <span className="text-[11px] md:text-[13px] text-slate-400">…</span>
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                    )}
                  </button>
                );
              })}
              {scanButtons.length === 0 ? (
                <p className="text-[12px] md:text-[14px] text-slate-400">
                  No scan buttons. Add them in Configure columns.
                </p>
              ) : null}
            </div>
          </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function InfoRow({
  label,
  value,
  icon,
  danger,
}: {
  label: string;
  value: string;
  icon: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="flex items-center gap-1.5 text-[12px] md:text-[14px] text-slate-500">
        {icon === "user" && (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        )}
        {icon === "palette" && (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><circle cx="9" cy="10" r="1.5" fill="currentColor" /><circle cx="15" cy="10" r="1.5" fill="currentColor" /><circle cx="12" cy="15" r="1.5" fill="currentColor" />
          </svg>
        )}
        {icon === "calendar" && (
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />
          </svg>
        )}
        {label}
      </span>
      <span className={cn("text-[13px] md:text-[15px] font-medium", danger ? "text-red-600" : "text-slate-800")}>
        {value}
      </span>
    </div>
  );
}

function BalanceRow({
  label,
  value,
  positive,
  danger,
}: {
  label: string;
  value: number;
  positive?: boolean;
  danger?: boolean;
}) {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[13px] md:text-[15px] text-slate-500">{label}</span>
      <span
        className={cn(
          "text-[13px] md:text-[15px] font-semibold",
          positive && "text-emerald-600",
          danger && "text-red-600",
          !positive && !danger && "text-slate-800"
        )}
      >
        {positive ? "−" : ""}{formatted}
      </span>
    </div>
  );
}
