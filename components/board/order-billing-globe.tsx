"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe } from "lucide-react";
import {
  billingFromSpecs,
  formatBillingMoney,
  hasBillingInfo,
  paymentStatusLabel,
  type OrderBillingInfo,
  type PaymentStatus,
} from "@/lib/order-billing";
import { cn } from "@/lib/utils";

interface Props {
  specs: Record<string, unknown> | null | undefined;
  className?: string;
}

function globeTone(status: PaymentStatus | null | undefined) {
  if (status === "full") {
    return {
      idle: "text-emerald-500",
      hover: "hover:bg-emerald-50 hover:text-emerald-600",
      open: "bg-emerald-50 text-emerald-600",
    };
  }
  if (status === "partial") {
    return {
      idle: "text-amber-500",
      hover: "hover:bg-amber-50 hover:text-amber-600",
      open: "bg-amber-50 text-amber-600",
    };
  }
  return {
    idle: "text-red-500",
    hover: "hover:bg-red-50 hover:text-red-600",
    open: "bg-red-50 text-red-600",
  };
}

function findOverlayHost(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  return (
    (el.closest("[data-order-card]") as HTMLElement | null) ??
    (el.closest("tr") as HTMLElement | null) ??
    (el.closest("[data-order-id]") as HTMLElement | null)
  );
}

export function OrderBillingGlobe({ specs, className }: Props) {
  const billing = billingFromSpecs(specs);
  const [open, setOpen] = useState(false);
  const [hostRect, setHostRect] = useState<DOMRect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    if (!open) {
      setHostRect(null);
      return;
    }
    const host = findOverlayHost(wrapRef.current);
    if (!host) return;

    function update() {
      const next = findOverlayHost(wrapRef.current);
      if (next) setHostRect(next.getBoundingClientRect());
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!hasBillingInfo(billing) || !billing) return null;

  const tone = globeTone(billing.payment_status);

  return (
    <div
      ref={wrapRef}
      className={cn("relative shrink-0", className)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Payment details"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors",
          tone.idle,
          tone.hover,
          open && tone.open
        )}
      >
        <Globe className="h-3.5 w-3.5" />
      </button>

      {open && hostRect && typeof document !== "undefined"
        ? createPortal(
            <BillingOverlay
              id={panelId}
              billing={billing}
              hostRect={hostRect}
              panelRef={panelRef}
              onClose={() => setOpen(false)}
            />,
            document.body
          )
        : null}
    </div>
  );
}

function BillingOverlay({
  id,
  billing,
  hostRect,
  panelRef,
  onClose,
}: {
  id: string;
  billing: OrderBillingInfo;
  hostRect: DOMRect;
  panelRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  return (
    <div
      className="pointer-events-auto fixed z-[80]"
      style={{
        top: hostRect.top,
        left: hostRect.left,
        width: hostRect.width,
        height: hostRect.height,
      }}
    >
      <button
        type="button"
        aria-label="Close payment details"
        className="absolute inset-0 rounded-md bg-slate-900/25 backdrop-blur-[1px]"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-label="Payment details"
        className="absolute left-1/2 top-1/2 w-[min(11.5rem,calc(100%-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-3 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <dl className="space-y-2 text-[11px] leading-snug text-slate-700">
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
    </div>
  );
}
