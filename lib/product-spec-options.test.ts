import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSetSizeValue,
  isSetSizeKey,
  nestedFieldOptions,
  normalizeSpecSelectOptions,
  parseSetSizeValue,
} from "./product-spec-options.ts";

describe("set size helpers", () => {
  it("recognizes SET_SIZE keys", () => {
    assert.equal(isSetSizeKey("SET_SIZE"), true);
    assert.equal(isSetSizeKey("SET SIZE"), true);
    assert.equal(isSetSizeKey("set-size"), true);
    assert.equal(isSetSizeKey("ROLL_DIRECTION"), false);
  });

  it("formats and parses WxH", () => {
    assert.equal(formatSetSizeValue("2", "4.5"), "2x4.5");
    assert.deepEqual(parseSetSizeValue("2x4.5"), {
      width: "2",
      height: "4.5",
    });
    assert.deepEqual(parseSetSizeValue("2 × 4.5"), {
      width: "2",
      height: "4.5",
    });
    assert.equal(parseSetSizeValue(""), null);
  });

  it("normalizes CRM option shapes", () => {
    assert.deepEqual(
      normalizeSpecSelectOptions([
        { value: "2x3.65", label: "2x3.65" },
        "4x2.75",
        { name: "2.5x3.5" },
      ]),
      [
        { value: "2x3.65", label: "2x3.65" },
        { value: "4x2.75", label: "4x2.75" },
        { value: "2.5x3.5", label: "2.5x3.5" },
      ]
    );
    assert.deepEqual(normalizeSpecSelectOptions(null), []);
    assert.deepEqual(normalizeSpecSelectOptions({ value: "x" }), []);
  });

  it("reads field_options from v1 or nested v2 options", () => {
    assert.deepEqual(
      nestedFieldOptions({ field_options: { SET_SIZE: [1] } }),
      { SET_SIZE: [1] }
    );
    assert.deepEqual(
      nestedFieldOptions({
        options: { field_options: { SET_SIZE: [{ value: "2x3" }] } },
      }),
      { SET_SIZE: [{ value: "2x3" }] }
    );
    assert.equal(nestedFieldOptions({ name: "Roll Labels" }), null);
  });
});
