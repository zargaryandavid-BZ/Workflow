"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Trophy } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import type { DesignerLeaderboardResult } from "@/lib/designer-leaderboard";

function Stars({ count }: { count: number }) {
  return (
    <span className="tracking-tight text-amber-500" aria-label={`${count} stars`}>
      {"★".repeat(count)}
      <span className="text-slate-200">{"★".repeat(Math.max(0, 5 - count))}</span>
    </span>
  );
}

function rankBadge(rank: number) {
  if (rank === 1) {
    return "bg-amber-100 text-amber-800 border-amber-200";
  }
  if (rank === 2) {
    return "bg-slate-100 text-slate-700 border-slate-200";
  }
  if (rank === 3) {
    return "bg-orange-50 text-orange-800 border-orange-200";
  }
  return "bg-white text-slate-500 border-slate-200";
}

const MENU_Z = 200;

export function DesignerLeaderboardButton() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DesignerLeaderboardResult | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch("/api/designers/leaderboard");
        const json = (await res.json()) as DesignerLeaderboardResult & {
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? "Failed to load leaderboard");
          setData(null);
          return;
        }
        setData(json);
      } catch {
        if (!cancelled) {
          setError("Failed to load leaderboard");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const menu =
    open && mounted && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
            style={{
              top: menuPos.top,
              right: menuPos.right,
              zIndex: MENU_Z,
            }}
          >
            <div className="border-b border-slate-100 bg-gradient-to-r from-amber-50 to-white px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Trophy className="h-4 w-4 text-amber-600" />
                Designer leaders
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {data?.monthLabel ?? "This month"} · all assigned cards
                (Orders/SKUs)
              </p>
            </div>

            <div className="max-h-[min(24rem,70vh)] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : error ? (
                <p className="px-4 py-6 text-center text-sm text-red-600">
                  {error}
                </p>
              ) : !data || data.rows.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-500">
                  No designers yet.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 py-1">
                  {data.rows.map((row) => (
                    <li
                      key={row.id}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5",
                        row.rank === 1 && row.orderCount > 0 && "bg-amber-50/60"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold tabular-nums",
                          rankBadge(row.rank)
                        )}
                      >
                        {row.rank === 1 ? (
                          <Trophy className="h-3.5 w-3.5 text-amber-600" />
                        ) : (
                          row.rank
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {row.name}
                        </p>
                        <Stars count={row.stars} />
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums text-slate-800">
                          {row.orderCount}/{row.skuCount}
                        </p>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">
                          Orders/SKUs
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {data && !loading && !error ? (
              <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
                <span>
                  Total {data.totalOrders}/{data.totalSkus} · Updated{" "}
                  {formatDateTime(data.updatedAt)}
                </span>
              </div>
            ) : null}
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
          open
            ? "border-amber-300 bg-amber-50 text-amber-700"
            : "border-slate-300 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
        )}
        aria-label="Designer leaderboard"
        title="Designer leaders — this month"
        aria-expanded={open}
      >
        <Trophy className="h-4 w-4" />
      </button>
      {menu}
    </div>
  );
}
