"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { notifyQueueChanged } from "@/lib/queue-events";

interface QueueRankBadgeProps {
  orderId: string;
  /** 1-based rank shown to the user. */
  rank: number;
  /** Managers can click to re-rank; others just see the number. */
  canEdit: boolean;
  className?: string;
}

/**
 * Small circular "#N" badge on a card showing the designer's queue position.
 * Managers click it to type a new position — the card is moved within that
 * designer's queue and every affected card's badge updates (no page reload).
 */
export function QueueRankBadge({
  orderId,
  rank,
  canEdit,
  className,
}: QueueRankBadgeProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(rank));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => setValue(String(rank)), [rank]);

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

  async function save() {
    const next = Math.floor(Number(value));
    if (!Number.isFinite(next) || next < 1) {
      setError("Enter a number ≥ 1");
      return;
    }
    if (next === rank) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/designers/queue/move", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId, position: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        designer_id?: string;
        posById?: Record<string, number>;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to move");
      if (data.designer_id && data.posById) {
        notifyQueueChanged({
          designerId: data.designer_id,
          posById: data.posById,
        });
      }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to move");
    } finally {
      setSaving(false);
    }
  }

  const badge = (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 px-1 text-[11px] font-bold tabular-nums leading-none text-white shadow-sm",
        canEdit && "cursor-pointer hover:bg-slate-700",
        className
      )}
      title={canEdit ? `Queue #${rank} — click to change` : `Queue #${rank}`}
      aria-label={`Designer queue position ${rank}`}
    >
      {rank}
    </span>
  );

  if (!canEdit) return badge;

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
        {badge}
      </button>
      {open ? (
        <div
          ref={popRef}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute left-0 top-6 z-30 w-40 rounded-md border border-slate-200 bg-white p-2 shadow-lg"
        >
          <p className="mb-1 text-[11px] font-semibold text-slate-600">
            Move to position
          </p>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
                if (e.key === "Escape") setOpen(false);
              }}
              className="h-7 w-14 rounded border border-slate-300 px-1.5 text-sm tabular-nums focus:border-blue-400 focus:outline-none"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="h-7 rounded bg-slate-800 px-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? "…" : "Save"}
            </button>
          </div>
          {error ? (
            <p className="mt-1 text-[10px] font-medium text-rose-600">{error}</p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
