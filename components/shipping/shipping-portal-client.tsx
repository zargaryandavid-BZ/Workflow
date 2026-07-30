"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Car,
  ChevronDown,
  Loader2,
  MapPin,
  Package,
  Truck,
  UserRound,
} from "lucide-react";
import type {
  FedExRateOption,
  ShippingBox,
  ShippingClientChoice,
  ShippingDeliveryAddress,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ShippingPortalData {
  token: string;
  status: string;
  boxes: ShippingBox[];
  clientChoice: ShippingClientChoice | null;
  fedexSelection: FedExRateOption | null;
  deliveryAddress: ShippingDeliveryAddress | null;
  deliveryNotes?: string;
  expiresAt: string | null;
  orderTitle: string;
  productLabel: string;
  /** Key order fields for the customer (same idea as /respond). */
  orderDetailRows?: { label: string; value: string }[];
  tenantName: string;
  expiredWarning: boolean;
  paymentEnabled: boolean;
  pickupLines: string[];
  offerPickup: boolean;
  offerFedex: boolean;
  offerUber: boolean;
  offerCurri: boolean;
  paymentReturnSessionId?: string | null;
  paymentCancelled?: boolean;
  /** Board-card main image (SKU gallery / order asset). */
  mainImageUrl?: string | null;
}

const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

function formatMoney(amount: number | null, currency: string) {
  if (amount == null || !Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function formatTransit(rate: FedExRateOption) {
  if (rate.provider === "curri") {
    if (rate.transitDays) return rate.transitDays;
    switch ((rate.priority ?? "sameday").toLowerCase()) {
      case "rush":
        return "2–4 hours";
      case "scheduled":
        return "Scheduled";
      default:
        return "By end of day";
    }
  }
  if (rate.deliveryDate) {
    try {
      return new Date(rate.deliveryDate).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    } catch {
      /* fall through */
    }
  }
  if (rate.transitDays) {
    return rate.transitDays.replace(/_/g, " ").toLowerCase();
  }
  return "Est. arrival TBD";
}

function rateKey(rate: FedExRateOption) {
  return [
    rate.provider ?? "fedex",
    rate.quoteId ?? "",
    rate.serviceType,
    rate.priority ?? "",
  ].join(":");
}

function isSameRate(a: FedExRateOption | null, b: FedExRateOption) {
  if (!a) return false;
  return rateKey(a) === rateKey(b);
}

export function ShippingPortalClient({ data }: { data: ShippingPortalData }) {
  const hasBoxes = data.boxes.length > 0;
  // FedEx / Curri need box sizes — hide that option entirely when qty is 0.
  const offerDelivery = hasBoxes && (data.offerFedex || data.offerCurri);
  const [step, setStep] = useState<
    "choose" | "pickup" | "delivery" | "uber" | "done"
  >(
    data.status === "client_responded" || data.paymentReturnSessionId
      ? data.status === "client_responded"
        ? "done"
        : "delivery"
      : "choose"
  );
  const [address, setAddress] = useState<ShippingDeliveryAddress>({
    street: data.deliveryAddress?.street ?? "",
    city: data.deliveryAddress?.city ?? "",
    state: data.deliveryAddress?.state ?? "",
    zip: data.deliveryAddress?.zip ?? "",
    country: data.deliveryAddress?.country ?? "US",
  });
  const [deliveryNotes, setDeliveryNotes] = useState(data.deliveryNotes ?? "");
  const [rates, setRates] = useState<FedExRateOption[]>([]);
  const [paymentRequired, setPaymentRequired] = useState(data.paymentEnabled);
  const [selectedRate, setSelectedRate] = useState<FedExRateOption | null>(
    data.fedexSelection
  );
  const [loadingRates, setLoadingRates] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneChoice, setDoneChoice] = useState<ShippingClientChoice | null>(
    data.clientChoice
  );
  const [doneRate, setDoneRate] = useState<FedExRateOption | null>(
    data.fedexSelection
  );
  const [doneAddress, setDoneAddress] =
    useState<ShippingDeliveryAddress | null>(data.deliveryAddress);
  const [doneNotes, setDoneNotes] = useState(data.deliveryNotes ?? "");
  // Highlight Self Pickup by default so customers notice the recommended option.
  const [selectedChoice, setSelectedChoice] = useState<
    "pickup" | "delivery" | "uber"
  >(data.offerPickup ? "pickup" : offerDelivery ? "delivery" : "uber");
  const shippingOptionsRef = useRef<HTMLDivElement | null>(null);
  const ratesPanelRef = useRef<HTMLDivElement | null>(null);
  const [optionsEl, setOptionsEl] = useState<HTMLDivElement | null>(null);
  const [optionsInView, setOptionsInView] = useState(false);

  const pickupLines = useMemo(
    () =>
      data.pickupLines.length > 0
        ? data.pickupLines
        : ["306 Boyd St", "Los Angeles, CA 90013"],
    [data.pickupLines]
  );

  useEffect(() => {
    if (step !== "choose" || !optionsEl) {
      if (step !== "choose") setOptionsInView(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setOptionsInView(entry.isIntersecting);
      },
      {
        // Treat options as "in view" once they enter the main viewport
        // (bottom inset = sticky bar height so it can hide cleanly).
        threshold: [0, 0.05, 0.2],
        rootMargin: "0px 0px -140px 0px",
      }
    );
    observer.observe(optionsEl);
    return () => observer.disconnect();
  }, [step, optionsEl]);

  function scrollToShippingOptions() {
    // Hide sticky immediately so it doesn't cover the anchor during scroll.
    setOptionsInView(true);
    shippingOptionsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  useEffect(() => {
    if (step !== "delivery" || rates.length === 0) return;
    const timer = window.setTimeout(() => {
      ratesPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [step, rates]);

  function setShippingOptionsNode(node: HTMLDivElement | null) {
    shippingOptionsRef.current = node;
    setOptionsEl(node);
  }

  useEffect(() => {
    if (!data.paymentReturnSessionId) return;
    void finalizePaidDelivery(data.paymentReturnSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on return from Stripe
  }, [data.paymentReturnSessionId]);

  // If FedEx/Curri isn't offered (no boxes), never stay on the delivery step.
  useEffect(() => {
    if (step === "delivery" && !offerDelivery) {
      setStep("choose");
      setError(null);
    }
  }, [step, offerDelivery]);

  async function finalizePaidDelivery(checkoutSessionId: string) {
    setConfirming(true);
    setError(null);
    setStep("delivery");
    try {
      const rate = data.fedexSelection ?? selectedRate;
      const choice: ShippingClientChoice =
        rate?.provider === "curri" ? "curri" : "delivery";
      const res = await fetch(`/api/shipping/${data.token}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice,
          checkoutSessionId,
          fedexSelection: rate,
          deliveryAddress: data.deliveryAddress ?? address,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          setDoneChoice(choice);
          setDoneRate(rate);
          setDoneAddress(data.deliveryAddress ?? address);
          setStep("done");
          return;
        }
        throw new Error(json.error ?? "Failed to confirm after payment");
      }
      setDoneChoice(choice);
      setDoneRate(rate);
      setDoneAddress(data.deliveryAddress ?? address);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setConfirming(false);
    }
  }

  const boxSummary = useMemo(() => {
    if (data.boxes.length === 0) return "No box details";
    return data.boxes
      .map(
        (b, i) =>
          `Box ${i + 1}: ${b.length}×${b.width}×${b.height} ${b.dimUnit}, ${b.weight} ${b.weightUnit}`
      )
      .join(" · ");
  }, [data.boxes]);

  // Delivery quoting needs box dimensions; without them rates can never load.
  const boxCountLabel = hasBoxes
    ? `${data.boxes.length} ${data.boxes.length === 1 ? "box" : "boxes"}`
    : "0 boxes";

  /** Editing the address invalidates any prior rate error/quote. */
  function editAddress(patch: Partial<ShippingDeliveryAddress>) {
    setAddress((a) => ({ ...a, ...patch }));
    setError(null);
  }

  async function confirmPickup() {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/shipping/${data.token}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice: "pickup" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to confirm pickup");
      }
      setDoneChoice("pickup");
      setDoneRate(null);
      setDoneAddress(null);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setConfirming(false);
    }
  }

  async function loadRates() {
    setError(null);
    if (
      !address.street.trim() ||
      !address.city.trim() ||
      !address.state.trim() ||
      !address.zip.trim()
    ) {
      setError("Please fill in street, city, state, and ZIP.");
      return;
    }
    setLoadingRates(true);
    try {
      const payload = JSON.stringify({ deliveryAddress: address });
      const headers = { "Content-Type": "application/json" };

      const fetches: Promise<{
        ok: boolean;
        rates: FedExRateOption[];
        paymentEnabled?: boolean;
        error?: string;
        source: "fedex" | "curri";
      }>[] = [];

      if (data.offerFedex) {
        fetches.push(
          fetch(`/api/shipping/${data.token}/fedex-rates`, {
            method: "POST",
            headers,
            body: payload,
          }).then(async (res) => {
            const json = await res.json().catch(() => ({}));
            return {
              ok: res.ok,
              rates: (json.rates ?? []) as FedExRateOption[],
              paymentEnabled: Boolean(json.paymentEnabled),
              error:
                typeof json.error === "string" ? json.error : undefined,
              source: "fedex" as const,
            };
          })
        );
      }

      if (data.offerCurri) {
        fetches.push(
          fetch(`/api/shipping/${data.token}/curri-rates`, {
            method: "POST",
            headers,
            body: payload,
          }).then(async (res) => {
            const json = await res.json().catch(() => ({}));
            // Curri out-of-area → empty rates, never block FedEx.
            return {
              ok: true,
              rates: res.ok ? ((json.rates ?? []) as FedExRateOption[]) : [],
              paymentEnabled: Boolean(json.paymentEnabled),
              source: "curri" as const,
            };
          })
        );
      }

      const results = await Promise.all(fetches);
      const fedexResult = results.find((r) => r.source === "fedex");
      if (fedexResult && !fedexResult.ok) {
        throw new Error(fedexResult.error ?? "Failed to get FedEx rates");
      }

      const fedexRates = (fedexResult?.rates ?? []).map((r) => ({
        ...r,
        provider: "fedex" as const,
      }));
      const curriRates = (
        results.find((r) => r.source === "curri")?.rates ?? []
      ).map((r) => ({ ...r, provider: "curri" as const }));

      const nextRates = [...curriRates, ...fedexRates].sort((a, b) => {
        const ac = a.totalCharge ?? Number.POSITIVE_INFINITY;
        const bc = b.totalCharge ?? Number.POSITIVE_INFINITY;
        return ac - bc;
      });

      const paymentEnabled = results.some((r) => r.paymentEnabled);
      setRates(nextRates);
      setPaymentRequired(paymentEnabled);
      setSelectedRate(nextRates[0] ?? null);
      if (nextRates.length === 0) {
        setError("No delivery rates returned for this address.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get rates");
      setRates([]);
      setSelectedRate(null);
    } finally {
      setLoadingRates(false);
    }
  }

  async function confirmUber() {
    setError(null);
    if (
      !address.street.trim() ||
      !address.city.trim() ||
      !address.state.trim() ||
      !address.zip.trim()
    ) {
      setError("Please fill in street, city, state, and ZIP.");
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch(`/api/shipping/${data.token}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice: "uber",
          deliveryAddress: address,
          deliveryNotes,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to confirm Uber delivery");
      }
      setDoneChoice("uber");
      setDoneRate(null);
      setDoneAddress(address);
      setDoneNotes(deliveryNotes.trim());
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setConfirming(false);
    }
  }

  async function confirmDelivery() {
    if (!selectedRate) {
      setError("Select a shipping option.");
      return;
    }
    setConfirming(true);
    setError(null);
    const choice: ShippingClientChoice =
      selectedRate.provider === "curri" ? "curri" : "delivery";
    try {
      if (paymentRequired) {
        const res = await fetch(
          `/api/shipping/${data.token}/create-checkout-session`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fedexSelection: selectedRate,
              deliveryAddress: address,
            }),
          }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error ?? "Failed to start payment");
        }
        if (typeof json.url === "string") {
          window.location.href = json.url;
          return;
        }
        throw new Error("No checkout URL returned");
      }

      const res = await fetch(`/api/shipping/${data.token}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice,
          fedexSelection: selectedRate,
          deliveryAddress: address,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to confirm delivery");
      }
      setDoneChoice(choice);
      setDoneRate(selectedRate);
      setDoneAddress(address);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-6">
      {data.paymentCancelled && step !== "done" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Payment was cancelled. You can select a shipping option and try again.
        </div>
      ) : null}

      {data.expiredWarning && step !== "done" ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This link is past its suggested expiry date. You can still respond;
          contact us if you have trouble.
        </div>
      ) : null}

      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Your order #<strong className="font-bold">{data.orderTitle}</strong> is
          ready!
        </h1>
        {data.productLabel ? (
          <p className="mt-1 text-sm text-slate-500">{data.productLabel}</p>
        ) : null}
        <p className="mt-2 text-sm text-slate-600">
          {step === "done"
            ? doneChoice === "pickup"
              ? "Your order is ready for pickup — details are below."
              : "Your order details are below."
            : (
              <>
                View your order below,{" "}
                <span className="animate-shipping-cta font-bold text-slate-900">
                  then choose pickup or delivery.
                </span>
              </>
            )}
        </p>
      </div>

      {data.mainImageUrl ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          <img
            src={data.mainImageUrl}
            alt={`Order ${data.orderTitle}`}
            className="mx-auto max-h-72 w-full object-contain"
          />
        </div>
      ) : null}

      {data.orderDetailRows && data.orderDetailRows.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-medium text-slate-800">
            Order details
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-2">
            {data.orderDetailRows.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[42%_1fr] gap-2 border-b border-slate-100 px-4 py-2.5 text-sm last:border-b-0 sm:[&:nth-child(odd)]:border-r sm:[&:nth-last-child(-n+2)]:border-b-0"
              >
                <dt className="text-slate-500">{row.label}</dt>
                <dd className="min-w-0 break-words font-medium text-slate-800">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {step === "choose" ? (
        <div className="space-y-3">
          <p className="rounded-lg border-2 border-slate-800 bg-slate-900 px-4 py-3 text-center text-base font-bold text-white shadow-sm">
            How would you like to receive your order?
          </p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-800">
              <Package className="h-4 w-4 text-slate-500" />
              Shipment summary
            </p>
            <p className="text-sm text-slate-600">
              {boxCountLabel}
              {boxSummary ? ` · ${boxSummary}` : null}
            </p>
          </div>
          <div
            id="shipping-options"
            ref={setShippingOptionsNode}
            className="scroll-mt-4 grid gap-3 sm:grid-cols-2"
          >
            {data.offerPickup ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedChoice("pickup");
                  setStep("pickup");
                  setError(null);
                }}
                className={cn(
                  "rounded-xl border-2 border-solid p-4 text-left transition active:scale-[0.99]",
                  selectedChoice === "pickup"
                    ? "border-black bg-sky-50 shadow-md ring-2 ring-black/15"
                    : "border-sky-200 bg-sky-50 shadow-sm hover:border-sky-400 hover:bg-sky-100 hover:shadow-md"
                )}
              >
                <UserRound
                  className={cn(
                    "mb-2 h-5 w-5",
                    selectedChoice === "pickup" ? "text-black" : "text-sky-700"
                  )}
                />
                <p className="font-semibold text-slate-900">
                  Self Pickup (In-Store)
                </p>
                {selectedChoice === "pickup" ? (
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-black">
                    Selected
                  </p>
                ) : null}
                <div className="mt-2 space-y-0.5 text-sm text-slate-600">
                  {pickupLines.slice(0, 2).map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                  {pickupLines[2] ? (
                    <p className="pt-1 text-xs leading-snug text-slate-500">
                      {pickupLines[2]}
                    </p>
                  ) : null}
                </div>
                <p
                  className={cn(
                    "mt-3 text-xs font-semibold uppercase tracking-wide",
                    selectedChoice === "pickup" ? "text-black" : "text-sky-700"
                  )}
                >
                  Tap to select →
                </p>
              </button>
            ) : null}
            {offerDelivery ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedChoice("delivery");
                  setStep("delivery");
                  setError(null);
                }}
                className={cn(
                  "rounded-xl border-2 border-solid p-4 text-left transition active:scale-[0.99]",
                  selectedChoice === "delivery"
                    ? "border-black bg-sky-50 shadow-md ring-2 ring-black/15"
                    : "border-sky-200 bg-sky-50 shadow-sm hover:border-sky-400 hover:bg-sky-100 hover:shadow-md"
                )}
              >
                <Truck
                  className={cn(
                    "mb-2 h-5 w-5",
                    selectedChoice === "delivery" ? "text-black" : "text-sky-700"
                  )}
                />
                <p className="font-semibold text-slate-900">FedEx Shipping</p>
                {selectedChoice === "delivery" ? (
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-black">
                    Selected
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-slate-500">
                  {data.offerFedex && data.offerCurri
                    ? "FedEx and Curri rates to your address"
                    : data.offerCurri
                      ? "Curri courier delivery to your address"
                      : "We ship to you via FedEx"}
                </p>
                <p
                  className={cn(
                    "mt-3 text-xs font-semibold uppercase tracking-wide",
                    selectedChoice === "delivery" ? "text-black" : "text-sky-700"
                  )}
                >
                  Tap to select →
                </p>
              </button>
            ) : null}
            {data.offerUber ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedChoice("uber");
                  setStep("uber");
                  setError(null);
                }}
                className={cn(
                  "rounded-xl border-2 border-solid p-4 text-left transition active:scale-[0.99]",
                  selectedChoice === "uber"
                    ? "border-black bg-sky-50 shadow-md ring-2 ring-black/15"
                    : "border-sky-200 bg-sky-50 shadow-sm hover:border-sky-400 hover:bg-sky-100 hover:shadow-md"
                )}
              >
                <Car
                  className={cn(
                    "mb-2 h-5 w-5",
                    selectedChoice === "uber" ? "text-black" : "text-sky-700"
                  )}
                />
                <p className="font-semibold text-slate-900">Uber Local Delivery</p>
                {selectedChoice === "uber" ? (
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-black">
                    Selected
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-slate-500">
                  Local delivery to your address
                </p>
                <p
                  className={cn(
                    "mt-3 text-xs font-semibold uppercase tracking-wide",
                    selectedChoice === "uber" ? "text-black" : "text-sky-700"
                  )}
                >
                  Tap to select →
                </p>
              </button>
            ) : null}
          </div>
          {!data.offerPickup && !offerDelivery && !data.offerUber ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              No shipping options are available right now. Please contact the
              shop.
            </p>
          ) : null}
        </div>
      ) : null}

      {step !== "choose" ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-800">
            <Package className="h-4 w-4 text-slate-500" />
            Shipment summary
          </p>
          <p className="text-sm text-slate-600">
            {boxCountLabel}
            {boxSummary ? ` · ${boxSummary}` : null}
          </p>
        </div>
      ) : null}

      {step === "pickup" ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setStep("choose")}
            className="text-sm font-bold text-black hover:text-slate-800"
          >
            ← Back
          </button>
          <div className="rounded-xl border border-slate-200 p-4">
            <p className="mb-2 flex items-center gap-2 font-semibold text-slate-900">
              <MapPin className="h-4 w-4" />
              Pickup location
            </p>
            {pickupLines.map((line) => (
              <p key={line} className="text-sm text-slate-600">
                {line}
              </p>
            ))}
          </div>
          <button
            type="button"
            disabled={confirming}
            onClick={() => void confirmPickup()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1a1f2e] px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {confirming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Confirm Self Pickup
          </button>
        </div>
      ) : null}

      {step === "uber" ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setStep("choose");
              setError(null);
            }}
            className="text-sm font-bold text-black hover:text-slate-800"
          >
            ← Back
          </button>

          <p className="text-sm font-medium text-slate-800">
            Where should we send your order via Uber?
          </p>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_6.5rem]">
            <label className="block text-sm font-semibold text-slate-800 sm:col-span-3">
              Street
              <input
                value={address.street}
                onChange={(e) => editAddress({ street: e.target.value })}
                className="mt-1 w-full rounded-lg border-2 border-slate-400 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-800">
              City
              <input
                value={address.city}
                onChange={(e) => editAddress({ city: e.target.value })}
                className="mt-1 w-full rounded-lg border-2 border-slate-400 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-800">
              State
              <select
                value={address.state}
                onChange={(e) => editAddress({ state: e.target.value })}
                className="mt-1 w-full rounded-lg border-2 border-slate-400 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
              >
                <option value="">Select</option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold text-slate-800">
              ZIP
              <input
                value={address.zip}
                onChange={(e) => editAddress({ zip: e.target.value })}
                className="mt-1 w-full rounded-lg border-2 border-slate-400 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
              />
            </label>
          </div>

          <label className="block text-sm font-semibold text-slate-800">
            Delivery notes
            <span className="ml-1 font-normal text-slate-500">(optional)</span>
            <textarea
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              rows={3}
              placeholder="Apartment, gate code, contact person, parking instructions…"
              className="mt-1 w-full rounded-lg border-2 border-slate-400 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
            />
          </label>

          <button
            type="button"
            disabled={confirming}
            onClick={() => void confirmUber()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1a1f2e] px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {confirming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Confirm Uber Delivery
          </button>
        </div>
      ) : null}

      {step === "delivery" ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setStep("choose");
              setRates([]);
              setSelectedRate(null);
              setError(null);
            }}
            className="text-sm font-bold text-black hover:text-slate-800"
          >
            ← Back
          </button>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_6.5rem]">
            <label className="block text-sm font-semibold text-slate-800 sm:col-span-3">
              Street
              <input
                value={address.street}
                onChange={(e) => editAddress({ street: e.target.value })}
                className="mt-1 w-full rounded-lg border-2 border-slate-400 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-800">
              City
              <input
                value={address.city}
                onChange={(e) => editAddress({ city: e.target.value })}
                className="mt-1 w-full rounded-lg border-2 border-slate-400 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-800">
              State
              <select
                value={address.state}
                onChange={(e) => editAddress({ state: e.target.value })}
                className="mt-1 w-full rounded-lg border-2 border-slate-400 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
              >
                <option value="">Select</option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold text-slate-800">
              ZIP
              <input
                value={address.zip}
                onChange={(e) => editAddress({ zip: e.target.value })}
                className="mt-1 w-full rounded-lg border-2 border-slate-400 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
              />
            </label>
          </div>

          <button
            type="button"
            disabled={loadingRates}
            onClick={() => void loadRates()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1a1f2e] px-4 py-3 text-sm font-bold text-white shadow-md transition hover:bg-slate-800 disabled:opacity-50 sm:w-auto"
          >
            {loadingRates ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            {loadingRates
              ? "Getting rates…"
              : rates.length > 0
                ? "Refresh rates"
                : data.offerFedex && data.offerCurri
                  ? "Get shipping rates"
                  : data.offerCurri
                    ? "Get Curri rates"
                    : "Get FedEx rates"}
          </button>

          {rates.length > 0 ? (
            <div
              ref={ratesPanelRef}
              className="space-y-2 rounded-xl border border-slate-200 p-3"
            >
              <p className="text-sm font-medium text-slate-800">
                Select a shipping option
              </p>
              {rates.map((rate) => {
                const selected = isSameRate(selectedRate, rate);
                const isCurri = rate.provider === "curri";
                return (
                  <label
                    key={rateKey(rate)}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                      selected
                        ? "border-slate-800 bg-slate-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      checked={selected}
                      onChange={() => setSelectedRate(rate)}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 font-medium text-slate-800">
                        {rate.serviceName}
                        {isCurri ? (
                          <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700">
                            Curri · Same Day
                          </span>
                        ) : (
                          <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                            FedEx
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-slate-500">
                      {formatTransit(rate)}
                    </span>
                    <span className="shrink-0 font-semibold text-slate-900">
                      {formatMoney(rate.totalCharge, rate.currency)}
                    </span>
                    {rate.fedexBaseCharge != null &&
                    rate.totalCharge != null &&
                    rate.fedexBaseCharge !== rate.totalCharge ? (
                      <span className="text-xs text-slate-400">
                        incl. fees
                      </span>
                    ) : null}
                  </label>
                );
              })}
              <button
                type="button"
                disabled={confirming || !selectedRate}
                onClick={() => void confirmDelivery()}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1a1f2e] px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {confirming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {paymentRequired
                  ? "Continue to Payment →"
                  : "Confirm Shipping →"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === "done" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-600" />
          <p className="text-lg font-semibold text-emerald-900">
            {doneChoice === "pickup"
              ? "Self pickup confirmed"
              : doneChoice === "uber"
                ? "Uber delivery confirmed"
                : doneRate?.provider === "curri"
                  ? "Curri delivery confirmed"
                  : "Shipping preference saved"}
          </p>
          {doneChoice === "pickup" ? (
            <div className="mt-3 text-sm text-emerald-800">
              {pickupLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : doneChoice === "uber" ? (
            <div className="mt-3 space-y-1 text-sm text-emerald-800">
              {doneAddress ? (
                <p>
                  {doneAddress.street}, {doneAddress.city} {doneAddress.state}{" "}
                  {doneAddress.zip}
                </p>
              ) : null}
              {doneNotes ? (
                <p className="text-emerald-700/90">Note: {doneNotes}</p>
              ) : null}
            </div>
          ) : doneRate ? (
            <div className="mt-3 space-y-1 text-sm text-emerald-800">
              <p>
                {doneRate.serviceName}
                {doneRate.totalCharge != null
                  ? ` · ${formatMoney(doneRate.totalCharge, doneRate.currency)}`
                  : null}
              </p>
              {doneAddress ? (
                <p>
                  {doneAddress.street}, {doneAddress.city} {doneAddress.state}{" "}
                  {doneAddress.zip}
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="mt-4 text-xs text-emerald-700">
            Thanks — our team will take it from here.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {step === "choose" && !optionsInView ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 p-3">
          <div className="pointer-events-auto mx-auto max-w-lg rounded-xl border border-slate-200 bg-white/95 p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur">
            <button
              type="button"
              onClick={scrollToShippingOptions}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-sky-300 bg-sky-50 px-4 py-3 text-sm font-bold text-sky-900 shadow-sm transition hover:bg-sky-100"
            >
              Select shipping option
              <ChevronDown className="h-4 w-4 animate-bounce" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
