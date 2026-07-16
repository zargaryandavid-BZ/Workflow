"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Car,
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
  tenantName: string;
  expiredWarning: boolean;
  paymentEnabled: boolean;
  pickupLines: string[];
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

export function ShippingPortalClient({ data }: { data: ShippingPortalData }) {
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

  const pickupLines = useMemo(
    () =>
      data.pickupLines.length > 0
        ? data.pickupLines
        : ["306 Boyd St", "Los Angeles, CA 90013"],
    [data.pickupLines]
  );

  useEffect(() => {
    if (!data.paymentReturnSessionId) return;
    void finalizePaidDelivery(data.paymentReturnSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on return from Stripe
  }, [data.paymentReturnSessionId]);

  async function finalizePaidDelivery(checkoutSessionId: string) {
    setConfirming(true);
    setError(null);
    setStep("delivery");
    try {
      const res = await fetch(`/api/shipping/${data.token}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice: "delivery",
          checkoutSessionId,
          fedexSelection: data.fedexSelection ?? selectedRate,
          deliveryAddress: data.deliveryAddress ?? address,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) {
          setDoneChoice("delivery");
          setDoneRate(data.fedexSelection ?? selectedRate);
          setDoneAddress(data.deliveryAddress ?? address);
          setStep("done");
          return;
        }
        throw new Error(json.error ?? "Failed to confirm after payment");
      }
      setDoneChoice("delivery");
      setDoneRate(data.fedexSelection ?? selectedRate);
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
      const res = await fetch(`/api/shipping/${data.token}/fedex-rates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryAddress: address }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to get shipping rates");
      }
      const nextRates = (json.rates ?? []) as FedExRateOption[];
      setRates(nextRates);
      setPaymentRequired(Boolean(json.paymentEnabled));
      setSelectedRate(nextRates[0] ?? null);
      if (nextRates.length === 0) {
        setError("No FedEx rates returned for this address.");
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
          choice: "delivery",
          fedexSelection: selectedRate,
          deliveryAddress: address,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to confirm delivery");
      }
      setDoneChoice("delivery");
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
          Your order #{data.orderTitle} is ready!
        </h1>
        {data.productLabel ? (
          <p className="mt-1 text-sm text-slate-500">{data.productLabel}</p>
        ) : null}
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

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-800">
          <Package className="h-4 w-4 text-slate-500" />
          Shipment summary
        </p>
        <p className="text-sm text-slate-600">
          {data.boxes.length} {data.boxes.length === 1 ? "box" : "boxes"}
          {boxSummary ? ` · ${boxSummary}` : null}
        </p>
      </div>

      {step === "choose" ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-800">
            How would you like to receive your order?
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => {
                setStep("pickup");
                setError(null);
              }}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-400 hover:shadow-sm"
            >
              <UserRound className="mb-2 h-5 w-5 text-slate-600" />
              <p className="font-semibold text-slate-900">Self Pickup</p>
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
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("delivery");
                setError(null);
              }}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-400 hover:shadow-sm"
            >
              <Truck className="mb-2 h-5 w-5 text-slate-600" />
              <p className="font-semibold text-slate-900">Shipping</p>
              <p className="mt-1 text-sm text-slate-500">
                We ship to you via FedEx
              </p>
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("uber");
                setError(null);
              }}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-400 hover:shadow-sm"
            >
              <Car className="mb-2 h-5 w-5 text-slate-600" />
              <p className="font-semibold text-slate-900">Uber Delivery</p>
              <p className="mt-1 text-sm text-slate-500">
                Local delivery to your address
              </p>
            </button>
          </div>
        </div>
      ) : null}

      {step === "pickup" ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setStep("choose")}
            className="text-sm text-slate-500 hover:text-slate-700"
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
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            ← Back
          </button>

          <p className="text-sm font-medium text-slate-800">
            Where should we send your order via Uber?
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-600 sm:col-span-2">
              Street
              <input
                value={address.street}
                onChange={(e) =>
                  setAddress((a) => ({ ...a, street: e.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-slate-600">
              City
              <input
                value={address.city}
                onChange={(e) =>
                  setAddress((a) => ({ ...a, city: e.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-slate-600">
                State
                <select
                  value={address.state}
                  onChange={(e) =>
                    setAddress((a) => ({ ...a, state: e.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select</option>
                  {US_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-600">
                ZIP
                <input
                  value={address.zip}
                  onChange={(e) =>
                    setAddress((a) => ({ ...a, zip: e.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
          </div>

          <label className="block text-sm text-slate-600">
            Delivery notes
            <span className="ml-1 font-normal text-slate-400">(optional)</span>
            <textarea
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              rows={3}
              placeholder="Apartment, gate code, contact person, parking instructions…"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
            }}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            ← Back
          </button>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-600 sm:col-span-2">
              Street
              <input
                value={address.street}
                onChange={(e) =>
                  setAddress((a) => ({ ...a, street: e.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-slate-600">
              City
              <input
                value={address.city}
                onChange={(e) =>
                  setAddress((a) => ({ ...a, city: e.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-slate-600">
                State
                <select
                  value={address.state}
                  onChange={(e) =>
                    setAddress((a) => ({ ...a, state: e.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select</option>
                  {US_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-600">
                ZIP
                <input
                  value={address.zip}
                  onChange={(e) =>
                    setAddress((a) => ({ ...a, zip: e.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
          </div>

          <button
            type="button"
            disabled={loadingRates}
            onClick={() => void loadRates()}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingRates ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            {loadingRates ? "Getting rates…" : "Get FedEx rates"}
          </button>

          {rates.length > 0 ? (
            <div className="space-y-2 rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-medium text-slate-800">
                Select a shipping option
              </p>
              {rates.map((rate) => {
                const selected =
                  selectedRate?.serviceType === rate.serviceType;
                return (
                  <label
                    key={rate.serviceType}
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
                    <span className="flex-1 font-medium text-slate-800">
                      {rate.serviceName}
                    </span>
                    <span className="text-slate-500">{formatTransit(rate)}</span>
                    <span className="font-semibold text-slate-900">
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
    </div>
  );
}
