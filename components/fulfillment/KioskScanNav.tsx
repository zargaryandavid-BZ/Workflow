"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { SCAN_QUERY_EVENT } from "@/components/fulfillment/FulfillmentNav";

interface Props {
  tenantName: string;
  kioskToken: string;
}

export function KioskScanNav({ tenantName }: Props) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<{ stop: () => void; destroy: () => void } | null>(
    null
  );

  useEffect(() => {
    if (/Mobi|Android|iPhone/i.test(navigator.userAgent)) {
      setCameraOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!cameraOpen) return;
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
          window.dispatchEvent(
            new CustomEvent(SCAN_QUERY_EVENT, { detail: { query: code } })
          );
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
  }, [cameraOpen]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3">
        <span className="text-sm font-semibold text-slate-700">
          {tenantName} — Scan
        </span>
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
        >
          <Camera className="h-4 w-4" />
          Camera
        </button>
      </header>

      {cameraOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            playsInline
            muted
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-56 w-56 rounded-xl border-4 border-white/80 shadow-lg" />
          </div>
          <p className="absolute bottom-10 left-0 right-0 text-center text-sm font-medium text-white/70">
            Point at a QR code or barcode
          </p>
          <button
            type="button"
            onClick={() => setCameraOpen(false)}
            className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/30"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : null}
    </>
  );
}
