"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Layers,
  MoveRight,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PRIORITY_STYLES } from "@/lib/constants";
import { itemLabel, sharedOrderTitle, type GroupEntry } from "@/lib/group-orders";
import { customerNameFromOrder } from "@/lib/notification-messages";
import { cn, formatDateShort } from "@/lib/utils";
import type { CustomField, Designer, OrderWithRelations } from "@/lib/types";
import type { WebhookSourceStyles } from "@/lib/webhook-source-styles";
import { WebhookSourceLabel } from "./webhook-source-label";
import {
  GroupDueDatesModal,
  type GroupDueDateUpdate,
} from "./group-due-dates-modal";

interface ColumnOption {
  id: string;
  name: string;
  color: string | null;
}

interface GroupedOrderCardProps {
  entry: GroupEntry;
  onOpen: (order: OrderWithRelations) => void;
  customFields?: CustomField[];
  fieldValuesByOrder?: Record<string, Record<string, unknown>>;
  webhookSourceStyles?: WebhookSourceStyles;
  designers?: Designer[];
  availableColumns?: ColumnOption[];
  onAssignDesigner?: (
    orders: OrderWithRelations[],
    designer: { id: string | null; name: string | null }
  ) => void;
  onSetDueDates?: (updates: GroupDueDateUpdate[]) => Promise<void>;
  onMoveGroup?: (orders: OrderWithRelations[], targetColumnId: string) => void;
}

export function GroupedOrderCard({
  entry,
  onOpen,
  customFields = [],
  fieldValuesByOrder = {},
  webhookSourceStyles,
  designers = [],
  availableColumns = [],
  onAssignDesigner,
  onSetDueDates,
  onMoveGroup,
}: GroupedOrderCardProps) {
  const { key, orders } = entry;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [designerSubOpen, setDesignerSubOpen] = useState(false);
  const [moveSubOpen, setMoveSubOpen] = useState(false);
  const [dueDatesOpen, setDueDatesOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasGroupActions =
    Boolean(onAssignDesigner) ||
    Boolean(onSetDueDates) ||
    Boolean(onMoveGroup && availableColumns.length > 0);

  const rep = [...orders].sort((a, b) => {
    const ai =
      typeof a.specs?.webhook_item_index === "number"
        ? a.specs.webhook_item_index
        : 999;
    const bi =
      typeof b.specs?.webhook_item_index === "number"
        ? b.specs.webhook_item_index
        : 999;
    if (ai !== bi) return ai - bi;
    return a.position - b.position;
  })[0];

  const priority = rep.priority;
  const dueDate = rep.due_date;

  const shortKey = entry.key.replace(/^ORD-\d{4}-/, "");
  const repFieldValues = fieldValuesByOrder[rep.id] ?? {};
  const customerName = customerNameFromOrder(rep, repFieldValues, customFields);
  const displayCustomerName = customerName === "there" ? null : customerName;

  const earliestDue =
    orders
      .map((o) => o.due_date)
      .filter((d): d is string => Boolean(d))
      .sort()[0] ?? null;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClose(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") {
          setMenuOpen(false);
          setDesignerSubOpen(false);
          setMoveSubOpen(false);
        }
        return;
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setDesignerSubOpen(false);
        setMoveSubOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClose);
    document.addEventListener("keydown", handleClose);
    return () => {
      document.removeEventListener("mousedown", handleClose);
      document.removeEventListener("keydown", handleClose);
    };
  }, [menuOpen]);

  function handleContextMenu(e: React.MouseEvent) {
    if (!hasGroupActions) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setDesignerSubOpen(false);
    setMoveSubOpen(false);
    setMenuOpen(true);
  }

  // Keep the menu fully on-screen after it mounts / expands.
  useLayoutEffect(() => {
    if (!menuOpen || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = menuPos.x;
    let y = menuPos.y;
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (x !== menuPos.x || y !== menuPos.y) {
      setMenuPos({ x, y });
    }
  }, [menuOpen, designerSubOpen, moveSubOpen, menuPos.x, menuPos.y]);

  function closeMenu() {
    setMenuOpen(false);
    setDesignerSubOpen(false);
    setMoveSubOpen(false);
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <div
        onClick={() => setOpen((v) => !v)}
        onContextMenu={handleContextMenu}
        className={cn(
          "cursor-pointer rounded-md border-2 border-blue-200 bg-blue-50 px-3 py-3.5 shadow-sm transition-shadow hover:shadow-md",
          open && "ring-2 ring-blue-400 ring-offset-1"
        )}
      >
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0 flex-1">
            <WebhookSourceLabel
              webhookSource={rep.webhook_source}
              sourceStyles={webhookSourceStyles}
              orderTitle={sharedOrderTitle(rep)}
            />
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 shrink-0 text-blue-500" />
              {displayCustomerName ? (
                <span className="truncate text-[15px] font-bold text-slate-900">
                  {displayCustomerName}
                </span>
              ) : null}
              <span className="shrink-0 text-[15px] font-bold text-slate-400">
                {shortKey}
              </span>
              <span className="shrink-0 rounded-full bg-blue-500 px-2 py-0.5 text-[11px] font-semibold leading-none text-white">
                {orders.length} items
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {priority && priority !== "normal" ? (
              <Badge
                className={cn("px-2 py-0 text-[11px]", PRIORITY_STYLES[priority])}
              >
                {priority}
              </Badge>
            ) : null}
            {open ? (
              <ChevronUp className="h-5 w-5 text-slate-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-400" />
            )}
          </div>
        </div>

        {earliestDue ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            <span>{formatDateShort(earliestDue)}</span>
            {orders.some((o) => o.due_date && o.due_date !== dueDate) ? (
              <span className="text-slate-400">(varies)</span>
            ) : null}
          </div>
        ) : null}

        <div className="mt-2 space-y-1">
          {orders.map((order) => (
            <div
              key={order.id}
              className="truncate text-[11px] text-slate-600"
            >
              · {itemLabel(order)}
            </div>
          ))}
        </div>
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
            <span className="text-[13px] font-semibold text-slate-700">
              {key} — {orders.length} items
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
              className="text-[13px] text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {[...orders]
              .sort((a, b) => {
                const ai =
                  typeof a.specs?.webhook_item_index === "number"
                    ? a.specs.webhook_item_index
                    : 999;
                const bi =
                  typeof b.specs?.webhook_item_index === "number"
                    ? b.specs.webhook_item_index
                    : 999;
                if (ai !== bi) return ai - bi;
                return a.position - b.position;
              })
              .map((order, idx) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    onOpen(order);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-600">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-slate-800">
                      {itemLabel(order)}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span>
                        {order.title
                          .replace(/^ORD-\d{4}-/, "")
                          .replace(/^0+(\d)/, "$1")}
                        <span className="text-slate-300"> ({orders.length})</span>
                      </span>
                      {order.due_date ? (
                        <span className="flex items-center gap-0.5">
                          <CalendarClock className="h-3.5 w-3.5" />
                          {formatDateShort(order.due_date)}
                        </span>
                      ) : null}
                      {typeof order.specs?.designer_name === "string" &&
                      order.specs.designer_name.trim() ? (
                        <span className="flex items-center gap-0.5 rounded-full bg-[var(--primary)]/10 px-1.5 py-px font-semibold text-[var(--primary)]">
                          <User className="h-3.5 w-3.5 shrink-0" />
                          {order.specs.designer_name.trim()}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500" />
                </button>
              ))}
          </div>
        </div>
      ) : null}

      {menuOpen && hasGroupActions
        ? createPortal(
            <div
              ref={menuRef}
              style={{ top: menuPos.y, left: menuPos.x }}
              className="fixed z-[80] w-max min-w-[13.5rem] max-w-[min(18rem,calc(100vw-16px))] rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <p className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <Layers className="h-3 w-3" />
                Group — {orders.length} items
              </p>

              {onAssignDesigner ? (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setDesignerSubOpen((v) => !v);
                      setMoveSubOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <User className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="flex-1 whitespace-nowrap">
                      Assigned designer
                    </span>
                    {designerSubOpen ? (
                      <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    )}
                  </button>
                  {designerSubOpen ? (
                    <div className="border-t border-slate-100 bg-slate-50/80 py-1">
                      <button
                        type="button"
                        onClick={() => {
                          onAssignDesigner(orders, { id: null, name: null });
                          closeMenu();
                        }}
                        className="flex w-full px-3 py-1.5 pl-8 text-left text-sm text-slate-600 hover:bg-slate-100"
                      >
                        Unassigned
                      </button>
                      {designers.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => {
                            onAssignDesigner(orders, {
                              id: d.id,
                              name: d.name,
                            });
                            closeMenu();
                          }}
                          className="flex w-full px-3 py-1.5 pl-8 text-left text-sm text-slate-700 hover:bg-slate-100"
                        >
                          <span className="truncate">{d.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {onSetDueDates ? (
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    setDueDatesOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <CalendarClock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="whitespace-nowrap">Set due dates…</span>
                </button>
              ) : null}

              {onMoveGroup && availableColumns.length > 0 ? (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setMoveSubOpen((v) => !v);
                      setDesignerSubOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <MoveRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="flex-1 whitespace-nowrap">Move group</span>
                    {moveSubOpen ? (
                      <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    )}
                  </button>
                  {moveSubOpen ? (
                    <div className="border-t border-slate-100 bg-slate-50/80 py-1">
                      {availableColumns.map((col) => (
                        <button
                          key={col.id}
                          type="button"
                          onClick={() => {
                            onMoveGroup(orders, col.id);
                            closeMenu();
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 pl-8 text-left text-sm text-slate-700 hover:bg-slate-100"
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-200"
                            style={{
                              backgroundColor: col.color ?? "#e2e8f0",
                            }}
                          />
                          <span className="truncate">{col.name}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}

      {onSetDueDates ? (
        <GroupDueDatesModal
          open={dueDatesOpen}
          orders={orders}
          groupKey={key}
          onClose={() => setDueDatesOpen(false)}
          onSave={onSetDueDates}
        />
      ) : null}
    </div>
  );
}
