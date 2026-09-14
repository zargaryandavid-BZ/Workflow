import type { FedExRateOption } from "@/lib/types";

/** Fallback names when FedEx omits serviceName. Prefer the API string (matches FedEx.com). */
export const FEDEX_SERVICE_NAMES: Record<string, string> = {
  FEDEX_GROUND: "FedEx Ground",
  GROUND_HOME_DELIVERY: "FedEx Home Delivery",
  FEDEX_2_DAY: "FedEx 2Day",
  FEDEX_2_DAY_AM: "FedEx 2Day AM",
  FEDEX_EXPRESS_SAVER: "FedEx Express Saver",
  STANDARD_OVERNIGHT: "FedEx Standard Overnight",
  PRIORITY_OVERNIGHT: "FedEx Priority Overnight",
  FIRST_OVERNIGHT: "FedEx First Overnight",
  INTERNATIONAL_ECONOMY: "FedEx International Economy",
  INTERNATIONAL_PRIORITY: "FedEx International Priority",
};

/** FedEx.com / DHL-style time-definite labels (US). */
export const FEDEX_COMMITMENT_LABEL: Record<string, string> = {
  FIRST_OVERNIGHT: "8:30 AM",
  PRIORITY_OVERNIGHT: "10:30 AM",
  STANDARD_OVERNIGHT: "5:00 PM",
  FEDEX_2_DAY_AM: "10:30 AM",
  FEDEX_2_DAY: "5:00 PM",
  FEDEX_EXPRESS_SAVER: "5:00 PM",
  GROUND_HOME_DELIVERY: "End of Day",
  FEDEX_GROUND: "End of Day",
};

/** Screenshot-style order within a delivery day. */
const FEDEX_CHART_ORDER: Record<string, number> = {
  PRIORITY_OVERNIGHT: 10,
  STANDARD_OVERNIGHT: 20,
  FIRST_OVERNIGHT: 30,
  FEDEX_2_DAY_AM: 40,
  FEDEX_2_DAY: 50,
  FEDEX_EXPRESS_SAVER: 60,
  FEDEX_GROUND: 70,
  GROUND_HOME_DELIVERY: 80,
};

export function friendlyFedExServiceName(
  serviceType: string,
  fallback?: string
) {
  const api = fallback?.trim();
  if (api) return api;
  return FEDEX_SERVICE_NAMES[serviceType] ?? serviceType;
}

export function fedexCommitmentLabel(rate: FedExRateOption): string | null {
  if (rate.provider === "curri") return null;
  const fromMap = FEDEX_COMMITMENT_LABEL[rate.serviceType];
  if (fromMap) return fromMap;
  if (
    rate.serviceType.includes("HOME_DELIVERY") ||
    /home delivery/i.test(rate.serviceName)
  ) {
    return "End of Day";
  }
  return null;
}

export function parseDeliveryDate(raw: string | null | undefined): Date | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  try {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
      const d = new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      );
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const monDay = /^([A-Za-z]{3})-(\d{1,2})-(\d{2,4})$/.exec(value);
    if (monDay) {
      const yearRaw = Number(monDay[3]);
      const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
      const d = new Date(`${monDay[1]} ${monDay[2]}, ${year}`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function addBusinessDays(start: Date, businessDays: number): Date {
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let added = 0;
  while (added < businessDays) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d;
}

export function estimateDeliveryDate(rate: FedExRateOption): Date | null {
  const parsed = parseDeliveryDate(rate.deliveryDate);
  if (parsed) return parsed;

  const transit = (rate.transitDays ?? "").toUpperCase().replace(/\s+/g, "_");
  const service = rate.serviceType.toUpperCase();

  let businessDays: number | null = null;
  if (
    transit.includes("ONE_DAY") ||
    transit === "1D" ||
    transit === "ONE_DAY"
  ) {
    businessDays = 1;
  } else if (
    transit.includes("TWO_DAY") ||
    transit === "2D" ||
    transit === "TWO_DAYS"
  ) {
    businessDays = 2;
  } else if (
    transit.includes("THREE_DAY") ||
    transit === "3D" ||
    transit === "THREE_DAYS"
  ) {
    businessDays = 3;
  } else if (transit.includes("FOUR_DAY") || transit === "4D") {
    businessDays = 4;
  } else if (transit.includes("FIVE_DAY") || transit === "5D") {
    businessDays = 5;
  } else if (
    service.includes("FIRST_OVERNIGHT") ||
    service.includes("PRIORITY_OVERNIGHT") ||
    service.includes("STANDARD_OVERNIGHT")
  ) {
    businessDays = 1;
  } else if (service.includes("2_DAY") || service.includes("2DAY")) {
    businessDays = 2;
  } else if (service.includes("EXPRESS_SAVER")) {
    businessDays = 3;
  } else if (service.includes("GROUND") || service.includes("HOME_DELIVERY")) {
    businessDays = 5;
  }

  if (businessDays == null) return null;
  return addBusinessDays(new Date(), businessDays);
}

export function formatDeliveredByHeading(date: Date): string {
  return `Delivered by ${date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;
}

export type RateChartGroup = {
  key: string;
  heading: string;
  rates: FedExRateOption[];
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function chartSortIndex(rate: FedExRateOption): number {
  if (rate.provider === "curri") return 0;
  return FEDEX_CHART_ORDER[rate.serviceType] ?? 90;
}

export function groupRatesForPriceChart(
  rates: FedExRateOption[]
): RateChartGroup[] {
  const buckets = new Map<string, { date: Date | null; rates: FedExRateOption[] }>();

  for (const rate of rates) {
    if (rate.provider === "curri") {
      const bucket = buckets.get("curri") ?? { date: null, rates: [] };
      bucket.rates.push(rate);
      buckets.set("curri", bucket);
      continue;
    }
    const date = estimateDeliveryDate(rate);
    const key = date ? dayKey(date) : "unknown";
    const bucket = buckets.get(key) ?? { date, rates: [] };
    if (!bucket.date && date) bucket.date = date;
    bucket.rates.push(rate);
    buckets.set(key, bucket);
  }

  const groups: RateChartGroup[] = [];
  const curri = buckets.get("curri");
  if (curri) {
    groups.push({
      key: "curri",
      heading: "Same day",
      rates: curri.rates,
    });
    buckets.delete("curri");
  }

  const rest = [...buckets.entries()].sort((a, b) => {
    if (a[0] === "unknown") return 1;
    if (b[0] === "unknown") return -1;
    return a[0].localeCompare(b[0]);
  });

  for (const [key, bucket] of rest) {
    const sorted = [...bucket.rates].sort(
      (a, b) => chartSortIndex(a) - chartSortIndex(b)
    );
    groups.push({
      key,
      heading: bucket.date
        ? formatDeliveredByHeading(bucket.date)
        : "Delivery date TBD",
      rates: sorted,
    });
  }

  return groups;
}
