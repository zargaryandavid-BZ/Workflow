"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { PackageCheck, PackagePlus, ScanLine, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export const SCAN_CONFIGURE_EVENT = "workflow:scan-configure";
export const SCAN_QUERY_EVENT = "workflow:scan-query";
export const SCAN_FOCUS_EVENT = "workflow:scan-focus-input";
export const SCAN_LOADING_EVENT = "workflow:scan-loading";

export function FulfillmentNav() {
  const pathname = usePathname();
  const isSend = pathname === "/fulfillment/send" || pathname === "/fulfillment";
  const isReceived = pathname === "/fulfillment/received";
  const isScan = pathname === "/fulfillment/scan" || pathname.startsWith("/fulfillment/scan/");

  const [navQuery, setNavQuery] = useState("");
  const [navLoading, setNavLoading] = useState(false);
  const navInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input on mount when on scan page
  useEffect(() => {
    if (isScan) navInputRef.current?.focus();
  }, [isScan]);

  // Listen for focus requests from the page (after action clears)
  useEffect(() => {
    if (!isScan) return;
    function onFocus() { navInputRef.current?.focus(); }
    function onLoading(e: Event) {
      const detail = (e as CustomEvent<{ loading: boolean }>).detail;
      setNavLoading(detail.loading);
      if (!detail.loading) setNavQuery("");
    }
    window.addEventListener(SCAN_FOCUS_EVENT, onFocus);
    window.addEventListener(SCAN_LOADING_EVENT, onLoading);
    return () => {
      window.removeEventListener(SCAN_FOCUS_EVENT, onFocus);
      window.removeEventListener(SCAN_LOADING_EVENT, onLoading);
    };
  }, [isScan]);

  function handleNavSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = navQuery.trim();
    if (!q) return;
    window.dispatchEvent(new CustomEvent(SCAN_QUERY_EVENT, { detail: { query: q } }));
  }

  return (
    <header className="flex flex-nowrap items-center gap-1 border-b border-slate-200 bg-white px-4 py-2">
      <Link
        href="/fulfillment/send"
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          isSend
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:bg-slate-100"
        )}
      >
        <PackagePlus className="h-4 w-4" />
        Send
      </Link>
      <Link
        href="/fulfillment/received"
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          isReceived
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:bg-slate-100"
        )}
      >
        <PackageCheck className="h-4 w-4" />
        Received
      </Link>
      <Link
        href="/fulfillment/scan"
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          isScan
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:bg-slate-100"
        )}
      >
        <ScanLine className="h-4 w-4" />
        Scan
      </Link>

      {/* Inline scan input — visible only on scan page */}
      {isScan && (
        <form
          onSubmit={handleNavSubmit}
          className="ml-3 flex flex-1 items-center gap-2"
        >
          <input
            ref={navInputRef}
            type="text"
            value={navQuery}
            onChange={(e) => setNavQuery(e.target.value)}
            placeholder="e.g. 15118-1"
            className="h-8 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300"
          />
          <button
            type="submit"
            disabled={navLoading || !navQuery.trim()}
            className="h-8 rounded-lg bg-slate-900 px-4 text-[13px] font-medium text-white disabled:opacity-40"
          >
            {navLoading ? "…" : "Scan"}
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(SCAN_CONFIGURE_EVENT))}
            title="Configure columns"
            aria-label="Configure columns"
            className="ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <Settings className="h-4 w-4" />
          </button>
        </form>
      )}

      {/* Settings gear for non-scan pages */}
      {!isScan && null}
    </header>
  );
}
