"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Camera, Package, PackageCheck, PackagePlus, ScanLine, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScanNumberKeypad } from "@/components/fulfillment/ScanNumberKeypad";

export const SCAN_CONFIGURE_EVENT = "workflow:scan-configure";
export const SCAN_QUERY_EVENT = "workflow:scan-query";
export const SCAN_FOCUS_EVENT = "workflow:scan-focus-input";
export const SCAN_LOADING_EVENT = "workflow:scan-loading";

export function FulfillmentNav() {
  const pathname = usePathname();
  const isSend = pathname === "/fulfillment/send" || pathname === "/fulfillment";
  const isReceived = pathname === "/fulfillment/received";
  const isScan = pathname === "/fulfillment/scan" || pathname.startsWith("/fulfillment/scan/");
  const isBoxSlip = pathname === "/fulfillment/multiitem-box";

  const [navQuery, setNavQuery] = useState("");
  const [navLoading, setNavLoading] = useState(false);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const navInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null);

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
        setNavQuery("");
        // Return focus to the input after lookup completes so the next scan lands here.
        navInputRef.current?.focus();
      }
    }
    window.addEventListener(SCAN_FOCUS_EVENT, onFocus);
    window.addEventListener(SCAN_LOADING_EVENT, onLoading);
    return () => {
      window.removeEventListener(SCAN_FOCUS_EVENT, onFocus);
      window.removeEventListener(SCAN_LOADING_EVENT, onLoading);
    };
  }, [isScan]);

  // Close camera when leaving scan page
  useEffect(() => {
    if (!isScan) setCameraOpen(false);
  }, [isScan]);

  // Start / stop QrScanner when cameraOpen toggles
  useEffect(() => {
    if (!cameraOpen || !isScan) return;

    let destroyed = false;

    void (async () => {
      const { default: QrScanner } = await import("qr-scanner");
      if (destroyed || !videoRef.current) return;

      const scanner = new QrScanner(
        videoRef.current,
        (result: { data: string }) => {
          const code = result.data.trim();
          if (!code) return;
          scanner.stop();
          scanner.destroy();
          scannerRef.current = null;
          setCameraOpen(false);
          navInputRef.current?.focus();
          window.dispatchEvent(new CustomEvent(SCAN_QUERY_EVENT, { detail: { query: code } }));
        },
        {
          returnDetailedScanResult: true,
          highlightScanRegion: true,
          highlightCodeOutline: true,
          preferredCamera: "environment",
        }
      );

      scannerRef.current = scanner;
      await scanner.start();
    })();

    return () => {
      destroyed = true;
      if (scannerRef.current) {
        scannerRef.current.stop();
        scannerRef.current.destroy();
        scannerRef.current = null;
      }
    };
  }, [cameraOpen, isScan]);

  function handleNavSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const q = navQuery.trim();
    if (!q) return;
    setKeypadOpen(false);
    // Keep focus on the input so the QR scanner can scan the next order immediately.
    navInputRef.current?.focus();
    window.dispatchEvent(new CustomEvent(SCAN_QUERY_EVENT, { detail: { query: q } }));
  }

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
            onChange={(e) => setNavQuery(e.target.value)}
            onClick={() => setKeypadOpen(true)}
            placeholder="e.g. 15118-1"
            className="h-8 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[16px] text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 md:h-10 md:text-[17px]"
          />
          <button
            type="submit"
            disabled={navLoading || !navQuery.trim()}
            className="h-8 rounded-lg bg-slate-900 px-4 text-[13px] font-medium text-white disabled:opacity-40 md:h-10"
          >
            {navLoading ? "…" : "Scan"}
          </button>
          {/* Camera button — mobile only, uses phone camera to scan QR */}
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            onMouseDown={(e) => e.preventDefault()}
            title="Scan with camera"
            aria-label="Scan with phone camera"
            className="md:hidden inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white"
          >
            <Camera className="h-4 w-4" />
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
          onInsert={(ch) => setNavQuery((q) => q + ch)}
          onBackspace={() => setNavQuery((q) => q.slice(0, -1))}
          onSubmit={() => handleNavSubmit()}
          onClose={() => setKeypadOpen(false)}
        />
      ) : null}

      {/* Full-screen camera overlay — mobile QR scanning */}
      {isScan && cameraOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black"
          style={{ touchAction: "none" }}
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-medium text-white">Point camera at QR code</span>
            <button
              type="button"
              aria-label="Close camera"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setCameraOpen(false)}
              className="rounded-full p-2 text-white hover:bg-white/10 active:bg-white/20"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Live video */}
          <div className="relative flex-1 overflow-hidden">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
            />
            {/* Aim guide */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className="rounded-xl border-2 border-white/80"
                style={{
                  width: 220,
                  height: 220,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                }}
              />
            </div>
          </div>

          {/* Hint */}
          <div className="px-4 py-3 text-center text-xs text-white/60">
            Keep the code inside the frame — it scans automatically
          </div>
        </div>
      )}
    </>
  );
}
