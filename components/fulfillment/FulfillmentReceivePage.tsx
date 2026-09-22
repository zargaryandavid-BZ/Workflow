"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Package,
  Plus,
  Search,
  X,
} from "lucide-react";
import { FulfillmentBoxSlipButtons } from "@/components/fulfillment/FulfillmentBoxSlipButtons";
import { FulfillmentOrderThumb } from "@/components/fulfillment/FulfillmentOrderThumb";
import {
  boxesForReceiveDay,
  fulfillmentBoxLabel,
  localDayKey,
  localDayLabel,
  receivedDayKeys,
} from "@/lib/fulfillment-day";
import {
  boxReceiveStatusFromLines,
  defaultBoxReceiveStatus,
  FULFILLMENT_RECEIVE_STATUSES,
  FULFILLMENT_RECEIVE_STATUS_LABEL,
  isFulfillmentReceiveStatus,
  type FulfillmentReceiveStatus,
} from "@/lib/fulfillment-receive-status";
import { fulfillmentDisplayQty } from "@/lib/fulfillment-expected-qty";
import {
  formatShortOrderNumber,
  orderMatchesNumberSearch,
} from "@/lib/order-number-tokens";
import { cn } from "@/lib/utils";

interface Box {
  id: string;
  box_number: string;
  status: "open" | "sent" | "received";
  order_count: number;
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
  receive_status?: FulfillmentReceiveStatus | null;
  receive_comment?: string | null;
}

interface OrderInBox {
  id: string;
  title: string;
  specs: Record<string, unknown> | null;
  column_id: string | null;
  box_order_id: string;
  quantity_expected: number | null;
  quantity_received: number | null;
  receive_status?: FulfillmentReceiveStatus | null;
  thumbnail_url?: string | null;
}

function sortBoxes(a: Box, b: Box): number {
  return a.box_number.localeCompare(b.box_number, undefined, { numeric: true });
}

function calcQty(
  quantityExpected: number | null | undefined,
  specs: Record<string, unknown> | null
): number {
  return fulfillmentDisplayQty(quantityExpected, specs);
}

function rowMatchesSearch(order: OrderInBox, q: string): boolean {
  return (
    orderMatchesNumberSearch(order, q) ||
    formatShortOrderNumber(order.title).toLowerCase().includes(q.toLowerCase())
  );
}

function statusSelectClass(status: FulfillmentReceiveStatus): string {
  if (status === "counted") {
    return "border-green-300 bg-green-50 text-green-800";
  }
  if (status === "missing") {
    return "border-amber-300 bg-amber-50 text-amber-900";
  }
  return "border-blue-300 bg-blue-50 text-blue-800";
}

export function FulfillmentReceivePage() {
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [boxOrders, setBoxOrders] = useState<Record<string, OrderInBox[]>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [statusByBox, setStatusByBox] = useState<
    Record<string, FulfillmentReceiveStatus>
  >({});
  const [commentByBox, setCommentByBox] = useState<Record<string, string>>({});
  const [savingBoxId, setSavingBoxId] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedReceivedDay, setSelectedReceivedDay] = useState<string | null>(
    null
  );
  const [orderSearch, setOrderSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addBoxId, setAddBoxId] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const daySelectInit = useRef(false);

  const loadBoxContents = useCallback(async (list: Box[]) => {
    const nextOrders: Record<string, OrderInBox[]> = {};
    const nextQty: Record<string, number> = {};
    const nextStatus: Record<string, FulfillmentReceiveStatus> = {};
    const nextComment: Record<string, string> = {};
    await Promise.all(
      list.map(async (box) => {
        let apiOrders: OrderInBox[] = [];
        let apiBox: Partial<Box> = {};
        try {
          const res = await fetch(`/api/fulfillment/boxes/${box.id}`);
          if (res.ok) {
            const data = (await res.json()) as Box & { orders: OrderInBox[] };
            apiOrders = data.orders ?? [];
            apiBox = data;
          }
        } catch {
          /* non-fatal */
        }
        const orders = apiOrders;
        nextOrders[box.id] = orders;
        for (const o of orders) {
          const expected = calcQty(o.quantity_expected, o.specs);
          nextQty[o.id] = expected;
        }
        const stored =
          isFulfillmentReceiveStatus(apiBox.receive_status)
            ? apiBox.receive_status
            : isFulfillmentReceiveStatus(box.receive_status)
              ? box.receive_status
              : null;
        nextStatus[box.id] =
          stored ??
          boxReceiveStatusFromLines(orders.map((o) => o.receive_status));
        nextComment[box.id] =
          apiBox.receive_comment ?? box.receive_comment ?? "";
      })
    );
    setBoxOrders(nextOrders);
    setQuantities((prev) => ({ ...prev, ...nextQty }));
    setStatusByBox((prev) => ({ ...prev, ...nextStatus }));
    setCommentByBox((prev) => ({ ...prev, ...nextComment }));
  }, []);

  const loadBoxes = useCallback(async () => {
    try {
      const res = await fetch("/api/fulfillment/boxes");
      let list: Box[] = [];
      if (res.ok) {
        const data = (await res.json()) as Box[];
        list = data.filter((b) => b.status === "sent" || b.status === "received");
      }
      setBoxes(list);
      if (!daySelectInit.current) {
        daySelectInit.current = true;
      }
      await loadBoxContents(list);
    } catch {
      setBoxes([]);
      if (!daySelectInit.current) {
        daySelectInit.current = true;
      }
    } finally {
      setLoading(false);
    }
  }, [loadBoxContents]);

  useEffect(() => {
    void loadBoxes();
  }, [loadBoxes]);

  const dayKeys = useMemo(() => receivedDayKeys(boxes), [boxes]);

  useEffect(() => {
    if (
      selectedReceivedDay &&
      !dayKeys.includes(selectedReceivedDay)
    ) {
      setSelectedReceivedDay(null);
    }
  }, [dayKeys, selectedReceivedDay]);

  const deliveredBoxes = useMemo(
    () =>
      boxes
        .filter((b) => b.status === "sent")
        .slice()
        .sort(sortBoxes),
    [boxes]
  );

  const availableToAdd = deliveredBoxes;

  const viewingIncoming = selectedReceivedDay === null;
  const dayBoxes = useMemo(() => {
    return boxesForReceiveDay(boxes, selectedReceivedDay)
      .slice()
      .sort(sortBoxes);
  }, [boxes, selectedReceivedDay]);

  const displayedBoxes = useMemo(() => {
    const q = orderSearch.trim();
    if (!q) return dayBoxes;
    return boxes
      .filter((box) => box.status !== "open")
      .filter((box) =>
        (boxOrders[box.id] ?? []).some((order) => rowMatchesSearch(order, q))
      )
      .slice()
      .sort(sortBoxes);
  }, [boxes, boxOrders, dayBoxes, orderSearch]);

  async function handleApprove(box: Box) {
    const receivedAt = new Date().toISOString();
    setApproving(box.id);
    setErrors((prev) => ({ ...prev, [box.id]: "" }));
    const orders = boxOrders[box.id] ?? [];
    const quantitiesPayload = orders.map((o) => ({
      orderId: o.id,
      quantity: quantities[o.id] ?? calcQty(o.quantity_expected, o.specs),
    }));

    try {
      const res = await fetch(`/api/fulfillment/boxes/${box.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantities: quantitiesPayload,
          status: statusByBox[box.id] ?? "received",
          comment: commentByBox[box.id] ?? "",
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setErrors((prev) => ({ ...prev, [box.id]: data.error ?? "Failed" }));
        return;
      }
      setSelectedReceivedDay(localDayKey(receivedAt));
      await loadBoxes();
    } catch {
      setErrors((prev) => ({ ...prev, [box.id]: "Network error" }));
    } finally {
      setApproving(null);
    }
  }

  async function persistBoxOutcome(
    box: Box,
    status: FulfillmentReceiveStatus,
    comment: string
  ) {
    if (box.status !== "received") return;
    setSavingBoxId(box.id);
    try {
      const res = await fetch(
        `/api/fulfillment/boxes/${box.id}/receive-status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, comment }),
        }
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrors((prev) => ({
          ...prev,
          [box.id]: data.error ?? "Could not save box",
        }));
      }
    } catch {
      setErrors((prev) => ({ ...prev, [box.id]: "Network error" }));
    } finally {
      setSavingBoxId(null);
    }
  }

  async function handleBoxStatus(box: Box, status: FulfillmentReceiveStatus) {
    setStatusByBox((prev) => ({ ...prev, [box.id]: status }));
    setBoxes((prev) =>
      prev.map((b) => (b.id === box.id ? { ...b, receive_status: status } : b))
    );
    await persistBoxOutcome(box, status, commentByBox[box.id] ?? "");
  }

  async function handleBoxComment(box: Box, comment: string) {
    setCommentByBox((prev) => ({ ...prev, [box.id]: comment }));
    await persistBoxOutcome(
      box,
      statusByBox[box.id] ?? "received",
      comment
    );
  }

  function handleAddDeliveredBox(e?: React.FormEvent) {
    e?.preventDefault();
    if (!addBoxId) {
      setAddError("Select an incoming box");
      return;
    }
    setShowAddModal(false);
    setAddBoxId("");
    setAddError(null);
    setSelectedReceivedDay(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {(dayKeys.length > 0 || deliveredBoxes.length > 0) && (
          <button
            type="button"
            onClick={() => setSelectedReceivedDay(null)}
            className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${
              viewingIncoming
                ? "bg-slate-900 text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            Incoming
          </button>
        )}
        {dayKeys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSelectedReceivedDay(key)}
            className={`rounded-md px-2.5 py-1.5 text-sm font-medium tabular-nums ${
              selectedReceivedDay === key
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
            placeholder="Search order id"
            className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setShowAddModal(true);
              setAddError(null);
              setAddBoxId(availableToAdd[0]?.id ?? "");
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Add box
          </button>
        </div>
      </div>

      {showAddModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                Add incoming box
              </h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded p-1 text-slate-400 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleAddDeliveredBox} className="space-y-3">
              <label className="block text-sm text-slate-600">
                Incoming box (delivered, not checked in)
                <select
                  value={addBoxId}
                  onChange={(e) => {
                    setAddBoxId(e.target.value);
                    setAddError(null);
                  }}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select a box</option>
                  {availableToAdd.map((box) => {
                    const nums = (boxOrders[box.id] ?? [])
                      .map((o) => formatShortOrderNumber(o.title))
                      .filter(Boolean);
                    const shown = nums.slice(0, 4).join(", ");
                    const extra =
                      nums.length > 4 ? ` +${nums.length - 4}` : "";
                    return (
                      <option key={box.id} value={box.id}>
                        {fulfillmentBoxLabel(box)}
                        {shown ? ` · ${shown}${extra}` : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
              {availableToAdd.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No incoming boxes. Mark a box delivered on Send first.
                </p>
              ) : null}
              {addError ? (
                <p className="text-sm text-red-600">{addError}</p>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!addBoxId}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {addError && !showAddModal ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {addError}
        </div>
      ) : null}

      {displayedBoxes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
          {orderSearch.trim()
            ? "No boxes match that order id."
            : viewingIncoming
              ? "Click Add box and choose a delivered box to check in."
              : `Nothing was received on ${localDayLabel(selectedReceivedDay ?? "")}.`}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-300 bg-slate-200">
          <div className="flex min-h-[28rem] divide-x divide-slate-300">
            {displayedBoxes.map((box) => {
              const orders = boxOrders[box.id] ?? [];
              const isReceived = box.status === "received";
              const isApproving = approving === box.id;
              const ttlQty = orders.reduce(
                (sum, order) =>
                  sum + calcQty(order.quantity_expected, order.specs),
                0
              );
              const boxStatus: FulfillmentReceiveStatus =
                statusByBox[box.id] ??
                (isFulfillmentReceiveStatus(box.receive_status)
                  ? box.receive_status
                  : "received");
              return (
                <section
                  key={box.id}
                  className="flex h-[38rem] w-80 shrink-0 flex-col bg-white"
                >
                  <header
                    className={`flex items-center justify-center gap-2 border-b px-2 py-2 ${
                      isReceived
                        ? "border-green-300 bg-green-200"
                        : "border-blue-300 bg-blue-200"
                    }`}
                  >
                    <h2 className="text-center text-base font-semibold tabular-nums text-slate-900">
                      {fulfillmentBoxLabel(box)}
                    </h2>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                        isReceived
                          ? "bg-green-600 text-white"
                          : "bg-blue-600 text-white"
                      )}
                    >
                      {isReceived ? "received" : "delivered"}
                    </span>
                  </header>

                  <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-2 px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <span className="w-7" />
                    <span>Order number</span>
                    <span className="text-right">Exp</span>
                    <span className="text-right">Recv</span>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
                    <ul>
                      {orders.map((order) => {
                        const expectedQty = calcQty(
                          order.quantity_expected,
                          order.specs
                        );
                        return (
                          <li
                            key={order.id}
                            className="border-b border-slate-100 py-1.5"
                          >
                            <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-2">
                            <FulfillmentOrderThumb
                              url={order.thumbnail_url}
                              label={formatShortOrderNumber(order.title)}
                            />
                            <span className="truncate font-mono text-sm font-medium tabular-nums text-slate-900">
                              {formatShortOrderNumber(order.title)}
                            </span>
                            <span className="text-right font-mono text-sm tabular-nums text-slate-600">
                              {expectedQty}
                            </span>
                            {isReceived ? (
                              <span className="min-w-[2.5rem] text-right font-mono text-sm tabular-nums text-slate-600">
                                {order.quantity_received ?? expectedQty}
                              </span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                value={quantities[order.id] ?? expectedQty}
                                onChange={(e) => {
                                  const quantity = Number(e.target.value);
                                  setQuantities((prev) => {
                                    const next = {
                                      ...prev,
                                      [order.id]: quantity,
                                    };
                                    const lines = orders.map((row) => {
                                      const expected = calcQty(
                                        row.quantity_expected,
                                        row.specs
                                      );
                                      return {
                                        expected,
                                        received:
                                          row.id === order.id
                                            ? quantity
                                            : (next[row.id] ?? expected),
                                      };
                                    });
                                    setStatusByBox((s) => ({
                                      ...s,
                                      [box.id]: defaultBoxReceiveStatus(lines),
                                    }));
                                    return next;
                                  });
                                }}
                                className="w-14 rounded border border-slate-300 px-1 py-0.5 text-right font-mono text-sm tabular-nums focus:border-blue-500 focus:outline-none"
                              />
                            )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="mt-auto border-t border-slate-200 bg-white px-3 py-2">
                    <div className="mb-2 flex items-center justify-between text-sm font-semibold">
                      <span className="uppercase tracking-wide text-slate-500">
                        TTL qty
                      </span>
                      <span className="font-mono tabular-nums text-slate-900">
                        {ttlQty}
                      </span>
                    </div>
                    {errors[box.id] ? (
                      <p className="mb-2 text-xs text-red-600">{errors[box.id]}</p>
                    ) : null}
                    <div className="mb-2 space-y-1.5">
                      <select
                        aria-label="Box receive status"
                        value={boxStatus}
                        disabled={savingBoxId === box.id}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (!isFulfillmentReceiveStatus(next)) return;
                          void handleBoxStatus(box, next);
                        }}
                        className={cn(
                          "w-full rounded border px-1.5 py-1 text-[11px] font-medium focus:outline-none",
                          statusSelectClass(boxStatus)
                        )}
                      >
                        {FULFILLMENT_RECEIVE_STATUSES.map((id) => (
                          <option key={id} value={id}>
                            {FULFILLMENT_RECEIVE_STATUS_LABEL[id]}
                          </option>
                        ))}
                      </select>
                      <textarea
                        aria-label="Box comment"
                        placeholder="Comment"
                        rows={2}
                        value={commentByBox[box.id] ?? ""}
                        onChange={(e) =>
                          setCommentByBox((prev) => ({
                            ...prev,
                            [box.id]: e.target.value,
                          }))
                        }
                        onBlur={(e) => {
                          void handleBoxComment(box, e.target.value);
                        }}
                        className="w-full resize-none rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    {!isReceived ? (
                      <button
                        type="button"
                        onClick={() => void handleApprove(box)}
                        disabled={isApproving}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {isApproving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        Approve received
                      </button>
                    ) : (
                      <p className="flex items-center justify-center gap-1 text-xs font-medium text-green-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Checked in
                        {box.received_at
                          ? ` · ${localDayLabel(localDayKey(box.received_at))}`
                          : ""}
                      </p>
                    )}
                    <FulfillmentBoxSlipButtons
                      boxId={box.id}
                      hasOrders={orders.length > 0}
                    />
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
