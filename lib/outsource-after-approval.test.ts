import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isOutsourceAfterApprovalProduct,
  isOutsourceColumnName,
} from "./outsource-after-approval.ts";

test("gift bags, wrapping paper, gift wrap rolls are outsourced", () => {
  for (const t of [
    "Gift Bags",
    "Custom Gift Bag",
    "Wrapping Paper",
    "Custom Gift Wrap Rolls",
    "Gift Wrapping Paper",
    "Wrap Rolls",
  ]) {
    assert.equal(isOutsourceAfterApprovalProduct([null, t]), true, t);
  }
});

test("in-house products are not outsourced", () => {
  for (const t of [
    "Roll Labels",
    "Mylar Bags",
    "Paper Bags",
    "Shrink Sleeves",
    "Business Cards",
    "",
  ]) {
    assert.equal(isOutsourceAfterApprovalProduct([t]), false, t);
  }
  assert.equal(isOutsourceAfterApprovalProduct([null, undefined]), false);
});

test("Outsource column name match", () => {
  assert.equal(isOutsourceColumnName(" OUTSOURCE "), true);
  assert.equal(isOutsourceColumnName("Outsourced vendors"), false);
  assert.equal(isOutsourceColumnName(null), false);
});
