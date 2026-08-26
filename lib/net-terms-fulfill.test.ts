import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  finishedCustomerSmsKind,
  isFulfilledStage,
  reviewStateFromStage,
} from "./net-terms-fulfill.ts";

describe("isFulfilledStage", () => {
  it("matches Finished and Fulfilled columns, not mid-pipeline names", () => {
    assert.equal(isFulfilledStage("Finished: Review Request"), true);
    assert.equal(isFulfilledStage("Finished: No Review Request"), true);
    assert.equal(isFulfilledStage("Fulfilled: Pickup"), true);
    assert.equal(isFulfilledStage("Design Finished"), false);
    assert.equal(isFulfilledStage("In Progress"), false);
  });
});

describe("reviewStateFromStage", () => {
  it("treats Review Request and Review Required as review", () => {
    assert.equal(reviewStateFromStage("Finished: Review Request"), "required");
    assert.equal(reviewStateFromStage("Finished: Review Required"), "required");
  });

  it("treats No Review columns as not required", () => {
    assert.equal(
      reviewStateFromStage("Finished: No Review Request"),
      "not_required"
    );
    assert.equal(
      reviewStateFromStage("Finished: No Review Required"),
      "not_required"
    );
  });
});

describe("finishedCustomerSmsKind", () => {
  it("sends the review SMS on review columns", () => {
    assert.equal(
      finishedCustomerSmsKind("Finished: Review Request"),
      "review"
    );
  });

  it("sends the no-review SMS on no-review and generic finished columns", () => {
    assert.equal(
      finishedCustomerSmsKind("Finished: No Review Request"),
      "no_review"
    );
    assert.equal(finishedCustomerSmsKind("Finished: Fulfilled"), "no_review");
  });

  it("does not send on other columns", () => {
    assert.equal(finishedCustomerSmsKind("Ready to Ship"), null);
    assert.equal(finishedCustomerSmsKind("Design Finished"), null);
  });
});
