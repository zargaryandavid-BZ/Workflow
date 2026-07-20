import "server-only";

import type {
  FedExRateOption,
  ShippingBox,
  ShippingDeliveryAddress,
} from "@/lib/types";

const CURRI_GRAPHQL_URL = "https://api.curri.com/graphql";

const DELIVERY_QUOTES_QUERY = `
  query GetQuotes($data: DeliveryQuotesInput!) {
    deliveryQuotes(data: $data) {
      id
      fee
      deliveryMethod
      deliveryMethodDisplayName
      distance
      duration
      priority
      feeComparison {
        rush
        sameday
        scheduled
      }
    }
  }
`;

type CurriFeeComparison = {
  rush?: number | null;
  sameday?: number | null;
  scheduled?: number | null;
};

type CurriQuote = {
  id: string;
  fee: number;
  deliveryMethod: string;
  deliveryMethodDisplayName?: string | null;
  distance?: number | null;
  duration?: number | null;
  priority?: string | null;
  feeComparison?: CurriFeeComparison | null;
};

export function isCurriConfigured(): boolean {
  const userId = process.env.CURRI_USER_ID?.trim();
  const apiKey =
    process.env.CURRI_SANDBOX === "true"
      ? process.env.CURRI_SANDBOX_KEY?.trim()
      : process.env.CURRI_API_KEY?.trim();
  return Boolean(userId && apiKey);
}

function curriCredentials(): { userId: string; apiKey: string } | null {
  const userId = process.env.CURRI_USER_ID?.trim();
  const apiKey =
    process.env.CURRI_SANDBOX === "true"
      ? process.env.CURRI_SANDBOX_KEY?.trim()
      : process.env.CURRI_API_KEY?.trim();
  if (!userId || !apiKey) return null;
  return { userId, apiKey };
}

/** Curri manifest dimensions are centimeters; weight is pounds. */
function boxesToManifestItems(boxes: ShippingBox[]) {
  return boxes.map((box, i) => {
    const toCm = (n: number) =>
      box.dimUnit === "cm" ? n : Math.round(n * 2.54 * 100) / 100;
    const toLbs = (n: number) =>
      box.weightUnit === "lbs" ? n : Math.round(n * 2.20462 * 100) / 100;
    return {
      description: `Box ${i + 1}`,
      height: toCm(box.height),
      length: toCm(box.length),
      width: toCm(box.width),
      weight: toLbs(box.weight),
      quantity: 1,
    };
  });
}

function centsToDollars(cents: number | null | undefined): number | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return cents / 100;
}

function priorityLabel(priority: string | null | undefined): string {
  switch ((priority ?? "sameday").toLowerCase()) {
    case "rush":
      return "Rush";
    case "scheduled":
      return "Scheduled";
    default:
      return "Same Day";
  }
}

function transitForPriority(priority: string | null | undefined): string {
  switch ((priority ?? "sameday").toLowerCase()) {
    case "rush":
      return "2–4 hours";
    case "scheduled":
      return "Scheduled";
    default:
      return "By end of day";
  }
}

export function normalizeCurriQuote(quote: CurriQuote): FedExRateOption {
  const method =
    quote.deliveryMethodDisplayName?.trim() ||
    quote.deliveryMethod ||
    "Courier";
  const priority = (quote.priority ?? "sameday").toLowerCase();
  const feeComparison = quote.feeComparison
    ? {
        rush: centsToDollars(quote.feeComparison.rush) ?? undefined,
        sameday: centsToDollars(quote.feeComparison.sameday) ?? undefined,
        scheduled: centsToDollars(quote.feeComparison.scheduled) ?? undefined,
      }
    : undefined;

  return {
    provider: "curri",
    quoteId: quote.id,
    serviceType: quote.deliveryMethod || "curri",
    serviceName: `Curri — ${method}`,
    totalCharge: centsToDollars(quote.fee),
    currency: "USD",
    deliveryDate: null,
    transitDays: transitForPriority(priority),
    priority,
    feeComparison,
  };
}

export async function fetchCurriRates(args: {
  boxes: ShippingBox[];
  deliveryAddress: ShippingDeliveryAddress;
  origin: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
}): Promise<FedExRateOption[]> {
  const creds = curriCredentials();
  if (!creds) return [];

  const auth = Buffer.from(`${creds.userId}:${creds.apiKey}`).toString(
    "base64"
  );

  const variables = {
    data: {
      origin: {
        addressLine1: args.origin.street,
        city: args.origin.city,
        state: args.origin.state,
        postalCode: args.origin.zip,
      },
      destination: {
        addressLine1: args.deliveryAddress.street,
        city: args.deliveryAddress.city,
        state: args.deliveryAddress.state,
        postalCode: args.deliveryAddress.zip,
      },
      manifestItems: boxesToManifestItems(args.boxes),
      priority: "sameday",
    },
  };

  try {
    const res = await fetch(CURRI_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({ query: DELIVERY_QUOTES_QUERY, variables }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      data?: { deliveryQuotes?: CurriQuote[] | null };
      errors?: unknown;
    };

    if (!res.ok || json.errors || !json.data?.deliveryQuotes) {
      if (json.errors) {
        console.warn("[curri] deliveryQuotes errors:", json.errors);
      }
      return [];
    }

    return json.data.deliveryQuotes
      .filter((q) => q?.id && q.fee != null)
      .map(normalizeCurriQuote)
      .map((rate) => ({
        ...rate,
        serviceName: rate.priority
          ? `${rate.serviceName} · ${priorityLabel(rate.priority)}`
          : rate.serviceName,
      }));
  } catch (err) {
    console.error(
      "[curri] fetch failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
