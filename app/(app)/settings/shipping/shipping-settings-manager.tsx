"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ShippingSettingsPublic } from "@/lib/types";

interface Props {
  initialSettings: ShippingSettingsPublic;
  loadError: string | null;
}

function SecretInput({
  label,
  placeholder,
  masked,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  masked: { set: boolean; preview: string | null };
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm text-slate-600">
      {label}
      {masked.set ? (
        <p className="mt-0.5 text-xs text-slate-400">
          Saved ({masked.preview}) — leave blank to keep
        </p>
      ) : null}
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={masked.set ? "Leave blank to keep current" : placeholder}
        className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
      />
    </label>
  );
}

export function ShippingSettingsManager({ initialSettings, loadError }: Props) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [fedexApiKey, setFedexApiKey] = useState("");
  const [fedexSecretKey, setFedexSecretKey] = useState("");
  const [fedexAccountNumber, setFedexAccountNumber] = useState(
    settings.fedex_account_number ?? ""
  );
  const [fedexSandbox, setFedexSandbox] = useState(settings.fedex_sandbox);
  const [shipperStreet, setShipperStreet] = useState(
    settings.shipper_street ?? ""
  );
  const [shipperCity, setShipperCity] = useState(settings.shipper_city ?? "");
  const [shipperState, setShipperState] = useState(
    settings.shipper_state ?? ""
  );
  const [shipperZip, setShipperZip] = useState(settings.shipper_zip ?? "");
  const [shipperCountry, setShipperCountry] = useState(
    settings.shipper_country ?? "US"
  );
  const [pickupHoursNote, setPickupHoursNote] = useState(
    settings.pickup_hours_note ?? ""
  );
  const [offerPickup, setOfferPickup] = useState(settings.offer_pickup);
  const [offerFedex, setOfferFedex] = useState(settings.offer_fedex);
  const [offerUber, setOfferUber] = useState(settings.offer_uber);
  const [offerCurri, setOfferCurri] = useState(settings.offer_curri);
  const [paymentEnabled, setPaymentEnabled] = useState(settings.payment_enabled);
  const [stripePublishableKey, setStripePublishableKey] = useState(
    settings.stripe_publishable_key ?? ""
  );
  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");
  const [markupFixedDollars, setMarkupFixedDollars] = useState(
    (settings.markup_fixed_cents / 100).toFixed(2)
  );
  const [markupPercent, setMarkupPercent] = useState(
    String(settings.markup_percent)
  );

  async function save() {
    setError(null);
    setMessage(null);
    setSaving(true);

    const body: Record<string, unknown> = {
      fedex_account_number: fedexAccountNumber.trim() || null,
      fedex_sandbox: fedexSandbox,
      shipper_street: shipperStreet.trim() || null,
      shipper_city: shipperCity.trim() || null,
      shipper_state: shipperState.trim() || null,
      shipper_zip: shipperZip.trim() || null,
      shipper_country: shipperCountry.trim() || "US",
      pickup_hours_note: pickupHoursNote.trim() || null,
      offer_pickup: offerPickup,
      offer_fedex: offerFedex,
      offer_uber: offerUber,
      offer_curri: offerCurri,
      payment_enabled: paymentEnabled,
      stripe_publishable_key: stripePublishableKey.trim() || null,
      markup_fixed_dollars: Number.parseFloat(markupFixedDollars) || 0,
      markup_percent: Number.parseFloat(markupPercent) || 0,
    };

    if (fedexApiKey.trim()) body.fedex_api_key = fedexApiKey.trim();
    if (fedexSecretKey.trim()) body.fedex_secret_key = fedexSecretKey.trim();
    if (stripeSecretKey.trim()) body.stripe_secret_key = stripeSecretKey.trim();
    if (stripeWebhookSecret.trim()) {
      body.stripe_webhook_secret = stripeWebhookSecret.trim();
    }

    const res = await fetch("/api/shipping-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(typeof json.error === "string" ? json.error : "Failed to save");
      return;
    }

    const next = json.settings as ShippingSettingsPublic;
    setSettings(next);
    setOfferPickup(next.offer_pickup);
    setOfferFedex(next.offer_fedex);
    setOfferUber(next.offer_uber);
    setOfferCurri(next.offer_curri);
    setFedexApiKey("");
    setFedexSecretKey("");
    setStripeSecretKey("");
    setStripeWebhookSecret("");
    setMessage("Shipping settings saved");
    setTimeout(() => setMessage(null), 3000);
    router.refresh();
  }

  const appUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://your-domain.com";

  const offerOptions = [
    {
      id: "pickup" as const,
      label: "Pickup",
      description: "Client picks up at your shop",
      checked: offerPickup,
      set: setOfferPickup,
    },
    {
      id: "fedex" as const,
      label: "Delivery FedEx",
      description: "Live FedEx rates on the portal",
      checked: offerFedex,
      set: setOfferFedex,
    },
    {
      id: "uber" as const,
      label: "Delivery Uber",
      description: "Local Uber delivery to their address",
      checked: offerUber,
      set: setOfferUber,
    },
    {
      id: "curri" as const,
      label: "Curri rates",
      description:
        "Show Curri same-day quotes with FedEx on the Delivery step",
      checked: offerCurri,
      set: setOfferCurri,
    },
  ];

  return (
    <div className="space-y-6">
      {loadError ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {loadError}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800">
          Offer to clients
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Choose which delivery options appear on the client shipping portal.
          At least one must stay enabled.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {offerOptions.map((opt) => {
            const enabledCount = [
              offerPickup,
              offerFedex,
              offerUber,
              offerCurri,
            ].filter(Boolean).length;
            const disableUncheck = opt.checked && enabledCount === 1;
            return (
              <label
                key={opt.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition-colors ${
                  opt.checked
                    ? "border-[var(--primary)] bg-[var(--primary)]/5"
                    : "border-slate-200 bg-white hover:border-slate-300"
                } ${disableUncheck ? "opacity-80" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={opt.checked}
                  disabled={disableUncheck}
                  onChange={(e) => opt.set(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">
                    {opt.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {opt.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800">FedEx</h2>
        <p className="mt-1 text-sm text-slate-500">
          Live rate quotes on the client shipping portal. Env vars in
          .env.local are used as fallback when fields here are empty.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <SecretInput
            label="API key"
            placeholder="FedEx API key"
            masked={settings.fedex_api_key}
            value={fedexApiKey}
            onChange={setFedexApiKey}
          />
          <SecretInput
            label="Secret key"
            placeholder="FedEx secret"
            masked={settings.fedex_secret_key}
            value={fedexSecretKey}
            onChange={setFedexSecretKey}
          />
          <label className="block text-sm text-slate-600 sm:col-span-2">
            Account number
            <input
              value={fedexAccountNumber}
              onChange={(e) => setFedexAccountNumber(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input
              type="checkbox"
              checked={fedexSandbox}
              onChange={(e) => setFedexSandbox(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Use FedEx sandbox API
          </label>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          FedEx: {settings.fedex_configured ? "configured" : "not configured"}
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800">Ship-from / pickup</h2>
        <p className="mt-1 text-sm text-slate-500">
          Shown to clients who choose self pickup.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-slate-600 sm:col-span-2">
            Street
            <input
              value={shipperStreet}
              onChange={(e) => setShipperStreet(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm text-slate-600">
            City
            <input
              value={shipperCity}
              onChange={(e) => setShipperCity(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-slate-600">
              State
              <input
                value={shipperState}
                onChange={(e) => setShipperState(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-slate-600">
              ZIP
              <input
                value={shipperZip}
                onChange={(e) => setShipperZip(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block text-sm text-slate-600 sm:col-span-2">
            Pickup hours note
            <input
              value={pickupHoursNote}
              onChange={(e) => setPickupHoursNote(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Payments</h2>
            <p className="mt-1 text-sm text-slate-500">
              When enabled, delivery orders go through Stripe Checkout before
              confirmation. Pickup is always free.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={paymentEnabled}
              onChange={(e) => setPaymentEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Require payment for delivery
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-slate-600 sm:col-span-2">
            Stripe publishable key
            <input
              value={stripePublishableKey}
              onChange={(e) => setStripePublishableKey(e.target.value)}
              placeholder="pk_test_…"
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 font-mono text-sm"
            />
          </label>
          <SecretInput
            label="Stripe secret key"
            placeholder="sk_test_…"
            masked={settings.stripe_secret_key}
            value={stripeSecretKey}
            onChange={setStripeSecretKey}
          />
          <SecretInput
            label="Stripe webhook secret"
            placeholder="whsec_…"
            masked={settings.stripe_webhook_secret}
            value={stripeWebhookSecret}
            onChange={setStripeWebhookSecret}
          />
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Webhook URL:{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">
            {appUrl}/api/webhooks/stripe
          </code>
          {" · "}
          Stripe: {settings.stripe_configured ? "configured" : "not configured"}
        </p>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-800">Markup</h3>
          <p className="mt-1 text-xs text-slate-500">
            Client price = FedEx rate + fixed markup + (FedEx rate × percent).
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-600">
              Fixed markup ($)
              <input
                type="number"
                min={0}
                step={0.01}
                value={markupFixedDollars}
                onChange={(e) => setMarkupFixedDollars(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-slate-600">
              Percent markup (%)
              <input
                type="number"
                min={0}
                step={0.1}
                value={markupPercent}
                onChange={(e) => setMarkupPercent(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
