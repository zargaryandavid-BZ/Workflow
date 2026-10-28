import { localDayKey } from "./fulfillment-day.ts";

/** One logged move of an order into a Sender-station column. */
export type DeliveryEvent = {
  orderId: string;
  columnId: string;
  /** ISO timestamp of the move (`activity_log.created_at`). */
  at: string;
};

export type DeliveryMetric = "orders" | "items";
export type DeliveryPeriod = "day" | "week" | "month";

/** How many bars each period shows. */
export const DELIVERY_PERIOD_COUNT: Record<DeliveryPeriod, number> = {
  day: 14,
  week: 12,
  month: 12,
};

export type DeliveryLine = {
  orderId: string;
  columnId: string;
  at: string;
  amount: number;
};

export type DeliveryBucket = {
  /** Day `YYYY-MM-DD`, week start (Monday) `YYYY-MM-DD`, or month `YYYY-MM`. */
  key: string;
  value: number;
  /** Orders in this period, newest first. */
  lines: DeliveryLine[];
};

/** Local period key for a timestamp. Weeks start on Monday. */
export function deliveryPeriodKey(
  value: Date | string,
  period: DeliveryPeriod
): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  if (period === "month") return localDayKey(d).slice(0, 7);
  if (period === "week") {
    const sinceMonday = (d.getDay() + 6) % 7;
    return localDayKey(
      new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday)
    );
  }
  return localDayKey(d);
}

/** The last `count` period keys ending with the one holding `end`, oldest first. */
export function deliveryPeriodKeys(
  end: Date,
  period: DeliveryPeriod,
  count: number
): string[] {
  const keys: string[] = [];
  for (let offset = Math.max(1, Math.floor(count)) - 1; offset >= 0; offset -= 1) {
    const d =
      period === "month"
        ? new Date(end.getFullYear(), end.getMonth() - offset, 1)
        : new Date(
            end.getFullYear(),
            end.getMonth(),
            end.getDate() - offset * (period === "week" ? 7 : 1)
          );
    keys.push(deliveryPeriodKey(d, period));
  }
  return keys;
}

/** Days of history needed to fill `count` periods. */
export function deliveryPeriodDays(period: DeliveryPeriod, count: number): number {
  if (period === "month") return count * 31;
  if (period === "week") return count * 7;
  return count;
}

/**
 * Orders (or their item quantities) sent per period. With `columnId` only
 * that column counts; without it an order counts once per period even when
 * it reached several Sender columns.
 */
export function bucketDeliveries(args: {
  events: DeliveryEvent[];
  itemsByOrder: Record<string, number>;
  keys: string[];
  period: DeliveryPeriod;
  metric: DeliveryMetric;
  columnId?: string | null;
  keyOf?: (iso: string, period: DeliveryPeriod) => string;
}): DeliveryBucket[] {
  const keyOf = args.keyOf ?? deliveryPeriodKey;
  const byKey = new Map<string, DeliveryBucket>(
    args.keys.map((key) => [key, { key, value: 0, lines: [] }])
  );
  const seen = new Set<string>();
  const newestFirst = [...args.events].sort((a, b) => b.at.localeCompare(a.at));
  for (const event of newestFirst) {
    if (args.columnId && event.columnId !== args.columnId) continue;
    const key = keyOf(event.at, args.period);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    const dedupe = `${event.orderId}|${key}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const amount =
      args.metric === "orders"
        ? 1
        : Math.max(0, Math.floor(args.itemsByOrder[event.orderId] ?? 0));
    bucket.value += amount;
    bucket.lines.push({ ...event, amount });
  }
  return args.keys.map((key) => byKey.get(key)!);
}
