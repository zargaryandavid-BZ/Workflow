import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boardThumbSrc } from "./board-thumb-url.ts";

const base = "https://abc.supabase.co/storage/v1/object/sign/order-assets";

describe("boardThumbSrc", () => {
  it("maps signed order-assets URLs to the thumbnail endpoint", () => {
    const url = `${base}/t1/o1/skus/s1/0-123-final%20art.png?token=xyz`;
    assert.equal(
      boardThumbSrc(url),
      "/api/thumb?w=224&p=" + encodeURIComponent("t1/o1/skus/s1/0-123-final art.png")
    );
  });

  it("leaves other URLs untouched", () => {
    const drive = "https://lh3.googleusercontent.com/abc=s220";
    assert.equal(boardThumbSrc(drive), drive);
    assert.equal(boardThumbSrc(""), "");
  });

  it("leaves svg/gif and suspicious paths untouched", () => {
    const svg = `${base}/t1/o1/logo.svg?token=1`;
    assert.equal(boardThumbSrc(svg), svg);
    const bad = `${base}/t1/../x.png?token=1`;
    assert.equal(boardThumbSrc(bad), bad);
  });
});
