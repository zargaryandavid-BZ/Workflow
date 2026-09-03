import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firstMatchingTagId,
  tagNameAsExactPhrase,
} from "./tag-exact-word.ts";

describe("tagNameAsExactPhrase", () => {
  it("matches DIE REQUEST as whole words in a service title", () => {
    assert.equal(
      tagNameAsExactPhrase("Die Request for folding carton", "DIE REQUEST"),
      true
    );
    assert.equal(
      tagNameAsExactPhrase("DIE REQUEST", "DIE REQUEST"),
      true
    );
  });

  it("does not match a partial word or a different phrase", () => {
    assert.equal(tagNameAsExactPhrase("Diecut labels", "DIE REQUEST"), false);
    assert.equal(tagNameAsExactPhrase("Request only", "DIE REQUEST"), false);
    assert.equal(tagNameAsExactPhrase("Die cut stickers", "DIE REQUEST"), false);
  });

  it("ignores tags shorter than 3 characters", () => {
    assert.equal(tagNameAsExactPhrase("UV coating", "UV"), false);
  });
});

describe("firstMatchingTagId", () => {
  const tags = [
    { id: "die", name: "DIE" },
    { id: "req", name: "DIE REQUEST" },
    { id: "rush", name: "Rush Order" },
  ];

  it("prefers the longer matching tag name", () => {
    assert.equal(
      firstMatchingTagId(["0713-2 Die Request service"], tags),
      "req"
    );
  });

  it("maps Cutting (including Die (Cutting)) to DIE REQUEST", () => {
    const tags = [
      { id: "die", name: "DIE" },
      { id: "req", name: "DIE REQUEST" },
      { id: "cut", name: "Cutting" },
    ];
    assert.equal(
      firstMatchingTagId(["Die (Cutting) – Square corner"], tags),
      "req"
    );
    assert.equal(firstMatchingTagId(["Cutting"], tags), "req");
  });

  it("returns null when no tag phrase is present", () => {
    assert.equal(firstMatchingTagId(["3.5 Grams Sticker Bags"], tags), null);
  });
});
