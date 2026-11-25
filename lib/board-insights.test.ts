import test from "node:test";
import assert from "node:assert/strict";
import { buildBoardInsights, groupColumns, type InsightsInput } from "./board-insights.ts";

const NOW = new Date("2026-11-24T20:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const columns = [
  { id: "start", name: "Start (Create Order)", position: 0, kind: "normal" },
  { id: "hold", name: "Hold", position: 1, kind: "normal" },
  { id: "mi", name: "Missing Info / Changes", position: 2, kind: "exception" },
  { id: "wa", name: "Waiting Approval", position: 3, kind: "approval" },
  { id: "prod", name: "In Production", position: 4, kind: "normal" },
  { id: "boyd", name: "Shipped Boyd", position: 5, kind: "normal" },
  { id: "rts", name: "Ready to Ship", position: 6, kind: "ready_to_ship" },
  { id: "fin", name: "Finished: Review Request", position: 7, kind: "normal" },
];

function base(over: Partial<InsightsInput> = {}): InsightsInput {
  return {
    now: NOW,
    days: 30,
    columns,
    openOrders: [],
    newOrders: [],
    orderMeta: new Map(),
    events: [],
    notifications: [],
    customers: new Map([["c1", "Acme"]]),
    designers: [
      { id: "d1", name: "Har" },
      { id: "d2", name: "Marianna" },
      { id: "d3", name: "Chris" },
    ],
    ...over,
  };
}

const order = (id: string, column_id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  column_id,
  customer_id: "c1",
  designer_id: null as string | null,
  sku_count: 1,
  created_at: ago(10),
  last_moved_at: ago(5),
  days_to_due: null as number | null,
  due_date: null as string | null,
  ...extra,
});

test("columns are grouped by board order", () => {
  const g = groupColumns(columns);
  assert.equal(g.get("start"), "design");
  assert.equal(g.get("hold"), "design");
  assert.equal(g.get("mi"), "client");
  assert.equal(g.get("wa"), "client");
  assert.equal(g.get("prod"), "production");
  assert.equal(g.get("rts"), "shipping");
  assert.equal(g.get("fin"), "finished");
});

test("rejection rate, missing info rate and previous-period comparison", () => {
  const r = buildBoardInsights(
    base({
      newOrders: [
        { id: "a", created_at: ago(3), customer_id: "c1" },
        { id: "b", created_at: ago(4), customer_id: "c1" },
        { id: "c", created_at: ago(40), customer_id: "c1" },
      ],
      notifications: [{ order_id: "a", type: "missing_info", status: "responded", created_at: ago(3), responded_at: ago(2.5) }],
      events: [
        { order_id: "a", action: "rejected", created_at: ago(2) },
        { order_id: "a", action: "rejected", created_at: ago(1) },
        { order_id: "b", action: "approved", created_at: ago(1) },
        { order_id: "c", action: "approved", created_at: ago(40) },
      ],
      orderMeta: new Map([
        ["a", { id: "a", title: "A-1", customer_id: "c1", designer_id: "d1", created_at: ago(3) }],
        ["b", { id: "b", title: "B-1", customer_id: "c1", designer_id: "d2", created_at: ago(4) }],
      ]),
    })
  );
  assert.equal(r.quality.rejections.rate, 66.7);
  assert.equal(r.quality.rejections.prevRate, 0);
  assert.equal(r.quality.missingInfo.rate, 50);
  assert.equal(r.quality.missingInfo.avgResponseHours, 12);
  assert.deepEqual(r.quality.rejections.multiRejectJobs.map((j) => [j.title, j.count]), [["A-1", 2]]);
  assert.equal(r.quality.clients[0]?.name, "Acme");
  assert.equal(r.designers.find((d) => d.id === "d1")?.rejectionRate, 100);
});

test("column flow and time in column from moves", () => {
  const r = buildBoardInsights(
    base({
      orderMeta: new Map([["x", { id: "x", title: "X", customer_id: null, designer_id: null, created_at: ago(6) }]]),
      events: [
        { order_id: "x", action: "moved", created_at: ago(4), from: "start", to: "wa" },
        { order_id: "x", action: "moved", created_at: ago(3), from: "wa", to: "prod" },
        { order_id: "x", action: "moved", created_at: ago(1), from: "prod", to: "rts" },
      ],
    })
  );
  const col = (id: string) => r.columns.find((c) => c.id === id)!;
  assert.equal(col("start").avgDaysToLeave, 2);
  assert.equal(col("wa").avgDaysToLeave, 1);
  assert.equal(col("prod").avgDaysToLeave, 2);
  assert.equal(col("prod").inCount, 1);
  assert.equal(col("prod").outCount, 1);
  assert.equal(r.kpis.completed.value, 1);
  assert.equal(r.stages.find((s) => s.key === "total")?.medianDays, 5);
});

test("bottlenecks skip Boyd; actions have steps and ignore Hold", () => {
  const open = [
    ...Array.from({ length: 6 }, (_, i) => order(`h${i}`, "hold", { last_moved_at: ago(20), days_to_due: -2 })),
    ...Array.from({ length: 9 }, (_, i) => order(`b${i}`, "boyd", { last_moved_at: ago(30) })),
    ...Array.from({ length: 6 }, (_, i) => order(`s${i}`, "start", { designer_id: "d1" })),
  ];
  const r = buildBoardInsights(base({ openOrders: open, designerPool: ["d1", "d2"] }));
  assert.equal(r.bottlenecks[0]?.name, "Hold");
  assert.ok(!r.bottlenecks.some((b) => b.name === "Shipped Boyd"));
  assert.match(r.bottlenecks[0]!.fix, /held jobs/);
  assert.equal(r.kpis.late, 6);
  // Late jobs in Hold are left out of the action list (Hold is not tracked).
  const late = r.actions.find((a) => a.id === "late");
  assert.equal(late, undefined);
  // Every action comes with exact steps.
  for (const a of r.actions) assert.ok(a.steps.length > 0, a.id);
  // Hold never counts as a growing column.
  assert.ok(!r.focus.growing.includes("hold"));
});
