import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isCancelledOrderSpecs,
  isCancelledSearchTerm,
  pickCanceledColumn,
} from "./order-cancelled.ts";

describe("pickCanceledColumn", () => {
  it("prefers a Canceled column", () => {
    const col = pickCanceledColumn([
      { id: "f", name: "Finished: No Review Request" },
      { id: "c", name: "Cancelled" },
    ]);
    assert.equal(col?.id, "c");
  });
  it("falls back to Finished: No Review Request (Hayk 2026-11-26)", () => {
    const col = pickCanceledColumn([
      { id: "r", name: "Finished: Review Request" },
      { id: "f", name: "Finished: No Review Request" },
    ]);
    assert.equal(col?.id, "f");
  });
  it("returns null when neither exists", () => {
    assert.equal(pickCanceledColumn([{ id: "x", name: "Start" }]), null);
  });
});

describe("cancelled flags", () => {
  it("reads the stamp", () => {
    assert.equal(isCancelledOrderSpecs({ crm_cancelled_at: "2026-11-25T19:50:41Z" }), true);
    assert.equal(isCancelledOrderSpecs({}), false);
    assert.equal(isCancelledOrderSpecs(null), false);
  });
  it("search words", () => {
    for (const w of ["cancelled", "Canceled", "cancel"]) assert.equal(isCancelledSearchTerm(w), true);
    assert.equal(isCancelledSearchTerm("candle"), false);
  });
});
