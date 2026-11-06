"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { formatShortOrderNumber } from "@/lib/board-order-filters";

export type DieOrderHit = {
  id: string;
  title: string;
  orderNumber: string;
  dueDate: string | null;
  customerName: string | null;
  email: string | null;
  productName: string | null;
  width: string | null;
  height: string | null;
  depth: string | null;
  /** Order's total qty (same as the scan page), when known. */
  totalQty?: number | null;
};

/**
 * "Type digits…" order search used by the Add Die and Request quote popups.
 * Matches board cards by number (same API as before: /api/die-requests/orders).
 */
export function DieOrderPicker({
  id,
  initialText = "",
  onPick,
  onClear,
  placeholder = "Type digits…",
}: {
  id: string;
  initialText?: string;
  onPick: (hit: DieOrderHit) => void;
  onClear: () => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(initialText);
  const [hits, setHits] = useState<DieOrderHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 256 });
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) {
      setHits([]);
      setSearching(false);
      return;
    }
    const q = query.trim().replace(/^#/, "");
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      setSearching(true);
      void fetch(`/api/die-requests/orders?q=${encodeURIComponent(q)}`, {
        signal: ac.signal,
      })
        .then((res) => res.json())
        .then((json: { orders?: DieOrderHit[] }) => {
          setHits(
            (json.orders ?? []).map((hit) => ({
              ...hit,
              orderNumber: hit.orderNumber || formatShortOrderNumber(hit.title),
            }))
          );
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setHits([]);
        })
        .finally(() => setSearching(false));
    }, q.length === 1 ? 0 : 160);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [query, open]);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, 18 * 16);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      setMenuPos({ top: r.bottom + 4, left, width });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, hits.length]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (inputRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  function pick(hit: DieOrderHit) {
    const orderNumber = hit.orderNumber || formatShortOrderNumber(hit.title);
    setQuery(orderNumber);
    setHits([]);
    setOpen(false);
    onPick({ ...hit, orderNumber });
  }

  return (
    <>
      <Input
        ref={inputRef}
        id={id}
        className="mt-1"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onClear();
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-hits`}
      />
      {open && typeof document !== "undefined"
        ? createPortal(
            <ul
              ref={menuRef}
              id={`${id}-hits`}
              role="listbox"
              // Above the popup (z-[100]).
              className="fixed z-[200] max-h-64 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
              style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {searching && hits.length === 0 ? (
                <li className="px-3 py-2 text-sm text-slate-500">Matching board cards…</li>
              ) : hits.length === 0 ? (
                <li className="px-3 py-2 text-sm text-slate-500">
                  {query.trim()
                    ? "No matching board orders"
                    : "Type the order number from the card"}
                </li>
              ) : (
                hits.map((hit) => (
                  <li key={hit.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                      onClick={() => pick(hit)}
                    >
                      <span className="font-medium tabular-nums">
                        {hit.orderNumber || formatShortOrderNumber(hit.title)}
                      </span>
                      {hit.productName ? (
                        <span className="text-slate-500"> · {hit.productName}</span>
                      ) : hit.customerName ? (
                        <span className="text-slate-500"> · {hit.customerName}</span>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>,
            document.body
          )
        : null}
    </>
  );
}
