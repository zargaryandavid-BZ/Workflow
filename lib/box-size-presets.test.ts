import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { missingBoxFieldsMessage, removeBoxDraft } from "./box-size-presets.ts";

const full = { length: "18", width: "12", height: "12", weight: "4" };

describe("removeBoxDraft", () => {
  it("removes the chosen box and keeps the last one", () => {
    assert.deepEqual(removeBoxDraft(["a", "b", "c"], 1), ["a", "c"]);
    assert.deepEqual(removeBoxDraft(["a"], 0), ["a"]);
  });
});

describe("missingBoxFieldsMessage", () => {
  it("is null when every box is complete", () => {
    assert.equal(missingBoxFieldsMessage([full, full]), null);
  });

  it("names the missing field and boxes", () => {
    assert.equal(
      missingBoxFieldsMessage([
        { ...full, weight: "" },
        { ...full, weight: "" },
      ]),
      "Enter weight for Box 1 & 2"
    );
    assert.equal(
      missingBoxFieldsMessage([full, { ...full, height: "0", weight: "" }]),
      "Enter height & weight for Box 2"
    );
  });

  it("drops the box number when there is only one box", () => {
    assert.equal(
      missingBoxFieldsMessage([{ length: "", width: "", height: "", weight: "" }]),
      "Enter size and weight"
    );
  });
});
