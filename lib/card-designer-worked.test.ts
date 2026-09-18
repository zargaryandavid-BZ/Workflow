import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { designerWorkedDisplaySeconds } from "./card-designer-worked.ts";

describe("designerWorkedDisplaySeconds", () => {
  it("is 0 when nobody has time", () => {
    assert.equal(
      designerWorkedDisplaySeconds({
        boardTotal: 0,
        myTotal: 0,
        liveElapsed: 0,
      }),
      0
    );
  });

  it("uses the largest of board, mine, and live", () => {
    assert.equal(
      designerWorkedDisplaySeconds({
        boardTotal: 3600,
        myTotal: 120,
        liveElapsed: 45,
      }),
      3600
    );
  });
});
