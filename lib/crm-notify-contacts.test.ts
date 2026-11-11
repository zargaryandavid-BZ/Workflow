import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extraNotifyRecipients,
  parseCrmNotifyContacts,
} from "./crm-notify-contacts.ts";

describe("CRM company notify contacts (item 17)", () => {
  const c = parseCrmNotifyContacts({
    found: true,
    approval_emails: ["Art@Acme.com", "nope"],
    shipping_emails: ["dock@acme.com", "owner@acme.com"],
    billing_emails: [],
    cc_rep_on_approvals: true,
    rep_email: "rep@bazaarprinting.com",
  });

  it("approvals go to approval emails + the rep when the toggle is on", () => {
    assert.deepEqual(extraNotifyRecipients(c, "approval", "owner@acme.com"), [
      "art@acme.com",
      "rep@bazaarprinting.com",
    ]);
  });
  it("shipping goes to shipping emails, never repeating the main address", () => {
    assert.deepEqual(extraNotifyRecipients(c, "shipping", "Owner@acme.com"), ["dock@acme.com"]);
  });
  it("rep is not copied when the toggle is off", () => {
    const off = parseCrmNotifyContacts({ found: true, cc_rep_on_approvals: false, rep_email: "rep@x.com" });
    assert.deepEqual(extraNotifyRecipients(off, "approval", null), []);
  });
  it("not found / bad reply → nothing extra", () => {
    assert.equal(parseCrmNotifyContacts({ found: false }), null);
    assert.deepEqual(extraNotifyRecipients(null, "shipping", "a@b.com"), []);
  });
});
