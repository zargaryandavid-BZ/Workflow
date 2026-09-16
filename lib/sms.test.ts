import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSmsPhone, validateSmsRecipient } from "./sms-phone.ts";

test("normalizeSmsPhone adds +1 to 10-digit US numbers", () => {
  assert.equal(normalizeSmsPhone("8185551234"), "+18185551234");
  assert.equal(normalizeSmsPhone("(818) 555-1234"), "+18185551234");
});

test("validateSmsRecipient rejects unused NANP area code 322 before Twilio", () => {
  const err = validateSmsRecipient("+13223818990");
  assert.ok(err);
  assert.match(err, /322/);
  assert.doesNotMatch(err, /XXXX/);
});

test("validateSmsRecipient allows a normal US mobile", () => {
  assert.equal(validateSmsRecipient("+18185551234"), null);
  assert.equal(validateSmsRecipient("818-555-1234"), null);
});

test("validateSmsRecipient allows an explicit international E.164 number", () => {
  assert.equal(validateSmsRecipient("+3223818990"), null);
});
