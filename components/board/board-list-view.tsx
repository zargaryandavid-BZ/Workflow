"use client";

import { Fragment, useMemo, useState } from "react";
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
import { priorityScoreFromSpecs } from "@/lib/order-priority-score";

type GroupBy = "none" | "designer" | "owner";
const UNASSIGNED = "Unassigned";

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
  // Per-person priority queue: group by designer/owner and, within each person,
  // order by priority (highest first) then due date — their "do this first" list.
  const [groupBy, setGroupBy] = useState<GroupBy>("none");

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
        priority: priorityScoreFromSpecs(o.specs) ?? 0,
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

  // Per-person queues: buckets keyed by person, each ordered by priority (high
  // first) then soonest due — everyone's "do this first" list.
  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const buckets = new Map<string, typeof rows>();
    for (const r of rows) {
      const name = (groupBy === "designer" ? r.designer : r.owner) || UNASSIGNED;
      const list = buckets.get(name) ?? [];
      list.push(r);
      buckets.set(name, list);
    }
    for (const list of buckets.values()) {
      list.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        const av = a.daysToDue ?? Number.MAX_SAFE_INTEGER;
        const bv = b.daysToDue ?? Number.MAX_SAFE_INTEGER;
        return av - bv;
      });
    }
    return Array.from(buckets.entries()).sort(([a], [b]) => {
      if (a === UNASSIGNED) return 1;
      if (b === UNASSIGNED) return -1;
      return a.localeCompare(b);
    });
  }, [rows, groupBy]);

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

  const renderRow = (r: (typeof rows)[number]) => {
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
            {r.priority ? (
              <span
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[9px] font-bold text-white"
                title={`Priority ${r.priority}`}
              >
                {r.priority}
              </span>
            ) : null}
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
  };

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto px-4 pb-4">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-[11px] text-slate-500">
          {rows.length} order{rows.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-500">
          Queue by
          {(
            [
              { key: "none", label: "None" },
              { key: "designer", label: "Designer" },
              { key: "owner", label: "Owner" },
            ] as { key: GroupBy; label: string }[]
          ).map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGroupBy(g.key)}
              className={cn(
                "rounded px-1.5 py-0.5 font-medium",
                groupBy === g.key
                  ? "bg-slate-800 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              {g.label}
            </button>
          ))}
        </span>
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
          {groups
            ? groups.map(([person, list]) => (
                <Fragment key={person}>
                  <tr className="bg-slate-50">
                    <td
                      colSpan={headers.length}
                      className="sticky left-0 border-b border-t border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
                    >
                      {person}{" "}
                      <span className="font-normal text-slate-400">
                        · {list.length}
                      </span>
                    </td>
                  </tr>
                  {list.map((r) => renderRow(r))}
                </Fragment>
              ))
            : rows.map((r) => renderRow(r))}
        </tbody>
      </table>
    </div>
  );
}
