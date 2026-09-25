"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, RefreshCw, Minus, Plus, Send, AlertCircle, CheckCircle2, Clock, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BatchRerequestOrder } from "@/app/api/notifications/batch-rerequest/route";

interface Props {
  columnId: string;
  columnName: string;
  onClose: () => void;
  onSent: () => void;
}

export function BatchRerequestPopup({ columnId, columnName, onClose, onSent }: Props) {
  const [staleDays, setStaleDays] = useState(2);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [eligible, setEligible] = useState<BatchRerequestOrder[] | null>(null);
  const [sentResult, setSentResult] = useState<{ sent: number; failed: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const fetchEligible = useCallback(async (days: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/notifications/batch-rerequest?columnId=${encodeURIComponent(columnId)}&staleDays=${days}`
      );
      const json = (await res.json()) as { eligible?: BatchRerequestOrder[]; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? "Failed to load");
      setEligible(json.eligible ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [columnId]);

  useEffect(() => { void fetchEligible(staleDays); }, [fetchEligible, staleDays]);

  const handleDaysChange = (delta: number) => {
    const next = Math.max(1, staleDays + delta);
    setStaleDays(next);
  };

  const handleSendAll = async () => {
    if (!eligible || eligible.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications/batch-rerequest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId, staleDays }),
      });
      const json = (await res.json()) as { ok?: boolean; sent?: number; failed?: number; skipped?: number; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? "Failed to send");
      setSentResult({ sent: json.sent ?? 0, failed: json.failed ?? 0, skipped: json.skipped ?? 0 });
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const neverSent = eligible?.filter((o) => o.reason === "never_sent") ?? [];
  const stale = eligible?.filter((o) => o.reason === "stale") ?? [];

  const formatAgo = (iso: string) => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
    return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
  };

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-blue-600" />
            <h2 className="text-[15px] font-semibold text-slate-800">
              Re-request Approvals
            </h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
              {columnName}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Days control */}
        <div className="border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-600">
              Last request older than
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleDaysChange(-1)}
                disabled={staleDays <= 1}
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="min-w-[3rem] text-center text-sm font-semibold text-slate-800">
                {staleDays} {staleDays === 1 ? "day" : "days"}
              </span>
              <button
                onClick={() => handleDaysChange(1)}
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <span className="text-sm text-slate-400">(also includes never sent)</span>
          </div>
        </div>

        {/* Order list */}
        <div className="flex-1 overflow-y-auto" style={{ maxHeight: "360px" }}>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-slate-400">
              Loading orders…
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : sentResult ? (
            <div className="flex flex-col items-center gap-3 px-5 py-10">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="text-center text-sm font-medium text-slate-800">
                Sent {sentResult.sent} approval {sentResult.sent === 1 ? "request" : "requests"}
              </p>
              {sentResult.failed > 0 && (
                <p className="text-center text-xs text-red-500">{sentResult.failed} failed</p>
              )}
              {sentResult.skipped > 0 && (
                <p className="text-center text-xs text-slate-400">
                  {sentResult.skipped} skipped (no contact info)
                </p>
              )}
            </div>
          ) : eligible && eligible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-sm text-slate-400">
              <CheckCircle2 className="h-8 w-8 text-green-400" />
              All orders are up to date
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {/* Stale orders */}
              {stale.length > 0 && (
                <>
                  <div className="bg-amber-50 px-5 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                      Stale — {stale.length} order{stale.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {stale.map((order) => (
                    <OrderRow key={order.orderId} order={order} formatAgo={formatAgo} />
                  ))}
                </>
              )}
              {/* Never sent orders */}
              {neverSent.length > 0 && (
                <>
                  <div className="bg-blue-50 px-5 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">
                      Never requested — {neverSent.length} order{neverSent.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {neverSent.map((order) => (
                    <OrderRow key={order.orderId} order={order} formatAgo={formatAgo} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!sentResult && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
            <p className="text-xs text-slate-400">
              {loading
                ? "Loading…"
                : eligible
                  ? `${eligible.length} order${eligible.length !== 1 ? "s" : ""} to send`
                  : ""}
            </p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSendAll()}
                disabled={loading || sending || !eligible || eligible.length === 0}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition-colors",
                  "bg-blue-600 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {sending ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {sending ? "Sending…" : `Send All (${eligible?.length ?? 0})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OrderRow({
  order,
  formatAgo,
}: {
  order: BatchRerequestOrder;
  formatAgo: (iso: string) => string;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-slate-800">
          #{order.title}
        </span>
        {order.customerName && (
          <span className="truncate text-xs text-slate-500">{order.customerName}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-xs">
        {order.reason === "stale" && order.lastSentAt ? (
          <span className="flex items-center gap-1 text-amber-600">
            <Clock className="h-3 w-3" />
            {formatAgo(order.lastSentAt)}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-blue-500">
            <Mail className="h-3 w-3" />
            {order.customerEmail ?? order.customerPhone ?? "no contact"}
          </span>
        )}
      </div>
    </div>
  );
}
