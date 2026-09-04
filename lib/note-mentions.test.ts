import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mentionQueryAtCursor,
  mentionedUserIds,
} from "./note-mentions.ts";

const members = [
  { id: "a", fullName: "Alex Rivera" },
  { id: "r", fullName: "Rafayel" },
  { id: "b", fullName: "Bob Smith" },
];

describe("mentionedUserIds", () => {
  it("matches full names longest-first", () => {
    assert.deepEqual(
      mentionedUserIds("Please see @Alex Rivera about this.", members),
      ["a"]
    );
  });

  it("matches a unique first name", () => {
    assert.deepEqual(mentionedUserIds("Hey @Alex can you look?", members), ["a"]);
  });

  it("matches a single-token full name", () => {
    assert.deepEqual(mentionedUserIds("cc @Rafayel thanks", members), ["r"]);
  });

  it("skips the author via caller; still finds the mention", () => {
    assert.deepEqual(mentionedUserIds("@Rafayel and @Bob Smith", members).sort(), [
      "b",
      "r",
    ]);
  });

  it("deduplicates the same person", () => {
    assert.deepEqual(
      mentionedUserIds("@Rafayel please and @Rafayel again", members),
      ["r"]
    );
  });

  it("does not match emails", () => {
    assert.deepEqual(mentionedUserIds("email rafayel@example.com", members), []);
  });

  it("ignores unknown names", () => {
    assert.deepEqual(mentionedUserIds("@Nobody here", members), []);
  });
});

describe("mentionQueryAtCursor", () => {
  it("finds the query after @", () => {
    assert.deepEqual(mentionQueryAtCursor("Hi @Al", 6), {
      start: 3,
      query: "Al",
    });
  });

  it("returns null when @ is mid-word", () => {
    assert.equal(mentionQueryAtCursor("a@b", 3), null);
  });
});
