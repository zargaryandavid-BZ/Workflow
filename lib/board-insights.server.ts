import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveDaysUntilDue } from "@/lib/board-due-date";
import { isOrderArchived } from "@/lib/board-order-filters";
import { shopDayKey } from "@/lib/fulfillment-day";
import { getDesignerAssignmentSettings } from "@/lib/designer-assignment-settings";
import {
  buildBoardInsights,
  groupColumns,
  type BoardInsights,
  type InsightsColumn,
  type InsightsEvent,
  type InsightsNotification,
  type InsightsOpenOrder,
  type InsightsOrderMeta,
} from "@/lib/board-insights";

const PAGE = 1000;
/** Every activity row that records a column change (customer replies and automations log their own action). */
const MOVE_ACTIONS = ["moved", "customer_replied", "column_moved", "idle_auto_moved"];
export const INSIGHTS_PERIODS = [7, 30, 90] as const;

function specsOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function designerOf(specs: Record<string, unknown>): string | null {
  return typeof specs.designer_id === "string" && specs.designer_id ? specs.designer_id : null;
}

function skuCount(specs: Record<string, unknown>): number {
  return Array.isArray(specs.skus) ? specs.skus.length : 1;
}

function skuQty(specs: Record<string, unknown>): number {
  if (!Array.isArray(specs.skus)) return 0;
  return specs.skus.reduce((n: number, s: unknown) => {
    const q = Number((s as { qty?: unknown } | null)?.qty);
    return n + (Number.isFinite(q) && q > 0 ? q : 0);
  }, 0);
}

/** Midnight today in the shop's time zone (America/Los_Angeles), as epoch ms. */
function shopTodayStartMs(now: Date): number {
  const day = shopDayKey(now);
  const offset =
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "shortOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-8";
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(offset);
  const hours = m ? Number(m[1]) : -8;
  const mins = m?.[2] ? Number(m[2]) * Math.sign(hours) : 0;
  return Date.parse(`${day}T00:00:00Z`) - (hours * 60 + mins) * 60_000;
}

/**
 * Page through a PostgREST query in parallel: count first, then fetch all
 * pages at once (it returns at most 1000 rows per call).
 */
async function allParallel<T>(
  count: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const { count: n, error } = await count();
  if (error) throw new Error(error.message);
  const total = n ?? 0;
  const pages = await Promise.all(
    Array.from({ length: Math.ceil(total / PAGE) || 1 }, (_, i) => page(i * PAGE, i * PAGE + PAGE - 1))
  );
  const out: T[] = [];
  for (const p of pages) {
    if (p.error) throw new Error(p.error.message);
    out.push(...((p.data ?? []) as T[]));
  }
  return out;
}

/** Page through a PostgREST query (it returns at most 1000 rows per call). */
async function all<T>(
  run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

export async function loadBoardInsights(
  client: SupabaseClient,
  tenantId: string,
  days: number,
  timings?: Record<string, number>
): Promise<BoardInsights> {
  const now = new Date();
  let mark = Date.now();
  const lap = (name: string) => {
    if (timings) timings[name] = Date.now() - mark;
    mark = Date.now();
  };
  const since = new Date(now.getTime() - 2 * days * 86_400_000).toISOString();
  const today = shopDayKey(now);

  const [colsRes, membersRes] = await Promise.all([
    client.from("board_columns").select("id, name, position, kind").eq("tenant_id", tenantId),
    client.from("memberships").select("user_id").eq("tenant_id", tenantId).eq("role", "designer"),
  ]);
  const columns = (colsRes.data ?? []) as InsightsColumn[];
  const colById = new Map(columns.map((c) => [c.id, c]));
  // Finished columns hold most of the history and are never shown: skip them.
  const finishedIds = columns.filter((c) => /^finished/i.test(c.name.trim())).map((c) => c.id);

  type OrderRow = {
    id: string;
    title: string | null;
    column_id: string;
    customer_id: string | null;
    created_at: string;
    last_moved_at: string | null;
    due_date: string | null;
    specs: unknown;
  };
  // Only the spec keys this report reads (full specs are large).
  const SLIM_ORDER =
    "id, title, column_id, customer_id, created_at, last_moved_at, due_date, " +
    "designer_id:specs->designer_id, archived:specs->archived, skus:specs->skus, " +
    "due_date_mode:specs->due_date_mode, due_processing_days:specs->due_processing_days, " +
    "due_date_status:specs->due_date_status, due_date_label:specs->due_date_label, due_anchor_at:specs->due_anchor_at";
  type SlimRow = Omit<OrderRow, "specs"> & Record<string, unknown>;
  const slimSpecs = (o: SlimRow): Record<string, unknown> => ({
    designer_id: o.designer_id,
    archived: o.archived,
    skus: o.skus,
    due_date_mode: o.due_date_mode,
    due_processing_days: o.due_processing_days,
    due_date_status: o.due_date_status,
    due_date_label: o.due_date_label,
    due_anchor_at: o.due_anchor_at,
  });

  const openQuery = (sel: string, head = false) => {
    let q = client
      .from("orders")
      .select(sel, head ? { count: "exact", head: true } : undefined)
      .eq("tenant_id", tenantId)
      .is("removed_at", null);
    if (finishedIds.length) q = q.not("column_id", "in", `(${finishedIds.join(",")})`);
    return q;
  };
  const eventQuery = (sel: string, head = false) =>
    client
      .from("activity_log")
      .select(sel, head ? { count: "exact", head: true } : undefined)
      .eq("tenant_id", tenantId)
      .in("action", [...MOVE_ACTIONS, "approved", "rejected", "approval_queued"])
      .gte("created_at", since);
  const EVENT_SELECT = "order_id, action, actor, created_at, from:metadata->>from, to:metadata->>to";

  // Moves into Ready to Ship (or later) over the last 60 days, for the Production day / week / month progress.
  const shipCols = [...groupColumns(columns)].filter(([, g]) => g === "shipping" || g === "finished").map(([id]) => id);
  const exitsSince = new Date(now.getTime() - 61 * 86_400_000).toISOString();
  const exitsQuery = shipCols.length
    ? all<{ order_id: string | null; created_at: string; from: string | null; to: string | null }>((f, t) =>
        client
          .from("activity_log")
          .select("order_id, created_at, from:metadata->>from, to:metadata->>to")
          .eq("tenant_id", tenantId)
          .in("action", MOVE_ACTIONS)
          .in("metadata->>to", shipCols)
          .gte("created_at", exitsSince)
          .order("created_at", { ascending: true })
          .range(f, t)
      ).catch((err) => {
        console.warn("[board/insights] production exits query failed:", err);
        return null;
      })
    : Promise.resolve(null);

  const [slimRows, newRows, eventRows, noteRows, timeRows, exitRows] = await Promise.all([
    allParallel<SlimRow>(
      () => openQuery("id", true),
      (f, t) => openQuery(SLIM_ORDER).order("id").range(f, t)
    ),
    all<{ id: string; created_at: string; customer_id: string | null; column_id: string | null; skus: unknown }>((f, t) =>
      client
        .from("orders")
        .select("id, created_at, customer_id, column_id, skus:specs->skus")
        .eq("tenant_id", tenantId)
        .gte("created_at", since)
        .is("removed_at", null)
        .range(f, t)
    ),
    allParallel<{ order_id: string | null; action: string; actor: string | null; created_at: string; from: string | null; to: string | null }>(
      () => eventQuery("id", true),
      (f, t) => eventQuery(EVENT_SELECT).order("created_at", { ascending: true }).order("id").range(f, t)
    ),
    all<InsightsNotification>((f, t) =>
      client
        .from("job_notifications")
        .select("order_id, type, status, created_at, responded_at")
        .eq("tenant_id", tenantId)
        .eq("type", "missing_info")
        .gte("created_at", since)
        .range(f, t)
    ),
    all<{ user_id: string; order_id: string | null; started_at: string; ended_at: string | null; paused_seconds: number | null }>((f, t) =>
      client
        .from("time_entries")
        .select("user_id, order_id, started_at, ended_at, paused_seconds")
        .eq("tenant_id", tenantId)
        .eq("activity_type", "Design")
        .not("ended_at", "is", null)
        .gte("started_at", since)
        .range(f, t)
    ).catch(() => []),
    exitsQuery,
  ]);

  lap("main");
  const openRows: OrderRow[] = slimRows.map((o) => ({ ...(o as unknown as OrderRow), specs: slimSpecs(o) }));
  const openOrders: InsightsOpenOrder[] = openRows
    .filter((o) => !isOrderArchived(o))
    .map((o) => {
      const specs = specsOf(o.specs);
      return {
        id: o.id,
        title: (o.title ?? "").trim() || "Untitled",
        column_id: o.column_id,
        customer_id: o.customer_id,
        designer_id: designerOf(specs),
        sku_count: skuCount(specs),
        qty: skuQty(specs),
        created_at: o.created_at,
        last_moved_at: o.last_moved_at,
        due_date: o.due_date,
        days_to_due: effectiveDaysUntilDue(o.due_date, o.specs, {
          today,
          column: colById.get(o.column_id) ?? null,
        }),
      };
    });

  const events: InsightsEvent[] = eventRows
    .filter((e) => e.order_id)
    .map((e) => ({
      order_id: e.order_id!,
      action: MOVE_ACTIONS.includes(e.action) ? "moved" : e.action,
      created_at: e.created_at,
      from: e.from || null,
      to: e.to || null,
      actor: e.actor ?? null,
    }));

  // Meta for every order the events / notes mention (closed ones too).
  const orderMeta = new Map<string, InsightsOrderMeta>();
  for (const o of openRows) {
    const specs = specsOf(o.specs);
    orderMeta.set(o.id, {
      id: o.id,
      title: (o.title ?? "").trim(),
      customer_id: o.customer_id,
      designer_id: designerOf(specs),
      created_at: o.created_at,
      sku_count: skuCount(specs),
    });
  }
  const missing = [
    ...new Set([...events.map((e) => e.order_id), ...noteRows.map((n) => n.order_id)].filter((id) => !orderMeta.has(id))),
  ];
  const chunks = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const metaPages = await Promise.all(
    chunks(missing, 150).map((ids) =>
      client.from("orders").select("id, title, customer_id, created_at, designer_id:specs->>designer_id, skus:specs->skus").in("id", ids)
    )
  );
  for (const page of metaPages) {
    for (const o of (page.data ?? []) as { id: string; title: string | null; customer_id: string | null; created_at: string; designer_id: string | null; skus: unknown }[]) {
      orderMeta.set(o.id, {
        id: o.id,
        title: (o.title ?? "").trim(),
        customer_id: o.customer_id,
        designer_id: o.designer_id || null,
        created_at: o.created_at,
        sku_count: Array.isArray(o.skus) ? o.skus.length : 1,
      });
    }
  }

  lap("meta");
  const customerIds = [...new Set([...orderMeta.values()].map((o) => o.customer_id).filter(Boolean))] as string[];
  const customers = new Map<string, string>();
  const custPages = await Promise.all(
    chunks(customerIds, 150).map((ids) => client.from("customers").select("id, name, company").in("id", ids))
  );
  for (const page of custPages) {
    for (const c of (page.data ?? []) as { id: string; name: string | null; company: string | null }[]) {
      customers.set(c.id, (c.company?.trim() || c.name?.trim() || "Client") as string);
    }
  }

  lap("customers");
  const designerIds = ((membersRes.data ?? []) as { user_id: string }[]).map((m) => m.user_id);
  const { data: profiles } = designerIds.length
    ? await client.from("profiles").select("id, full_name").in("id", designerIds)
    : { data: [] };
  const designers = designerIds.map((id) => ({
    id,
    name:
      ((profiles ?? []) as { id: string; full_name: string | null }[]).find((p) => p.id === id)?.full_name?.trim() ||
      "Designer",
  }));

  const assignment = await getDesignerAssignmentSettings(client, tenantId).catch(() => null);

  lap("designers");
  const result = buildBoardInsights({
    now,
    days,
    columns,
    openOrders,
    newOrders: newRows.map((o) => ({
      id: o.id,
      created_at: o.created_at,
      customer_id: o.customer_id,
      column_id: o.column_id,
      qty: skuQty({ skus: o.skus }),
    })),
    orderMeta,
    events,
    notifications: noteRows,
    customers,
    designers,
    designerPool: assignment?.pool ?? [],
    todayStartMs: shopTodayStartMs(now),
    productionExits: exitRows
      ? exitRows
          .filter((e) => e.order_id)
          .map((e) => ({ order_id: e.order_id!, created_at: e.created_at, from: e.from || null, to: e.to || null }))
      : undefined,
    timeEntries: timeRows.map((t) => ({
      user_id: t.user_id,
      order_id: t.order_id,
      started_at: t.started_at,
      seconds: Math.max(
        0,
        (new Date(t.ended_at!).getTime() - new Date(t.started_at).getTime()) / 1000 - (t.paused_seconds ?? 0)
      ),
    })),
  });
  lap("compute");
  return result;
}
