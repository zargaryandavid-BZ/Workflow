"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { PackingSlipConfigModal } from "@/components/fulfillment/PackingSlipConfigModal";

/** Same-size scan shipping actions: lucide icon + one-line label. */
export const SCAN_SHIPPING_ACTION_BTN =
  "inline-flex h-12 w-full min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-3 text-[13px] font-medium md:text-[14px]";

export const SCAN_SHIPPING_ACTION_BTN_READY =
  "border-slate-200 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50";

export function ScanShippingSlipButtons({
  orderId,
  orderNumber,
  groupSize,
  compact = false,
  skuImages,
  totalQty,
  qtyPerSku,
  sender = false,
  scanApiBase,
}: {
  orderId: string;
  orderNumber: string;
  groupSize: number;
  compact?: boolean;
  skuImages?: {
    sku_id: string;
    sku_name: string;
    url: string;
    qty?: number | null;
  }[];
  totalQty?: number | null;
  qtyPerSku?: number | null;
  sender?: boolean;
  scanApiBase?: string;
}) {
  const [showModal, setShowModal] = useState(false);

  if (compact) {
    return (
      <>
        {showModal && (
          <PackingSlipConfigModal
            orderId={orderId}
            orderNumber={orderNumber}
            groupSize={groupSize}
            skuImages={skuImages}
            totalQty={totalQty}
            qtyPerSku={qtyPerSku}
            sender={sender}
            scanApiBase={scanApiBase}
            onClose={() => setShowModal(false)}
          />
        )}
        <div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <Printer className="h-3.5 w-3.5 shrink-0" />
            Print slip
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {showModal && (
        <PackingSlipConfigModal
          orderId={orderId}
          orderNumber={orderNumber}
          groupSize={groupSize}
          skuImages={skuImages}
          totalQty={totalQty}
          qtyPerSku={qtyPerSku}
          sender={sender}
          scanApiBase={scanApiBase}
          onClose={() => setShowModal(false)}
        />
      )}
      <div>
        <p className="mb-2 text-[11px] md:text-[12px] font-semibold uppercase tracking-wide text-slate-400">
          Shipping slip
        </p>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className={cn(SCAN_SHIPPING_ACTION_BTN, SCAN_SHIPPING_ACTION_BTN_READY)}
        >
          <Printer className="h-4 w-4 shrink-0" />
          Print packing slip
        </button>
      </div>
    </>
  );
}
