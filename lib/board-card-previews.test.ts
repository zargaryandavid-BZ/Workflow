import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  designerNamesByOrder,
  resolveDesignerDisplayName,
} from "./board-card-previews.ts";

const names = new Map([
  ["marianna-id", "Marianna"],
  ["har-id", "Har Unusyan"],
]);

describe("resolveDesignerDisplayName", () => {
  it("prefers the assigned designer_id over a stale designer_name", () => {
    assert.equal(
      resolveDesignerDisplayName(
        { designer_id: "marianna-id", designer_name: "Har Unusyan" },
        names
      ),
      "Marianna"
    );
  });

  it("falls back to designer_name when the id is missing", () => {
    assert.equal(
      resolveDesignerDisplayName({ designer_name: "Har Unusyan" }, names),
      "Har Unusyan"
    );
  });
});

describe("designerNamesByOrder", () => {
  it("labels cards by designer_id even when the stored name disagrees", () => {
    const out = designerNamesByOrder(
      [
        {
          id: "597-1",
          specs: {
            designer_id: "marianna-id",
            designer_name: "Har Unusyan",
          },
        },
      ],
      names
    );
    assert.equal(out["597-1"], "Marianna");
  });
});
