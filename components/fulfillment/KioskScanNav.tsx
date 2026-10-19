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
    if (replaceNextInput.current) {
      replaceNextInput.current = false;
      const prev = query;
      setQuery(next.startsWith(prev) ? next.slice(prev.length) : next);
      return;
    }
    setQuery(next);
  }

  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setKeypadOpen(false);
    replaceNextInput.current = true;
    inputRef.current?.focus();
    inputRef.current?.select();
    window.dispatchEvent(
      new CustomEvent(SCAN_QUERY_EVENT, { detail: { query: q } })
    );
  }

  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <span className="min-w-0 truncate text-sm font-semibold text-slate-700">
          {tenantName} — Scan
        </span>
        <Link
          href="/fulfillment/multiitem-box"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          <Package className="h-4 w-4" />
          Multi-item box
        </Link>
        <form
          onSubmit={submit}
          className="flex min-w-[16rem] flex-1 items-center gap-2"
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
            onClick={() => setKeypadOpen(true)}
            placeholder="e.g. 15118-1"
            className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 text-[17px] text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
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
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            <X className="h-5 w-5" />
          </button>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="h-12 shrink-0 rounded-xl bg-slate-900 px-5 text-[15px] font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {loading ? "…" : "Scan"}
          </button>
          <button
            type="button"
            onClick={() => {
              setKeypadOpen(false);
              window.dispatchEvent(
                new CustomEvent(SCAN_CAMERA_EVENT, { detail: { open: true } })
              );
            }}
            aria-label="Scan with camera"
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl border border-slate-200 px-4 text-[14px] font-medium text-slate-700 hover:bg-slate-100"
          >
            <Camera className="h-5 w-5" />
            Camera
          </button>
        </form>
      </header>
      {keypadOpen ? (
        <ScanNumberKeypad
          value={query}
          onInsert={(ch) => {
            if (replaceNextInput.current) {
              replaceNextInput.current = false;
              setQuery(ch);
              return;
            }
            setQuery((current) => current + ch);
          }}
          onBackspace={() => {
            replaceNextInput.current = false;
            setQuery((current) => current.slice(0, -1));
          }}
          onSubmit={() => submit()}
          onClose={() => setKeypadOpen(false)}
        />
      ) : null}
    </>
  );
}
