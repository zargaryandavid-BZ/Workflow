import "server-only";

import { fetchCurriRates } from "@/lib/curri";
import { fetchFedExRates } from "@/lib/fedex";
import { applyShippingMarkup } from "@/lib/shipping-markup";
import {
  loadShippingSettings,
  resolveFedExConfig,
} from "@/lib/shipping-settings";
import type {
  FedExRateOption,
  ShippingBox,
  ShippingDeliveryAddress,
} from "@/lib/types";

type Settings = Awaited<ReturnType<typeof loadShippingSettings>>;

const DEFAULT_CURRI_BOX: ShippingBox = {
  length: 12,
  width: 10,
  height: 6,
  weight: 5,
  dimUnit: "in",
  weightUnit: "lbs",
};

/** Customer price = carrier rate + percent markup (when online payment is on). */
function withCustomerMarkup(
  rates: FedExRateOption[],
  settings: Settings
): FedExRateOption[] {
  const paymentEnabled = settings?.payment_enabled ?? false;
  const markupPercent = settings?.markup_percent ?? 0;
  return rates.map((rate) => {
    const base = rate.totalCharge;
    if (!paymentEnabled || base == null || markupPercent === 0) return rate;
    return {
      ...rate,
      fedexBaseCharge: base,
      totalCharge: applyShippingMarkup(base, 0, markupPercent),
    };
  });
}

/** FedEx rates the customer is shown and charged for this shipping request. */
export async function quoteFedExCustomerRates(args: {
  boxes: ShippingBox[];
  deliveryAddress: ShippingDeliveryAddress;
  settings: Settings;
}): Promise<FedExRateOption[]> {
  const baseRates = await fetchFedExRates(args);
  // Customer price uses FedEx ACCOUNT rates (see pickRatedDetail).
  return withCustomerMarkup(
    baseRates.map((rate) => ({ ...rate, provider: "fedex" as const })),
    args.settings
  );
}

/** Curri rates the customer is shown and charged for this shipping request. */
export async function quoteCurriCustomerRates(args: {
  boxes: ShippingBox[];
  deliveryAddress: ShippingDeliveryAddress;
  settings: Settings;
}): Promise<FedExRateOption[]> {
  const config = resolveFedExConfig(args.settings);
  const baseRates = await fetchCurriRates({
    boxes: args.boxes.length > 0 ? args.boxes : [DEFAULT_CURRI_BOX],
    deliveryAddress: args.deliveryAddress,
    origin: {
      street: config.shipper.street,
      city: config.shipper.city,
      state: config.shipper.state,
      zip: config.shipper.zip,
    },
  });
  return withCustomerMarkup(baseRates, args.settings);
}

/**
 * Re-quote on the server and return the rate matching the customer's pick,
 * so the browser can never set its own price. Null when that service is no
 * longer offered for this address.
 */
export async function serverPricedSelection(args: {
  selection: FedExRateOption;
  boxes: ShippingBox[];
  deliveryAddress: ShippingDeliveryAddress;
  settings: Settings;
}): Promise<FedExRateOption | null> {
  const isCurri = args.selection.provider === "curri";
  const rates = isCurri
    ? await quoteCurriCustomerRates(args)
    : await quoteFedExCustomerRates(args);
  return (
    rates.find(
      (rate) =>
        rate.serviceType === args.selection.serviceType &&
        rate.totalCharge != null
    ) ?? null
  );
}
