import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandBoxGroups, totalBoxCount } from "./box-size-presets.ts";

describe("expandBoxGroups", () => {
  it("expands count × same box into one row per box", () => {
    const boxes = expandBoxGroups([
      { qty: "3", length: "12", width: "10", height: "8", weight: "22" },
      { qty: "1", length: "6", width: "6", height: "6", weight: "4.5" },
    ]);
    assert.equal(boxes.length, 4);
    assert.deepEqual(boxes[2], { length: "12", width: "10", height: "8", weight: "22" });
    assert.equal(boxes[3]!.weight, "4.5");
  });

  it("ignores empty / zero / bad counts", () => {
    assert.equal(totalBoxCount([{ qty: "" }, { qty: "0" }, { qty: "x" }, { qty: "2.7" }]), 2);
  });
});
