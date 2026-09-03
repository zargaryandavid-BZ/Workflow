"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmd(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function displayDate(value: string): string {
  const d = parseYmd(value);
  if (!d) return "";
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

export function RequiredDatePicker({
  id,
  value,
  dueDate,
  onChange,
  onOpenChange,
  dueLabel = "Requested",
  selectedLabel = "Your offer",
}: {
  id?: string;
  value: string;
  dueDate: string | null;
  onChange: (ymd: string) => void;
  onOpenChange?: (open: boolean) => void;
  dueLabel?: string;
  selectedLabel?: string;
}) {
  const due = dueDate?.slice(0, 10) || null;
  const selected = parseYmd(value);
  const dueParsed = due ? parseYmd(due) : null;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() =>
    startOfMonth(selected ?? dueParsed ?? new Date())
  );
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    setView(startOfMonth(selected ?? dueParsed ?? new Date()));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- snap once when opened

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 17 * 16;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      setPos({ top: r.bottom + 4, left });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || popoverRef.current?.contains(t)) {
        return;
      }
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const days = useMemo(() => {
    const first = startOfMonth(view);
    const start = first.getDay();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < start; i++) cells.push(null);
    const last = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= last; day++) {
      cells.push(new Date(view.getFullYear(), view.getMonth(), day));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [view]);

  const today = toYmd(new Date());
  const monthLabel = view.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const calendar = open
    ? createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[200] w-[17rem] rounded-md border border-slate-200 bg-white p-2 shadow-lg"
          style={{ top: pos.top, left: pos.left }}
          role="dialog"
          aria-label="Choose required date"
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-sm font-semibold text-slate-800">{monthLabel}</p>
            <div className="flex gap-0.5">
              <button
                type="button"
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                onClick={() => setView((d) => addMonths(d, -1))}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                onClick={() => setView((d) => addMonths(d, 1))}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] font-medium text-slate-400">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 text-center text-sm">
            {days.map((d, i) => {
              if (!d) return <div key={`e-${i}`} className="h-8" />;
              const ymd = toYmd(d);
              const isSelected = ymd === value;
              const isDue = due === ymd;
              const isToday = ymd === today;
              return (
                <div key={ymd} className="flex h-8 items-center justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(ymd);
                      setOpen(false);
                    }}
                    title={
                      [
                        isToday ? "Today" : null,
                        isDue ? dueLabel : null,
                        isSelected ? selectedLabel : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-sm",
                      isSelected
                        ? "bg-[var(--primary)] font-semibold text-white"
                        : "text-slate-800 hover:bg-slate-100",
                      isToday && !isSelected
                        ? "ring-1 ring-inset ring-slate-800"
                        : null,
                      isDue
                        ? "outline outline-2 outline-offset-1 outline-red-500"
                        : null
                    )}
                  >
                    {d.getDate()}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-2 space-y-1 border-t border-slate-100 px-1 pt-2 text-[11px] text-slate-600">
            <p className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-inset ring-slate-800" />
                Today
              </span>
              <span className="tabular-nums text-slate-800">
                {displayDate(today)}
              </span>
            </p>
            <p className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-4 w-4 rounded-full outline outline-2 outline-red-500" />
                {dueLabel}
              </span>
              <span className="tabular-nums text-slate-800">
                {due ? displayDate(due) : "—"}
              </span>
            </p>
            <p className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-4 w-4 rounded-full bg-[var(--primary)]" />
                {selectedLabel}
              </span>
              <span className="tabular-nums font-medium text-slate-800">
                {value ? displayDate(value) : "—"}
              </span>
            </p>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div ref={rootRef} className="relative">
      <div className="mt-1 flex items-center gap-0.5">
        <input
          id={id}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 tabular-nums focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
        />
        <button
          type="button"
          className="flex h-10 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50"
          onClick={() => setOpen((v) => !v)}
          aria-label="Open calendar"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <CalendarDays className="h-4 w-4" />
        </button>
      </div>
      {calendar}
    </div>
  );
}
