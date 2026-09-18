import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  manualPrioritySpecsPatch,
  preservePriorityScore,
} from "./order-priority-score.ts";

describe("preservePriorityScore", () => {
  const saved = { priority_score: 4, priority_source: "manual", skus: [] };

  it("keeps board priority when a specs patch omits it", () => {
    const next = preservePriorityScore(saved, {
      designer_id: "d1",
      designer_name: "Alex",
    });
    assert.equal(next.priority_score, 4);
    assert.equal(next.priority_source, "manual");
    assert.equal(next.designer_id, "d1");
  });

  it("allows an explicit new score", () => {
    const next = preservePriorityScore(saved, { priority_score: 2 });
    assert.equal(next.priority_score, 2);
  });

  it("clears when the patch sends null", () => {
    const next = preservePriorityScore(saved, {
      ...saved,
      priority_score: null,
      priority_source: null,
    });
    assert.equal(next.priority_score, undefined);
    assert.equal(next.priority_source, undefined);
  });
});

describe("manualPrioritySpecsPatch", () => {
  it("sends null so a merged PATCH can clear the score", () => {
    const next = manualPrioritySpecsPatch({ priority_score: 3, rush: true }, null);
    assert.equal(next.priority_score, null);
    assert.equal(next.priority_source, null);
    assert.equal(next.rush, true);
  });
});
