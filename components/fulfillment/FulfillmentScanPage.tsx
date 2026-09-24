"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  CircleCheck,
  GripVertical,
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
import type { BoardColumn } from "@/lib/types";
import {
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
import type { CustomField, OrderWithRelations } from "@/lib/types";

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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
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
            <span className="text-[13px] md:text-[15px] font-semibold text-slate-900">
              {order.main_item_count != null ? String(order.main_item_count) : "—"}
            </span>
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
      <p className="mb-2 text-[11px] md:text-[12px] font-semibold uppercase tracking-wide text-slate-400">
        Shipping
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50 p-3">
        {/* No shipping request yet */}
        {!sr && (
          <button
            type="button"
            onClick={() => void openSetup()}
            disabled={setupLoading}
            className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-[13px] md:text-[15px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <PackageCheck className="h-4 w-4" />
            </span>
            <span className="flex-1">{setupLoading ? "Loading…" : "Set Up Shipping"}</span>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </button>
        )}

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

        {/* SMS buttons — contextual: pickup→only pickup reminder, awaiting→only select shipping */}
        <div className="flex flex-col gap-2">
          {(choice === "pickup" || choice === null) && (
            <button
              type="button"
              disabled={!phone || sending !== null}
              onClick={() => void sendReminder(choice === "pickup" ? "pickup" : "shipping")}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-[13px] md:text-[15px] font-medium transition-colors",
                phone
                  ? "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                  : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400"
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 text-base">
                {choice === "pickup" ? "📦" : "🚚"}
              </span>
              <span className="flex-1">
                {sending !== null ? "Sending…" : sent !== null ? "✓ Sent" : choice === "pickup" ? "Reminder Pickup" : "Reminder Select Shipping"}
              </span>
            </button>
          )}
        </div>

        {lastSentLabel && (
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
}

export function FulfillmentScanPage({ columns, initialButtons, tenantName, customFields, smsConfigured }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ label: string; column: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [scanButtons, setScanButtons] = useState<ScanActionButton[]>(initialButtons);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const open = () => setShowSettings(true);
    window.addEventListener(SCAN_CONFIGURE_EVENT, open);
    return () => window.removeEventListener(SCAN_CONFIGURE_EVENT, open);
  }, []);

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
      const res = await fetch(`/api/fulfillment/scan?q=${encodeURIComponent(trimmed)}`);
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
  }, []);

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
      const res = await fetch("/api/fulfillment/scan/action", {
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
        // Clear order after short delay so the user can see the confirmation
        setTimeout(() => {
          setOrder(null);
          setQuery("");
          setActionResult(null);
          window.dispatchEvent(new Event(SCAN_FOCUS_EVENT));
        }, 2500);
      }
    } catch {
      setActionError("Network error");
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
      {showSettings && (
        <SettingsPanel
          columns={columns}
          buttons={scanButtons}
          onSave={saveConfig}
          onClose={() => setShowSettings(false)}
        />
      )}

      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {/* ---------------------------------------------------------------- */}
        {/* LEFT — scan input + order details                                */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b border-slate-100 md:w-[55%] md:border-b-0 md:border-r">
          {/* Lookup error */}
          {lookupError && (
            <div className="mx-5 mt-4 shrink-0 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-[13px] md:text-[15px] text-red-700">
              {lookupError}
            </div>
          )}

          {/* Order details */}
          {order && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Product specification */}
              <div className="shrink-0 border-b border-slate-100 px-4 py-3">
                <p className="mb-1.5 text-[11px] md:text-[12px] font-semibold uppercase tracking-wide text-slate-400">
                  Product specification
                </p>
                <PinnedSpecTable order={order} specsArr={specsArr} />
              </div>

              {/* Artwork fills remaining height; images scale to fit */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3">
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
            </div>
          )}

          {/* Empty state */}
          {!order && !loading && !lookupError && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-slate-400">
              <svg className="h-10 w-10 opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                <rect x="8" y="8" width="8" height="8" rx="1" />
              </svg>
              <p className="text-[13px] md:text-[15px] font-medium text-slate-500">Scan or enter an order number</p>
              <p className="text-[12px] md:text-[14px]">Order details will appear here</p>
            </div>
          )}
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* RIGHT — order info, balance, actions                             */}
        {/* ---------------------------------------------------------------- */}
        <div className="flex w-full min-w-0 flex-col gap-4 overflow-y-auto px-4 py-4 md:w-[45%] md:px-5 md:py-5">

          {/* Customer + Order identity card — compact 2-column */}
          {order && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="grid grid-cols-2 divide-x divide-slate-100">
                {/* Left: order # + status + due */}
                <div className="flex flex-col gap-1 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] md:text-[13px] font-bold text-blue-700">
                      #{order.title}
                    </span>
                    {order.column_name && (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] md:text-[13px] font-medium text-slate-600">
                        {order.column_name}
                      </span>
                    )}
                  </div>
                  <span className={cn("text-[11px] md:text-[13px] font-medium", late ? "text-red-600" : "text-slate-400")}>
                    Due {dueLabel}{late && " · Late"}
                  </span>
                </div>
                {/* Right: customer name + contact */}
                <div className="flex flex-col justify-center gap-0.5 px-3 py-2.5">
                  <p className="truncate text-[13px] md:text-[15px] font-semibold text-slate-900">
                    {order.customer?.name ?? "Unknown customer"}
                  </p>
                  {order.customer?.email && (
                    <p className="truncate text-[11px] md:text-[13px] text-slate-500">{order.customer.email}</p>
                  )}
                  {order.customer?.phone && (
                    <p className="text-[11px] md:text-[13px] text-slate-500">{order.customer.phone}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Shipping reminders */}
          {order && (
            <ShippingReminderSection
              order={order}
              onShippingCreated={() => void lookup(order.title)}
              tenantName={tenantName}
              customFields={customFields}
              smsConfigured={smsConfigured}
            />
          )}

          {/* Order info + Balance — side by side on md+, stacked on mobile */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Order info card */}
            <div className="flex flex-col">
              <p className="mb-2 text-[11px] md:text-[12px] font-semibold uppercase tracking-wide text-slate-400">
                Order info
              </p>
              <div className="flex-1 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <InfoRow label="Owner" value={order?.owner_name ?? "—"} icon="user" />
                <div className="my-1.5 border-t border-slate-100" />
                <InfoRow label="Designer" value={order?.designer_name ?? "—"} icon="palette" />
              </div>
            </div>

            {/* Balance card */}
            <div className="flex flex-col">
              <p className="mb-2 text-[11px] md:text-[12px] font-semibold uppercase tracking-wide text-slate-400">
                Balance
              </p>
              <div className="flex-1 rounded-xl border border-slate-100 bg-slate-50 p-3">
                {order?.billing ? (
                  <>
                    {order.billing.deposit != null && (
                      <BalanceRow label="Deposit paid" value={order.billing.deposit} positive />
                    )}
                    {order.billing.balance != null && (
                      <BalanceRow label="Balance due" value={order.billing.balance} danger />
                    )}
                    {!order.billing.deposit && !order.billing.balance && (
                      <p className="text-[12px] md:text-[14px] text-slate-400">No billing data</p>
                    )}
                  </>
                ) : (
                  <p className="text-[12px] md:text-[14px] text-slate-400">
                    {order ? "No billing data" : "Scan an order to see balance"}
                  </p>
                )}
              </div>
            </div>
          </div>

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
            <p className="mb-2 text-[11px] md:text-[12px] font-semibold uppercase tracking-wide text-slate-400">
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
