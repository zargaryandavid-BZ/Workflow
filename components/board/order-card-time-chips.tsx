"use client";

import type { MouseEvent, PointerEvent, ReactNode } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Flag,
  Mail,
  Package,
  Star,
  Timer,
  Truck,
  type LucideIcon,
} from "lucide-react";
import {
  readTimeChipStamps,
  timeChipVisibleInColumn,
  type TimeChip,
  type TimeChipSystemKey,
} from "@/lib/time-chips";
import { dueDateBadgeClass, dueDateStatus } from "@/lib/board-due-date";
import { formatTimeInColumn } from "@/lib/card-warning-rules";
import { formatWorkingHours } from "@/lib/working-hours";
import { isShippedCustomerColumn } from "@/lib/shipped-customer-column";
import { PRIORITY_STYLES } from "@/lib/constants";
import { cn, formatDate, formatDateShort } from "@/lib/utils";
import type { OrderWithRelations } from "@/lib/types";

type DueContextMenuHandler = (e: MouseEvent) => void;

function dueInteractiveProps(
  onDueContextMenu: DueContextMenuHandler | undefined,
  title?: string
) {
  if (!onDueContextMenu) {
    return title ? { title } : {};
  }
  return {
    title: title
      ? `${title} — Right-click to set due date`
      : "Right-click to set due date",
    className: "cursor-context-menu",
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDueContextMenu(e);
    },
    onPointerDown: (e: PointerEvent) => e.stopPropagation(),
    onClick: (e: MouseEvent) => e.stopPropagation(),
  };
}

const ICON_MAP: Record<string, LucideIcon> = {
  clock: Clock,
  calendar: CalendarClock,
  timer: Timer,
  truck: Truck,
  check: CheckCircle2,
  package: Package,
  flag: Flag,
  star: Star,
  alert: AlertTriangle,
  mail: Mail,
};

export function TimeChipIconView({
  icon,
  className,
}: {
  icon: string;
  className?: string;
}) {
  const Cmp = ICON_MAP[icon] ?? Clock;
  return <Cmp className={className} />;
}

interface RenderArgs {
  order: OrderWithRelations;
  columnId: string | null;
  columnName?: string | null;
  columnKind?: string | null;
  chips: TimeChip[] | null | undefined;
  approvalDate?: string | null;
  warningWorkingDays?: number[];
  /** Legacy prop when chips config not loaded */
  showShippedEnteredDate?: boolean;
  /** Outer wrapper class (default card spacing). */
  className?: string;
  /** When false, skip the priority chip (e.g. table view renders it elsewhere). */
  showPriority?: boolean;
  /** Right-click on due / “No due date” chip to set due date. */
  onDueContextMenu?: DueContextMenuHandler;
}

/**
 * Renders the date/time chip row for a card.
 * Falls back to legacy layout when `chips` is null/undefined/empty.
 */
export function OrderCardTimeChips({
  order,
  columnId,
  columnName = null,
  columnKind = null,
  chips,
  approvalDate = null,
  warningWorkingDays = [1, 2, 3, 4, 5],
  showShippedEnteredDate,
  className,
  showPriority = true,
  onDueContextMenu,
}: RenderArgs) {
  // Finished / shipped-to-customer / done columns are terminal — the job is
  // complete, so don't flag it "Late" or stuck.
  const columnNm = (columnName ?? "").toLowerCase();
  const isTerminalColumn =
    columnKind === "done" ||
    columnNm.includes("finished") ||
    columnNm.includes("shipped customer");
  const dueStatus = dueDateStatus(order.due_date, {
    inDoneColumn: isTerminalColumn,
    specs: order.specs,
  });
  const timeHere = formatTimeInColumn(
    order.last_moved_at,
    Date.now(),
    warningWorkingDays
  );
  const stamps = readTimeChipStamps(order.specs);

  const useConfig = Array.isArray(chips) && chips.length > 0;

  if (!useConfig) {
    return (
      <LegacyTimeChips
        order={order}
        columnName={columnName}
        dueStatus={dueStatus}
        timeHere={timeHere}
        approvalDate={approvalDate}
        showShippedEnteredDate={showShippedEnteredDate}
        className={className}
        showPriority={showPriority}
        onDueContextMenu={onDueContextMenu}
      />
    );
  }

  const visible = chips.filter((c) =>
    timeChipVisibleInColumn(c, columnId)
  );

  const left: ReactNode[] = [];
  let priorityNode: ReactNode = null;

  for (const chip of visible) {
    if (chip.kind === "system" && chip.system_key === "priority") {
      if (
        !showPriority ||
        (order.priority !== "high" && order.priority !== "urgent")
      ) {
        continue;
      }
      priorityNode = (
        <span
          key={chip.id}
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            PRIORITY_STYLES[order.priority]
          )}
        >
          {order.priority}
        </span>
      );
      continue;
    }

    const node = renderSystemOrCustomChip({
      chip,
      order,
      dueStatus,
      timeHere,
      approvalDate,
      stamps,
      columnName,
      columnId,
      onDueContextMenu,
    });
    if (node) left.push(node);
  }

  return (
    <div className={cn("mt-2 flex w-full items-center gap-2", className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] leading-none text-slate-500">
        {left}
      </div>
      {priorityNode}
    </div>
  );
}

function renderSystemOrCustomChip(args: {
  chip: TimeChip;
  order: OrderWithRelations;
  dueStatus: ReturnType<typeof dueDateStatus>;
  timeHere: ReturnType<typeof formatTimeInColumn>;
  approvalDate: string | null;
  stamps: Record<string, string>;
  columnName: string | null;
  columnId: string | null;
  onDueContextMenu?: DueContextMenuHandler;
}): ReactNode {
  const {
    chip,
    order,
    dueStatus,
    timeHere,
    approvalDate,
    stamps,
    columnName,
    onDueContextMenu,
  } = args;
  const iconCls = "h-3 w-3 shrink-0";
  const dueProps = (title?: string) =>
    dueInteractiveProps(onDueContextMenu, title);

  if (chip.kind === "custom") {
    const stamped = stamps[chip.id];
    if (!stamped) return null;
    return (
      <span
        key={chip.id}
        className="inline-flex items-center gap-0.5 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-px text-[10px] font-semibold text-sky-800"
        title={`${chip.name} ${formatDate(stamped)}`}
      >
        <TimeChipIconView icon={chip.icon} className={cn(iconCls, "text-sky-700")} />
        <span className="font-medium">{chip.name}</span>
        {formatDateShort(stamped)}
      </span>
    );
  }

  const key = chip.system_key as TimeChipSystemKey;

  if (key === "created") {
    return (
      <span
        key={chip.id}
        className="inline-flex items-center gap-0.5"
        title={`Created ${formatDate(order.created_at)}`}
      >
        <TimeChipIconView
          icon={chip.icon}
          className={cn(iconCls, "text-slate-400")}
        />
        <span className="font-medium text-slate-500">Created</span>
        {formatDateShort(order.created_at)}
      </span>
    );
  }

  if (key === "due") {
    if (order.due_date) {
      const props = dueProps(`Due ${formatDate(order.due_date)}`);
      return (
        <span
          key={chip.id}
          {...props}
          className={cn(
            "inline-flex items-center gap-0.5 font-medium text-slate-600",
            props.className
          )}
        >
          <TimeChipIconView icon={chip.icon} className={iconCls} />
          <span>Due</span>
          {formatDateShort(order.due_date)}
        </span>
      );
    }
    if (dueStatus.kind === "pending_approval") {
      const props = dueProps(dueStatus.label);
      return (
        <span
          key={chip.id}
          {...props}
          className={cn(
            "inline-flex max-w-full items-center rounded-full border px-1.5 py-px text-[10px] font-medium",
            dueDateBadgeClass(dueStatus),
            props.className
          )}
        >
          {dueStatus.label}
        </span>
      );
    }
    const props = dueProps(dueStatus.label);
    return (
      <span
        key={chip.id}
        {...props}
        className={cn(
          "inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium",
          dueDateBadgeClass(dueStatus),
          props.className
        )}
      >
        {dueStatus.label}
      </span>
    );
  }

  if (key === "late") {
    if (
      dueStatus.kind !== "late" &&
      dueStatus.kind !== "today" &&
      dueStatus.kind !== "soon" &&
      dueStatus.kind !== "pending_approval"
    ) {
      return null;
    }
    const lateTitle = order.due_date
      ? `Due ${formatDate(order.due_date)}`
      : dueStatus.kind === "pending_approval"
        ? dueStatus.label
        : undefined;
    const props = dueProps(lateTitle);
    return (
      <span
        key={chip.id}
        {...props}
        className={cn(
          "inline-flex max-w-full items-center rounded-full border px-1.5 py-px text-[10px] font-semibold",
          dueDateBadgeClass(dueStatus),
          props.className
        )}
      >
        {dueStatus.label}
      </span>
    );
  }

  if (key === "time_in_column") {
    if (!timeHere) return null;
    return (
      <span
        key={chip.id}
        className="inline-flex items-center gap-0.5"
        title={timeHere.title}
      >
        <TimeChipIconView
          icon={chip.icon}
          className={cn(iconCls, "text-slate-400")}
        />
        <span className="font-medium text-slate-500">In col</span>
        {timeHere.label}
        {(() => {
          const w = formatWorkingHours(order.last_moved_at, Date.now(), columnName);
          return w ? (
            <span className="ml-0.5 font-medium text-emerald-600" title={w.title}>
              · {w.label}
            </span>
          ) : null;
        })()}
      </span>
    );
  }

  if (key === "shipped_entered") {
    const stamped = stamps[chip.id];
    const date =
      stamped ||
      order.last_moved_at ||
      (isShippedCustomerColumn(columnName) ? order.created_at : null);
    if (!date) return null;
    return (
      <span
        key={chip.id}
        className="inline-flex items-center gap-0.5 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-px text-[10px] font-semibold text-sky-800"
        title={`Entered ${columnName?.trim() || chip.name} ${formatDate(date)}`}
      >
        <TimeChipIconView
          icon={chip.icon}
          className={cn(iconCls, "text-sky-700")}
        />
        <span className="font-medium">Entered</span>
        {formatDateShort(date)}
      </span>
    );
  }

  if (key === "approval") {
    if (!approvalDate) return null;
    return (
      <span
        key={chip.id}
        className="inline-flex items-center gap-0.5 text-green-700"
        title={`Approved ${formatDate(approvalDate)}`}
      >
        <TimeChipIconView icon={chip.icon} className={iconCls} />
        <span className="font-medium">Approved</span>
        {formatDateShort(approvalDate)}
      </span>
    );
  }

  return null;
}

function LegacyTimeChips({
  order,
  columnName,
  dueStatus,
  timeHere,
  approvalDate,
  showShippedEnteredDate,
  className,
  showPriority = true,
  onDueContextMenu,
}: {
  order: OrderWithRelations;
  columnName: string | null;
  dueStatus: ReturnType<typeof dueDateStatus>;
  timeHere: ReturnType<typeof formatTimeInColumn>;
  approvalDate: string | null;
  showShippedEnteredDate?: boolean;
  className?: string;
  showPriority?: boolean;
  onDueContextMenu?: DueContextMenuHandler;
}) {
  const showShipped =
    showShippedEnteredDate ?? isShippedCustomerColumn(columnName);
  const shippedEnteredAt = showShipped
    ? order.last_moved_at || order.created_at || null
    : null;
  const dueProps = (title?: string) =>
    dueInteractiveProps(onDueContextMenu, title);

  return (
    <div className={cn("mt-2 flex w-full items-center gap-2", className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] leading-none text-slate-500">
        <span
          className="inline-flex items-center gap-0.5"
          title={`Created ${formatDate(order.created_at)}`}
        >
          <Clock className="h-3 w-3 shrink-0 text-slate-400" />
          <span className="font-medium text-slate-500">Created</span>
          {formatDateShort(order.created_at)}
        </span>
        {order.due_date ? (
          (() => {
            const props = dueProps(`Due ${formatDate(order.due_date)}`);
            return (
              <span
                {...props}
                className={cn(
                  "inline-flex items-center gap-0.5 font-medium text-slate-600",
                  props.className
                )}
              >
                <CalendarClock className="h-3 w-3 shrink-0" />
                <span>Due</span>
                {formatDateShort(order.due_date)}
              </span>
            );
          })()
        ) : (
          (() => {
            const props = dueProps(dueStatus.label);
            return (
              <span
                {...props}
                className={cn(
                  "inline-flex max-w-full items-center rounded-full border px-1.5 py-px text-[10px] font-medium",
                  dueDateBadgeClass(dueStatus),
                  props.className
                )}
              >
                {dueStatus.label}
              </span>
            );
          })()
        )}
        {dueStatus.kind === "late" ||
        dueStatus.kind === "today" ||
        dueStatus.kind === "soon" ||
        (dueStatus.kind === "pending_approval" && order.due_date) ? (
          (() => {
            const props = dueProps(
              order.due_date ? `Due ${formatDate(order.due_date)}` : undefined
            );
            return (
              <span
                {...props}
                className={cn(
                  "inline-flex max-w-full items-center rounded-full border px-1.5 py-px text-[10px] font-semibold",
                  dueDateBadgeClass(dueStatus),
                  props.className
                )}
              >
                {dueStatus.label}
              </span>
            );
          })()
        ) : null}
        {timeHere ? (
          <span
            className="inline-flex items-center gap-0.5"
            title={timeHere.title}
          >
            <Timer className="h-3 w-3 shrink-0 text-slate-400" />
            <span className="font-medium text-slate-500">In col</span>
            {timeHere.label}
            {(() => {
              const w = formatWorkingHours(
                order.last_moved_at,
                Date.now(),
                columnName
              );
              return w ? (
                <span
                  className="ml-0.5 font-medium text-emerald-600"
                  title={w.title}
                >
                  · {w.label}
                </span>
              ) : null;
            })()}
          </span>
        ) : null}
        {showShipped ? (
          <span
            className="inline-flex items-center gap-0.5 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-px text-[10px] font-semibold text-sky-800"
            title={`Entered ${columnName?.trim() || "Shipped Customer"}${
              shippedEnteredAt ? ` ${formatDate(shippedEnteredAt)}` : ""
            }`}
          >
            <Truck className="h-3 w-3 shrink-0 text-sky-700" />
            <span className="font-medium">Entered</span>
            {shippedEnteredAt ? formatDateShort(shippedEnteredAt) : "—"}
          </span>
        ) : null}
        {approvalDate ? (
          <span
            className="inline-flex items-center gap-0.5 text-green-700"
            title={`Approved ${formatDate(approvalDate)}`}
          >
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            <span className="font-medium">Approved</span>
            {formatDateShort(approvalDate)}
          </span>
        ) : null}
      </div>
      {showPriority &&
      (order.priority === "high" || order.priority === "urgent") ? (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            PRIORITY_STYLES[order.priority]
          )}
        >
          {order.priority}
        </span>
      ) : null}
    </div>
  );
}
