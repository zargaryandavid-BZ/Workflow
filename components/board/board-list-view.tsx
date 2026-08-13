"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { BoardColumn, CustomField, OrderWithRelations } from "@/lib/types";
import {
  customerNameFromOrder,
  productFromOrder,
} from "@/lib/notification-messages";
import { formatShortOrderNumber } from "./order-number-label";
import { partCardTitle } from "@/lib/group-orders";
import { formatTimeInColumn } from "@/lib/card-warning-rules";
import { calendarDaysUntilDue } from "@/lib/board-due-date";
import { formatDateShort } from "@/lib/utils";

type SortKey =
  | "order"
  | "customer"
  | "item"
  | "stage"
  | "owner"
  | "designer"
  | "due"
  | "incol";

interface Props {
  orders: OrderWithRelations[];
  columns: BoardColumn[];
  customFields: CustomField[];
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  thumbnailByOrder: Record<string, string[]>;
  ownerNameByOrder: Record<string, string>;
  designerNameByOrder: Record<string, string>;
  onOpenOrder: (order: OrderWithRelations) => void;
}

/**
 * Flat, sortable list of every order across all stages (like the old InkCloud
 * Orders list). Uses the board's already-filtered orders, so the top search /
 * person / owner / source / due / Emergency filters all apply here too.
 */
export function BoardListView({
  orders,
  columns,
  customFields,
  fieldValuesByOrder,
  thumbnailByOrder,
  ownerNameByOrder,
  designerNameByOrder,
  onOpenOrder,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [asc, setAsc] = useState(true);

  const columnName = useMemo(() => {
    const m = new Map<string, string>();
    columns.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [columns]);
  const columnIndex = useMemo(() => {
    const m = new Map<string, number>();
    columns.forEach((c, i) => m.set(c.id, i));
    return m;
  }, [columns]);

  const rows = useMemo(() => {
    const enriched = orders.map((o) => {
      const fv = fieldValuesByOrder[o.id] ?? {};
      const product = productFromOrder(fv, customFields);
      const daysToDue = o.due_date ? calendarDaysUntilDue(o.due_date) : null;
      return {
        order: o,
        orderNo: formatShortOrderNumber(o.title),
        customer: customerNameFromOrder(o, fv, customFields),
        item: partCardTitle(o, product) || product,
        stage: columnName.get(o.column_id) ?? "",
        stageIdx: columnIndex.get(o.column_id) ?? 999,
        owner: ownerNameByOrder[o.id] ?? "",
        designer: designerNameByOrder[o.id] ?? "",
        daysToDue,
        inCol: formatTimeInColumn(o.last_moved_at, Date.now()),
        thumb: thumbnailByOrder[o.id]?.[0] ?? null,
      };
    });
    const dir = asc ? 1 : -1;
    const cmp = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true });
    enriched.sort((a, b) => {
      switch (sortKey) {
        case "order":
          return dir * cmp(a.orderNo, b.orderNo);
        case "customer":
          return dir * cmp(a.customer, b.customer);
        case "item":
          return dir * cmp(a.item, b.item);
        case "stage":
          return dir * (a.stageIdx - b.stageIdx);
        case "owner":
          return dir * cmp(a.owner, b.owner);
        case "designer":
          return dir * cmp(a.designer, b.designer);
        case "due": {
          const av = a.daysToDue ?? Number.MAX_SAFE_INTEGER;
          const bv = b.daysToDue ?? Number.MAX_SAFE_INTEGER;
          return dir * (av - bv);
        }
        case "incol": {
          const av = new Date(a.order.last_moved_at ?? 0).getTime();
          const bv = new Date(b.order.last_moved_at ?? 0).getTime();
          return dir * (av - bv);
        }
      }
    });
    return enriched;
  }, [
    orders,
    fieldValuesByOrder,
    customFields,
    columnName,
    columnIndex,
    ownerNameByOrder,
    designerNameByOrder,
    thumbnailByOrder,
    sortKey,
    asc,
  ]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(true);
    }
  }

  const headers: { key: SortKey; label: string }[] = [
    { key: "order", label: "Order" },
    { key: "customer", label: "Customer" },
    { key: "item", label: "Item" },
    { key: "stage", label: "Stage" },
    { key: "owner", label: "Owner" },
    { key: "designer", label: "Designer" },
    { key: "due", label: "Due" },
    { key: "incol", label: "In col" },
  ];

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto px-4 pb-4">
      <div className="mb-2 text-[11px] text-slate-500">
        {rows.length} order{rows.length === 1 ? "" : "s"}
      </div>
      <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-white">
          <tr>
            {headers.map((h) => (
              <th
                key={h.key}
                onClick={() => toggleSort(h.key)}
                className="cursor-pointer select-none border-b border-slate-200 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-800"
              >
                {h.label}
                {sortKey === h.key ? (asc ? " ↑" : " ↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const late = r.daysToDue != null && r.daysToDue < 0;
            const dueToday = r.daysToDue === 0;
            return (
              <tr
                key={r.order.id}
                onClick={() => onOpenOrder(r.order)}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-slate-800">
                  <span className="inline-flex items-center gap-2">
                    {r.thumb ? (
                      <Image
                        src={r.thumb}
                        alt=""
                        width={24}
                        height={24}
                        unoptimized
                        className="h-6 w-6 shrink-0 rounded object-cover"
                      />
                    ) : null}
                    {r.orderNo}
                  </span>
                </td>
                <td className="max-w-[180px] truncate px-3 py-1.5 text-slate-700">
                  {r.customer === "there" ? "" : r.customer}
                </td>
                <td className="max-w-[220px] truncate px-3 py-1.5 text-slate-700">
                  {r.item}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">
                  {r.stage}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">
                  {r.owner}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">
                  {r.designer}
                </td>
                <td
                  className={cn(
                    "whitespace-nowrap px-3 py-1.5",
                    late
                      ? "font-semibold text-red-600"
                      : dueToday
                        ? "font-semibold text-amber-600"
                        : "text-slate-600"
                  )}
                >
                  {r.order.due_date ? formatDateShort(r.order.due_date) : "—"}
                  {late ? ` (${Math.abs(r.daysToDue as number)}d late)` : ""}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">
                  {r.inCol?.label ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
