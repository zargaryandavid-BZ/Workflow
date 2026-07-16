"use client";

import { useState } from "react";
import {
  Car,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  MapPin,
  Package,
  Truck,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import type { ShippingBox, ShippingDeliveryAddress, ShippingRequest } from "@/lib/types";

interface ShippingTabProps {
  shippingRequest: ShippingRequest;
  orderId: string;
  appUrl?: string;
  onStaffNotesSaved?: (notes: string | null) => void;
}

function formatMoney(amount: number | null | undefined, currency?: string) {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(Number(amount));
  } catch {
    return `$${Number(amount).toFixed(2)}`;
  }
}

function formatTransit(value: string | null | undefined) {
  if (!value) return null;
  return value.replace(/_/g, " ").toLowerCase();
}

function formatBox(box: ShippingBox, index: number) {
  return `Box ${index + 1}: ${box.length}×${box.width}×${box.height} ${box.dimUnit}, ${box.weight} ${box.weightUnit}`;
}

function formatDeliveryAddress(address: ShippingDeliveryAddress) {
  const line1 = address.street.trim();
  const cityStateZip = [
    address.city.trim(),
    [address.state.trim(), address.zip.trim()].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const country =
    address.country && address.country !== "US" ? address.country.trim() : "";
  return [line1, cityStateZip, country].filter(Boolean).join("\n");
}

function AddressBlock({
  address,
  label,
  copied,
  onCopy,
  tone = "slate",
}: {
  address: ShippingDeliveryAddress;
  label: string;
  copied: boolean;
  onCopy: () => void;
  tone?: "amber" | "slate" | "violet";
}) {
  const labelClass =
    tone === "amber"
      ? "text-amber-700/70"
      : tone === "violet"
        ? "text-violet-600/80"
        : "text-slate-400";
  const buttonClass =
    tone === "amber"
      ? "text-amber-700 hover:bg-white hover:text-amber-950"
      : tone === "violet"
        ? "text-violet-600 hover:bg-white hover:text-violet-900"
        : "text-slate-500 hover:bg-white hover:text-slate-800";
  const boxClass =
    tone === "amber"
      ? "bg-white/70 text-amber-950"
      : tone === "violet"
        ? "bg-violet-50 text-violet-950"
        : "bg-slate-50 text-slate-800";

  return (
    <div className={`rounded-md px-3 py-2 ${boxClass}`}>
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <p className={`text-xs font-medium uppercase tracking-wide ${labelClass}`}>
          {label}
        </p>
        <button
          type="button"
          onClick={onCopy}
          title={copied ? "Copied" : "Copy address"}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${buttonClass}`}
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p>
        {address.street}
        <br />
        {address.city}, {address.state} {address.zip}
        {address.country && address.country !== "US"
          ? `, ${address.country}`
          : null}
      </p>
    </div>
  );
}

export function ShippingTab({
  shippingRequest,
  orderId,
  appUrl,
  onStaffNotesSaved,
}: ShippingTabProps) {
  const [addressCopied, setAddressCopied] = useState(false);
  const [portalCopied, setPortalCopied] = useState(false);
  const [staffNotes, setStaffNotes] = useState(
    shippingRequest.staff_notes ?? ""
  );
  const [savingStaffNotes, setSavingStaffNotes] = useState(false);
  const [staffNotesError, setStaffNotesError] = useState<string | null>(null);
  const [staffNotesSaved, setStaffNotesSaved] = useState(false);

  const boxes = Array.isArray(shippingRequest.boxes)
    ? shippingRequest.boxes
    : [];
  const pending =
    shippingRequest.status === "pending" ||
    shippingRequest.status === "payment_pending";
  const isPickup = shippingRequest.client_choice === "pickup";
  const isDelivery = shippingRequest.client_choice === "delivery";
  const isUber = shippingRequest.client_choice === "uber";
  const rate = shippingRequest.fedex_selection;
  const address = shippingRequest.delivery_address;
  const portalUrl = appUrl
    ? `${appUrl.replace(/\/$/, "")}/shipping/${shippingRequest.token}`
    : null;
  const money = formatMoney(rate?.totalCharge, rate?.currency);
  const transit = formatTransit(rate?.transitDays);

  async function copyPortalUrl() {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
      setPortalCopied(true);
      window.setTimeout(() => setPortalCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function copyDeliveryAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(formatDeliveryAddress(address));
      setAddressCopied(true);
      window.setTimeout(() => setAddressCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  async function saveStaffNotes() {
    setSavingStaffNotes(true);
    setStaffNotesError(null);
    setStaffNotesSaved(false);
    try {
      const res = await fetch(`/api/orders/${orderId}/shipping-request`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffNotes }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to save notes");
      }
      const saved =
        typeof json.staff_notes === "string" ? json.staff_notes : staffNotes.trim() || null;
      setStaffNotes(saved ?? "");
      onStaffNotesSaved?.(saved);
      setStaffNotesSaved(true);
      window.setTimeout(() => setStaffNotesSaved(false), 2000);
    } catch (err) {
      setStaffNotesError(
        err instanceof Error ? err.message : "Failed to save notes"
      );
    } finally {
      setSavingStaffNotes(false);
    }
  }

  return (
    <div className="space-y-4 py-1">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Package className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">
            Sent to client
          </h3>
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Sent</dt>
            <dd className="text-right text-slate-800">
              {shippingRequest.sent_at
                ? formatDateTime(shippingRequest.sent_at)
                : formatDateTime(shippingRequest.created_at)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Boxes</dt>
            <dd className="text-right font-medium text-slate-800">
              {boxes.length} {boxes.length === 1 ? "box" : "boxes"}
            </dd>
          </div>
        </dl>

        {boxes.length > 0 ? (
          <ul className="mt-3 space-y-1.5 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {boxes.map((box, i) => (
              <li key={i}>{formatBox(box, i)}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No box details saved.</p>
        )}

        {portalUrl ? (
          <div className="mt-3 flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <p className="min-w-0 break-all text-xs text-slate-500">
              <span className="font-medium text-slate-600">Portal:</span>{" "}
              {portalUrl}
            </p>
            <button
              type="button"
              onClick={() => void copyPortalUrl()}
              title={portalCopied ? "Copied" : "Copy portal link"}
              className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white hover:text-slate-800"
            >
              <Copy className="h-3.5 w-3.5" />
              {portalCopied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          {pending ? (
            <Clock className="h-4 w-4 text-amber-500" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          )}
          <h3 className="text-sm font-semibold text-slate-800">
            Client response
          </h3>
        </div>

        {pending ? (
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <p>
              {shippingRequest.status === "payment_pending"
                ? "Awaiting payment — client started checkout but hasn’t finished yet."
                : "Awaiting client response — they haven’t chosen pickup, FedEx shipping, or Uber delivery yet."}
            </p>
            {shippingRequest.status === "payment_pending" && rate ? (
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-4">
                  <dt className="text-amber-700/80">Selected service</dt>
                  <dd className="text-right font-medium text-amber-950">
                    {rate.serviceName}
                  </dd>
                </div>
                {money ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-amber-700/80">Amount due</dt>
                    <dd className="font-medium text-amber-950">{money}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            {shippingRequest.status === "payment_pending" && address ? (
              <AddressBlock
                address={address}
                label="Deliver to"
                copied={addressCopied}
                onCopy={() => void copyDeliveryAddress()}
                tone="amber"
              />
            ) : null}
          </div>
        ) : isPickup ? (
          <div className="space-y-2 text-sm text-slate-700">
            <p className="flex items-center gap-2 font-medium text-slate-900">
              <MapPin className="h-4 w-4 text-slate-500" />
              Self Pickup
            </p>
            {shippingRequest.responded_at ? (
              <p className="text-slate-500">
                Confirmed {formatDateTime(shippingRequest.responded_at)}
              </p>
            ) : null}
          </div>
        ) : isUber ? (
          <div className="space-y-3 text-sm text-slate-700">
            <p className="flex items-center gap-2 font-medium text-slate-900">
              <Car className="h-4 w-4 text-violet-500" />
              Uber Delivery
            </p>
            {address ? (
              <AddressBlock
                address={address}
                label="Deliver to"
                copied={addressCopied}
                onCopy={() => void copyDeliveryAddress()}
                tone="violet"
              />
            ) : null}
            {shippingRequest.delivery_notes ? (
              <div className="rounded-lg bg-violet-50 px-3 py-2 text-violet-950">
                <p className="text-xs font-medium uppercase tracking-wide text-violet-600/80">
                  Customer note
                </p>
                <p className="mt-1 whitespace-pre-wrap">
                  {shippingRequest.delivery_notes}
                </p>
              </div>
            ) : null}
            {shippingRequest.responded_at ? (
              <p className="text-slate-500">
                Confirmed {formatDateTime(shippingRequest.responded_at)}
              </p>
            ) : null}
          </div>
        ) : isDelivery ? (
          <div className="space-y-3 text-sm text-slate-700">
            <p className="flex items-center gap-2 font-medium text-slate-900">
              <Truck className="h-4 w-4 text-slate-500" />
              Delivery
              {rate?.serviceName ? ` · ${rate.serviceName}` : null}
            </p>
            <dl className="space-y-1.5">
              {money ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Rate</dt>
                  <dd className="font-medium text-slate-800">{money}</dd>
                </div>
              ) : null}
              {shippingRequest.payment_status === "succeeded" &&
              shippingRequest.payment_amount != null ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Paid</dt>
                  <dd className="font-medium text-emerald-700">
                    {formatMoney(
                      shippingRequest.payment_amount / 100,
                      shippingRequest.payment_currency ?? "USD"
                    )}
                  </dd>
                </div>
              ) : null}
              {transit ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Transit</dt>
                  <dd className="text-slate-800">{transit}</dd>
                </div>
              ) : null}
              {rate?.deliveryDate ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Est. delivery</dt>
                  <dd className="text-slate-800">
                    {formatDateTime(rate.deliveryDate)}
                  </dd>
                </div>
              ) : null}
            </dl>
            {address ? (
              <AddressBlock
                address={address}
                label="Deliver to"
                copied={addressCopied}
                onCopy={() => void copyDeliveryAddress()}
              />
            ) : null}
            {shippingRequest.responded_at ? (
              <p className="text-slate-500">
                Confirmed {formatDateTime(shippingRequest.responded_at)}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Client responded with no choice recorded.</p>
        )}
      </section>

      {isUber ? (
        <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
          <h3 className="text-sm font-semibold text-violet-900">
            Uber booking notes
          </h3>
          <p className="mt-1 text-xs text-violet-700/80">
            Internal only — add your Uber order reference or payment details
            after you book the delivery.
          </p>
          <textarea
            value={staffNotes}
            onChange={(e) => setStaffNotes(e.target.value)}
            rows={3}
            placeholder="Uber order ID, driver notes, payment reference…"
            className="mt-3 w-full rounded-md border border-violet-200 bg-white px-3 py-2 text-sm text-slate-800"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={savingStaffNotes}
              onClick={() => void saveStaffNotes()}
              className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {savingStaffNotes ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Save notes
            </button>
            {staffNotesSaved ? (
              <span className="text-xs text-emerald-600">Saved</span>
            ) : null}
            {staffNotesError ? (
              <span className="text-xs text-red-600">{staffNotesError}</span>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
