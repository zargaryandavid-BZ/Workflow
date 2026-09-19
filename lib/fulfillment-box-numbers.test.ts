import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextAvailableBoxNumbers,
  sequentialOpenRenumber,
} from "./fulfillment-box-numbers.ts";

describe("nextAvailableBoxNumbers", () => {
  it("fills the gap so 1,3 becomes 2 next", () => {
    assert.deepEqual(nextAvailableBoxNumbers(["01", "03"], 1), ["02"]);
  });

  it("starts at 1 even when older sent boxes used 1 and 2", () => {
    assert.deepEqual(nextAvailableBoxNumbers([], 2), ["01", "02"]);
  });
});

describe("sequentialOpenRenumber", () => {
  it("renumbers open 1 and 3 to 1 and 2", () => {
    const next = sequentialOpenRenumber(
      [
        { id: "a", box_number: "01" },
        { id: "c", box_number: "03" },
      ],
      []
    );
    assert.deepEqual(
      next.map((b) => b.box_number),
      ["01", "02"]
    );
  });

  it("does not skip numbers used by sent boxes", () => {
    const next = sequentialOpenRenumber(
      [{ id: "open", box_number: "05" }],
      ["01", "02"]
    );
    assert.deepEqual(
      next.map((b) => b.box_number),
      ["01"]
    );
  });
});
