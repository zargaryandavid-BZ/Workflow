"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Plus,
  Search,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { localDayKey, localDayLabel, fulfillmentBoxLabel, fulfillmentDateTimeLabel } from "@/lib/fulfillment-day";
import { FulfillmentBoxSlipButtons } from "@/components/fulfillment/FulfillmentBoxSlipButtons";
import { FulfillmentOrderThumb } from "@/components/fulfillment/FulfillmentOrderThumb";
import { fulfillmentDisplayQty } from "@/lib/fulfillment-expected-qty";
import {
  formatShortOrderNumber,
  orderMatchesNumberSearch,
} from "@/lib/order-number-tokens";

interface Box {
  id: string;
  box_number: string;
  status: "open" | "sent" | "received";
  order_count: number;
  created_at: string;
  sent_at: string | null;
}

interface OrderInBox {
  id: string;
  title: string;
  specs: Record<string, unknown> | null;
  column_id: string | null;
  box_order_id: string;
  quantity_expected: number | null;
  thumbnail_url?: string | null;
}

type QtyEdit = { boxId: string; orderId: string; value: string };

function boxCountInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 2);
  const n = Number(digits);
  if (!digits || !Number.isFinite(n) || n < 1) return digits;
  return String(Math.min(24, n));
}

function boxCountValue(value: string): number {
  const n = Math.floor(Number(boxCountInput(value)));
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(24, n);
}

function scanQrInput(value: string): string {
  return value.replace(/\s+/g, "").slice(0, 10);
}

function qtyInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

function sortBoxes(a: Box, b: Box): number {
  return a.box_number.localeCompare(b.box_number, undefined, { numeric: true });
}

function rowMatchesSearch(
  order: { title: string; specs?: Record<string, unknown> | null },
  q: string
): boolean {
  return (
    orderMatchesNumberSearch(order, q) ||
    formatShortOrderNumber(order.title).toLowerCase().includes(q.toLowerCase())
  );
}

export function FulfillmentSendPage() {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [ordersByBox, setOrdersByBox] = useState<Record<string, OrderInBox[]>>(
    {}
  );
  const [loadingBoxIds, setLoadingBoxIds] = useState<Set<string>>(new Set());
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);

  const [showNewRow, setShowNewRow] = useState(false);
  const [newBoxNumber, setNewBoxNumber] = useState("1");
  const [creatingBox, setCreatingBox] = useState(false);
  const newBoxRef = useRef<HTMLInputElement>(null);

  const [scanValue, setScanValue] = useState("");
  const [scanError, setScanError] = useState("");
  const [addingBoxId, setAddingBoxId] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const [qtyEdit, setQtyEdit] = useState<QtyEdit | null>(null);
  const qtyEditRef = useRef<HTMLInputElement>(null);

  const [deliveringBoxId, setDeliveringBoxId] = useState<string | null>(null);
  const [deliverErrorByBox, setDeliverErrorByBox] = useState<
    Record<string, string>
  >({});
  const [rowErrorByBox, setRowErrorByBox] = useState<Record<string, string>>(
    {}
  );

  const [error, setError] = useState<string | null>(null);
  const [selectedSentDay, setSelectedSentDay] = useState<string | null>(null);
  const [orderSearch, setOrderSearch] = useState("");

  const packingBoxes = useMemo(
    () => boxes.filter((b) => b.status === "open"),
    [boxes]
  );

  const sentDayKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const box of boxes) {
      if (
        box.sent_at &&
        (box.status === "sent" || box.status === "received")
      ) {
        const key = localDayKey(box.sent_at);
        if (key) keys.add(key);
      }
    }
    return [...keys].sort().reverse();
  }, [boxes]);

  const viewingHistory = Boolean(selectedSentDay);
  const historyBoxes = useMemo(() => {
    if (!selectedSentDay) return [];
    return boxes
      .filter(
        (b) =>
          b.sent_at &&
          (b.status === "sent" || b.status === "received") &&
          localDayKey(b.sent_at) === selectedSentDay
      )
      .slice()
      .sort(sortBoxes);
  }, [boxes, selectedSentDay]);

  const viewBoxes = viewingHistory ? historyBoxes : packingBoxes;

  const displayedBoxes = useMemo(() => {
    const q = orderSearch.trim();
    if (!q) return viewBoxes;
    return viewBoxes.filter((box) => {
      const orders = ordersByBox[box.id] ?? [];
      return orders.some((order) => rowMatchesSearch(order, q));
    });
  }, [orderSearch, viewBoxes, ordersByBox]);

  const boxesLoadGen = useRef(0);

  const loadBoxOrders = useCallback(async (boxId: string) => {
    setLoadingBoxIds((prev) => new Set(prev).add(boxId));
    try {
      const res = await fetch(`/api/fulfillment/boxes/${boxId}`);
      if (res.ok) {
        const data = (await res.json()) as { orders: OrderInBox[] };
        setOrdersByBox((prev) => ({ ...prev, [boxId]: data.orders ?? [] }));
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoadingBoxIds((prev) => {
        const next = new Set(prev);
        next.delete(boxId);
        return next;
      });
    }
  }, []);

  const loadBoxes = useCallback(async () => {
    const gen = ++boxesLoadGen.current;
    try {
      const res = await fetch("/api/fulfillment/boxes");
      if (!res.ok) return;
      const list = ((await res.json()) as Box[]).slice().sort(sortBoxes);
      if (gen !== boxesLoadGen.current) return;
      setBoxes(list);
      await Promise.all(list.map((box) => loadBoxOrders(box.id)));
    } catch {
      /* non-fatal */
    }
  }, [loadBoxOrders]);

  useEffect(() => {
    void loadBoxes();
  }, [loadBoxes]);

  useEffect(() => {
    if (showNewRow) setTimeout(() => newBoxRef.current?.focus(), 30);
  }, [showNewRow]);

  useEffect(() => {
    if (qtyEdit) setTimeout(() => qtyEditRef.current?.focus(), 30);
  }, [qtyEdit]);

  useEffect(() => {
    if (packingBoxes.length === 0) {
      setSelectedBoxId(null);
      return;
    }
    if (
      !selectedBoxId ||
      !packingBoxes.some((b) => b.id === selectedBoxId)
    ) {
      setSelectedBoxId(packingBoxes[0].id);
    }
  }, [packingBoxes, selectedBoxId]);

  useEffect(() => {
    if (!selectedBoxId || viewingHistory) return;
    setTimeout(() => scanRef.current?.focus(), 30);
  }, [selectedBoxId, viewingHistory]);

  function selectBox(boxId: string) {
    setSelectedBoxId(boxId);
    setScanError("");
  }

  async function handleCreateBox(e?: React.FormEvent) {
    e?.preventDefault();
    const count = boxCountValue(newBoxNumber);
    if (!count) return;
    setCreatingBox(true);
    setError(null);
    try {
      const res = await fetch("/api/fulfillment/boxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ add: count }),
      });
      const data = (await res.json()) as {
        error?: string;
        created?: number;
        ids?: string[];
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to create boxes");
        return;
      }
      if (!data.created) {
        setError("Could not create a new box");
        return;
      }
      const newId = data.ids?.[data.ids.length - 1] ?? null;
      setNewBoxNumber("1");
      setShowNewRow(false);
      setSelectedSentDay(null);
      await loadBoxes();
      if (newId) setSelectedBoxId(newId);
    } catch {
      setError("Network error");
    } finally {
      setCreatingBox(false);
    }
  }

  async function handleDeleteBox(boxId: string) {
    if (!confirm("Delete this box? This cannot be undone.")) return;
    setError(null);
    try {
      const res = await fetch(`/api/fulfillment/boxes/${boxId}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not delete box");
        return;
      }
      boxesLoadGen.current += 1;
      setBoxes((prev) => prev.filter((b) => b.id !== boxId));
      setOrdersByBox((prev) => {
        const next = { ...prev };
        delete next[boxId];
        return next;
      });
      if (selectedBoxId === boxId) setSelectedBoxId(null);
      await loadBoxes();
    } catch {
      setError("Could not delete box");
    }
  }

  async function handleAddOrder() {
    if (!selectedBoxId) return;
    const scanned = scanValue.trim();
    if (!scanned) return;
    setAddingBoxId(selectedBoxId);
    setScanError("");
    try {
      const res = await fetch(`/api/fulfillment/boxes/${selectedBoxId}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_number: scanned }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setScanError(data.error ?? "Order not found");
        return;
      }
      setScanValue("");
      await Promise.all([loadBoxOrders(selectedBoxId), loadBoxes()]);
    } catch {
      setScanError("Network error");
    } finally {
      setAddingBoxId(null);
      setTimeout(() => scanRef.current?.focus(), 50);
    }
  }

  async function handleRemoveOrder(boxId: string, orderId: string) {
    try {
      await fetch(`/api/fulfillment/boxes/${boxId}/orders/${orderId}`, {
        method: "DELETE",
      });
      setOrdersByBox((prev) => ({
        ...prev,
        [boxId]: (prev[boxId] ?? []).filter((o) => o.id !== orderId),
      }));
      await loadBoxes();
    } catch {
      /* non-fatal */
    }
  }

  async function commitQtyEdit() {
    if (!qtyEdit) return;
    const qty = Math.floor(Number(qtyEdit.value));
    if (!Number.isFinite(qty) || qty < 1) {
      setQtyEdit(null);
      return;
    }
    try {
      const res = await fetch(
        `/api/fulfillment/boxes/${qtyEdit.boxId}/orders/${qtyEdit.orderId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity_expected: qty }),
        }
      );
      if (res.ok) {
        setOrdersByBox((prev) => ({
          ...prev,
          [qtyEdit.boxId]: (prev[qtyEdit.boxId] ?? []).map((order) =>
            order.id === qtyEdit.orderId
              ? { ...order, quantity_expected: qty }
              : order
          ),
        }));
      }
    } catch {
      /* non-fatal */
    } finally {
      setQtyEdit(null);
    }
  }

  async function handleMoveOrder(
    fromBoxId: string,
    orderId: string,
    toBoxId: string
  ) {
    if (!toBoxId || toBoxId === fromBoxId) return;
    if (!packingBoxes.some((b) => b.id === toBoxId && b.status === "open")) {
      setRowErrorByBox((prev) => ({
        ...prev,
        [fromBoxId]: "Cannot move into a delivered box",
      }));
      return;
    }
    setRowErrorByBox((prev) => ({ ...prev, [fromBoxId]: "" }));
    try {
      const res = await fetch(
        `/api/fulfillment/boxes/${fromBoxId}/orders/${orderId}/move`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toBoxId }),
        }
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setRowErrorByBox((prev) => ({
          ...prev,
          [fromBoxId]: data.error ?? "Could not move order",
        }));
        return;
      }
      await Promise.all([
        loadBoxOrders(fromBoxId),
        loadBoxOrders(toBoxId),
        loadBoxes(),
      ]);
    } catch {
      setRowErrorByBox((prev) => ({ ...prev, [fromBoxId]: "Network error" }));
    }
  }

  async function handleDeliver(boxId: string) {
    setDeliveringBoxId(boxId);
    setDeliverErrorByBox((prev) => ({ ...prev, [boxId]: "" }));
    try {
      const res = await fetch(`/api/fulfillment/boxes/${boxId}/deliver`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setDeliverErrorByBox((prev) => ({
          ...prev,
          [boxId]: data.error ?? "Failed",
        }));
        return;
      }
      await loadBoxes();
      setSelectedSentDay(localDayKey(new Date()));
    } catch {
      setDeliverErrorByBox((prev) => ({
        ...prev,
        [boxId]: "Network error",
      }));
    } finally {
      setDeliveringBoxId(null);
    }
  }

  return (
    <div className="w-full px-3 py-4 sm:px-4 sm:py-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {sentDayKeys.length > 0 && (
          <button
            type="button"
            onClick={() => setSelectedSentDay(null)}
            className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${
              !selectedSentDay
                ? "bg-slate-900 text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            Current
          </button>
        )}
        {sentDayKeys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSelectedSentDay(key)}
            className={`rounded-md px-2.5 py-1.5 text-sm font-medium tabular-nums ${
              selectedSentDay === key
                ? "bg-slate-900 text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {localDayLabel(key)}
          </button>
        ))}
        <label className="relative ml-auto min-w-[10rem] max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            placeholder="Search order #"
            className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <div className="flex items-center gap-2">
          {showNewRow ? (
            <form onSubmit={handleCreateBox} className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-500">
                How many boxes
              </label>
              <input
                ref={newBoxRef}
                type="text"
                inputMode="numeric"
                maxLength={2}
                placeholder="1"
                value={newBoxNumber}
                onChange={(e) => setNewBoxNumber(boxCountInput(e.target.value))}
                className="w-12 rounded-md border border-slate-300 px-1 py-1.5 text-center text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={creatingBox || !boxCountValue(newBoxNumber)}
                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {creatingBox ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowNewRow(false);
                  setNewBoxNumber("1");
                }}
                className="rounded p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowNewRow(true);
                setNewBoxNumber("1");
                setSelectedSentDay(null);
                setError(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              New Box
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {displayedBoxes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
          {viewingHistory
            ? orderSearch.trim()
              ? "No sent orders match that number on this date."
              : "Nothing was sent on this date."
            : orderSearch.trim()
              ? "No open box has that order number."
              : "No open boxes. Use New Box to start packing."}
        </div>
      ) : (
        <div className="w-full overflow-visible rounded-lg border border-slate-300 bg-slate-200">
          <div className="grid w-full grid-cols-1 gap-px bg-slate-300 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {displayedBoxes.map((box) => {
              const orders = ordersByBox[box.id] ?? [];
              const loading = loadingBoxIds.has(box.id);
              const q = orderSearch.trim();
              const visibleOrders = q
                ? orders.filter((order) => rowMatchesSearch(order, q))
                : orders;
              const selected =
                !viewingHistory && selectedBoxId === box.id;
              const ttlQty = orders.reduce(
                (sum, order) =>
                  sum +
                  fulfillmentDisplayQty(order.quantity_expected, order.specs),
                0
              );
              const isDelivered =
                viewingHistory ||
                box.status === "sent" ||
                box.status === "received";
              const canEdit = !isDelivered;
              const otherBoxes = canEdit
                ? packingBoxes.filter(
                    (b) => b.id !== box.id && b.status === "open"
                  )
                : [];
              return (
                <section
                  key={box.id}
                  onClick={() => {
                    if (!isDelivered) selectBox(box.id);
                  }}
                  className={`flex h-[32rem] min-w-0 flex-col overflow-hidden ${
                    isDelivered ? "bg-slate-100" : "bg-white"
                  } ${selected ? "ring-2 ring-inset ring-blue-500" : ""}`}
                >
                  <header
                    className={`relative flex shrink-0 items-center justify-center border-b px-8 py-2 ${
                      isDelivered
                        ? "border-slate-200 bg-slate-200"
                        : "border-slate-300 bg-slate-50"
                    }`}
                  >
                    <h2 className="text-center text-base font-semibold tabular-nums text-slate-900">
                      {fulfillmentBoxLabel(box)}
                    </h2>
                    {isDelivered ? (
                      <span className="absolute right-2 rounded-full bg-slate-500 px-2 py-0.5 text-[11px] font-medium text-white">
                        delivered
                      </span>
                    ) : (
                      <button
                        type="button"
                        title="Delete box"
                        aria-label="Delete box"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteBox(box.id);
                        }}
                        className="absolute right-1.5 rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </header>

                  <div className="grid shrink-0 grid-cols-[auto_1fr_auto] gap-x-2 px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <span className="w-7" />
                    <span>Order number</span>
                    <span className="text-right">Qty</span>
                  </div>

                  {canEdit ? (
                  <div
                    className="shrink-0 px-3 pt-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {selected ? (
                      <>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Scan QR code
                        </label>
                        <input
                          ref={scanRef}
                          type="text"
                          inputMode="text"
                          maxLength={10}
                          size={10}
                          placeholder="0000-0"
                          value={scanValue}
                          onChange={(e) =>
                            setScanValue(scanQrInput(e.target.value))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleAddOrder();
                            }
                          }}
                          className="w-full min-w-0 rounded-md border border-blue-400 px-1.5 py-1.5 font-mono text-sm tabular-nums tracking-wide focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        {addingBoxId === box.id ? (
                          <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Adding…
                          </p>
                        ) : null}
                        {scanError ? (
                          <p className="mt-1 text-xs text-red-600">{scanError}</p>
                        ) : null}
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => selectBox(box.id)}
                        className="w-full rounded-md border border-dashed border-slate-300 px-2 py-2 text-left text-xs text-slate-500 hover:border-blue-400 hover:text-blue-700"
                      >
                        Tap to scan into {fulfillmentBoxLabel(box)}
                      </button>
                    )}
                  </div>
                  ) : null}

                  <div className="mx-3 mt-2 border-t border-slate-300" />

                  <div
                    className="min-h-0 flex-1 overflow-y-auto px-3 py-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {loading && orders.length === 0 ? (
                      <p className="flex items-center gap-1 py-3 text-xs text-slate-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading…
                      </p>
                    ) : (
                      <ul className="flex flex-col" style={{ gap: 10 }}>
                        {visibleOrders.map((order) => {
                          const qty = fulfillmentDisplayQty(
                            order.quantity_expected,
                            order.specs
                          );
                          const editing =
                            qtyEdit?.boxId === box.id &&
                            qtyEdit.orderId === order.id;
                          return (
                            <li
                              key={order.id}
                              className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2"
                            >
                              <FulfillmentOrderThumb
                                url={order.thumbnail_url}
                                label={formatShortOrderNumber(order.title)}
                              />
                              <span className="truncate font-mono text-sm font-medium tabular-nums text-slate-900">
                                {formatShortOrderNumber(order.title)}
                              </span>
                              <div className="flex items-center gap-1">
                                {editing ? (
                                  <input
                                    ref={qtyEditRef}
                                    type="text"
                                    inputMode="numeric"
                                    value={qtyEdit.value}
                                    onChange={(e) =>
                                      setQtyEdit({
                                        ...qtyEdit,
                                        value: qtyInput(e.target.value),
                                      })
                                    }
                                    onBlur={() => void commitQtyEdit()}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        void commitQtyEdit();
                                      }
                                      if (e.key === "Escape") setQtyEdit(null);
                                    }}
                                    className="w-14 rounded border border-blue-400 px-1 py-0.5 text-right font-mono text-sm tabular-nums focus:outline-none"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    title="Edit qty"
                                    onClick={() =>
                                      setQtyEdit({
                                        boxId: box.id,
                                        orderId: order.id,
                                        value: String(qty),
                                      })
                                    }
                                    className="min-w-[2.5rem] rounded px-1 py-0.5 text-right font-mono text-sm tabular-nums text-slate-600 hover:bg-white hover:ring-1 hover:ring-slate-300"
                                  >
                                    {qty}
                                  </button>
                                )}
                                {canEdit && otherBoxes.length > 0 ? (
                                  <select
                                    aria-label="Move to box"
                                    defaultValue=""
                                    onChange={(e) => {
                                      const toBoxId = e.target.value;
                                      e.target.value = "";
                                      void handleMoveOrder(
                                        box.id,
                                        order.id,
                                        toBoxId
                                      );
                                    }}
                                    className="max-w-[5.5rem] rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-600"
                                  >
                                    <option value="" disabled>
                                      Move
                                    </option>
                                    {otherBoxes.map((target) => (
                                      <option key={target.id} value={target.id}>
                                        {fulfillmentBoxLabel(target)}
                                      </option>
                                    ))}
                                  </select>
                                ) : null}
                                {canEdit ? (
                                <button
                                  type="button"
                                  title="Remove from box"
                                  onClick={() =>
                                    void handleRemoveOrder(box.id, order.id)
                                  }
                                  className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {rowErrorByBox[box.id] ? (
                      <p className="mt-1 text-xs text-red-600">
                        {rowErrorByBox[box.id]}
                      </p>
                    ) : null}
                  </div>

                  <div
                    className={`mt-auto shrink-0 border-t px-3 py-2 ${
                      isDelivered
                        ? "border-slate-200 bg-slate-200/80"
                        : "border-slate-200 bg-white"
                    }`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                      <span className="uppercase tracking-wide text-slate-500">
                        TTL qty
                      </span>
                      <span className="font-mono tabular-nums text-slate-900">
                        {ttlQty}
                      </span>
                    </div>
                    {isDelivered ? (
                      <FulfillmentBoxSlipButtons boxId={box.id} />
                    ) : null}
                    {isDelivered ? (
                      <p className="mt-2 text-center text-xs font-medium text-slate-500">
                        Sent{" "}
                        {box.sent_at
                          ? fulfillmentDateTimeLabel(box.sent_at)
                          : ""}
                      </p>
                    ) : (
                      <>
                    <button
                      type="button"
                      onClick={() => void handleDeliver(box.id)}
                      disabled={
                        deliveringBoxId === box.id || orders.length === 0
                      }
                      className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-40"
                    >
                      {deliveringBoxId === box.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Truck className="h-3.5 w-3.5" />
                      )}
                      Mark as Delivered ({orders.length})
                    </button>
                    {deliverErrorByBox[box.id] ? (
                      <p className="mt-1 text-xs text-red-600">
                        {deliverErrorByBox[box.id]}
                      </p>
                    ) : null}
                      </>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
