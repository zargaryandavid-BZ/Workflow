"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Globe } from "lucide-react";
import {
  billingFromSpecs,
  formatBillingMoney,
  hasBillingInfo,
  paymentStatusLabel,
  type OrderBillingInfo,
} from "@/lib/order-billing";
import { cn } from "@/lib/utils";

interface Props {
  specs: Record<string, unknown> | null | undefined;
  className?: string;
}

export function OrderBillingGlobe({ specs, className }: Props) {
  const billing = billingFromSpecs(specs);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (!hasBillingInfo(billing) || !billing) return null;

  return (
    <div
      ref={wrapRef}
      className={cn("relative shrink-0", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Payment and source details"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors",
          "hover:bg-slate-100 hover:text-sky-600",
          open && "bg-slate-100 text-sky-600"
        )}
      >
        <Globe className="h-3.5 w-3.5" />
      </button>

      {open ? <BillingPopover id={panelId} billing={billing} /> : null}
    </div>
  );
}

function BillingPopover({
  id,
  billing,
}: {
  id: string;
  billing: OrderBillingInfo;
}) {
  const sourceUrl = billing.source_url?.trim() || null;

  return (
    <div
      id={id}
      role="dialog"
      className="absolute left-0 top-full z-40 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-2.5 shadow-lg"
    >
      <dl className="space-y-1.5 text-[11px] leading-snug text-slate-700">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="shrink-0 text-slate-500">Source</dt>
          <dd className="min-w-0 text-right font-medium">
            {sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-600 underline-offset-2 hover:underline"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                Source
              </a>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="shrink-0 text-slate-500">Payment</dt>
          <dd className="font-medium">
            {paymentStatusLabel(billing.payment_status)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="shrink-0 text-slate-500">Deposit</dt>
          <dd className="font-medium tabular-nums">
            {formatBillingMoney(billing.deposit)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="shrink-0 text-slate-500">Balance</dt>
          <dd className="font-medium tabular-nums">
            {formatBillingMoney(billing.balance)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
