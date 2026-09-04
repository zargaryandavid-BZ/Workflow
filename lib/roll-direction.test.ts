import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRollDirectionField,
  isRollDirectionFieldName,
  normalizeRollDirectionValue,
  rollDirectionArtworkRotateDeg,
  rollDirectionFromRespondRows,
  rollDirectionOption,
  rollDirectionPrintCaption,
} from "./roll-direction.ts";

describe("roll direction", () => {
  it("recognizes Position and Roll Direction fields", () => {
    assert.equal(isRollDirectionFieldName("Roll Direction"), true);
    assert.equal(isRollDirectionFieldName("Position"), true);
    assert.equal(
      isRollDirectionField({
        name: "Unwind",
        options: ["1-Top", "2-Bottom"],
      }),
      true
    );
  });

  it("normalizes CRM labels to card values", () => {
    assert.equal(normalizeRollDirectionValue("1-Top"), "1-Top");
    assert.equal(normalizeRollDirectionValue("1 · Top of Copy"), "1-Top");
    assert.equal(normalizeRollDirectionValue("2-Bottom"), "2-Bottom");
    assert.equal(normalizeRollDirectionValue("3 Right"), "3-Right");
    assert.equal(normalizeRollDirectionValue("4-Left"), "4-Left");
    assert.equal(normalizeRollDirectionValue("nope"), null);
  });

  it("resolves the diagram for a stored value", () => {
    assert.equal(rollDirectionOption("2-Bottom")?.src, "/roll-direction/2-bottom.png");
    assert.equal(rollDirectionOption("")?.src, undefined);
  });

  it("reads roll direction from customer respond rows", () => {
    assert.equal(
      rollDirectionFromRespondRows([
        { label: "Product", value: "Roll Labels" },
        { label: "Roll Direction", value: "4-Left" },
      ]),
      "4-Left"
    );
    assert.equal(rollDirectionArtworkRotateDeg("4-Left"), -90);
    assert.equal(rollDirectionArtworkRotateDeg("1-Top"), 0);
    assert.equal(
      rollDirectionPrintCaption("4-Left"),
      "Left of copy off first"
    );
  });
});
