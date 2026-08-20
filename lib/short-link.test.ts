import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SHORT_LINK_ALPHABET,
  SHORT_LINK_CODE_LENGTH,
  normalizeTargetPath,
  randomShortCode,
} from "./short-link.ts";

describe("short links", () => {
  it("generates unambiguous codes of the expected length", () => {
    const code = randomShortCode();
    assert.equal(code.length, SHORT_LINK_CODE_LENGTH);
    for (const ch of code) {
      assert.equal(SHORT_LINK_ALPHABET.includes(ch), true);
    }
  });

  it("only allows same-origin paths", () => {
    assert.equal(normalizeTargetPath("/respond/abc"), "/respond/abc");
    assert.equal(
      normalizeTargetPath("/respond/g/tok?item=1"),
      "/respond/g/tok?item=1"
    );
    assert.equal(normalizeTargetPath("https://evil.example/x"), null);
    assert.equal(normalizeTargetPath("//evil.example/x"), null);
    assert.equal(normalizeTargetPath("respond/abc"), null);
  });
});
