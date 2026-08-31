import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMissingInfoNotifyHoldColumn,
  recipientsAfterMissingInfoHold,
} from "./column-notify-hold.ts";

describe("isMissingInfoNotifyHoldColumn", () => {
  it("holds exception-kind columns", () => {
    assert.equal(
      isMissingInfoNotifyHoldColumn({
        kind: "exception",
        name: "On Hold",
      }),
      true
    );
  });

  it("holds columns named Missing Info even without exception kind", () => {
    assert.equal(
      isMissingInfoNotifyHoldColumn({
        kind: "normal",
        name: "Missing Info / Changes",
      }),
      true
    );
  });

  it("does not hold production columns", () => {
    assert.equal(
      isMissingInfoNotifyHoldColumn({
        kind: "normal",
        name: "In Progress",
      }),
      false
    );
  });
});

describe("recipientsAfterMissingInfoHold", () => {
  const base = {
    emails: ["dz@example.com", "shop@bazar.com"],
    phones: ["+18185551234", "+18185559999"],
    customerEmail: "dz@example.com",
    customerPhone: "818-555-1234",
  };

  it("leaves recipients unchanged when not holding", () => {
    assert.deepEqual(
      recipientsAfterMissingInfoHold({
        ...base,
        holdCustomer: false,
        recipient: "customer",
      }),
      { emails: base.emails, phones: base.phones }
    );
  });

  it("clears customer-only rules on hold", () => {
    assert.deepEqual(
      recipientsAfterMissingInfoHold({
        ...base,
        holdCustomer: true,
        recipient: "customer",
      }),
      { emails: [], phones: [] }
    );
  });

  it("keeps staff contacts on both-recipient rules", () => {
    assert.deepEqual(
      recipientsAfterMissingInfoHold({
        ...base,
        holdCustomer: true,
        recipient: "both",
      }),
      {
        emails: ["shop@bazar.com"],
        phones: ["+18185559999"],
      }
    );
  });

  it("does not strip staff-only rules", () => {
    assert.deepEqual(
      recipientsAfterMissingInfoHold({
        ...base,
        holdCustomer: true,
        recipient: "staff",
      }),
      { emails: base.emails, phones: base.phones }
    );
  });
});
