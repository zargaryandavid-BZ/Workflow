import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextColumnIdAfter } from "./stage-groups.ts";

const board = ["start", "apparel", "apparel-prod", "in-prod", "completed"];

describe("nextColumnIdAfter", () => {
  it("picks the next board column that is still a valid move", () => {
    assert.equal(
      nextColumnIdAfter("apparel-prod", board, board.filter((id) => id !== "apparel-prod")),
      "in-prod"
    );
  });

  it("skips columns the user cannot drop into", () => {
    const moveable = ["start", "completed"];
    assert.equal(nextColumnIdAfter("apparel", board, moveable), "completed");
  });

  it("returns null on the last column", () => {
    assert.equal(nextColumnIdAfter("completed", board, board), null);
  });
});
