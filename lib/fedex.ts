import "server-only";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type {
  FedExConfig,
  FedExRateOption,
  ShippingBox,
  ShippingDeliveryAddress,
} from "@/lib/types";
import { resolveFedExConfig } from "@/lib/shipping-settings";
import type { ShippingSettings } from "@/lib/types";

const FEDEX_SERVICE_NAMES: Record<string, string> = {
  FEDEX_GROUND: "FedEx Ground",
  GROUND_HOME_DELIVERY: "FedEx Home Delivery",
  FEDEX_2_DAY: "FedEx 2Day",
  FEDEX_2_DAY_AM: "FedEx 2Day A.M.",
  FEDEX_EXPRESS_SAVER: "FedEx Express Saver",
  STANDARD_OVERNIGHT: "FedEx Standard Overnight",
  PRIORITY_OVERNIGHT: "FedEx Priority Overnight",
  FIRST_OVERNIGHT: "FedEx First Overnight",
  INTERNATIONAL_ECONOMY: "FedEx International Economy",
  INTERNATIONAL_PRIORITY: "FedEx International Priority",
};

function fedexBaseUrl(config: FedExConfig): string {
  return config.sandbox
    ? "https://apis-sandbox.fedex.com"
    : "https://apis.fedex.com";
}

export function isFedExConfigured(config?: FedExConfig | null): boolean {
  const c = config ?? resolveFedExConfig(null);
  return Boolean(
    c.apiKey?.trim() && c.secretKey?.trim() && c.accountNumber?.trim()
  );
}

export function friendlyFedExServiceName(serviceType: string, fallback?: string) {
  return FEDEX_SERVICE_NAMES[serviceType] ?? fallback ?? serviceType;
}

async function getFedExAccessToken(config: FedExConfig): Promise<string> {
  const clientId = config.apiKey?.trim();
  const clientSecret = config.secretKey?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("FedEx is not configured. Add API credentials in Shipping settings.");
  }

  const oauthUrl = `${fedexBaseUrl(config)}/oauth/token`;
  const res = await fetchWithTimeout(oauthUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    errors?: Array<{ message?: string; code?: string }>;
  };

  if (!res.ok || !json.access_token) {
    const msg =
      json.errors?.[0]?.message ?? "Failed to authenticate with FedEx.";
    throw new Error(msg);
  }

  return json.access_token;
}

function shipperAddress(config: FedExConfig) {
  return {
    streetLines: [config.shipper.street],
    city: config.shipper.city,
    stateOrProvinceCode: config.shipper.state,
    postalCode: config.shipper.zip,
    countryCode: config.shipper.country,
  };
}

/** Sample rates for local testing when FedEx API keys are not set. */
export function mockFedExRates(
  deliveryAddress: ShippingDeliveryAddress
): FedExRateOption[] {
  const zipHint = Number.parseInt(deliveryAddress.zip.replace(/\D/g, "").slice(0, 3), 10);
  const distanceFactor = Number.isFinite(zipHint) ? (zipHint % 40) / 100 : 0.15;
  const ground = Math.round((18 + distanceFactor * 40) * 100) / 100;
  const twoDay = Math.round((ground * 2.1) * 100) / 100;
  const overnight = Math.round((ground * 3.5) * 100) / 100;
  const day = 24 * 60 * 60 * 1000;
  const inDays = (n: number) =>
    new Date(Date.now() + n * day).toISOString().slice(0, 10);

  const mk = (
    serviceType: string,
    totalCharge: number,
    deliveryDate: string,
    transitDays: string
  ): FedExRateOption => ({
    serviceType,
    serviceName: friendlyFedExServiceName(serviceType),
    totalCharge,
    fedexBaseCharge: totalCharge,
    currency: "USD",
    deliveryDate,
    transitDays,
  });

  return [
    mk("FEDEX_GROUND", ground, inDays(5), "THREE_TO_FIVE_DAYS"),
    mk("FEDEX_2_DAY", twoDay, inDays(2), "TWO_DAYS"),
    mk("PRIORITY_OVERNIGHT", overnight, inDays(1), "ONE_DAY"),
  ];
}

export async function fetchFedExRates(args: {
  boxes: ShippingBox[];
  deliveryAddress: ShippingDeliveryAddress;
  settings?: ShippingSettings | null;
}): Promise<FedExRateOption[]> {
  const config = resolveFedExConfig(args.settings ?? null);

  if (!isFedExConfigured(config)) {
    if (config.sandbox || process.env.FEDEX_ALLOW_MOCK === "true") {
      return mockFedExRates(args.deliveryAddress);
    }
    throw new Error(
      "FedEx is not configured. Add credentials in Settings → Shipping."
    );
  }

  const accessToken = await getFedExAccessToken(config);
  const accountNumber = config.accountNumber!.trim();

  const ratePayload = {
    accountNumber: { value: accountNumber },
    requestedShipment: {
      shipper: { address: shipperAddress(config) },
      recipient: {
        address: {
          streetLines: [args.deliveryAddress.street],
          city: args.deliveryAddress.city,
          stateOrProvinceCode: args.deliveryAddress.state,
          postalCode: args.deliveryAddress.zip,
          countryCode: args.deliveryAddress.country || "US",
        },
      },
      pickupType: "DROPOFF_AT_FEDEX_LOCATION",
      rateRequestType: ["ACCOUNT", "LIST"],
      requestedPackageLineItems: args.boxes.map((box, i) => ({
        sequenceNumber: i + 1,
        weight: {
          units: box.weightUnit === "kg" ? "KG" : "LB",
          value: box.weight,
        },
        dimensions: {
          length: box.length,
          width: box.width,
          height: box.height,
          units: box.dimUnit === "cm" ? "CM" : "IN",
        },
      })),
    },
  };

  const ratesUrl = `${fedexBaseUrl(config)}/rate/v1/rates/quotes`;
  const ratesRes = await fetchWithTimeout(ratesUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(ratePayload),
  });

  const ratesData = (await ratesRes.json().catch(() => ({}))) as {
    output?: {
      rateReplyDetails?: Array<{
        serviceType?: string;
        serviceName?: string;
        ratedShipmentDetails?: Array<{
          totalNetCharge?: number | string;
          currency?: string;
        }>;
        operationalDetail?: {
          deliveryDate?: string;
          transitTime?: string;
        };
      }>;
    };
    errors?: Array<{ message?: string; code?: string }>;
  };

  if (!ratesRes.ok) {
    const msg =
      ratesData.errors?.[0]?.message ?? "FedEx rate request failed.";
    throw new Error(msg);
  }

  return (ratesData.output?.rateReplyDetails ?? []).map((r) => {
    const detail = r.ratedShipmentDetails?.[0];
    const rawCharge = detail?.totalNetCharge;
    const totalCharge =
      rawCharge == null
        ? null
        : typeof rawCharge === "number"
          ? rawCharge
          : Number.parseFloat(String(rawCharge));

    return {
      serviceType: r.serviceType ?? "UNKNOWN",
      serviceName: friendlyFedExServiceName(
        r.serviceType ?? "",
        r.serviceName
      ),
      totalCharge: Number.isFinite(totalCharge) ? totalCharge : null,
      fedexBaseCharge: Number.isFinite(totalCharge) ? totalCharge : null,
      currency: detail?.currency ?? "USD",
      deliveryDate: r.operationalDetail?.deliveryDate ?? null,
      transitDays: r.operationalDetail?.transitTime ?? null,
    };
  });
}

export function pickupLocationLines(settings?: ShippingSettings | null): string[] {
  const config = resolveFedExConfig(settings ?? null);
  return [
    config.shipper.street,
    `${config.shipper.city}, ${config.shipper.state} ${config.shipper.zip}`,
    config.pickupHoursNote,
  ];
}
