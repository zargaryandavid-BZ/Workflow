import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { artworkThumbPath } from "./artwork-thumb-path.ts";

describe("artworkThumbPath", () => {
  it("stores the thumbnail next to the preview as JPEG", () => {
    assert.equal(
      artworkThumbPath("t/previews/file/rev/p1/composite.jpg"),
      "t/previews/file/rev/p1/composite.thumb.jpg"
    );
    assert.equal(
      artworkThumbPath("t/previews/file/rev/p1/base.png"),
      "t/previews/file/rev/p1/base.thumb.jpg"
    );
  });

  it("ignores dots in folder names", () => {
    assert.equal(artworkThumbPath("t/v1.2/artwork"), "t/v1.2/artwork.thumb.jpg");
  });
});
