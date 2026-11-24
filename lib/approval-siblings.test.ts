import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLiveApprovalRow,
  latestRowPerOrder,
  selectOrderSiblings,
  siblingApprovalState,
  titleOrderBase,
  webhookOrderKey,
} from "./approval-siblings.ts";

const T = "tenant-a";
const card = (
  id: string,
  title: string,
  extra: Partial<{
    tenant_id: string;
    removed_at: string | null;
    specs: Record<string, unknown>;
  }> = {}
) => ({ id, title, tenant_id: T, removed_at: null, specs: {}, ...extra });

describe("titleOrderBase / webhookOrderKey", () => {
  it("parses NNNN-N titles", () => {
    assert.equal(titleOrderBase("15809-2"), "15809");
    assert.equal(titleOrderBase("15809"), null);
    assert.equal(titleOrderBase("ABC-12-3"), "ABC-12");
  });
  it("trims webhook keys", () => {
    assert.equal(webhookOrderKey({ webhook_order_number: " ORD-1 " }), "ORD-1");
    assert.equal(webhookOrderKey({ webhook_order_number: "" }), null);
    assert.equal(webhookOrderKey(null), null);
  });
});

describe("selectOrderSiblings", () => {
  it("returns all parts of the same title base, sorted, seed included", () => {
    const seed = card("a1", "15500-1");
    const out = selectOrderSiblings(seed, [
      card("a3", "15500-3"),
      card("a2", "15500-2"),
      card("a10", "15500-10"),
    ]);
    assert.deepEqual(
      out.map((o) => o.title),
      ["15500-1", "15500-2", "15500-3", "15500-10"]
    );
  });

  it("never includes another tenant, removed cards, or a different base", () => {
    const seed = card("a1", "15500-1");
    const out = selectOrderSiblings(seed, [
      card("x", "15500-2", { tenant_id: "tenant-b" }),
      card("r", "15500-3", { removed_at: "2026-11-01T00:00:00Z" }),
      card("o", "15501-1"),
      card("p", "155000-1"),
      card("q", "15500"),
    ]);
    assert.deepEqual(out.map((o) => o.id), ["a1"]);
  });

  it("matches portal cards by webhook order number", () => {
    const w = { webhook_order_number: "ORD-2026-15809" };
    const seed = card("m1", "15809-1", { specs: w });
    const out = selectOrderSiblings(seed, [
      card("m2", "15809-2", { specs: w }),
      card("m3", "Different title", { specs: w }),
    ]);
    assert.deepEqual(out.map((o) => o.id), ["m1", "m2", "m3"]);
  });

  it("joins a title-base sibling that is missing the webhook number", () => {
    const seed = card("m1", "15809-1", {
      specs: { webhook_order_number: "ORD-2026-15809" },
    });
    const out = selectOrderSiblings(seed, [card("m2", "15809-2")]);
    assert.deepEqual(out.map((o) => o.id), ["m1", "m2"]);
  });

  it("rejects a same-title card carrying a different webhook order", () => {
    const seed = card("m1", "15809-1", {
      specs: { webhook_order_number: "ORD-2026-15809" },
    });
    const out = selectOrderSiblings(seed, [
      card("z", "15809-2", { specs: { webhook_order_number: "ORD-2026-99999" } }),
    ]);
    assert.deepEqual(out.map((o) => o.id), ["m1"]);
  });

  it("single-line order (no -N suffix, no webhook) stays alone", () => {
    const seed = card("s", "15600");
    assert.deepEqual(
      selectOrderSiblings(seed, [card("t", "15600-1")]).map((o) => o.id),
      ["s"]
    );
  });

  it("dedupes the seed if the query returned it", () => {
    const seed = card("a1", "15500-1");
    const out = selectOrderSiblings(seed, [seed, card("a2", "15500-2")]);
    assert.equal(out.length, 2);
  });
});

describe("siblingApprovalState", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  const row = (o: Partial<{ status: string; customer_response: string | null; token_expires_at: string | null }>) => ({
    id: "n",
    token: "tok",
    status: "sent",
    customer_response: null,
    token_expires_at: "2026-12-01T00:00:00Z",
    ...o,
  });

  it("no request yet → Not ready yet, no token", () => {
    assert.deepEqual(siblingApprovalState(null, now), { status: "pending", token: null });
  });
  it("live request → waiting with token", () => {
    assert.deepEqual(siblingApprovalState(row({}), now), { status: "waiting", token: "tok" });
    assert.deepEqual(
      siblingApprovalState(row({ status: "pending", token_expires_at: null }), now),
      { status: "waiting", token: "tok" }
    );
  });
  it("expired by date or status → no token", () => {
    assert.deepEqual(
      siblingApprovalState(row({ token_expires_at: "2026-11-01T00:00:00Z" }), now),
      { status: "pending", token: null }
    );
    assert.deepEqual(siblingApprovalState(row({ status: "expired" }), now), {
      status: "pending",
      token: null,
    });
  });
  it("decided rounds show their result", () => {
    assert.deepEqual(
      siblingApprovalState(row({ status: "responded", customer_response: "approved" }), now),
      { status: "approved", token: "tok" }
    );
    assert.deepEqual(
      siblingApprovalState(
        row({ status: "responded", customer_response: "changes_requested" }),
        now
      ),
      { status: "rejected", token: "tok" }
    );
  });
  it("isLiveApprovalRow", () => {
    assert.equal(isLiveApprovalRow(row({ status: "responded" }), now), false);
    assert.equal(isLiveApprovalRow(row({}), now), true);
  });
});

describe("latestRowPerOrder", () => {
  it("keeps the first (newest) row per order", () => {
    const m = latestRowPerOrder([
      { order_id: "a", id: 2 },
      { order_id: "a", id: 1 },
      { order_id: "b", id: 3 },
    ]);
    assert.equal(m.get("a")!.id, 2);
    assert.equal(m.get("b")!.id, 3);
  });
});
