"use client";

import { useState } from "react";
import { Boxes, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COMBO_STOCK_CONTACT_NAME,
  COMBO_STOCK_LABELS,
  type ComboStock,
  type ComboStockStatus,
} from "@/lib/combo-stock";

interface Props {
  orderId: string;
  stock: ComboStock | null;
  /** Managers (admin / account_manager) get the manual set + override controls. */
  canManage: boolean;
  onChanged: (stock: ComboStock) => void;
}

const SET_OPTIONS: { status: ComboStockStatus; label: string }[] = [
  { status: "in_stock", label: "In stock" },
  { status: "ordered", label: "Ordered" },
  { status: "cant_get", label: "Can't get" },
];

/**
 * Combo stock check: text the warehouse ({@link COMBO_STOCK_CONTACT_NAME}) and
 * show / manage the reply. The order can't leave In Progress until stock is
 * confirmed (in stock / ordered) unless a manager overrides.
 */
export function ComboStockControl({
  orderId,
  stock,
  canManage,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy("ask");
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/combo-stock`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        combo_stock?: ComboStock;
      };
      if (!res.ok || !json.combo_stock) {
        setError(json.error ?? "Couldn't send the text.");
        return;
      }
      onChanged(json.combo_stock);
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(status: ComboStockStatus, override: boolean) {
    setBusy(status);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/combo-stock`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, override }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        combo_stock?: ComboStock;
      };
      if (!res.ok || !json.combo_stock) {
        setError(json.error ?? "Couldn't update.");
        return;
      }
      onChanged(json.combo_stock);
    } finally {
      setBusy(null);
    }
  }

  const status = stock?.status ?? null;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-center gap-2">
        <Boxes className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Combo stock
        </p>
        {status ? (
          <span
            className={cn(
              "ml-auto rounded px-1.5 py-px text-[11px] font-semibold",
              status === "in_stock" && "bg-emerald-100 text-emerald-700",
              status === "ordered" && "bg-blue-100 text-blue-700",
              status === "pending" && "bg-amber-100 text-amber-700",
              status === "cant_get" && "bg-red-100 text-red-700"
            )}
          >
            {COMBO_STOCK_LABELS[status]}
          </span>
        ) : null}
      </div>

      <p className="text-[11px] text-slate-500">
        This combo needs base stock before it leaves In&nbsp;Progress. Text{" "}
        {COMBO_STOCK_CONTACT_NAME} to confirm — they reply 1&nbsp;=&nbsp;in
        stock, 2&nbsp;=&nbsp;ordered, 3&nbsp;=&nbsp;can&rsquo;t get.
      </p>

      <button
        type="button"
        onClick={() => void ask()}
        disabled={busy !== null}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy === "ask" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        {status === "pending"
          ? `Re-text ${COMBO_STOCK_CONTACT_NAME}`
          : `Text ${COMBO_STOCK_CONTACT_NAME} — check stock`}
      </button>

      {canManage ? (
        <div className="space-y-1.5 border-t border-slate-200 pt-2">
          <p className="text-[11px] font-medium text-slate-500">
            Manager: set manually / override
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SET_OPTIONS.map((o) => (
              <button
                key={o.status}
                type="button"
                onClick={() =>
                  void setStatus(o.status, o.status === "cant_get")
                }
                disabled={busy !== null}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {busy === o.status ? "…" : o.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
