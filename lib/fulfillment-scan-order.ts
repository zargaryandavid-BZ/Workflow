import {
  dieOrderNumberMatchRank,
  orderMatchesNumberSearch,
} from "./order-number-tokens.ts";

export function sanitizeScanLookupToken(value: string): string {
  return value.replace(/[%_,()]/g, "").trim().slice(0, 32);
}

export function pickScannedOrder<
  T extends { title: string; specs?: Record<string, unknown> | null },
>(orders: T[], query: string): T | null {
  const q = query.trim();
  if (!q || orders.length === 0) return null;
  const ranked = orders
    .filter((order) => orderMatchesNumberSearch(order, q))
    .sort(
      (a, b) =>
        dieOrderNumberMatchRank(a, q) - dieOrderNumberMatchRank(b, q)
    );
  return ranked[0] ?? null;
}
