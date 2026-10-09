"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Package, PackageCheck, PackagePlus, Printer, ScanLine, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScanNumberKeypad } from "@/components/fulfillment/ScanNumberKeypad";

export const SCAN_CONFIGURE_EVENT = "workflow:scan-configure";
export const SCAN_QUERY_EVENT = "workflow:scan-query";
export const SCAN_FOCUS_EVENT = "workflow:scan-focus-input";
export const SCAN_LOADING_EVENT = "workflow:scan-loading";
/** Dispatched by the camera button; FulfillmentScanPage listens and shows inline camera. */
export const SCAN_CAMERA_EVENT = "workflow:scan-camera";

export function FulfillmentNav() {
  const pathname = usePathname();
  const isSend = pathname === "/fulfillment/send" || pathname === "/fulfillment";
  const isReceived = pathname === "/fulfillment/received";
  const isScan = pathname === "/fulfillment/scan" || pathname.startsWith("/fulfillment/scan/");
  const isProduction = pathname === "/fulfillment/production";
  const isBoxSlip = pathname === "/fulfillment/multiitem-box";

  const [navQuery, setNavQuery] = useState("");
  const [navLoading, setNavLoading] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const navInputRef = useRef<HTMLInputElement>(null);
  /** After a scan is committed, the next keystrokes replace the field (wedge scanners). */
  const replaceNextInput = useRef(false);

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
      if (!detail.loading) {
        // Keep the scanned order # visible. Next scan replaces it (not append).
        replaceNextInput.current = true;
        navInputRef.current?.focus();
        navInputRef.current?.select();
      }
    }
    window.addEventListener(SCAN_FOCUS_EVENT, onFocus);
    window.addEventListener(SCAN_LOADING_EVENT, onLoading);
    return () => {
      window.removeEventListener(SCAN_FOCUS_EVENT, onFocus);
      window.removeEventListener(SCAN_LOADING_EVENT, onLoading);
    };
  }, [isScan]);

  function applyScanInput(next: string) {
    if (replaceNextInput.current) {
      replaceNextInput.current = false;
      const prev = navQuery;
      setNavQuery(next.startsWith(prev) ? next.slice(prev.length) : next);
      return;
    }
    setNavQuery(next);
  }

  function clearNavQuery() {
    replaceNextInput.current = false;
    setNavQuery("");
    navInputRef.current?.focus();
  }

  function handleNavSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const q = navQuery.trim();
    if (!q) return;
    setKeypadOpen(false);
    replaceNextInput.current = true;
    navInputRef.current?.focus();
    navInputRef.current?.select();
    window.dispatchEvent(new CustomEvent(SCAN_QUERY_EVENT, { detail: { query: q } }));
  }

  if (isProduction) return null;

  return (
    <>
    <header className="flex flex-nowrap items-center gap-1 border-b border-slate-200 bg-white px-2 py-2 md:px-4">
      <Link
        href="/fulfillment/send"
        title="Send"
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors md:px-3",
          isSend
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:bg-slate-100"
        )}
      >
        <PackagePlus className="h-4 w-4 shrink-0" />
        <span className="hidden md:inline">Send</span>
      </Link>
      <Link
        href="/fulfillment/received"
        title="Received"
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors md:px-3",
          isReceived
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:bg-slate-100"
        )}
      >
        <PackageCheck className="h-4 w-4 shrink-0" />
        <span className="hidden md:inline">Received</span>
      </Link>
      <Link
        href="/fulfillment/scan"
        title="Scan"
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors md:px-3",
          isScan
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:bg-slate-100"
        )}
      >
        <ScanLine className="h-4 w-4 shrink-0" />
        <span className="hidden md:inline">Scan</span>
      </Link>
      <Link
        href="/fulfillment/production"
        title="Production"
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors md:px-3",
          isProduction
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:bg-slate-100"
        )}
      >
        <Printer className="h-4 w-4 shrink-0" />
        <span className="hidden md:inline">Production</span>
      </Link>
      <Link
        href="/fulfillment/multiitem-box"
        title="Multi-item Box Slip"
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors md:px-3",
          isBoxSlip
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:bg-slate-100"
        )}
      >
        <Package className="h-4 w-4 shrink-0" />
        <span className="hidden md:inline">Multi-item Box Slip</span>
      </Link>

      {/* Inline scan input — visible only on scan page */}
      {isScan && (
        <form
          onSubmit={handleNavSubmit}
          className="ml-1 flex flex-1 items-center gap-2 md:ml-3"
        >
          <input
            ref={navInputRef}
            type="text"
            inputMode="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={navQuery}
            onChange={(e) => applyScanInput(e.target.value)}
            onClick={() => setKeypadOpen(true)}
            placeholder="e.g. 15118-1"
            className="h-8 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[16px] text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 md:h-10 md:text-[17px]"
          />
          <button
            type="button"
            onClick={clearNavQuery}
            disabled={!navQuery}
            title="Clear"
            aria-label="Clear scan text"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 md:h-10 md:w-10"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="submit"
            disabled={navLoading || !navQuery.trim()}
            className="h-8 rounded-lg bg-slate-900 px-4 text-[13px] font-medium text-white disabled:opacity-40 md:h-10"
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
    </header>
      {isScan && keypadOpen ? (
        <ScanNumberKeypad
          value={navQuery}
          onInsert={(ch) => {
            if (replaceNextInput.current) {
              replaceNextInput.current = false;
              setNavQuery(ch);
              return;
            }
            setNavQuery((q) => q + ch);
          }}
          onBackspace={() => {
            replaceNextInput.current = false;
            setNavQuery((q) => q.slice(0, -1));
          }}
          onSubmit={() => handleNavSubmit()}
          onClose={() => setKeypadOpen(false)}
        />
      ) : null}
    </>
  );
}
