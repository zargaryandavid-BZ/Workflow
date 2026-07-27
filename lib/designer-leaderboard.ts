/** Designer motivational leaderboard — same basis as Analytics Designer workload. */

export interface DesignerLeaderboardRow {
  id: string;
  name: string;
  /** Assigned cards (orders). */
  orderCount: number;
  /** Total SKU rows on those cards. */
  skuCount: number;
  rank: number;
  /** 1–5 motivational stars (1st = 5). */
  stars: number;
}

export interface DesignerLeaderboardResult {
  monthLabel: string;
  monthKey: string;
  updatedAt: string;
  totalOrders: number;
  totalSkus: number;
  rows: DesignerLeaderboardRow[];
}

function skuRowCount(specs: Record<string, unknown> | null | undefined): number {
  const raw = specs && typeof specs === "object" ? specs.skus : null;
  return Array.isArray(raw) ? raw.length : 0;
}

/** Calendar month label for the popover header. */
export function currentMonthBounds(now = new Date()): {
  dateFrom: string;
  dateTo: string;
  monthKey: string;
  monthLabel: string;
} {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(now);
  return {
    dateFrom: start.toISOString(),
    dateTo: end.toISOString(),
    monthKey,
    monthLabel,
  };
}

export function starsForRank(rank: number): number {
  if (rank <= 1) return 5;
  if (rank === 2) return 4;
  if (rank === 3) return 3;
  if (rank === 4) return 2;
  return 1;
}

function inRange(
  iso: string,
  dateFrom: string | null,
  dateTo: string
): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (dateFrom && t < new Date(dateFrom).getTime()) return false;
  if (t > new Date(dateTo).getTime()) return false;
  return true;
}

/**
 * Rank designers like Analytics → Designer workload (All columns):
 * every non-removed card created in the month, by assignee (Orders/SKUs).
 */
export function computeDesignerLeaderboard(input: {
  monthLabel: string;
  monthKey: string;
  dateFrom: string;
  dateTo: string;
  designers: { id: string; name: string }[];
  /** All non-removed orders (caller may already date-filter). */
  orders: {
    id: string;
    created_at: string;
    specs: Record<string, unknown> | null;
  }[];
  profileNames?: Map<string, string>;
}): DesignerLeaderboardResult {
  const profileNames = input.profileNames ?? new Map<string, string>();
  const counts = new Map<
    string,
    { name: string; orderCount: number; skuCount: number }
  >();

  for (const d of input.designers) {
    if (!d.id) continue;
    counts.set(d.id, {
      name: d.name.trim() || profileNames.get(d.id) || "Unnamed",
      orderCount: 0,
      skuCount: 0,
    });
  }

  let totalOrders = 0;
  let totalSkus = 0;

  for (const o of input.orders) {
    if (!inRange(o.created_at, input.dateFrom, input.dateTo)) continue;
    const skus = skuRowCount(o.specs);
    const designerId =
      typeof o.specs?.designer_id === "string"
        ? o.specs.designer_id.trim()
        : "";
    if (!designerId) continue;

    const designerName =
      typeof o.specs?.designer_name === "string"
        ? o.specs.designer_name.trim()
        : profileNames.get(designerId) ?? "Unnamed";
    const row = counts.get(designerId) ?? {
      name: designerName || "Unnamed",
      orderCount: 0,
      skuCount: 0,
    };
    if (designerName) row.name = designerName;
    row.orderCount += 1;
    row.skuCount += skus;
    counts.set(designerId, row);
    totalOrders += 1;
    totalSkus += skus;
  }

  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1].orderCount !== a[1].orderCount) {
      return b[1].orderCount - a[1].orderCount;
    }
    if (b[1].skuCount !== a[1].skuCount) {
      return b[1].skuCount - a[1].skuCount;
    }
    return a[1].name.localeCompare(b[1].name);
  });

  const rows: DesignerLeaderboardRow[] = sorted.map(([id, row], index) => {
    const rank = index + 1;
    return {
      id,
      name: row.name,
      orderCount: row.orderCount,
      skuCount: row.skuCount,
      rank,
      stars: starsForRank(rank),
    };
  });

  return {
    monthLabel: input.monthLabel,
    monthKey: input.monthKey,
    updatedAt: new Date().toISOString(),
    totalOrders,
    totalSkus,
    rows,
  };
}
