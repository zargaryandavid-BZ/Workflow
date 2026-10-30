import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  finishedCompletionSmsSent,
  finishedCustomerSmsKind,
  isFinishedNoReviewStage,
  isFulfilledStage,
  isInvoiceTriggerStage,
  preserveFinishedCustomerSms,
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
    assert.equal(
      reviewStateFromStage("Finished - Not Review"),
      "not_required"
    );
  });
});

describe("isFinishedNoReviewStage", () => {
  it("matches explicit no-review finished columns only", () => {
    assert.equal(isFinishedNoReviewStage("Finished: No Review Request"), true);
    assert.equal(isFinishedNoReviewStage("Finished - Not Review"), true);
    assert.equal(isFinishedNoReviewStage("Finished: Review Request"), false);
    assert.equal(isFinishedNoReviewStage("Finished: Fulfilled"), false);
    assert.equal(isFinishedNoReviewStage("In Progress"), false);
  });
});

describe("finishedCompletionSmsSent", () => {
  it("is true only after a send, not after skip", () => {
    assert.equal(finishedCompletionSmsSent({}), false);
    assert.equal(
      finishedCompletionSmsSent({
        finished_customer_sms: { skipped: true },
      }),
      false
    );
    assert.equal(
      finishedCompletionSmsSent({
        finished_customer_sms: { sent_at: "2026-08-28T00:00:00.000Z" },
      }),
      true
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

describe("preserveFinishedCustomerSms", () => {
  it("keeps the saved flag when a specs PATCH omits it", () => {
    const saved = {
      finished_customer_sms: { sent_at: "2026-09-18T00:00:00.000Z" },
    };
    const next = preserveFinishedCustomerSms(saved, { skus: [] });
    assert.deepEqual(next.finished_customer_sms, saved.finished_customer_sms);
  });
});

describe("isInvoiceTriggerStage", () => {
  it("fires on every Finished / Fulfilled column", () => {
    assert.equal(isInvoiceTriggerStage("Finished: No Review Request"), true);
    assert.equal(isInvoiceTriggerStage("Finished: Review Request"), true);
    assert.equal(isInvoiceTriggerStage("Fulfilled"), true);
  });
  it("fires on Shipped Customer", () => {
    assert.equal(isInvoiceTriggerStage("Shipped Customer"), true);
    assert.equal(isInvoiceTriggerStage("Shipped to Customer"), true);
  });
  it("does not fire on other columns", () => {
    assert.equal(isInvoiceTriggerStage("Shipped Boyd"), false);
    assert.equal(isInvoiceTriggerStage("🫡 Ready to Ship"), false);
    assert.equal(isInvoiceTriggerStage("To be Shipped"), false);
    assert.equal(isInvoiceTriggerStage("Design Finished"), false);
    assert.equal(isInvoiceTriggerStage(null), false);
  });
  it("Shipped Customer stays out of the finished/review SMS", () => {
    assert.equal(isFulfilledStage("Shipped Customer"), false);
  });
});
