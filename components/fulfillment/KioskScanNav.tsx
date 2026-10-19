"use client";

import Link from "next/link";
import { Camera, Package } from "lucide-react";
import { SCAN_CAMERA_EVENT } from "@/components/fulfillment/FulfillmentNav";

interface Props {
  tenantName: string;
  kioskToken: string;
}

export function KioskScanNav({ tenantName }: Props) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3">
      <span className="min-w-0 truncate text-sm font-semibold text-slate-700">
        {tenantName} — Scan
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/fulfillment/multiitem-box"
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          <Package className="h-4 w-4" />
          Multi-item box
        </Link>
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent(SCAN_CAMERA_EVENT, { detail: { open: true } })
            )
          }
          className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
        >
          <Camera className="h-4 w-4" />
          Camera
        </button>
      </div>
    </header>
  );
}
