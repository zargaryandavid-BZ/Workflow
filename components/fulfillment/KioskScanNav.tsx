"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Camera, Package, X } from "lucide-react";
import { ScanNumberKeypad } from "@/components/fulfillment/ScanNumberKeypad";
import {
  SCAN_CAMERA_EVENT,
  SCAN_FOCUS_EVENT,
  SCAN_LOADING_EVENT,
  SCAN_QUERY_EVENT,
  looksLikeScanOrderNumber,
} from "@/components/fulfillment/FulfillmentNav";

interface Props {
  tenantName: string;
  kioskToken: string;
}

export function KioskScanNav({ tenantName }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceNextInput = useRef(false);
  const lookupTimer = useRef<number | null>(null);

  function openTypedOrder(raw: string) {
    const q = raw.trim();
    if (!q) return;
    if (lookupTimer.current != null) window.clearTimeout(lookupTimer.current);
    setQuery(q);
    setKeypadOpen(false);
    window.dispatchEvent(
      new CustomEvent(SCAN_QUERY_EVENT, { detail: { query: q } })
    );
  }

  function scheduleTypedOrder(raw: string) {
    if (lookupTimer.current != null) window.clearTimeout(lookupTimer.current);
    const q = raw.trim();
    if (!looksLikeScanOrderNumber(q)) return;
    lookupTimer.current = window.setTimeout(() => openTypedOrder(q), 200);
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onFocus() {
      inputRef.current?.focus();
    }
    function onLoading(e: Event) {
      const detail = (e as CustomEvent<{ loading: boolean }>).detail;
      setLoading(Boolean(detail?.loading));
      if (!detail?.loading) {
        replaceNextInput.current = true;
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener(SCAN_FOCUS_EVENT, onFocus);
    window.addEventListener(SCAN_LOADING_EVENT, onLoading);
    return () => {
      window.removeEventListener(SCAN_FOCUS_EVENT, onFocus);
      window.removeEventListener(SCAN_LOADING_EVENT, onLoading);
    };
  }, []);

  function applyScanInput(next: string) {
    replaceNextInput.current = false;
    setQuery(next);
    scheduleTypedOrder(next);
  }

  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    openTypedOrder(inputRef.current?.value ?? query);
  }

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <span className="min-w-0 truncate text-sm font-semibold text-slate-700">
          {tenantName} — Scan
        </span>
        <Link
          href="/fulfillment/multiitem-box"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-xs font-semibold sm:h-auto sm:px-2.5 sm:py-1.5 text-slate-700 hover:bg-slate-100"
        >
          <Package className="h-4 w-4" />
          Multi-item box
        </Link>
        <form
          onSubmit={submit}
          className="flex min-w-full flex-1 items-center gap-2 sm:min-w-[16rem]"
        >
          <input
            ref={inputRef}
            type="text"
            inputMode="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(e) => applyScanInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              openTypedOrder(e.currentTarget.value);
            }}
            onPointerDown={(e) => {
              if (e.pointerType === "touch") setKeypadOpen(true);
            }}
            placeholder="e.g. 15118-1"
            className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[17px] sm:px-4 text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <button
            type="button"
            onClick={() => {
              replaceNextInput.current = false;
              setQuery("");
              inputRef.current?.focus();
            }}
            disabled={!query}
            aria-label="Clear scan text"
            className="inline-flex h-12 w-11 shrink-0 sm:w-12 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            <X className="h-5 w-5" />
          </button>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="h-12 shrink-0 rounded-xl bg-slate-900 px-4 text-[15px] sm:px-5 font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {loading ? "…" : "Scan"}
          </button>
          <button
            type="button"
            onClick={() => {
              setKeypadOpen(false);
              replaceNextInput.current = false;
              setQuery("");
              window.dispatchEvent(
                new CustomEvent(SCAN_CAMERA_EVENT, { detail: { open: true } })
              );
            }}
            aria-label="Scan with camera"
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 text-[14px] font-medium text-slate-700 hover:bg-slate-100 sm:w-auto sm:px-4"
          >
            <Camera className="h-5 w-5" />
            <span className="hidden sm:inline">Camera</span>
          </button>
        </form>
      </header>
      {keypadOpen ? (
        <ScanNumberKeypad
          value={query}
          onInsert={(ch) => {
            const next = replaceNextInput.current ? ch : `${query}${ch}`;
            replaceNextInput.current = false;
            setQuery(next);
            scheduleTypedOrder(next);
          }}
          onBackspace={() => {
            replaceNextInput.current = false;
            const next = query.slice(0, -1);
            setQuery(next);
            scheduleTypedOrder(next);
          }}
          onSubmit={() => submit()}
          onClose={() => setKeypadOpen(false)}
        />
      ) : null}
    </>
  );
}
