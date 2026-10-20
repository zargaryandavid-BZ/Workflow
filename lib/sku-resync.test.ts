import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SKU_INBOUND_FINGERPRINT_KEY,
  SKU_STAFF_EDITED_AT_KEY,
  SKU_STAFF_EDITED_BY_KEY,
  applySpecsPatch,
  applyStaffSkuEdit,
  matchSkuIds,
  preserveSkuSyncKeys,
  resolveInboundSkuResync,
  skuContentChanged,
  skuContentFingerprint,
  skuTotalQty,
} from "./sku-resync.ts";

const sku = (id: string, name: string, qty: number | null) => ({ id, name, qty });
const NOW = new Date("2026-10-20T12:00:00.000Z");

describe("skuContentFingerprint / skuContentChanged", () => {
  it("ignores ids and surrounding whitespace", () => {
    assert.equal(
      skuContentFingerprint([sku("a", " Mint ", 500)]),
      skuContentFingerprint([sku("b", "Mint", 500)])
    );
    assert.equal(
      skuContentChanged([sku("a", "Mint", 500)], [sku("z", "Mint", 500)]),
      false
    );
  });

  it("detects name, qty, row count and order changes", () => {
    const base = [sku("a", "Mint", 500), sku("b", "Berry", 250)];
    assert.ok(skuContentChanged(base, [sku("a", "Mint 2", 500), base[1]]));
    assert.ok(skuContentChanged(base, [sku("a", "Mint", 600), base[1]]));
    assert.ok(skuContentChanged(base, [base[0]]));
    assert.ok(skuContentChanged(base, [base[1], base[0]]));
  });

  it("treats string qty like numbers and junk as empty", () => {
    assert.equal(
      skuContentFingerprint([{ name: "A", qty: "100" }]),
      skuContentFingerprint([{ name: "A", qty: 100 }])
    );
    assert.equal(skuContentFingerprint("nope"), "[]");
    assert.equal(skuContentFingerprint([null, 3]), "[]");
  });
});

describe("skuTotalQty", () => {
  it("sums valid quantities only", () => {
    assert.equal(
      skuTotalQty([sku("a", "A", 500), sku("b", "B", null), sku("c", "C", 250)]),
      750
    );
    assert.equal(skuTotalQty([]), 0);
  });
});

describe("applyStaffSkuEdit (staff save path)", () => {
  it("stamps the staff flag only when SKU content changed", () => {
    const existing = { skus: [sku("a", "Mint", 500)], color: "CMYK" };
    const out = applyStaffSkuEdit(
      existing,
      { ...existing, skus: [sku("a", "Mint", 800)] },
      { userId: "u1", now: NOW }
    );
    assert.equal(out[SKU_STAFF_EDITED_AT_KEY], NOW.toISOString());
    assert.equal(out[SKU_STAFF_EDITED_BY_KEY], "u1");
    assert.equal(out.color, "CMYK");
    assert.deepEqual(out.skus, [sku("a", "Mint", 800)]);
  });

  it("does not stamp when only ids or other fields changed", () => {
    const existing = { skus: [sku("a", "Mint", 500)] };
    const out = applyStaffSkuEdit(
      existing,
      { skus: [sku("b", "Mint", 500)], designer_id: "d1" },
      { userId: "u1", now: NOW }
    );
    assert.equal(out[SKU_STAFF_EDITED_AT_KEY], undefined);
    assert.equal(out.designer_id, "d1");
  });

  it("does not stamp when the save has no skus key", () => {
    const out = applyStaffSkuEdit(
      { skus: [sku("a", "Mint", 500)] },
      { designer_id: "d1" },
      { now: NOW }
    );
    assert.equal(out[SKU_STAFF_EDITED_AT_KEY], undefined);
  });

  it("keeps server sync keys over a stale client copy", () => {
    const existing = {
      skus: [sku("a", "Mint", 500)],
      [SKU_INBOUND_FINGERPRINT_KEY]: "server-fp",
      [SKU_STAFF_EDITED_AT_KEY]: "2026-10-01T00:00:00.000Z",
    };
    const out = applyStaffSkuEdit(
      existing,
      {
        skus: [sku("a", "Mint", 500)],
        [SKU_INBOUND_FINGERPRINT_KEY]: "stale-fp",
        [SKU_STAFF_EDITED_AT_KEY]: "forged",
        [SKU_STAFF_EDITED_BY_KEY]: "someone",
      },
      { now: NOW }
    );
    assert.equal(out[SKU_INBOUND_FINGERPRINT_KEY], "server-fp");
    assert.equal(out[SKU_STAFF_EDITED_AT_KEY], "2026-10-01T00:00:00.000Z");
    assert.equal(
      Object.prototype.hasOwnProperty.call(out, SKU_STAFF_EDITED_BY_KEY),
      false
    );
  });
});

describe("preserveSkuSyncKeys", () => {
  it("does not mutate inputs", () => {
    const existing = { [SKU_INBOUND_FINGERPRINT_KEY]: "fp" };
    const next = { skus: [] as unknown[] };
    const out = preserveSkuSyncKeys(existing, next);
    assert.equal(out[SKU_INBOUND_FINGERPRINT_KEY], "fp");
    assert.equal(
      Object.prototype.hasOwnProperty.call(next, SKU_INBOUND_FINGERPRINT_KEY),
      false
    );
  });
});

describe("matchSkuIds", () => {
  it("matches by name (case-insensitive) first, then by position", () => {
    const existing = [sku("e1", "Mint", 500), sku("e2", "Berry", 250)];
    const incoming = [sku("i1", "berry", 300), sku("i2", "Lemon", 100)];
    const map = matchSkuIds(existing, incoming);
    assert.equal(map.get("i1"), "e2");
    // Lemon has no name match; position 1 (e2) is taken → keeps its own id.
    assert.equal(map.get("i2"), "i2");
  });

  it("falls back to the same position when names differ", () => {
    const map = matchSkuIds([sku("e1", "Old", 1)], [sku("i1", "New", 1)]);
    assert.equal(map.get("i1"), "e1");
  });
});

describe("resolveInboundSkuResync (CRM / website re-fire)", () => {
  const inbound = [sku("i1", "Mint", 500), sku("i2", "Berry", 250)];
  const inboundFp = skuContentFingerprint(inbound);

  it("leaves SKUs alone when nothing is inbound", () => {
    const r = resolveInboundSkuResync({
      existingSpecs: {},
      existingSkus: [sku("e1", "Mint", 500)],
      inbound: [],
    });
    assert.equal(r.skus, null);
    assert.deepEqual(r.specsPatch, {});
    assert.deepEqual(r.effectiveSkus, [sku("e1", "Mint", 500)]);
  });

  it("applies inbound when staff never edited, reusing existing ids", () => {
    const existingSkus = [sku("e1", "Mint", 400), sku("e2", "Berry", 250)];
    const r = resolveInboundSkuResync({
      existingSpecs: { skus: existingSkus },
      existingSkus,
      inbound,
    });
    assert.deepEqual(r.skus, [sku("e1", "Mint", 500), sku("e2", "Berry", 250)]);
    assert.equal(r.keptStaffEdit, false);
    assert.equal(r.specsPatch[SKU_INBOUND_FINGERPRINT_KEY], inboundFp);
    assert.equal(r.idMap.get("i1"), "e1");
  });

  it("keeps a staff edit when the source re-sent the same SKUs", () => {
    const staffSkus = [sku("e1", "Mint (fixed)", 600)];
    const r = resolveInboundSkuResync({
      existingSpecs: {
        skus: staffSkus,
        [SKU_INBOUND_FINGERPRINT_KEY]: inboundFp,
        [SKU_STAFF_EDITED_AT_KEY]: "2026-10-19T00:00:00.000Z",
      },
      existingSkus: staffSkus,
      inbound,
    });
    assert.equal(r.skus, null);
    assert.equal(r.keptStaffEdit, true);
    assert.deepEqual(r.effectiveSkus, staffSkus);
    assert.deepEqual(r.specsPatch, { [SKU_INBOUND_FINGERPRINT_KEY]: inboundFp });
  });

  it("keeps a staff edit (and records fingerprint) on legacy cards without one", () => {
    const staffSkus = [sku("e1", "Mint", 999)];
    const r = resolveInboundSkuResync({
      existingSpecs: {
        skus: staffSkus,
        [SKU_STAFF_EDITED_AT_KEY]: "2026-10-19T00:00:00.000Z",
      },
      existingSkus: staffSkus,
      inbound,
    });
    assert.equal(r.keptStaffEdit, true);
    assert.equal(r.specsPatch[SKU_INBOUND_FINGERPRINT_KEY], inboundFp);
  });

  it("source wins when its SKU list actually changed; staff flag cleared", () => {
    const staffSkus = [sku("e1", "Mint (fixed)", 600)];
    const specs: Record<string, unknown> = {
      skus: staffSkus,
      [SKU_INBOUND_FINGERPRINT_KEY]: skuContentFingerprint([sku("x", "Mint", 400)]),
      [SKU_STAFF_EDITED_AT_KEY]: "2026-10-19T00:00:00.000Z",
      [SKU_STAFF_EDITED_BY_KEY]: "u1",
      color: "CMYK",
    };
    const r = resolveInboundSkuResync({
      existingSpecs: specs,
      existingSkus: staffSkus,
      inbound,
    });
    assert.equal(r.keptStaffEdit, false);
    assert.deepEqual(r.skus, [sku("e1", "Mint", 500), sku("i2", "Berry", 250)]);
    const next = applySpecsPatch({ ...specs, skus: r.skus }, r.specsPatch);
    assert.equal(next[SKU_INBOUND_FINGERPRINT_KEY], inboundFp);
    assert.equal(SKU_STAFF_EDITED_AT_KEY in next, false);
    assert.equal(SKU_STAFF_EDITED_BY_KEY in next, false);
    assert.equal(next.color, "CMYK");
  });

  it("respects a staff edit that removed every SKU while source is unchanged", () => {
    const r = resolveInboundSkuResync({
      existingSpecs: {
        skus: [],
        [SKU_INBOUND_FINGERPRINT_KEY]: inboundFp,
        [SKU_STAFF_EDITED_AT_KEY]: "2026-10-19T00:00:00.000Z",
      },
      existingSkus: [],
      inbound,
    });
    assert.equal(r.skus, null);
    assert.equal(r.keptStaffEdit, true);
  });
});
