import test from "node:test";
import assert from "node:assert/strict";
import { dimensionsFromFinishedSize } from "./finished-size-dimensions";

test("parses CRM finished size with inch marks", () => {
  assert.deepEqual(dimensionsFromFinishedSize('1.875" x .7" in'), { width: "1.875", height: "0.7" });
  assert.deepEqual(dimensionsFromFinishedSize("2 x 3 in"), { width: "2", height: "3" });
  assert.deepEqual(dimensionsFromFinishedSize("2.5in × 4in"), { width: "2.5", height: "4" });
  assert.deepEqual(dimensionsFromFinishedSize("4 x 6 x 2 in"), { width: "4", height: "6" });
});

test("ignores non-dimension text", () => {
  assert.equal(dimensionsFromFinishedSize("Custom"), null);
  assert.equal(dimensionsFromFinishedSize(""), null);
  assert.equal(dimensionsFromFinishedSize(undefined), null);
});
