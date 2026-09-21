"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  PRODUCTION_STAGE_LABELS,
  PRODUCTION_STAGE_OPTIONS,
  PRODUCTION_STAGE_STYLES,
} from "@/lib/production-fields";
import type { ProductionStage } from "@/lib/types";

interface ProductionStageSelectProps {
  orderId: string;
  stage: ProductionStage | null;
  /** View-only contexts (e.g. customer-facing preview) can disable editing. */
  canEdit?: boolean;
  className?: string;
  onChanged?: (next: ProductionStage | null) => void;
}

/**
 * Compact colored chip showing the order's shop-floor status. Any authenticated
 * staff member can click it to change the stage — not admin-gated, since the
 * point is anyone glancing at a card can update or read it without asking.
 * Self-contained: saves via PATCH /api/orders/[id] and updates its own label;
 * the board's Realtime subscription on `orders` reconciles other viewers.
 */
export function ProductionStageSelect({
  orderId,
  stage,
  canEdit = true,
  className,
  onChanged,
}: ProductionStageSelectProps) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ProductionStage | null>(stage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => setCurrent(stage), [stage]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function save(next: ProductionStage | null) {
    if (next === current) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setError(null);
    const previous = current;
    setCurrent(next); // optimistic
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ production_stage: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      onChanged?.(next);
      setOpen(false);
    } catch (e) {
      setCurrent(previous); // rollback
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const label = current ? PRODUCTION_STAGE_LABELS[current] : "Set stage";
  const style = current
    ? PRODUCTION_STAGE_STYLES[current]
    : "bg-slate-100 text-slate-500 border border-dashed border-slate-300";

  const chip = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wide",
        style,
        canEdit && "cursor-pointer hover:opacity-80",
        className
      )}
      title={
        canEdit
          ? `Production stage: ${label} — click to change`
          : `Production stage: ${label}`
      }
    >
      {label}
    </span>
  );

  if (!canEdit) return chip;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="inline-flex"
      >
        {chip}
      </button>
      {open ? (
        <div
          ref={popRef}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute left-0 top-6 z-30 w-36 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
        >
          <button
            type="button"
            disabled={saving}
            onClick={() => void save(null)}
            className="flex w-full items-center rounded px-2 py-1 text-left text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            Not started
          </button>
          {PRODUCTION_STAGE_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={saving}
              onClick={() => void save(opt)}
              className={cn(
                "flex w-full items-center rounded px-2 py-1 text-left text-xs hover:bg-slate-50 disabled:opacity-50",
                current === opt ? "font-semibold text-slate-900" : "text-slate-700"
              )}
            >
              {PRODUCTION_STAGE_LABELS[opt]}
            </button>
          ))}
          {error ? (
            <p className="mt-1 px-2 text-[10px] font-medium text-rose-600">{error}</p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
