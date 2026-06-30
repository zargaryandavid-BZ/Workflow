"use client";

import { useMemo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import Image from "next/image";
import { ArrowDownAZ, ArrowDownToLine, ArrowUpAZ, ArrowUpFromLine, Plus } from "lucide-react";
import { OrderCard } from "./order-card";
import { GroupedOrderCard } from "./grouped-order-card";
import { groupOrdersForColumn } from "@/lib/group-orders";
import { effectiveDropRoles, parseDropRoles } from "@/lib/columns";
import { BOARD_ROLES, COLUMN_ACCENT, ROLE_ABBR } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { CardNotificationBadge } from "@/lib/card-badges";
import type {
  BoardColumn,
  CardWarningRule,
  CustomField,
  OrderWithRelations,
  Role,
} from "@/lib/types";

type DateSort = "default" | "asc" | "desc";

interface ColumnProps {
  column: BoardColumn;
  canDragCards: boolean;
  canAcceptDrop: boolean;
  isDragActive: boolean;
  groupedView: boolean;
  orders: OrderWithRelations[];
  customFields: CustomField[];
  fieldValuesByOrder: Record<string, Record<string, unknown>>;
  thumbnailByOrder: Record<string, string>;
  designerNameByOrder: Record<string, string>;
  notificationBadgeByOrder: Record<string, CardNotificationBadge>;
  ownerNameByOrder: Record<string, string>;
  warningRules?: CardWarningRule[];
  animateWarnings?: boolean;
  isFirst: boolean;
  onOpenOrder: (order: OrderWithRelations) => void;
  onAdd: (columnId: string) => void;
}

/** Short label of which roles a drop permission applies to. */
function dropLabel(roles: Role[] | null | undefined): string {
  const effective = effectiveDropRoles(parseDropRoles(roles));
  if (effective == null) return "All";
  if (effective.length === 0) return "Admins";
  return BOARD_ROLES.filter((r) => effective.includes(r))
    .map((r) => ROLE_ABBR[r])
    .join(" ");
}

export function Column({
  column,
  canDragCards,
  canAcceptDrop,
  isDragActive,
  groupedView,
  orders,
  customFields,
  fieldValuesByOrder,
  thumbnailByOrder,
  designerNameByOrder,
  notificationBadgeByOrder,
  ownerNameByOrder,
  warningRules = [],
  animateWarnings = true,
  isFirst,
  onOpenOrder,
  onAdd,
}: ColumnProps) {
  const [dateSort, setDateSort] = useState<DateSort>("default");

  const dropDisabled = isDragActive && !canAcceptDrop;
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    disabled: dropDisabled,
  });

  const showDropTarget = isDragActive && isOver && canAcceptDrop;

  const sortedOrders =
    dateSort === "default"
      ? orders
      : [...orders].sort((a, b) => {
          const ta = new Date(a.created_at).getTime();
          const tb = new Date(b.created_at).getTime();
          return dateSort === "asc" ? ta - tb : tb - ta;
        });

  const columnEntries = useMemo(
    () => (groupedView ? groupOrdersForColumn(sortedOrders) : null),
    [groupedView, sortedOrders]
  );

  function cycleDateSort() {
    setDateSort((prev) =>
      prev === "default" ? "asc" : prev === "asc" ? "desc" : "default"
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full w-72 shrink-0 flex-col rounded-lg transition-[opacity,box-shadow]",
        isDragActive && !canAcceptDrop && "opacity-50",
        showDropTarget && "ring-2 ring-blue-400 ring-offset-2"
      )}
    >
      <div
        className={cn(
          "mb-2 rounded-t-lg border-t-4 bg-slate-200/60 px-3 py-2",
          !column.color ? COLUMN_ACCENT[column.kind] : undefined
        )}
        style={column.color ? { borderTopColor: column.color } : undefined}
      >
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            {column.color ? (
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: column.color }}
              />
            ) : null}
            <span className="truncate text-sm font-semibold text-slate-700">
              {column.name}
            </span>
            <span className="rounded-full bg-white px-1.5 text-xs font-medium text-slate-500">
              {orders.length}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={cycleDateSort}
              className={cn(
                "rounded p-1 transition-colors",
                dateSort === "default"
                  ? "text-slate-400 hover:bg-white hover:text-slate-600"
                  : "bg-blue-100 text-blue-600 hover:bg-blue-200"
              )}
              title={
                dateSort === "default"
                  ? "Sort by date created (oldest first)"
                  : dateSort === "asc"
                    ? "Sorted: oldest first — click for newest first"
                    : "Sorted: newest first — click to reset"
              }
            >
              {dateSort === "desc" ? (
                <ArrowDownAZ className="h-4 w-4" />
              ) : (
                <ArrowUpAZ className="h-4 w-4" />
              )}
            </button>
            {isFirst ? (
              <button
                onClick={() => onAdd(column.id)}
                className="rounded p-1 text-slate-500 hover:bg-white hover:text-slate-700"
                aria-label="Add order"
              >
                <Plus className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        {column.image_url ? (
          <Image
            src={column.image_url}
            alt=""
            width={320}
            height={96}
            className="mt-2 h-20 w-full rounded-md object-cover"
            unoptimized
          />
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-medium text-slate-500">
          <span
            className="inline-flex items-center gap-0.5"
            title="Roles that can drop orders into this stage"
          >
            <ArrowDownToLine className="h-3 w-3" />
            {dropLabel(column.drop_in_roles)}
          </span>
          <span
            className="inline-flex items-center gap-0.5"
            title="Roles that can take orders out of this stage"
          >
            <ArrowUpFromLine className="h-3 w-3" />
            {dropLabel(column.drop_out_roles)}
          </span>
        </div>
      </div>

      <div
        className={cn(
          "board-scroll flex min-h-[8rem] flex-1 flex-col gap-1.5 overflow-y-auto rounded-b-lg p-1 transition-colors",
          showDropTarget ? "bg-blue-50" : !column.color ? "bg-slate-100/40" : undefined
        )}
        style={
          !showDropTarget && column.color
            ? { backgroundColor: `${column.color}08` }
            : undefined
        }
      >
        <SortableContext
          items={sortedOrders.map((o) => o.id)}
          strategy={verticalListSortingStrategy}
        >
          {columnEntries
            ? columnEntries.map((entry) =>
                entry.kind === "group" ? (
                  <GroupedOrderCard
                    key={`group-${entry.key}`}
                    entry={entry}
                    onOpen={onOpenOrder}
                    customFields={customFields}
                    fieldValuesByOrder={fieldValuesByOrder}
                  />
                ) : (
                  <OrderCard
                    key={entry.order.id}
                    order={entry.order}
                    canDrag={canDragCards}
                    customFields={customFields}
                    fieldValues={fieldValuesByOrder[entry.order.id]}
                    thumbnail={thumbnailByOrder[entry.order.id]}
                    designerName={designerNameByOrder[entry.order.id]}
                    notificationBadge={notificationBadgeByOrder[entry.order.id]}
                    ownerName={ownerNameByOrder[entry.order.id]}
                    warningRules={warningRules}
                    animateWarnings={animateWarnings}
                    columnColor={column.color}
                    onOpen={onOpenOrder}
                  />
                )
              )
            : sortedOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  canDrag={canDragCards}
                  customFields={customFields}
                  fieldValues={fieldValuesByOrder[order.id]}
                  thumbnail={thumbnailByOrder[order.id]}
                  designerName={designerNameByOrder[order.id]}
                  notificationBadge={notificationBadgeByOrder[order.id]}
                  ownerName={ownerNameByOrder[order.id]}
                  warningRules={warningRules}
                  animateWarnings={animateWarnings}
                  columnColor={column.color}
                  onOpen={onOpenOrder}
                />
              ))}
        </SortableContext>
      </div>
    </div>
  );
}
