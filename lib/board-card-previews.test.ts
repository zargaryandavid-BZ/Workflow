import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boardThumbnailsByOrder,
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

describe("boardThumbnailsByOrder", () => {
  it("never uses customer proof-rejection references as card pictures", async () => {
    const thumbs = await boardThumbnailsByOrder(
      [
        {
          id: "art",
          order_id: "o1",
          storage_path: "t/o1/1-art.png",
          file_name: "art.png",
          mime_type: "image/png",
          created_at: "2026-10-01T00:00:00Z",
        },
        {
          id: "ref",
          order_id: "o1",
          storage_path: "t/o1/customer-references/n1/all/2-ref.png",
          file_name: "ref.png",
          mime_type: "image/png",
          created_at: "2026-10-02T00:00:00Z",
        },
      ],
      async (paths) => new Map(paths.map((p) => [p, `signed:${p}`]))
    );
    assert.deepEqual(
      thumbs.o1?.map((t) => t.id),
      ["art"]
    );
  });
});
