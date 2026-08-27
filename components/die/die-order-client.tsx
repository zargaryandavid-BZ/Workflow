"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import {
  dieManufacturerLabel,
  type DieManufacturer,
} from "@/lib/die-manufacturers";
import {
  DIE_MAX_FILES,
  dieRequestAlert,
  type DieRequest,
} from "@/lib/die-request";
import { cn, formatDate } from "@/lib/utils";
import { RequiredDatePicker } from "@/components/die/required-date-picker";
import { DieRequestCard } from "@/components/die/die-request-card";
import { formatShortOrderNumber } from "@/lib/board-order-filters";

type OrderHit = {
  id: string;
  title: string;
  orderNumber: string;
  dueDate: string | null;
  customerName: string | null;
  email: string | null;
  productName: string | null;
  width: string | null;
  height: string | null;
  depth: string | null;
};

export function DieOrderClient({
  requests,
  manufacturers,
}: {
  requests: DieRequest[];
  manufacturers: DieManufacturer[];
}) {
  const router = useRouter();
  const [orderQuery, setOrderQuery] = useState("");
  const [hits, setHits] = useState<OrderHit[]>([]);
  const [orderPickerOpen, setOrderPickerOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [order, setOrder] = useState<OrderHit | null>(null);
  const [productName, setProductName] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [depth, setDepth] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [manufacturerId, setManufacturerId] = useState(
    manufacturers[0]?.id ?? ""
  );
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [allowOwnDate, setAllowOwnDate] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!manufacturerId && manufacturers[0]?.id) {
      setManufacturerId(manufacturers[0].id);
    }
  }, [manufacturers, manufacturerId]);

  useEffect(() => {
    if (!orderPickerOpen) {
      setHits([]);
      return;
    }
    const q = orderQuery.trim();
    const t = window.setTimeout(() => {
      void fetch(`/api/die-requests/orders?q=${encodeURIComponent(q)}`)
        .then((res) => res.json())
        .then((json: { orders?: OrderHit[] }) => {
          setHits(
            (json.orders ?? []).map((hit) => ({
              ...hit,
              orderNumber:
                hit.orderNumber || formatShortOrderNumber(hit.title),
            }))
          );
        })
        .catch(() => setHits([]));
    }, q ? 200 : 0);
    return () => window.clearTimeout(t);
  }, [orderQuery, orderPickerOpen, order?.id]);

  function pickOrder(hit: OrderHit) {
    const orderNumber = hit.orderNumber || formatShortOrderNumber(hit.title);
    setOrder({ ...hit, orderNumber });
    setOrderQuery(orderNumber);
    setHits([]);
    setOrderPickerOpen(false);
    setProductName(hit.productName ?? "");
    setWidth(hit.width ?? "");
    setHeight(hit.height ?? "");
    setDepth(hit.depth ?? "");
    if (hit.dueDate && !requiredDate) {
      setRequiredDate(hit.dueDate.slice(0, 10));
    }
  }

  const alarms = useMemo(
    () =>
      requests
        .map((req) => ({ req, alert: dieRequestAlert(req) }))
        .filter(
          (row): row is { req: DieRequest; alert: NonNullable<ReturnType<typeof dieRequestAlert>> } =>
            Boolean(row.alert)
        ),
    [requests]
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!order) {
      setError("Pick an order number from the board.");
      return;
    }
    if (!requiredDate) {
      setError("Pick a required date.");
      return;
    }
    if (!manufacturerId) {
      setError("Select a die manufacturer in Settings first.");
      return;
    }
    setSending(true);
    try {
      const form = new FormData();
      form.set("orderId", order.id);
      form.set("manufacturerId", manufacturerId);
      form.set("productName", productName);
      form.set("width", width);
      form.set("height", height);
      form.set("depth", depth);
      form.set("requiredDate", requiredDate);
      form.set("allowOwnDate", allowOwnDate ? "true" : "false");
      form.set("comment", comment);
      for (const f of files) form.append("files", f);
      const res = await fetch("/api/die-requests", { method: "POST", body: form });
      const json = (await res.json()) as { error?: string; warning?: string | null };
      if (!res.ok) throw new Error(json.error ?? "Failed to send");
      setNotice(
        json.warning
          ? `Request saved, but email did not send: ${json.warning}`
          : "Die request emailed to the manufacturer."
      );
      setOrder(null);
      setOrderQuery("");
      setProductName("");
      setWidth("");
      setHeight("");
      setDepth("");
      setComment("");
      setFiles([]);
      setAllowOwnDate(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-8">
      {alarms.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <AlertTriangle className="h-4 w-4" />
            Die due date alarms
          </p>
          <ul className="space-y-1 text-sm text-red-800">
            {alarms.map(({ req, alert }) => (
              <li key={req.id}>
                {req.order_title ?? "Order"} — {alert.label} (
                {formatDate(alert.confirmedDueDate)})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form
        onSubmit={(e) => void submit(e)}
        className={cn(
          "relative space-y-3 overflow-visible rounded-lg border border-slate-200 bg-white p-4",
          orderPickerOpen || datePickerOpen ? "z-30" : "z-0"
        )}
      >
        <h2 className="text-sm font-semibold text-slate-800">New die request</h2>
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <div className="relative z-40 w-[7.5rem] shrink-0">
            <Label htmlFor="die-order">Order number</Label>
            <Input
              id="die-order"
              className="mt-1.5"
              value={orderQuery}
              onChange={(e) => {
                setOrder(null);
                setProductName("");
                setWidth("");
                setHeight("");
                setDepth("");
                setOrderQuery(e.target.value);
                setOrderPickerOpen(true);
              }}
              onFocus={() => setOrderPickerOpen(true)}
              onBlur={() => {
                window.setTimeout(() => setOrderPickerOpen(false), 150);
              }}
              placeholder="Board order #"
              autoComplete="off"
              role="combobox"
              aria-expanded={orderPickerOpen}
              aria-controls="die-order-hits"
            />
            {orderPickerOpen ? (
              <ul
                id="die-order-hits"
                className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full min-w-[16rem] overflow-auto rounded-md border border-slate-200 bg-white shadow-lg"
                onMouseDown={(e) => e.preventDefault()}
              >
                {hits.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-slate-500">
                    {orderQuery.trim()
                      ? "No matching board orders"
                      : "Type a board order number"}
                  </li>
                ) : (
                  hits.map((hit) => {
                    const number =
                      hit.orderNumber || formatShortOrderNumber(hit.title);
                    return (
                      <li key={hit.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                          onClick={() => pickOrder(hit)}
                        >
                          <span className="font-medium tabular-nums">
                            {number}
                          </span>
                          {hit.productName ? (
                            <span className="text-slate-500">
                              {" "}
                              · {hit.productName}
                            </span>
                          ) : hit.customerName ? (
                            <span className="text-slate-500">
                              {" "}
                              · {hit.customerName}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            ) : null}
          </div>
          <div className="min-w-[8rem] w-[11rem] shrink-0">
            <Label htmlFor="die-product">Product</Label>
            <Input
              id="die-product"
              className="mt-1.5"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="From order"
            />
          </div>
          <div className="w-[5.5rem] shrink-0">
            <Label htmlFor="die-x">Width (X)</Label>
            <Input
              id="die-x"
              className="mt-1.5"
              type="number"
              min="0"
              step="0.001"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
            />
          </div>
          <div className="w-[5.5rem] shrink-0">
            <Label htmlFor="die-y">Height (Y)</Label>
            <Input
              id="die-y"
              className="mt-1.5"
              type="number"
              min="0"
              step="0.001"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </div>
          <div className="w-[5.5rem] shrink-0">
            <Label htmlFor="die-z">Depth (Z)</Label>
            <Input
              id="die-z"
              className="mt-1.5"
              type="number"
              min="0"
              step="0.001"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
            />
          </div>
          <div className="relative z-40 w-[9.5rem] shrink-0">
            <Label htmlFor="die-required">Required date</Label>
            <RequiredDatePicker
              id="die-required"
              value={requiredDate}
              dueDate={order?.dueDate ? order.dueDate.slice(0, 10) : null}
              dueLabel="Order due"
              selectedLabel="Required date"
              onChange={setRequiredDate}
              onOpenChange={setDatePickerOpen}
            />
          </div>
          <div className="w-[6.75rem] shrink-0">
            <Label htmlFor="die-own-date">Own date</Label>
            <label
              htmlFor="die-own-date"
              className="mt-1.5 flex h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700"
              title="Allow the manufacturer to offer their own due date"
            >
              <input
                id="die-own-date"
                type="checkbox"
                className="h-4 w-4 accent-blue-600"
                checked={allowOwnDate}
                onChange={(e) => setAllowOwnDate(e.target.checked)}
              />
              Allow
            </label>
          </div>
          <div className="w-[13.7rem] shrink-0">
            <Label htmlFor="die-manufacturer">Die manufacturer</Label>
            {manufacturers.length === 0 ? (
              <p className="mt-1.5 truncate text-xs text-slate-500">
                Add in Settings first.
              </p>
            ) : (
              <Select
                id="die-manufacturer"
                className="mt-1.5"
                value={manufacturerId}
                onChange={(e) => setManufacturerId(e.target.value)}
                required
              >
                {manufacturers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {dieManufacturerLabel(m)}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className="min-w-[12rem] flex-[2]">
            <Label htmlFor="die-comment">Comment</Label>
            <Input
              id="die-comment"
              className="mt-1.5"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="w-[11rem] shrink-0">
            <Label htmlFor="die-file">Files (up to {DIE_MAX_FILES})</Label>
            <label
              htmlFor="die-file"
              className="mt-1.5 flex h-10 cursor-pointer items-center truncate rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50"
              title={
                files.length
                  ? files.map((f) => f.name).join(", ")
                  : "Attach up to 5 pictures or files"
              }
            >
              <Paperclip className="mr-1 h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {files.length
                  ? `${files.length} file${files.length === 1 ? "" : "s"}`
                  : "Attach"}
              </span>
            </label>
            <input
              id="die-file"
              className="sr-only"
              type="file"
              multiple
              onChange={(e) => {
                const next = [
                  ...files,
                  ...Array.from(e.target.files ?? []),
                ].slice(0, DIE_MAX_FILES);
                setFiles(next);
                e.target.value = "";
              }}
            />
          </div>
          <Button
            type="submit"
            disabled={sending || manufacturers.length === 0}
            className="shrink-0 whitespace-nowrap"
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {notice ? (
          <p className="text-sm text-emerald-700">{notice}</p>
        ) : null}
      </form>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">
          Requests
        </h2>
        {requests.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No die requests yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {requests.map((req) => (
              <DieRequestCard
                key={req.id}
                req={req}
                manufacturers={manufacturers}
                onSaved={(msg) => {
                  if (msg) setNotice(msg);
                  router.refresh();
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
