"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/input";
import {
  ROLL_DIRECTION_OPTIONS,
  normalizeRollDirectionValue,
  rollDirectionOption,
  type RollDirectionValue,
} from "@/lib/roll-direction";
import { cn } from "@/lib/utils";

export function RollDirectionSelect({
  label = "Roll Direction",
  value,
  onChange,
  readOnly = false,
  required = false,
}: {
  label?: string;
  value: unknown;
  onChange: (value: string | null) => void;
  readOnly?: boolean;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 280 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = rollDirectionOption(
    typeof value === "string" ? value : null
  );
  const canonical = normalizeRollDirectionValue(value);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, 17 * 16);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      setPos({ top: r.bottom + 4, left, width });
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
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(next: RollDirectionValue | null) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <Label>
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </Label>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-10 w-full items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-left text-sm text-slate-900",
          "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30",
          readOnly && "cursor-not-allowed bg-slate-50 text-slate-500",
          !selected && "text-slate-400"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
      >
        {selected ? (
          <>
            <img
              src={selected.src}
              alt=""
              className="h-8 w-10 shrink-0 object-contain"
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              {selected.label}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate">Select from list</span>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-400 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && !readOnly && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              className="fixed z-[220] max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
              style={{ top: pos.top, left: pos.left, width: pos.width }}
            >
              <button
                type="button"
                role="option"
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-slate-50",
                  !canonical && "bg-blue-50 font-medium text-[var(--primary)]"
                )}
                onClick={() => pick(null)}
              >
                —
              </button>
              {ROLL_DIRECTION_OPTIONS.map((opt) => {
                const active = canonical === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={cn(
                      "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-slate-50",
                      active && "bg-blue-50 font-medium text-[var(--primary)]"
                    )}
                    onClick={() => pick(opt.value)}
                  >
                    <img
                      src={opt.src}
                      alt=""
                      className="h-10 w-14 shrink-0 object-contain"
                    />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export function RollDirectionThumb({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  const opt = rollDirectionOption(typeof value === "string" ? value : null);
  if (!opt) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      title={`Roll direction ${opt.label}`}
    >
      <img
        src={opt.src}
        alt={opt.label}
        className="h-6 w-8 object-contain"
      />
      <span className="tabular-nums">{opt.label}</span>
    </span>
  );
}
