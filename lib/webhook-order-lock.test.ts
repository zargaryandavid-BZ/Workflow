import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPgUniqueViolation,
  isUndefinedTableError,
  normalizeWebhookIngestOrderKey,
  withWebhookOrderIngestLock,
} from "./webhook-order-lock.ts";

describe("webhook ingest lock helpers", () => {
  it("normalizes order numbers for the lock key", () => {
    assert.equal(
      normalizeWebhookIngestOrderKey("  ORD-2026-15084 "),
      "ord-2026-15084"
    );
  });

  it("detects unique and missing-table errors", () => {
    assert.equal(isPgUniqueViolation({ code: "23505" }), true);
    assert.equal(isPgUniqueViolation({ code: "23503" }), false);
    assert.equal(isUndefinedTableError({ code: "42P01" }), true);
    assert.equal(
      isUndefinedTableError({
        message: 'relation "webhook_order_ingest_locks" does not exist',
      }),
      true
    );
  });
});

type LockRow = { tenant_id: string; order_key: string; claimed_at: string };

function fakeLockClient(store: { rows: LockRow[] }) {
  return {
    from(table: string) {
      if (table !== "webhook_order_ingest_locks") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        insert(row: { tenant_id: string; order_key: string }) {
          const exists = store.rows.some(
            (r) => r.tenant_id === row.tenant_id && r.order_key === row.order_key
          );
          if (exists) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
          }
          store.rows.push({
            ...row,
            claimed_at: new Date().toISOString(),
          });
          return Promise.resolve({ error: null });
        },
        delete() {
          const filters: Record<string, string> = {};
          const builder = {
            eq(col: string, val: string) {
              filters[col] = val;
              return builder;
            },
            lt() {
              return Promise.resolve({ error: null });
            },
            then(
              resolve: (v: { error: null }) => void,
              reject?: (e: unknown) => void
            ) {
              store.rows = store.rows.filter(
                (r) =>
                  !(
                    r.tenant_id === filters.tenant_id &&
                    r.order_key === filters.order_key
                  )
              );
              return Promise.resolve({ error: null }).then(resolve, reject);
            },
          };
          return builder;
        },
      };
    },
  };
}

describe("withWebhookOrderIngestLock", () => {
  it("runs the second caller only after the first releases", async () => {
    const store = { rows: [] as LockRow[] };
    const client = fakeLockClient(store) as never;
    const order: string[] = [];

    const first = withWebhookOrderIngestLock(
      client,
      "tenant-a",
      "ORD-2026-15084",
      async () => {
        order.push("a-start");
        await new Promise((r) => setTimeout(r, 40));
        order.push("a-end");
        return "a";
      },
      { pollMs: 5, waitMs: 2000, staleMs: 60_000 }
    );

    await new Promise((r) => setTimeout(r, 5));

    const second = withWebhookOrderIngestLock(
      client,
      "tenant-a",
      "ORD-2026-15084",
      async () => {
        order.push("b");
        return "b";
      },
      { pollMs: 5, waitMs: 2000, staleMs: 60_000 }
    );

    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, "a");
    assert.equal(b, "b");
    assert.deepEqual(order, ["a-start", "a-end", "b"]);
    assert.equal(store.rows.length, 0);
  });

  it("skips locking when the table is missing", async () => {
    const client = {
      from() {
        return {
          delete() {
            const builder = {
              eq() {
                return builder;
              },
              lt() {
                return Promise.resolve({
                  error: { code: "42P01", message: "missing" },
                });
              },
            };
            return builder;
          },
        };
      },
    } as never;

    const result = await withWebhookOrderIngestLock(
      client,
      "tenant-a",
      "ORD-2026-1",
      async () => 7
    );
    assert.equal(result, 7);
  });
});
