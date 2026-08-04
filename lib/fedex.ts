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

/**
 * Turn FedEx API errors into short messages customers can understand.
 * Keeps the original for server logs.
 */
export function friendlyFedExCustomerError(raw: string): string {
  const msg = raw.trim();
  if (!msg) {
    return "We couldn’t get shipping rates right now. Please check the address and try again.";
  }
  const lower = msg.toLowerCase();

  if (
    lower.includes("origin / destination") ||
    lower.includes("origin/destination") ||
    lower.includes("not currently available to this origin") ||
    lower.includes("service is not currently available")
  ) {
    return "FedEx can’t ship to this address from our location. Please double-check the street, city, state, and ZIP, then try again.";
  }

  if (
    lower.includes("postal") ||
    lower.includes("zip code") ||
    lower.includes("invalid destination") ||
    lower.includes("destination address")
  ) {
    return "That delivery address doesn’t look valid to FedEx. Please check the ZIP and city/state, then try again.";
  }

  if (
    lower.includes("weight") ||
    lower.includes("dimension") ||
    lower.includes("package")
  ) {
    return "FedEx couldn’t quote this package size. Please contact the shop for help.";
  }

  if (
    lower.includes("sandbox") ||
    lower.includes("authorize your credentials") ||
    lower.includes("authentication") ||
    lower.includes("not configured")
  ) {
    return "Shipping rates are temporarily unavailable. Please try again later or contact the shop.";
  }

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "FedEx took too long to respond. Please try again in a moment.";
  }

  // Generic fallback — never show raw FedEx jargon to customers.
  return "We couldn’t get shipping rates for this address. Please check the address and try again, or contact the shop.";
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

function parseNetCharge(raw: number | string | null | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

type RatedShipmentDetail = {
  rateType?: string;
  actualRateType?: string;
  totalNetCharge?: number | string;
  currency?: string;
};

/** Prefer LIST (published) rates so quotes align closer to fedex.com. */
function pickRatedDetail(
  details: RatedShipmentDetail[] | undefined
): RatedShipmentDetail | undefined {
  if (!details?.length) return undefined;
  const list = details.find((d) => {
    const t = `${d.rateType ?? ""} ${d.actualRateType ?? ""}`.toUpperCase();
    return t.includes("LIST");
  });
  return list ?? details[0];
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
  const residential = args.deliveryAddress.residential !== false;
  const usingOwnBox = args.deliveryAddress.usingOwnBox !== false;

  const today = new Date();
  const shipDateStamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  const ratePayload = {
    accountNumber: { value: accountNumber },
    rateRequestControlParameters: {
      returnTransitTimes: true,
    },
    requestedShipment: {
      shipDateStamp,
      shipper: { address: shipperAddress(config) },
      recipient: {
        address: {
          streetLines: [args.deliveryAddress.street],
          city: args.deliveryAddress.city,
          stateOrProvinceCode: args.deliveryAddress.state,
          postalCode: args.deliveryAddress.zip,
          countryCode: args.deliveryAddress.country || "US",
          residential,
        },
      },
      pickupType: "DROPOFF_AT_FEDEX_LOCATION",
      packagingType: usingOwnBox ? "YOUR_PACKAGING" : "FEDEX_BOX",
      rateRequestType: ["LIST", "ACCOUNT"],
      rateRequestControlParameters: {
        returnTransitTimes: true,
      },
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
        ratedShipmentDetails?: RatedShipmentDetail[];
        operationalDetail?: {
          deliveryDate?: string;
          transitTime?: string;
        };
        commit?: {
          dateDetail?: { dayFormat?: string; dayOfWeek?: string };
          transitDays?: string;
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
    const detail = pickRatedDetail(r.ratedShipmentDetails);
    const totalCharge = parseNetCharge(detail?.totalNetCharge);
    const deliveryDate =
      r.operationalDetail?.deliveryDate ??
      r.commit?.dateDetail?.dayFormat ??
      null;
    const transitDays =
      r.operationalDetail?.transitTime ?? r.commit?.transitDays ?? null;

    return {
      serviceType: r.serviceType ?? "UNKNOWN",
      serviceName: friendlyFedExServiceName(
        r.serviceType ?? "",
        r.serviceName
      ),
      totalCharge,
      fedexBaseCharge: totalCharge,
      currency: detail?.currency ?? "USD",
      deliveryDate,
      transitDays,
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

export interface FedExContact {
  personName: string;
  phoneNumber: string;
  companyName?: string | null;
}

export interface FedExCreatedShipment {
  trackingNumber: string;
  labelPdfs: Buffer[];
}

function digitsOnlyPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function todayShipDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Create a FedEx shipment and return tracking + PDF label bytes (one per package).
 */
export async function createFedExShipment(args: {
  boxes: ShippingBox[];
  deliveryAddress: ShippingDeliveryAddress;
  serviceType: string;
  settings?: ShippingSettings | null;
  shipperContact: FedExContact;
  recipientContact: FedExContact;
}): Promise<FedExCreatedShipment> {
  const config = resolveFedExConfig(args.settings ?? null);

  if (!isFedExConfigured(config)) {
    throw new Error(
      "FedEx is not configured. Add credentials in Settings → Shipping."
    );
  }
  if (!args.boxes.length) {
    throw new Error("At least one box is required to create a FedEx label.");
  }

  const shipperPhone = digitsOnlyPhone(args.shipperContact.phoneNumber);
  const recipientPhone = digitsOnlyPhone(args.recipientContact.phoneNumber);
  if (shipperPhone.length < 10) {
    throw new Error(
      "Shipper phone is required for FedEx labels. Add it in Settings → Shipping."
    );
  }
  if (recipientPhone.length < 10) {
    throw new Error(
      "Customer phone is required for FedEx labels. Add a phone on the order customer."
    );
  }

  const accessToken = await getFedExAccessToken(config);
  const accountNumber = config.accountNumber!.trim();
  const country =
    (args.deliveryAddress.country ?? "US").trim().toUpperCase() || "US";
  const residential = args.deliveryAddress.residential !== false;
  const usingOwnBox = args.deliveryAddress.usingOwnBox !== false;

  const shipPayload = {
    labelResponseOptions: "LABEL",
    accountNumber: { value: accountNumber },
    requestedShipment: {
      shipDatestamp: todayShipDate(),
      pickupType: "DROPOFF_AT_FEDEX_LOCATION",
      serviceType: args.serviceType,
      packagingType: usingOwnBox ? "YOUR_PACKAGING" : "FEDEX_BOX",
      blockInsightVisibility: false,
      shipper: {
        contact: {
          personName: args.shipperContact.personName.slice(0, 70),
          phoneNumber: shipperPhone,
          ...(args.shipperContact.companyName
            ? { companyName: args.shipperContact.companyName.slice(0, 35) }
            : {}),
        },
        address: shipperAddress(config),
      },
      recipients: [
        {
          contact: {
            personName: args.recipientContact.personName.slice(0, 70),
            phoneNumber: recipientPhone,
            ...(args.recipientContact.companyName
              ? {
                  companyName: args.recipientContact.companyName.slice(0, 35),
                }
              : {}),
          },
          address: {
            streetLines: [args.deliveryAddress.street],
            city: args.deliveryAddress.city,
            stateOrProvinceCode: args.deliveryAddress.state,
            postalCode: args.deliveryAddress.zip,
            countryCode: country,
            residential,
          },
        },
      ],
      shippingChargesPayment: {
        paymentType: "SENDER",
      },
      labelSpecification: {
        imageType: "PDF",
        labelStockType: "PAPER_4X6",
      },
      requestedPackageLineItems: args.boxes.map((box, i) => ({
        sequenceNumber: i + 1,
        weight: {
          units: box.weightUnit === "kg" ? "KG" : "LB",
          value: box.weight,
        },
        dimensions: {
          length: Math.round(box.length),
          width: Math.round(box.width),
          height: Math.round(box.height),
          units: box.dimUnit === "cm" ? "CM" : "IN",
        },
      })),
    },
  };

  const shipUrl = `${fedexBaseUrl(config)}/ship/v1/shipments`;
  const shipRes = await fetchWithTimeout(shipUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-locale": "en_US",
    },
    body: JSON.stringify(shipPayload),
  });

  const shipData = (await shipRes.json().catch(() => ({}))) as {
    output?: {
      transactionShipments?: Array<{
        masterTrackingNumber?: string;
        pieceResponses?: Array<{
          trackingNumber?: string;
          packageDocuments?: Array<{
            contentType?: string;
            docType?: string;
            encodedLabel?: string;
          }>;
        }>;
        shipmentDocuments?: Array<{
          contentType?: string;
          docType?: string;
          encodedLabel?: string;
        }>;
      }>;
    };
    errors?: Array<{ message?: string; code?: string }>;
  };

  if (!shipRes.ok) {
    const msg =
      shipData.errors?.[0]?.message ?? "FedEx create shipment failed.";
    throw new Error(msg);
  }

  const txn = shipData.output?.transactionShipments?.[0];
  if (!txn) {
    throw new Error("FedEx returned no shipment details.");
  }

  const trackingNumber =
    txn.masterTrackingNumber?.trim() ||
    txn.pieceResponses?.[0]?.trackingNumber?.trim() ||
    "";

  if (!trackingNumber) {
    throw new Error("FedEx returned no tracking number.");
  }

  const labelPdfs: Buffer[] = [];
  for (const piece of txn.pieceResponses ?? []) {
    for (const doc of piece.packageDocuments ?? []) {
      if (!doc.encodedLabel) continue;
      const isPdf =
        !doc.docType ||
        doc.docType.toUpperCase() === "PDF" ||
        doc.contentType?.toUpperCase() === "LABEL";
      if (!isPdf) continue;
      labelPdfs.push(Buffer.from(doc.encodedLabel, "base64"));
    }
  }

  if (labelPdfs.length === 0) {
    for (const doc of txn.shipmentDocuments ?? []) {
      if (!doc.encodedLabel) continue;
      labelPdfs.push(Buffer.from(doc.encodedLabel, "base64"));
    }
  }

  if (labelPdfs.length === 0) {
    throw new Error("FedEx returned no PDF label.");
  }

  return { trackingNumber, labelPdfs };
}
