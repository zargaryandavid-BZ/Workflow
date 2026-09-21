"use client";

import { useState } from "react";
import { Factory, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PRESS_LABELS,
  PRESS_OPTIONS,
  PRODUCTION_STAGE_LABELS,
  PRODUCTION_STAGE_OPTIONS,
} from "@/lib/production-fields";
import type { PressType, ProductionStage } from "@/lib/types";

interface Props {
  orderId: string;
  press: PressType | null;
  productionStage: ProductionStage | null;
  onChanged: (patch: {
    press?: PressType | null;
    production_stage?: ProductionStage | null;
  }) => void;
}

/**
 * Order Details: which HP Indigo press this job runs on, and its current
 * shop-floor status (printing → lamination → uv → cutting → folding). Both
 * are plain order columns (not specs) — any authenticated staff member can
 * change them; press has no separate manager gate either (Order Details tab
 * is already gated to staff who can edit order details as a whole).
 */
export function PressProductionControl({
  orderId,
  press,
  productionStage,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState<"press" | "stage" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: {
    press?: PressType | null;
    production_stage?: ProductionStage | null;
  }) {
    setBusy(patch.press !== undefined ? "press" : "stage");
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Couldn't save.");
        return;
      }
      onChanged(patch);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-center gap-2">
        <Factory className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Press &amp; production status
        </p>
        {busy ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-slate-400" /> : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500">
            Press
          </label>
          <select
            value={press ?? ""}
            disabled={busy !== null}
            onChange={(e) =>
              void save({ press: (e.target.value || null) as PressType | null })
            }
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 disabled:opacity-50"
          >
            <option value="">— None —</option>
            {PRESS_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {PRESS_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500">
            Production stage
          </label>
          <select
            value={productionStage ?? ""}
            disabled={busy !== null}
            onChange={(e) =>
              void save({
                production_stage: (e.target.value || null) as ProductionStage | null,
              })
            }
            className={cn(
              "h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 disabled:opacity-50"
            )}
          >
            <option value="">Not started</option>
            {PRODUCTION_STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {PRODUCTION_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
