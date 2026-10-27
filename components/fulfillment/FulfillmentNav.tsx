"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Camera, Package, ScanLine, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScanNumberKeypad } from "@/components/fulfillment/ScanNumberKeypad";

export const SCAN_CONFIGURE_EVENT = "workflow:scan-configure";
export const SCAN_QUERY_EVENT = "workflow:scan-query";

/** Order numbers look like 15464-2 or w412-1. A bare prefix is still being typed. */
export function looksLikeScanOrderNumber(value: string): boolean {
  return /^\S+-\d+$/.test(value.trim());
}
export const SCAN_FOCUS_EVENT = "workflow:scan-focus-input";
export const SCAN_LOADING_EVENT = "workflow:scan-loading";
/** Dispatched by the camera button; FulfillmentScanPage listens and shows inline camera. */
export const SCAN_CAMERA_EVENT = "workflow:scan-camera";

export function FulfillmentNav() {
  const pathname = usePathname();
  const isScan = pathname === "/fulfillment/scan" || pathname.startsWith("/fulfillment/scan/");
  const isProduction = pathname === "/fulfillment/production";
  const isBoxSlip = pathname === "/fulfillment/multiitem-box";

  const [navQuery, setNavQuery] = useState("");
  const [navLoading, setNavLoading] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const navInputRef = useRef<HTMLInputElement>(null);
  const [openBoxCount, setOpenBoxCount] = useState(0);

  // Count open (non-saved) boxes from localStorage for the badge
  useEffect(() => {
    function countOpenBoxes() {
      try {
        let count = 0;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith("multiitem-day-")) continue;
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw) as { status?: string }[];
          if (Array.isArray(parsed)) {
            count += parsed.filter((b) => b.status === "open").length;
          }
        }
        setOpenBoxCount(count);
      } catch { /* ignore */ }
    }
    countOpenBoxes();
    window.addEventListener("focus", countOpenBoxes);
    window.addEventListener("storage", countOpenBoxes);
    // Also refresh when navigating to/from multiitem-box
    const interval = setInterval(countOpenBoxes, 3000);
    return () => {
      window.removeEventListener("focus", countOpenBoxes);
      window.removeEventListener("storage", countOpenBoxes);
      clearInterval(interval);
    };
  }, []);
  /** After a scan is committed, the next keystrokes replace the field (wedge scanners). */
  const replaceNextInput = useRef(false);
  const lookupTimer = useRef<number | null>(null);

  function openTypedOrder(raw: string) {
    const q = raw.trim();
    if (!q) return;
    if (lookupTimer.current != null) window.clearTimeout(lookupTimer.current);
    setNavQuery(q);
    setKeypadOpen(false);
    window.dispatchEvent(new CustomEvent(SCAN_QUERY_EVENT, { detail: { query: q } }));
  }

  function scheduleTypedOrder(raw: string) {
    if (lookupTimer.current != null) window.clearTimeout(lookupTimer.current);
    const q = raw.trim();
    if (!looksLikeScanOrderNumber(q)) return;
    lookupTimer.current = window.setTimeout(() => openTypedOrder(q), 200);
  }

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
    replaceNextInput.current = false;
    setNavQuery(next);
    scheduleTypedOrder(next);
  }

  function clearNavQuery() {
    replaceNextInput.current = false;
    setNavQuery("");
    navInputRef.current?.focus();
  }

  function handleNavSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    openTypedOrder(navInputRef.current?.value ?? navQuery);
  }

  if (isProduction) return null;

  return (
    <>
    <header className="flex flex-col gap-2 border-b border-slate-200 bg-white px-2 py-2 sm:flex-row sm:flex-nowrap sm:items-center sm:gap-1 sm:overflow-x-auto md:px-4">
      <div className="flex shrink-0 items-center gap-1">
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
        <span className="inline">Scan</span>
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
        <span className="relative">
          <Package className="h-4 w-4 shrink-0" />
          {openBoxCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-600 text-[8px] font-bold text-white leading-none">
              {openBoxCount > 9 ? "9+" : openBoxCount}
            </span>
          )}
        </span>
        <span className="inline">Multi-item box</span>
      </Link>
      </div>
      {isBoxSlip ? (
        <div
          id="multiitem-box-header-actions"
          className="ml-auto min-w-0 flex-1"
        />
      ) : null}

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
            onClick={clearNavQuery}
            disabled={!navQuery}
            title="Clear"
            aria-label="Clear scan text"
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
          >
            <X className="h-5 w-5" />
          </button>
          <button
            type="submit"
            disabled={navLoading || !navQuery.trim()}
            className="h-12 shrink-0 rounded-xl bg-slate-900 px-4 text-[15px] sm:px-6 font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            {navLoading ? "…" : "Scan"}
          </button>
          <button
            type="button"
            onClick={() => {
              setKeypadOpen(false);
              replaceNextInput.current = false;
              setNavQuery("");
              window.dispatchEvent(
                new CustomEvent(SCAN_CAMERA_EVENT, { detail: { open: true } })
              );
            }}
            title="Scan with camera"
            aria-label="Scan with camera"
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 text-[14px] sm:w-auto sm:px-4 font-medium text-slate-700 hover:bg-slate-100"
          >
            <Camera className="h-5 w-5" />
            <span className="hidden sm:inline">Camera</span>
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
            const next = replaceNextInput.current ? ch : `${navQuery}${ch}`;
            replaceNextInput.current = false;
            setNavQuery(next);
            scheduleTypedOrder(next);
          }}
          onBackspace={() => {
            replaceNextInput.current = false;
            const next = navQuery.slice(0, -1);
            setNavQuery(next);
            scheduleTypedOrder(next);
          }}
          onSubmit={() => handleNavSubmit()}
          onClose={() => setKeypadOpen(false)}
        />
      ) : null}
    </>
  );
}
