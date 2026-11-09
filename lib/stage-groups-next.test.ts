import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyStage, likelyNextColumns } from "./stage-groups.ts";

const cols = [
  "Start (Create Order)", "In Progress", "Hold", "Missing Info / Changes",
  "Customer Replied", "Waiting Approval", "Done (Ready for Prod)", "Arsen",
  "Production Completed", "Shipping", "Finished",
].map((name, i) => ({ id: `c${i}`, name }));

describe("likelyNextColumns", () => {
  it("from Start suggests Missing Info / Waiting Approval / Hold first", () => {
    const names = likelyNextColumns("Start", cols).map((c) => c.name);
    assert.deepEqual(names.slice(0, 3), ["Missing Info / Changes", "Waiting Approval", "Hold"]);
  });

  it("adds the board's next column if not already suggested", () => {
    const names = likelyNextColumns("Shipping", cols, "c10").map((c) => c.name);
    assert.deepEqual(names, ["Finished"]);
  });

  it("unknown stage → only the next column", () => {
    assert.deepEqual(likelyNextColumns("Weird", cols, "c1").map((c) => c.id), ["c1"]);
    assert.deepEqual(likelyNextColumns(null, cols), []);
  });

  it("skips stages the tenant doesn't have", () => {
    const names = likelyNextColumns("Done (Ready for Prod)", cols).map((c) => c.name);
    assert.deepEqual(names, ["Arsen"]);
  });

  it("classification unchanged", () => {
    assert.equal(classifyStage({ id: "x", name: "Waiting Approval" }).group, "design");
  });
});
