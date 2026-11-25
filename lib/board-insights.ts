/**
 * Board insights (pure — no I/O). Powers the Board health dashboard:
 * workload, stuck production jobs, bottlenecks, column-to-column flow,
 * stage times, missing info %, proof rejections, repeat-rejection clients,
 * and a "what to do" action list. Every number compares the selected
 * period with the period just before it, so changes are trackable.
 *
 * Loader: lib/board-insights.server.ts · API: GET /api/board/insights?days=30
 */

export type InsightsColumn = { id: string; name: string; position: number; kind: string | null };

export type InsightsGroup = "design" | "client" | "production" | "shipping" | "finished";

export type InsightsOpenOrder = {
  id: string;
  title: string;
  column_id: string;
  customer_id: string | null;
  designer_id: string | null;
  sku_count: number;
  /** Sum of SKU quantities (specs.skus[].qty). */
  qty?: number;
  created_at: string;
  last_moved_at: string | null;
  /** Calendar days until due (negative = late), null = no clock (already resolved by the loader). */
  days_to_due: number | null;
  due_date: string | null;
};

/** Any order referenced by events (may be closed or removed). */
export type InsightsOrderMeta = {
  id: string;
  title: string;
  customer_id: string | null;
  designer_id: string | null;
  created_at: string;
  sku_count?: number;
};

export type InsightsEvent = {
  order_id: string;
  action: "moved" | "approved" | "rejected" | "approval_queued" | string;
  created_at: string;
  from?: string | null;
  to?: string | null;
  /** Who did it (for approval_queued: the designer who sent the proof). */
  actor?: string | null;
};

export type InsightsNotification = {
  order_id: string;
  type: string;
  status: string;
  created_at: string;
  responded_at: string | null;
};

export type InsightsInput = {
  now: Date;
  days: number;
  columns: InsightsColumn[];
  openOrders: InsightsOpenOrder[];
  /** Orders created since the start of the previous period (id, created_at, customer). */
  newOrders: { id: string; created_at: string; customer_id: string | null; column_id?: string | null; qty?: number }[];
  orderMeta: Map<string, InsightsOrderMeta>;
  events: InsightsEvent[];
  notifications: InsightsNotification[];
  customers: Map<string, string>;
  designers: { id: string; name: string }[];
  /** Design timer entries (time_entries, activity "Design") in the period. */
  timeEntries?: { user_id: string; order_id: string | null; seconds: number; started_at: string }[];
  /** Start of today in shop time (ms); defaults to UTC midnight. */
  todayStartMs?: number;
  /**
   * Moves into Ready to Ship (or later) over the last 60 days, for the day / week / month
   * progress — independent of the selected period. Falls back to `events` when missing.
   */
  productionExits?: { order_id: string; created_at: string; from: string | null; to: string | null }[];
  /** Auto-assign pool (Settings → Designer Assigning Algorithm); rebalancing stays inside it when set. */
  designerPool?: string[];
};

export type Trend = { value: number | null; prev: number | null };

export type OrderRef = {
  id: string;
  title: string;
  customer: string | null;
  column?: string;
  days?: number;
  dueDate?: string | null;
  late?: boolean;
};

export type ColumnInsight = {
  id: string;
  name: string;
  group: InsightsGroup;
  open: number;
  late: number;
  avgDaysHere: number | null;
  oldestDays: number | null;
  inCount: number;
  outCount: number;
  net: number;
  /** Average days a job spent here before moving on (period). */
  avgDaysToLeave: number | null;
  prevInCount: number;
  prevOutCount: number;
};

export type Bottleneck = {
  columnId: string;
  name: string;
  group: InsightsGroup;
  score: number;
  open: number;
  avgDaysHere: number | null;
  net: number;
  outPerDay: number;
  /** Jobs/day that must leave to clear the pile in 5 working days. */
  targetOutPerDay: number;
  why: string;
  fix: string;
  orders: OrderRef[];
};

export type DesignerInsight = {
  id: string;
  name: string;
  /** Start / In Progress — the designer's queue (same rule as auto-assign). */
  toDesign: number;
  /** Other design-stage columns (Hold, …). */
  onHold: number;
  waitingClient: number;
  inProduction: number;
  skus: number;
  late: number;
  oldestDays: number | null;
  approvals: number;
  rejections: number;
  rejectionRate: number | null;
};

export type StageInsight = {
  key: "to_proof" | "to_approval" | "to_ready" | "total";
  label: string;
  medianDays: number | null;
  prevMedianDays: number | null;
  count: number;
};

export type ClientInsight = {
  customerId: string;
  name: string;
  rejections: number;
  missingInfo: number;
  orders: OrderRef[];
};

export type ActionItem = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  /** Expected result when the steps are done. */
  result: string;
  /** Exact steps, in order. */
  steps: string[];
  orders: OrderRef[];
};

/** One column's flow: jobs in vs out per working day, and how long jobs wait there. */
export type FlowRow = {
  id: string;
  name: string;
  group: InsightsGroup;
  open: number;
  late: number;
  inPerDay: number;
  outPerDay: number;
  /** inPerDay − outPerDay; positive = the pile grows. */
  netPerDay: number;
  avgDaysWaiting: number | null;
};

export type TrendPoint = { label: string; created: number; completed: number; rejected: number };

export type BoardInsights = {
  days: number;
  generatedAt: string;
  kpis: {
    open: number;
    late: number;
    created: Trend;
    completed: Trend;
    leadDays: Trend;
    rejectionRate: Trend;
    missingInfoRate: Trend;
    approvalsPerDay: Trend;
  };
  trend: TrendPoint[];
  columns: ColumnInsight[];
  bottlenecks: Bottleneck[];
  designers: DesignerInsight[];
  stuckProduction: OrderRef[];
  stages: StageInsight[];
  quality: {
    missingInfo: {
      orders: number;
      newOrders: number;
      rate: number | null;
      prevRate: number | null;
      unanswered: number;
      avgResponseHours: number | null;
    };
    rejections: {
      rejected: number;
      approved: number;
      rate: number | null;
      prevRate: number | null;
      multiRejectJobs: (OrderRef & { count: number })[];
    };
    clients: ClientInsight[];
    waitingApproval: OrderRef[];
  };
  actions: ActionItem[];
  focus: Focus;
  popup: PopupSummary;
};

export type FocusStatus = "red" | "amber" | "green";

/** Compact numbers for the Board health popup. */
export type PopupSummary = {
  /** Design-queue jobs (Start / In Progress) with no designer. */
  unassigned: number;
  designers: { id: string; name: string; orders: number; skus: number; qty: number }[];
  missingToday: number;
  missingTotal: number;
  approvalToday: number;
  approvalTotal: number;
  /** In Production + Finishing / Converting only. */
  floorOpen: number;
  floorLate: number;
  createdToday: number;
  createdPerDay: {
    label: string;
    /** YYYY-MM-DD (shop day). */
    date: string;
    count: number;
    qty: number;
    /** Where those jobs are now (current column), biggest first. */
    where: { name: string; count: number }[];
  }[];
  /** Jobs created: today vs yesterday by this time, last 7 days vs the 7 before, last 30 vs the 30 before. */
  createdChange: {
    day: { cur: number; prev: number };
    week: { cur: number; prev: number };
    month: { cur: number; prev: number };
  };
};

export type DesignerCapacity = {
  id: string;
  name: string;
  /** Jobs in Start / In Progress. */
  queue: number;
  onHold: number;
  /** Proofs sent per working day (this period). */
  perDay: number | null;
  /** queue ÷ perDay × 100 — 100% = one full day of work waiting. */
  loadPct: number | null;
  /** Average timed design minutes per job (design timer), this period. */
  avgMinutes: number | null;
  /** SKUs in the jobs this designer sent proofs for, this period. */
  skus: number;
  /** Same three numbers for the previous period (growth vs decline). */
  prevPerDay: number | null;
  prevAvgMinutes: number | null;
  prevSkus: number;
};

/** The three areas the production manager watches: design, waiting on the client, production. */
export type Focus = {
  /** One short paragraph: where the bottleneck is. */
  summary: string;
  worst: "design" | "client" | "production" | null;
  design: {
    status: FocusStatus;
    note: string;
    queue: number;
    onHold: number;
    holdOldestDays: number | null;
    /** New jobs coming in per working day (this period / previous). */
    incomingPerDay: number | null;
    prevIncomingPerDay: number | null;
    queueOldestDays: number | null;
    late: number;
    perDay: number | null;
    prevPerDay: number | null;
    skus: number;
    prevSkus: number;
    avgMinutes: number | null;
    prevAvgMinutes: number | null;
    /** Per day (per week for long periods): new jobs coming in vs designs done. */
    loadTrend: { label: string; incoming: number; done: number }[];
    loadPct: number | null;
    daysToProof: number | null;
    prevDaysToProof: number | null;
    designers: DesignerCapacity[];
    oldest: OrderRef[];
  };
  client: {
    status: FocusStatus;
    note: string;
    missingNow: number;
    missingRate: number | null;
    prevMissingRate: number | null;
    missingOldest: OrderRef[];
    approvalNow: number;
    approvalOver2Days: number;
    approvalOldest: OrderRef[];
    hoursToApprove: number | null;
    /** Missing info: % of requests the client answered, and average hours to reply. */
    missingAnsweredPct: number | null;
    prevMissingAnsweredPct: number | null;
    missingReplyHours: number | null;
    prevMissingReplyHours: number | null;
    /** % of new orders that got a proof (went to Waiting Approval). */
    approvalReachPct: number | null;
    prevApprovalReachPct: number | null;
    /** approved ÷ (approved + rejected). */
    approvalRatePct: number | null;
    prevApprovalRatePct: number | null;
    rejectionRatePct: number | null;
    prevRejectionRatePct: number | null;
    /** Average hours from proof sent to the client's answer (approve or reject). */
    approvalHours: number | null;
    prevApprovalHours: number | null;
    /** Average proofs needed until approval (1 = approved first time). */
    avgRounds: number | null;
    prevAvgRounds: number | null;
    /** Jobs rejected 2+ times (period). */
    multiRejectCount: number;
  };
  /** Design → production columns (Hold excluded): in/out per day and waiting time. */
  flow: FlowRow[];
  /** Columns where clearly more comes in than goes out, worst first. */
  growing: string[];
  /** Column where jobs wait the longest. */
  longestWait: string | null;
  production: {
    status: FocusStatus;
    note: string;
    openNow: number;
    late: number;
    daysInProduction: number | null;
    prevDaysInProduction: number | null;
    slowest: { name: string; open: number; avgDays: number | null; late: number }[];
    oldest: OrderRef[];
    /** Jobs that left production (first move into Ready to Ship or later), per day (per week for 90 days). */
    leftPerBucket: { label: string; count: number }[];
    bucketDays: number;
    /** Average jobs leaving production per working day, this period and the one before. */
    leftPerDay: number | null;
    prevLeftPerDay: number | null;
    /** Jobs leaving production: today, last 7 days, last 30 days — each vs the window before it. */
    progress: ProductionProgress[];
  };
};

export type ProductionProgress = {
  key: "day" | "week" | "month";
  label: string;
  cur: number;
  prev: number;
  /** What `prev` is, e.g. "Mon by this time", "previous 7 days". */
  prevLabel: string;
};

const DAY_MS = 86_400_000;

function fmtAge(days: number): string {
  return days < 1 ? `${Math.max(1, Math.round(days * 24))} hours` : `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`;
}

function listAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function round1(n: number | null): number | null {
  return n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Jobs leaving production (first move into Ready to Ship or later) for three windows:
 * - day: today so far vs the previous working day up to the same time of day (fair early in the morning);
 * - week: last 7 days vs the 7 days before;
 * - month: last 30 days vs the 30 days before.
 */
export function productionProgress(
  moves: { order_id: string; created_at: string; from?: string | null; to?: string | null }[],
  shipCols: Set<string>,
  nowMs: number,
  todayStartMs: number
): ProductionProgress[] {
  const firstExit = new Map<string, number>();
  for (const m of moves) {
    if (!m.to || !shipCols.has(m.to) || (m.from && shipCols.has(m.from))) continue;
    const t = new Date(m.created_at).getTime();
    const had = firstExit.get(m.order_id);
    if (had == null || t < had) firstExit.set(m.order_id, t);
  }
  const times = [...firstExit.values()];
  const count = (from: number, to: number) => times.filter((t) => t >= from && t < to).length;

  // Shop-local weekday of a shop-midnight timestamp (noon of that day in UTC terms is safe for ±12h zones).
  const weekday = (dayStart: number) => new Date(dayStart + 12 * 3_600_000).getUTCDay();
  let prevDay = todayStartMs - 86_400_000;
  while (weekday(prevDay) === 0 || weekday(prevDay) === 6) prevDay -= 86_400_000;
  const elapsed = Math.max(0, nowMs - todayStartMs);

  const end = nowMs + 1;
  return [
    {
      key: "day",
      label: "Today",
      cur: count(todayStartMs, end),
      prev: count(prevDay, prevDay + elapsed),
      prevLabel: `${WEEKDAY_SHORT[weekday(prevDay)]} by this time`,
    },
    {
      key: "week",
      label: "Week",
      cur: count(nowMs - 7 * 86_400_000, end),
      prev: count(nowMs - 14 * 86_400_000, nowMs - 7 * 86_400_000),
      prevLabel: "last 7 days vs the 7 before",
    },
    {
      key: "month",
      label: "Month",
      cur: count(nowMs - 30 * 86_400_000, end),
      prev: count(nowMs - 60 * 86_400_000, nowMs - 30 * 86_400_000),
      prevLabel: "last 30 days vs the 30 before",
    },
  ];
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

function norm(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Stage group for each column, by board order: everything up to Waiting
 * Approval is design (missing info / approval = waiting on the client),
 * then production until Ready to Ship, then shipping, then Finished.
 */
export function groupColumns(columns: InsightsColumn[]): Map<string, InsightsGroup> {
  const sorted = [...columns].sort((a, b) => a.position - b.position);
  const approvalPos =
    sorted.find((c) => c.kind === "approval" || norm(c.name).includes("waiting approval"))?.position ??
    -Infinity;
  const shipPos =
    sorted.find((c) => c.kind === "ready_to_ship" || norm(c.name).includes("ready to ship"))?.position ??
    Infinity;
  const out = new Map<string, InsightsGroup>();
  for (const c of sorted) {
    const n = norm(c.name);
    let g: InsightsGroup;
    if (n.startsWith("finished")) g = "finished";
    else if (c.position >= shipPos || n.includes("shipped customer")) g = "shipping";
    else if (c.position > approvalPos) g = "production";
    else if (
      c.kind === "approval" ||
      c.kind === "exception" ||
      n.includes("missing info") ||
      n.includes("customer replied") ||
      n.includes("waiting approval")
    )
      g = "client";
    else g = "design";
    out.set(c.id, g);
  }
  return out;
}

function daysBetween(fromIso: string | null | undefined, nowMs: number): number | null {
  if (!fromIso) return null;
  const t = new Date(fromIso).getTime();
  return Number.isNaN(t) ? null : Math.max(0, (nowMs - t) / DAY_MS);
}

function trend(value: number | null, prev: number | null): Trend {
  return { value: round1(value), prev: round1(prev) };
}

export function buildBoardInsights(input: InsightsInput): BoardInsights {
  const nowMs = input.now.getTime();
  const days = Math.max(1, Math.round(input.days));
  const start = nowMs - days * DAY_MS;
  const prevStart = start - days * DAY_MS;
  const inCur = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= start && t <= nowMs;
  };
  const inPrev = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= prevStart && t < start;
  };

  const groups = groupColumns(input.columns);
  const colById = new Map(input.columns.map((c) => [c.id, c]));
  const colName = (id: string | null | undefined) => (id ? colById.get(id)?.name ?? "?" : "?");
  const customerName = (id: string | null) => (id ? input.customers.get(id) ?? null : null);

  const active = input.openOrders.filter((o) => {
    const g = groups.get(o.column_id);
    return g && g !== "finished";
  });
  const isLate = (o: InsightsOpenOrder) => {
    const g = groups.get(o.column_id);
    return (g === "design" || g === "client" || g === "production") && o.days_to_due != null && o.days_to_due < 0;
  };
  const ref = (o: InsightsOpenOrder): OrderRef => ({
    id: o.id,
    title: o.title,
    customer: customerName(o.customer_id),
    column: colName(o.column_id),
    days: round1(daysBetween(o.last_moved_at ?? o.created_at, nowMs)) ?? 0,
    dueDate: o.due_date,
    late: isLate(o),
  });

  // ---- moves per order (sorted) → column flow and time-in-column
  // Same move can be logged twice (e.g. "moved" + "customer_replied"): keep one per minute.
  const seenMove = new Map<string, number>();
  const moves = input.events
    .filter((e) => e.action === "moved" && (e.from || e.to))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .filter((e) => {
      const key = `${e.order_id}|${e.from ?? ""}|${e.to ?? ""}`;
      const t = new Date(e.created_at).getTime();
      const last = seenMove.get(key);
      seenMove.set(key, t);
      return last == null || t - last > 60_000;
    });
  const movesByOrder = new Map<string, InsightsEvent[]>();
  for (const m of moves) {
    const list = movesByOrder.get(m.order_id) ?? [];
    list.push(m);
    movesByOrder.set(m.order_id, list);
  }

  type Flow = { in: number; out: number; pin: number; pout: number; stays: number[] };
  const flow = new Map<string, Flow>();
  const f = (id: string) => {
    let x = flow.get(id);
    if (!x) flow.set(id, (x = { in: 0, out: 0, pin: 0, pout: 0, stays: [] }));
    return x;
  };
  for (const m of moves) {
    const cur = inCur(m.created_at);
    const prev = inPrev(m.created_at);
    if (m.to) {
      if (cur) f(m.to).in++;
      else if (prev) f(m.to).pin++;
    }
    if (m.from) {
      if (cur) f(m.from).out++;
      else if (prev) f(m.from).pout++;
    }
  }
  // New jobs arrive by being created, not moved: count them as "in" to their first column.
  const openColumnOf = new Map(input.openOrders.map((o) => [o.id, o.column_id]));
  for (const o of input.newOrders) {
    const first = movesByOrder.get(o.id)?.[0];
    const col = first?.from ?? openColumnOf.get(o.id);
    if (!col) continue;
    if (inCur(o.created_at)) f(col).in++;
    else if (inPrev(o.created_at)) f(col).pin++;
  }
  for (const [orderId, list] of movesByOrder) {
    for (let i = 0; i < list.length; i++) {
      const m = list[i]!;
      if (!m.from || !inCur(m.created_at)) continue;
      // When did it enter `from`? The previous move into it, else the order's creation.
      let enteredIso: string | null = null;
      for (let j = i - 1; j >= 0; j--) {
        if (list[j]!.to === m.from) {
          enteredIso = list[j]!.created_at;
          break;
        }
      }
      if (!enteredIso && i === 0) enteredIso = input.orderMeta.get(orderId)?.created_at ?? null;
      if (!enteredIso) continue;
      const d = (new Date(m.created_at).getTime() - new Date(enteredIso).getTime()) / DAY_MS;
      if (d >= 0) f(m.from).stays.push(d);
    }
  }

  // ---- columns
  const columns: ColumnInsight[] = [...input.columns]
    .sort((a, b) => a.position - b.position)
    .filter((c) => groups.get(c.id) !== "finished")
    .map((c) => {
      const here = active.filter((o) => o.column_id === c.id);
      const ages = here
        .map((o) => daysBetween(o.last_moved_at ?? o.created_at, nowMs))
        .filter((n): n is number => n != null);
      const fl = flow.get(c.id) ?? { in: 0, out: 0, pin: 0, pout: 0, stays: [] };
      return {
        id: c.id,
        name: c.name.trim(),
        group: groups.get(c.id)!,
        open: here.length,
        late: here.filter(isLate).length,
        avgDaysHere: round1(avg(ages)),
        oldestDays: round1(ages.length ? Math.max(...ages) : null),
        inCount: fl.in,
        outCount: fl.out,
        net: fl.in - fl.out,
        avgDaysToLeave: round1(avg(fl.stays)),
        prevInCount: fl.pin,
        prevOutCount: fl.pout,
      };
    });

  // ---- waiting approval list
  const approvalCols = new Set(
    input.columns
      .filter((c) => c.kind === "approval" || norm(c.name).includes("waiting approval"))
      .map((c) => c.id)
  );
  const waitingApproval = active
    .filter((o) => approvalCols.has(o.column_id))
    .map(ref)
    .filter((r) => (r.days ?? 0) >= 2)
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));

  // ---- quality: rejections / approvals
  const approvedCur = input.events.filter((e) => e.action === "approved" && inCur(e.created_at));
  const approvedPrev = input.events.filter((e) => e.action === "approved" && inPrev(e.created_at));
  const rejectedCur = input.events.filter((e) => e.action === "rejected" && inCur(e.created_at));
  const rejectedPrev = input.events.filter((e) => e.action === "rejected" && inPrev(e.created_at));
  const rejectRate = pct(rejectedCur.length, rejectedCur.length + approvedCur.length);
  const prevRejectRate = pct(rejectedPrev.length, rejectedPrev.length + approvedPrev.length);

  const openById = new Map(input.openOrders.map((o) => [o.id, o]));
  const metaRef = (orderId: string): OrderRef => {
    const open = openById.get(orderId);
    if (open) return ref(open);
    const m = input.orderMeta.get(orderId);
    return { id: orderId, title: m?.title ?? "?", customer: customerName(m?.customer_id ?? null) };
  };

  const rejectsByOrder = new Map<string, number>();
  for (const e of input.events) {
    if (e.action === "rejected") rejectsByOrder.set(e.order_id, (rejectsByOrder.get(e.order_id) ?? 0) + 1);
  }
  const rejectedNow = new Set(rejectedCur.map((e) => e.order_id));
  const multiRejectJobs = [...rejectsByOrder]
    .filter(([id, n]) => n >= 2 && rejectedNow.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([id, n]) => ({ ...metaRef(id), count: n }));

  // ---- quality: missing info
  const miNotes = input.notifications.filter((n) => n.type === "missing_info");
  const miOrders = new Set(miNotes.map((n) => n.order_id));
  const newCur = input.newOrders.filter((o) => inCur(o.created_at));
  const newPrev = input.newOrders.filter((o) => inPrev(o.created_at));
  const miCur = newCur.filter((o) => miOrders.has(o.id)).length;
  const miPrev = newPrev.filter((o) => miOrders.has(o.id)).length;
  const miCurNotes = miNotes.filter((n) => inCur(n.created_at));
  const responseHours = miCurNotes
    .filter((n) => n.responded_at)
    .map((n) => (new Date(n.responded_at!).getTime() - new Date(n.created_at).getTime()) / 3_600_000)
    .filter((h) => h >= 0);
  const unanswered = miCurNotes.filter((n) => n.status === "sent" || n.status === "pending").length;

  // ---- clients with repeat problems (current period)
  const clientAgg = new Map<string, { rej: number; mi: number; orders: Set<string> }>();
  const bump = (orderId: string, key: "rej" | "mi") => {
    const cid = input.orderMeta.get(orderId)?.customer_id ?? openById.get(orderId)?.customer_id;
    if (!cid) return;
    const a = clientAgg.get(cid) ?? { rej: 0, mi: 0, orders: new Set<string>() };
    a[key]++;
    a.orders.add(orderId);
    clientAgg.set(cid, a);
  };
  for (const e of rejectedCur) bump(e.order_id, "rej");
  for (const n of miCurNotes) bump(n.order_id, "mi");
  const clients: ClientInsight[] = [...clientAgg]
    .filter(([, a]) => a.rej >= 2 || a.rej + a.mi >= 3)
    .sort((a, b) => b[1].rej * 2 + b[1].mi - (a[1].rej * 2 + a[1].mi))
    .slice(0, 12)
    .map(([cid, a]) => ({
      customerId: cid,
      name: input.customers.get(cid) ?? "Unknown client",
      rejections: a.rej,
      missingInfo: a.mi,
      orders: [...a.orders].slice(0, 6).map(metaRef),
    }));

  // ---- designers
  const isQueueCol = (id: string) => {
    const n = norm(colById.get(id)?.name ?? "");
    return n === "start" || n.startsWith("start ") || n === "in progress";
  };
  const designerIdOf = (orderId: string) =>
    openById.get(orderId)?.designer_id ?? input.orderMeta.get(orderId)?.designer_id ?? null;
  const designers: DesignerInsight[] = input.designers
    .map((d) => {
      const mine = active.filter((o) => o.designer_id === d.id);
      const design = mine.filter((o) => isQueueCol(o.column_id));
      const ages = design
        .map((o) => daysBetween(o.last_moved_at ?? o.created_at, nowMs))
        .filter((n): n is number => n != null);
      const appr = approvedCur.filter((e) => designerIdOf(e.order_id) === d.id).length;
      const rej = rejectedCur.filter((e) => designerIdOf(e.order_id) === d.id).length;
      return {
        id: d.id,
        name: d.name,
        toDesign: design.length,
        onHold: mine.filter((o) => groups.get(o.column_id) === "design" && !isQueueCol(o.column_id)).length,
        waitingClient: mine.filter((o) => groups.get(o.column_id) === "client").length,
        inProduction: mine.filter((o) => groups.get(o.column_id) === "production").length,
        skus: design.reduce((n, o) => n + Math.max(1, o.sku_count), 0),
        late: mine.filter(isLate).length,
        oldestDays: round1(ages.length ? Math.max(...ages) : null),
        approvals: appr,
        rejections: rej,
        rejectionRate: pct(rej, appr + rej),
      };
    })
    .sort((a, b) => b.toDesign + b.waitingClient - (a.toDesign + a.waitingClient));

  // ---- stuck in production
  const stuckProduction = active
    .filter((o) => groups.get(o.column_id) === "production")
    .map(ref)
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
    .slice(0, 12);

  // ---- stage times (median days), by completion date of the stage
  const eventsByOrder = new Map<string, InsightsEvent[]>();
  for (const e of [...input.events].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const list = eventsByOrder.get(e.order_id) ?? [];
    list.push(e);
    eventsByOrder.set(e.order_id, list);
  }
  const firstEvent = (orderId: string, pred: (e: InsightsEvent) => boolean) =>
    (eventsByOrder.get(orderId) ?? []).find(pred) ?? null;
  const shipGroupCols = new Set([...groups].filter(([, g]) => g === "shipping" || g === "finished").map(([id]) => id));
  const stageSamples = {
    to_proof: { cur: [] as number[], prev: [] as number[] },
    to_approval: { cur: [] as number[], prev: [] as number[] },
    to_ready: { cur: [] as number[], prev: [] as number[] },
    total: { cur: [] as number[], prev: [] as number[] },
  };
  const completedCur = new Set<string>();
  const completedPrev = new Set<string>();
  const completedAt = new Map<string, string>();
  for (const orderId of eventsByOrder.keys()) {
    const meta = input.orderMeta.get(orderId);
    const proof =
      firstEvent(orderId, (e) => e.action === "approval_queued") ??
      firstEvent(orderId, (e) => e.action === "moved" && !!e.to && approvalCols.has(e.to));
    const approved = firstEvent(orderId, (e) => e.action === "approved");
    const ready = firstEvent(
      orderId,
      (e) => e.action === "moved" && !!e.to && shipGroupCols.has(e.to) && !(e.from && shipGroupCols.has(e.from))
    );
    const push = (key: keyof typeof stageSamples, fromIso: string | null | undefined, to: InsightsEvent | null) => {
      if (!fromIso || !to) return;
      const d = (new Date(to.created_at).getTime() - new Date(fromIso).getTime()) / DAY_MS;
      if (d < 0) return;
      if (inCur(to.created_at)) stageSamples[key].cur.push(d);
      else if (inPrev(to.created_at)) stageSamples[key].prev.push(d);
    };
    push("to_proof", meta?.created_at, proof);
    push("to_approval", proof?.created_at, approved);
    push("to_ready", approved?.created_at, ready);
    push("total", meta?.created_at, ready);
    if (ready) {
      completedAt.set(orderId, ready.created_at);
      if (inCur(ready.created_at)) completedCur.add(orderId);
      else if (inPrev(ready.created_at)) completedPrev.add(orderId);
    }
  }
  const stageLabels: Record<StageInsight["key"], string> = {
    to_proof: "Order → proof sent",
    to_approval: "Proof sent → approved",
    to_ready: "Approved → ready to ship",
    total: "Order → ready to ship",
  };
  const stages: StageInsight[] = (Object.keys(stageSamples) as StageInsight["key"][]).map((key) => ({
    key,
    label: stageLabels[key],
    medianDays: round1(median(stageSamples[key].cur)),
    prevMedianDays: round1(median(stageSamples[key].prev)),
    count: stageSamples[key].cur.length,
  }));

  // ---- daily / weekly trend
  const bucketDays = days > 31 ? 7 : 1;
  const nBuckets = Math.ceil(days / bucketDays);
  const trendPts: TrendPoint[] = Array.from({ length: nBuckets }, (_, i) => {
    const bStart = start + i * bucketDays * DAY_MS;
    const d = new Date(bStart);
    return {
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      created: 0,
      completed: 0,
      rejected: 0,
    };
  });
  const bucketOf = (iso: string) => {
    const t = new Date(iso).getTime();
    if (t < start || t > nowMs) return -1;
    return Math.min(nBuckets - 1, Math.floor((t - start) / (bucketDays * DAY_MS)));
  };
  for (const o of newCur) {
    const b = bucketOf(o.created_at);
    if (b >= 0) trendPts[b]!.created++;
  }
  for (const id of completedCur) {
    const b = bucketOf(completedAt.get(id)!);
    if (b >= 0) trendPts[b]!.completed++;
  }
  for (const e of rejectedCur) {
    const b = bucketOf(e.created_at);
    if (b >= 0) trendPts[b]!.rejected++;
  }

  // ---- bottlenecks: big pile × long stay, boosted when the pile is growing
  const workingDaysInPeriod = Math.max(1, Math.round((days * 5) / 7));
  const bottlenecks: Bottleneck[] = columns
    // Boyd (outside partner) columns are left out, same as the Board health score.
    .filter(
      (c) =>
        (c.group === "design" || c.group === "client" || c.group === "production") &&
        c.open > 0 &&
        !/\bboyd\b/.test(norm(c.name))
    )
    .map((c) => {
      // Activity logs miss some automatic moves, so flow only boosts the score when clearly unbalanced.
      const growth = c.inCount > c.outCount * 1.2 ? 1.5 : 1;
      const score = Math.round(c.open * Math.max(0.5, c.avgDaysHere ?? 0) * growth);
      const outPerDay = round1(c.outCount / workingDaysInPeriod) ?? 0;
      const inPerDay = c.inCount / workingDaysInPeriod;
      const targetOutPerDay = round1(inPerDay + c.open / 5) ?? 0;
      const here = active.filter((o) => o.column_id === c.id).map(ref).sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
      const n = norm(c.name);
      const why =
        `${c.open} jobs, avg ${c.avgDaysHere ?? "?"} days here` +
        (c.inCount + c.outCount > 0 ? `; ${c.inCount} came in, ${c.outCount} left this period` : "") +
        (c.late ? `, ${c.late} late` : "");
      let fix: string;
      if (n.includes("hold"))
        fix = `Review the ${Math.min(here.length, 10)} oldest held jobs: release, cancel or archive each one.`;
      else if (n.includes("missing info"))
        fix = "Call or text clients who have not answered in 2+ days; cancel requests nobody will answer.";
      else if (n.includes("waiting approval"))
        fix = "Resend proof reminders for jobs waiting 2+ days, then phone the oldest ones.";
      else if (c.group === "design")
        fix = "Move jobs from the busiest designer to the least busy one and work oldest first.";
      else
        fix = `Move ${targetOutPerDay}/day out of this column (now ${outPerDay}/day) to clear it in a week.`;
      return {
        columnId: c.id,
        name: c.name,
        group: c.group,
        score,
        open: c.open,
        avgDaysHere: c.avgDaysHere,
        net: c.net,
        outPerDay,
        targetOutPerDay,
        why,
        fix,
        orders: here.slice(0, 8),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // ---- KPIs
  const lateOpen = active.filter(isLate);
  const totalStage = stages.find((s) => s.key === "total")!;
  const kpis = {
    open: active.filter((o) => groups.get(o.column_id) !== "shipping").length,
    late: lateOpen.length,
    created: trend(newCur.length, newPrev.length),
    completed: trend(completedCur.size, completedPrev.size),
    leadDays: trend(totalStage.medianDays, totalStage.prevMedianDays),
    rejectionRate: trend(rejectRate, prevRejectRate),
    missingInfoRate: trend(pct(miCur, newCur.length), pct(miPrev, newPrev.length)),
    approvalsPerDay: trend(approvedCur.length / workingDaysInPeriod, approvedPrev.length / workingDaysInPeriod),
  };

  // ---- focus: design / waiting on client / production
  const proofsBy = new Map<string, Set<string>>();
  const prevProofsBy = new Map<string, Set<string>>();
  for (const e of input.events) {
    if (e.action !== "approval_queued" || !e.actor) continue;
    const target = inCur(e.created_at) ? proofsBy : inPrev(e.created_at) ? prevProofsBy : null;
    if (!target) continue;
    const set = target.get(e.actor) ?? new Set<string>();
    set.add(e.order_id);
    target.set(e.actor, set);
  }
  const perDayOf = (m: Map<string, Set<string>>, id: string) => (m.get(id)?.size ?? 0) / workingDaysInPeriod;
  const capPool = input.designerPool?.length ? new Set(input.designerPool) : null;
  // Design timer: total minutes per (designer, job), averaged per designer.
  const timed = new Map<string, Map<string, number>>();
  const prevTimed = new Map<string, Map<string, number>>();
  for (const t of input.timeEntries ?? []) {
    if (!t.order_id || !(t.seconds > 0)) continue;
    const target = inCur(t.started_at) ? timed : inPrev(t.started_at) ? prevTimed : null;
    if (!target) continue;
    const m = target.get(t.user_id) ?? new Map<string, number>();
    m.set(t.order_id, (m.get(t.order_id) ?? 0) + t.seconds);
    target.set(t.user_id, m);
  }
  const avgMin = (src: Map<string, Map<string, number>>, ids: string[]) => {
    const per = ids.flatMap((id) => [...(src.get(id)?.values() ?? [])]);
    return per.length ? Math.round(per.reduce((a, b) => a + b, 0) / per.length / 60) : null;
  };
  const skuOf = (orderId: string) =>
    Math.max(1, openById.get(orderId)?.sku_count ?? input.orderMeta.get(orderId)?.sku_count ?? 1);
  const designerCaps: DesignerCapacity[] = designers
    .filter((d) => !capPool || capPool.has(d.id) || d.toDesign + d.onHold > 0)
    .map((d) => {
      const pd = perDayOf(proofsBy, d.id);
      return {
        id: d.id,
        name: d.name,
        queue: d.toDesign,
        onHold: d.onHold,
        perDay: pd > 0 ? round1(pd) : null,
        loadPct: pd > 0 ? Math.round((d.toDesign / pd) * 100) : d.toDesign > 0 ? null : 0,
        avgMinutes: avgMin(timed, [d.id]),
        skus: [...(proofsBy.get(d.id) ?? [])].reduce((n, id) => n + skuOf(id), 0),
        prevPerDay: perDayOf(prevProofsBy, d.id) > 0 ? round1(perDayOf(prevProofsBy, d.id)) : null,
        prevAvgMinutes: avgMin(prevTimed, [d.id]),
        prevSkus: [...(prevProofsBy.get(d.id) ?? [])].reduce((n, id) => n + skuOf(id), 0),
      };
    });
  const teamPerDay = designerCaps.reduce((n, d) => n + (d.perDay ?? 0), 0);
  const teamPrevPerDay = designerCaps.reduce((n, d) => n + perDayOf(prevProofsBy, d.id), 0);
  const designQueue = active.filter((o) => isQueueCol(o.column_id)).length;
  const holdOrders = active.filter((o) => groups.get(o.column_id) === "design" && !isQueueCol(o.column_id));
  const holdRefs = holdOrders.map(ref).sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
  const designLoad = teamPerDay > 0 ? Math.round((designQueue / teamPerDay) * 100) : null;
  const toProof = stages.find((s) => s.key === "to_proof")!;
  const holdOldest = holdRefs[0]?.days ?? null;
  // Hold is ignored here: design health = designer speed vs jobs coming in.
  const incomingPerDay = newCur.length / workingDaysInPeriod;
  const queueAges = active
    .filter((o) => isQueueCol(o.column_id))
    .map((o) => daysBetween(o.last_moved_at ?? o.created_at, nowMs) ?? 0);
  const queueOldest = queueAges.length ? Math.max(...queueAges) : 0;
  const designLate = active.filter((o) => isQueueCol(o.column_id) && isLate(o)).length;
  const designStatus: FocusStatus =
    (teamPerDay > 0 && incomingPerDay > teamPerDay * 1.2) || (designLoad ?? 0) >= 200 || queueOldest >= 3
      ? "red"
      : (teamPerDay > 0 && incomingPerDay > teamPerDay) || (designLoad ?? 0) >= 100 || designLate > 0
        ? "amber"
        : "green";
  const designNote =
    (teamPerDay > 0
      ? `Designers finish about ${round1(teamPerDay)} jobs a day while about ${round1(incomingPerDay)} new jobs come in a day${
          incomingPerDay > teamPerDay ? " — more comes in than they finish" : " — they are keeping up"
        }. `
      : "") +
    `${designQueue} job${designQueue === 1 ? "" : "s"} wait${designQueue === 1 ? "s" : ""} to be designed` +
    (queueAges.length ? `, the oldest for ${fmtAge(queueOldest)}` : "") +
    (designLate ? `; ${designLate} already late.` : ".");

  const missingCols = new Set(
    input.columns.filter((c) => c.kind === "exception" || norm(c.name).includes("missing info")).map((c) => c.id)
  );
  const missingRefs = active
    .filter((o) => missingCols.has(o.column_id))
    .map(ref)
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
  const approvalRefs = active
    .filter((o) => approvalCols.has(o.column_id))
    .map(ref)
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
  const over2 = approvalRefs.filter((r) => (r.days ?? 0) >= 2).length;
  const toApproval = stages.find((s) => s.key === "to_approval")!;
  const missingRate = pct(miCur, newCur.length);
  // Missing info: answered % and reply time, per period. Answered = the client
  // replied through the link, or the card left Missing Info afterwards (SMS/email replies).
  const missingColIds = new Set(
    input.columns.filter((c) => c.kind === "exception" || norm(c.name).includes("missing info")).map((c) => c.id)
  );
  const replyAt = (n: InsightsNotification): number | null => {
    const sent = new Date(n.created_at).getTime();
    const viaLink = n.responded_at ? new Date(n.responded_at).getTime() : null;
    const left = (movesByOrder.get(n.order_id) ?? []).find(
      (m) => !!m.from && missingColIds.has(m.from) && new Date(m.created_at).getTime() >= sent
    );
    const viaMove = left ? new Date(left.created_at).getTime() : null;
    const t = [viaLink, viaMove].filter((x): x is number => x != null);
    return t.length ? Math.min(...t) : null;
  };
  const miIn = (inP: (iso: string) => boolean) => miNotes.filter((n) => inP(n.created_at));
  const answeredPct = (list: InsightsNotification[]) => pct(list.filter((n) => replyAt(n) != null).length, list.length);
  const replyHours = (list: InsightsNotification[]) =>
    round1(
      avg(
        list
          .map((n) => {
            const t = replyAt(n);
            return t == null ? -1 : (t - new Date(n.created_at).getTime()) / 3_600_000;
          })
          .filter((h) => h >= 0)
      )
    );
  // Orders that reached Waiting Approval (got a proof), by creation period.
  const proofOrders = new Set(
    input.events
      .filter((e) => e.action === "approval_queued" || (e.action === "moved" && !!e.to && approvalCols.has(e.to)))
      .map((e) => e.order_id)
  );
  const reach = (list: { id: string }[]) => pct(list.filter((o) => proofOrders.has(o.id)).length, list.length);
  // Proof → client answer: time from the latest proof sent before each decision.
  const decisionHours = (inP: (iso: string) => boolean) => {
    const out: number[] = [];
    for (const [orderId, list] of eventsByOrder) {
      let lastProof: number | null = null;
      for (const e of list) {
        if (e.action === "approval_queued") lastProof = new Date(e.created_at).getTime();
        else if ((e.action === "approved" || e.action === "rejected") && lastProof != null && inP(e.created_at)) {
          const h = (new Date(e.created_at).getTime() - lastProof) / 3_600_000;
          if (h >= 0) out.push(h);
          lastProof = null;
        }
      }
      void orderId;
    }
    return round1(avg(out));
  };
  // Proof rounds until approval: 1 + rejections before the first approval.
  const rounds = (inP: (iso: string) => boolean) => {
    const out: number[] = [];
    for (const list of eventsByOrder.values()) {
      let rej = 0;
      for (const e of list) {
        if (e.action === "rejected") rej++;
        else if (e.action === "approved") {
          if (inP(e.created_at)) out.push(1 + rej);
          break;
        }
      }
    }
    return round1(avg(out));
  };
  const approvalRate = pct(approvedCur.length, approvedCur.length + rejectedCur.length);
  const prevApprovalRate = pct(approvedPrev.length, approvedPrev.length + rejectedPrev.length);

  const clientStatus: FocusStatus =
    over2 >= 5 || (missingRefs[0]?.days ?? 0) >= 7 ? "red" : over2 >= 1 || (missingRate ?? 0) >= 20 ? "amber" : "green";
  const clientNote =
    `${Math.round(missingRate ?? 0)}% of new orders needed missing information and clients answer in about ${Math.round(replyHours(miIn(inCur)) ?? 0)} hours. ` +
    `${Math.round(rejectRate ?? 0)}% of proofs are rejected; a job needs about ${rounds(inCur) ?? 1} proof rounds. ` +
    `${approvalRefs.length} proofs wait for approval` +
    (over2 ? `, ${over2} of them for 2+ days (oldest ${Math.round(approvalRefs[0]?.days ?? 0)} days).` : ".");

  const prodCols = columns.filter((c) => c.group === "production" && c.open > 0);
  const prodOpen = active.filter((o) => groups.get(o.column_id) === "production");
  const prodLate = prodOpen.filter(isLate).length;
  const toReady = stages.find((s) => s.key === "to_ready")!;
  const slowest = [...prodCols]
    .sort((a, b) => b.open * (b.avgDaysHere ?? 0) - a.open * (a.avgDaysHere ?? 0))
    .slice(0, 4)
    .map((c) => ({ name: c.name.trim(), open: c.open, avgDays: c.avgDaysHere, late: c.late }));
  const lateShare = prodOpen.length ? prodLate / prodOpen.length : 0;
  const prodStatus: FocusStatus = lateShare >= 0.3 ? "red" : lateShare >= 0.1 ? "amber" : "green";
  const prodNote =
    `${prodOpen.length} jobs are in production, ${prodLate} of them late. ` +
    (toReady.medianDays != null ? `After approval a job takes about ${toReady.medianDays} days to be ready to ship. ` : "") +
    (slowest[0] ? `Slowest: ${slowest[0].name} (${slowest[0].open} jobs, about ${Math.round(slowest[0].avgDays ?? 0)} days each).` : "");

  const rank: Record<FocusStatus, number> = { red: 2, amber: 1, green: 0 };
  const areas = [
    { key: "design" as const, status: designStatus, label: "design speed" },
    { key: "client" as const, status: clientStatus, label: "jobs waiting on clients" },
    { key: "production" as const, status: prodStatus, label: "late production" },
  ];
  const worstArea = [...areas].sort((a, b) => rank[b.status] - rank[a.status])[0]!;
  const reds = areas.filter((a) => a.status === "red");
  const summary =
    reds.length === 0 && worstArea.status === "green"
      ? "The board is moving well: no area is jammed."
      : `Bottleneck${reds.length > 1 ? "s" : ""}: ${listAnd((reds.length ? reds : [worstArea]).map((a) => a.label))}. ` +
        `${lateOpen.length} jobs are late overall. ` +
        (over2 ? `${over2} proofs wait 2+ days for the client. ` : "") +
        (prodLate ? `${prodLate} production jobs are past due.` : "");

  const isHoldCol = (id: string) => norm(colById.get(id)?.name ?? "") === "hold";
  const flowRows: FlowRow[] = columns
    .filter((c) => (c.group === "design" || c.group === "client" || c.group === "production") && !isHoldCol(c.id))
    .filter((c) => c.open > 0 || c.inCount + c.outCount > 0)
    .map((c) => {
      const inPerDay = round1(c.inCount / workingDaysInPeriod) ?? 0;
      const outPerDay = round1(c.outCount / workingDaysInPeriod) ?? 0;
      return {
        id: c.id,
        name: c.name.trim(),
        group: c.group,
        open: c.open,
        late: c.late,
        inPerDay,
        outPerDay,
        netPerDay: round1(inPerDay - outPerDay) ?? 0,
        avgDaysWaiting: c.avgDaysHere,
      };
    });
  const growing = flowRows
    // Real piles only: more in than out AND jobs actually wait there (a day or more). The design
    // queue (Start / In Progress) is covered by designer speed.
    .filter(
      (f) =>
        f.inPerDay > f.outPerDay * 1.1 &&
        f.inPerDay - f.outPerDay >= 0.3 &&
        f.open >= 3 &&
        (f.avgDaysWaiting ?? 0) >= 1 &&
        !isQueueCol(f.id)
    )
    .sort((a, b) => b.netPerDay - a.netPerDay)
    .map((f) => f.id);
  const longestWait =
    [...flowRows].filter((f) => f.open > 0).sort((a, b) => (b.avgDaysWaiting ?? 0) * b.open - (a.avgDaysWaiting ?? 0) * a.open)[0]?.id ??
    null;

  const focus: Focus = {
    summary: summary.trim(),
    worst: worstArea.status === "green" ? null : worstArea.key,
    design: {
      status: designStatus,
      note: designNote,
      queue: designQueue,
      onHold: holdOrders.length,
      holdOldestDays: holdOldest,
      incomingPerDay: round1(incomingPerDay),
      prevIncomingPerDay: round1(newPrev.length / workingDaysInPeriod),
      queueOldestDays: queueAges.length ? round1(queueOldest) : null,
      late: designLate,
      perDay: teamPerDay > 0 ? round1(teamPerDay) : null,
      prevPerDay: teamPrevPerDay > 0 ? round1(teamPrevPerDay) : null,
      skus: designerCaps.reduce((n, d) => n + d.skus, 0),
      prevSkus: designerCaps.reduce((n, d) => n + d.prevSkus, 0),
      avgMinutes: avgMin(timed, designerCaps.map((d) => d.id)),
      prevAvgMinutes: avgMin(prevTimed, designerCaps.map((d) => d.id)),
      loadTrend: (() => {
        const pts = trendPts.map((t) => ({ label: t.label, incoming: t.created, done: 0 }));
        const seen = new Set<string>();
        for (const e of input.events) {
          if (e.action !== "approval_queued" || !inCur(e.created_at) || seen.has(e.order_id)) continue;
          seen.add(e.order_id);
          const b = bucketOf(e.created_at);
          if (b >= 0) pts[b]!.done++;
        }
        return pts;
      })(),
      loadPct: designLoad,
      daysToProof: toProof.medianDays,
      prevDaysToProof: toProof.prevMedianDays,
      designers: designerCaps,
      oldest: holdRefs.slice(0, 3),
    },
    client: {
      status: clientStatus,
      note: clientNote,
      missingNow: missingRefs.length,
      missingRate,
      prevMissingRate: pct(miPrev, newPrev.length),
      missingOldest: missingRefs.slice(0, 3),
      approvalNow: approvalRefs.length,
      approvalOver2Days: over2,
      approvalOldest: approvalRefs.slice(0, 3),
      hoursToApprove: toApproval.medianDays != null ? round1(toApproval.medianDays * 24) : null,
      missingAnsweredPct: answeredPct(miIn(inCur)),
      prevMissingAnsweredPct: answeredPct(miIn(inPrev)),
      missingReplyHours: replyHours(miIn(inCur)),
      prevMissingReplyHours: replyHours(miIn(inPrev)),
      approvalReachPct: reach(newCur),
      prevApprovalReachPct: reach(newPrev),
      approvalRatePct: approvalRate,
      prevApprovalRatePct: prevApprovalRate,
      rejectionRatePct: rejectRate,
      prevRejectionRatePct: prevRejectRate,
      approvalHours: decisionHours(inCur),
      prevApprovalHours: decisionHours(inPrev),
      avgRounds: rounds(inCur),
      prevAvgRounds: rounds(inPrev),
      multiRejectCount: multiRejectJobs.length,
    },
    flow: flowRows,
    growing,
    longestWait,
    production: {
      status: prodStatus,
      note: prodNote,
      openNow: prodOpen.length,
      late: prodLate,
      daysInProduction: toReady.medianDays,
      prevDaysInProduction: toReady.prevMedianDays,
      slowest,
      oldest: stuckProduction.slice(0, 3),
      leftPerBucket: trendPts.map((t) => ({ label: t.label, count: t.completed })),
      bucketDays,
      leftPerDay: round1(completedCur.size / workingDaysInPeriod),
      prevLeftPerDay: round1(completedPrev.size / workingDaysInPeriod),
      progress: productionProgress(
        input.productionExits ?? input.events.filter((e) => e.action === "moved"),
        shipGroupCols,
        nowMs,
        input.todayStartMs ?? new Date(input.now.toISOString().slice(0, 10)).getTime()
      ),
    },
  };

  // ---- popup summary
  const todayStart = input.todayStartMs ?? new Date(input.now.toISOString().slice(0, 10)).getTime();
  const isToday = (iso: string) => new Date(iso).getTime() >= todayStart;
  const enteredToday = (cols: Set<string>) =>
    new Set(moves.filter((m) => !!m.to && cols.has(m.to) && isToday(m.created_at)).map((m) => m.order_id)).size;
  const floorCols = new Set(
    input.columns
      .filter((c) => {
        const n = norm(c.name);
        return n === "in production" || n.startsWith("finishing");
      })
      .map((c) => c.id)
  );
  const floorOrders = active.filter((o) => floorCols.has(o.column_id));
  const queueOrders = active.filter((o) => isQueueCol(o.column_id));
  const popupDesigners = input.designers
    .map((d) => {
      const mine = queueOrders.filter((o) => o.designer_id === d.id);
      return {
        id: d.id,
        name: d.name,
        orders: mine.length,
        skus: mine.reduce((n, o) => n + Math.max(1, o.sku_count), 0),
        qty: mine.reduce((n, o) => n + (o.qty ?? 0), 0),
      };
    })
    .sort((a, b) => b.orders - a.orders);
  // Jobs created per day: always the last 14 days, whatever the period.
  const createdBetween = (from: number, to: number) =>
    input.newOrders.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= from && t < to;
    });
  const createdPerDay = Array.from({ length: 14 }, (_, i) => {
    const dayStart = todayStart - (13 - i) * DAY_MS;
    const d = new Date(dayStart + 12 * 3_600_000);
    const list = createdBetween(dayStart, dayStart + DAY_MS);
    const where = new Map<string, number>();
    for (const o of list) {
      const col = o.column_id ? colById.get(o.column_id)?.name.trim() : null;
      const name = col ?? "Removed";
      where.set(name, (where.get(name) ?? 0) + 1);
    }
    return {
      label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      date: d.toISOString().slice(0, 10),
      count: list.length,
      qty: list.reduce((n, o) => n + (o.qty ?? 0), 0),
      where: [...where].map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count),
    };
  });
  const endOfToday = todayStart + DAY_MS;
  const createdCount = (daysBack: number, len: number) =>
    createdBetween(endOfToday - (daysBack + len) * DAY_MS, endOfToday - daysBack * DAY_MS).length;
  const createdChange = {
    // Today so far vs yesterday up to the same time of day (fair while the day is still running).
    day: { cur: createdCount(0, 1), prev: createdBetween(todayStart - DAY_MS, nowMs - DAY_MS).length },
    week: { cur: createdCount(0, 7), prev: createdCount(7, 7) },
    month: { cur: createdCount(0, 30), prev: createdCount(30, 30) },
  };
  const popup: PopupSummary = {
    unassigned: queueOrders.filter((o) => !o.designer_id).length,
    designers: popupDesigners,
    missingToday: enteredToday(missingColIds),
    missingTotal: missingRefs.length,
    approvalToday: enteredToday(approvalCols),
    approvalTotal: approvalRefs.length,
    floorOpen: floorOrders.length,
    floorLate: floorOrders.filter(isLate).length,
    createdToday: createdPerDay[createdPerDay.length - 1]!.count,
    createdPerDay,
    createdChange,
  };

  // ---- actions: exact steps, aimed at getting jobs back on time (Hold ignored)
  const actions: ActionItem[] = [];
  const list = (refs: OrderRef[], n = 5) => refs.slice(0, n).map((o) => `#${o.title}`).join(", ");
  const byDue = (a: OrderRef, b: OrderRef) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  const flowById = new Map(flowRows.map((f) => [f.id, f]));

  // 1) Production speed: jobs must leave production faster.
  const leftPerDay = completedCur.size / workingDaysInPeriod;
  const prodLateRefs = active.filter((o) => groups.get(o.column_id) === "production" && isLate(o)).map(ref).sort(byDue);
  if (prodLateRefs.length > 0 || growing.some((id) => flowById.get(id)?.group === "production")) {
    const target = Math.ceil(leftPerDay + prodLateRefs.length / 5);
    const prodGrowing = growing.map((id) => flowById.get(id)!).filter((f) => f.group === "production");
    const steps = [
      `Sort every production column by due date (oldest due first) and work in that order today.`,
      prodLateRefs.length
        ? `Run these late jobs first: ${list(prodLateRefs, 6)}${prodLateRefs.length > 6 ? ` (+${prodLateRefs.length - 6} more)` : ""}.`
        : `Keep jobs due in the next 2 days at the front of every queue.`,
      ...prodGrowing.slice(0, 3).map((f) => {
        const n = norm(f.name);
        const goal = Math.ceil(f.inPerDay + f.open / 5);
        return /boyd|outsource|application/.test(n)
          ? `${f.name}: ${f.inPerDay} jobs/day go in but only ${f.outPerDay}/day come back (${f.open} jobs, about ${Math.round(f.avgDaysWaiting ?? 0)} days each) — call the vendor today for dates on the oldest jobs and push for at least ${goal}/day back.`
          : `${f.name}: ${f.inPerDay} jobs/day come in but only ${f.outPerDay}/day leave — add a shift or move work to another machine until it leaves at least ${goal}/day.`;
      }),
      `Target: at least ${target} jobs/day reaching Ready to Ship for the next 5 working days (now ${round1(leftPerDay)}/day).`,
      `Check this dashboard each morning: "Jobs leaving production per day" must stay at or above ${target}.`,
    ];
    actions.push({
      id: "production-speed",
      severity: prodLateRefs.length >= 10 ? "high" : "medium",
      title: `Speed up production: ${prodLateRefs.length} late jobs, ${round1(leftPerDay)} jobs/day leave production`,
      detail: `${prodOpen.length} jobs are in production. Jobs leave at about ${round1(leftPerDay)} a day.`,
      result:
        target > leftPerDay
          ? `At ${target} jobs/day out, the ${prodLateRefs.length} late production jobs are cleared in about 5 working days.`
          : "Production keeps pace with incoming work and no new jobs go late.",
      steps,
      orders: prodLateRefs.slice(0, 6),
    });
  }

  // 2) Where more comes in than goes out (not production; that is covered above).
  for (const id of growing.filter((g) => flowById.get(g)?.group !== "production").slice(0, 2)) {
    const f = flowById.get(id)!;
    const here = active.filter((o) => o.column_id === id).map(ref).sort(byDue);
    const n = norm(f.name);
    const steps = n.includes("waiting approval")
      ? [
          `Open ${f.name} and sort by "in column" time.`,
          `Resend the proof reminder to every job waiting 2+ days: ${list(here.filter((o) => (o.days ?? 0) >= 2))}.`,
          `Phone the clients of jobs waiting 4+ days and approve or change on the call.`,
          `Goal: ${f.name} back under ${Math.max(3, Math.round(f.outPerDay * 2))} jobs.`,
        ]
      : n.includes("missing info")
        ? [
            `Open ${f.name}; for each job check what is missing.`,
            `Text or call the client today: ${list(here)}.`,
            `If a client does not answer in 2 working days, move the job to Hold and tell the account manager.`,
          ]
        : [
            `Open ${f.name}: ${f.inPerDay} jobs/day come in, ${f.outPerDay}/day leave.`,
            `Work the jobs by due date: ${list(here)}.`,
            `Assign one person to clear this column first today until it shrinks.`,
          ];
    actions.push({
      id: `flow:${id}`,
      severity: f.late > 0 ? "high" : "medium",
      title: `${f.name}: more coming in than going out (${f.inPerDay}/day in, ${f.outPerDay}/day out)`,
      detail: `${f.open} jobs there now, waiting about ${f.avgDaysWaiting ?? 0} days each${f.late ? `, ${f.late} late` : ""}.`,
      result: `${f.name} stops growing: at least ${f.inPerDay}/day leave.`,
      steps,
      orders: here.slice(0, 5),
    });
  }

  // 3) Design speed: designers must keep up with incoming jobs.
  const queueRefs = active.filter((o) => isQueueCol(o.column_id)).map(ref).sort(byDue);
  if (designStatus !== "green" || popup.unassigned > 0) {
    const steps = [
      ...(popup.unassigned ? [`Assign a designer to the ${popup.unassigned} job${popup.unassigned === 1 ? "" : "s"} with no designer now.`] : []),
      `Designers work Start by due date (soonest due first): ${list(queueRefs)}.`,
      teamPerDay > 0 && incomingPerDay > teamPerDay
        ? `About ${round1(incomingPerDay)} jobs/day come in and designers finish ${round1(teamPerDay)}/day — plan about ${Math.max(1, Math.round(((incomingPerDay - teamPerDay) * (avgMin(timed, designerCaps.map((d) => d.id)) ?? 35)) / 60))} extra design hours a day (or a helper) until Start is empty each evening.`
        : `Keep Start empty by the end of each day.`,
      `Send the proof the same day the job is designed.`,
    ];
    actions.push({
      id: "design-speed",
      severity: designStatus === "red" ? "high" : "medium",
      title: `Design speed: ${round1(teamPerDay)} designs/day vs ${round1(incomingPerDay)} new jobs/day`,
      detail: `${designQueue} jobs wait to be designed${designLate ? `, ${designLate} late` : ""}.`,
      result: "Every new job gets its proof within 1 working day.",
      steps,
      orders: queueRefs.slice(0, 5),
    });
  }

  // 4) Late jobs anywhere before shipping: one list by due date.
  const lateNoHold = lateOpen.filter((o) => !isHoldCol(o.column_id));
  if (lateNoHold.length > 0) {
    const late = lateNoHold.map(ref).sort(byDue);
    const byCol = new Map<string, number>();
    for (const o of late) byCol.set(o.column ?? "?", (byCol.get(o.column ?? "?") ?? 0) + 1);
    const where = [...byCol].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c} ${n}`).join(", ");
    actions.push({
      id: "late",
      severity: lateNoHold.length >= 10 ? "high" : "medium",
      title: `${lateNoHold.length} jobs are past their due date`,
      detail: `Where they are: ${where}.`,
      result: "Every late job has a new date agreed with the client, and the oldest ones ship first.",
      steps: [
        `Open the board, click "Late", and sort by due date.`,
        `Start with the oldest due: ${list(late, 6)}.`,
        `For each one: if it can ship in 2 days, push it to the front; if not, call the client and set a new due date today.`,
        `Do not start new non-rush jobs on a machine while a late job for that machine is waiting.`,
      ],
      orders: late.slice(0, 6),
    });
  }

  // 5) Proofs waiting on the client.
  if (waitingApproval.length > 0 && !growing.some((id) => approvalCols.has(id))) {
    actions.push({
      id: "waiting-approval",
      severity: waitingApproval.length >= 5 ? "medium" : "low",
      title: `${waitingApproval.length} proofs waiting 2+ days for the client`,
      detail: "These jobs cannot move until the client answers.",
      result: "No proof waits more than 2 days.",
      steps: [
        `Resend the reminder today: ${list(waitingApproval)}.`,
        `Phone anyone waiting 4+ days.`,
        `Note the answer on the card so production can start.`,
      ],
      orders: waitingApproval.slice(0, 5),
    });
  }

  // 6) Clients who send work back again and again.
  for (const c of clients.slice(0, 2)) {
    actions.push({
      id: `client:${c.customerId}`,
      severity: c.rejections >= 3 ? "medium" : "low",
      title: `Call ${c.name}: ${c.rejections} rejections, ${c.missingInfo} missing-info requests`,
      detail: "Repeated back-and-forth with one client this period.",
      result: "Their next proof is approved the first time.",
      steps: [
        `Read the rejection notes on ${list(c.orders, 3)}.`,
        `Call the client and agree the requirements (files, colours, sizes, text) before the next proof.`,
        `Write the agreed requirements in the customer notes so every designer sees them.`,
      ],
      orders: c.orders.slice(0, 5),
    });
  }

  return {
    popup,
    focus,
    days,
    generatedAt: input.now.toISOString(),
    kpis,
    trend: trendPts,
    columns,
    bottlenecks,
    designers,
    stuckProduction,
    stages,
    quality: {
      missingInfo: {
        orders: miCur,
        newOrders: newCur.length,
        rate: pct(miCur, newCur.length),
        prevRate: pct(miPrev, newPrev.length),
        unanswered,
        avgResponseHours: round1(avg(responseHours)),
      },
      rejections: {
        rejected: rejectedCur.length,
        approved: approvedCur.length,
        rate: rejectRate,
        prevRate: prevRejectRate,
        multiRejectJobs,
      },
      clients,
      waitingApproval: waitingApproval.slice(0, 15),
    },
    actions,
  };
}

/** Compact facts for the AI coach (keeps the prompt small). */
export function insightsForAi(i: BoardInsights) {
  return {
    periodDays: i.days,
    kpis: i.kpis,
    bottlenecks: i.bottlenecks.filter((b) => norm(b.name) !== "hold").map((b) => ({
      column: b.name,
      open: b.open,
      avgDaysHere: b.avgDaysHere,
      netGrowth: b.net,
      outPerDay: b.outPerDay,
      targetOutPerDay: b.targetOutPerDay,
      oldest: b.orders.slice(0, 3).map((o) => `${o.title} (${o.days}d)`),
    })),
    designers: i.designers.map((d) => ({
      name: d.name,
      toDesign: d.toDesign,
      waitingClient: d.waitingClient,
      late: d.late,
      oldestDays: d.oldestDays,
      rejectionRate: d.rejectionRate,
    })),
    stuckInProduction: i.stuckProduction.slice(0, 6).map((o) => `${o.title} in ${o.column} ${o.days}d${o.late ? " LATE" : ""}`),
    stages: i.stages,
    designSpeed: {
      designsPerDay: i.focus.design.perDay,
      newJobsPerDay: i.focus.design.incomingPerDay,
      waitingToDesign: i.focus.design.queue,
      lateInDesign: i.focus.design.late,
    },
    productionSpeed: { jobsLeavingPerDay: i.focus.production.leftPerDay, previous: i.focus.production.prevLeftPerDay },
    flowPerDay: i.focus.flow.map((f) => ({ column: f.name, jobsNow: f.open, late: f.late, inPerDay: f.inPerDay, outPerDay: f.outPerDay, avgDaysWaiting: f.avgDaysWaiting })),
    pilingUp: i.focus.growing.map((id) => i.focus.flow.find((f) => f.id === id)?.name),
    columnFlow: i.columns
      .filter((c) => c.group !== "shipping")
      .map((c) => ({ column: c.name, open: c.open, in: c.inCount, out: c.outCount, avgDaysToLeave: c.avgDaysToLeave })),
    missingInfo: i.quality.missingInfo,
    rejections: { ...i.quality.rejections, multiRejectJobs: i.quality.rejections.multiRejectJobs.map((j) => `${j.title} ×${j.count}`) },
    repeatClients: i.quality.clients.map((c) => `${c.name}: ${c.rejections} rejections, ${c.missingInfo} missing info`),
    proofsWaiting2PlusDays: i.quality.waitingApproval.length,
  };
}
