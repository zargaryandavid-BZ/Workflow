import test from "node:test";
import assert from "node:assert/strict";
import {
  clientStatusForColumn,
  isClosedClientStatus,
  normalizeJobNumber,
  parseSmsCheck,
  readSmsCheckState,
  smsCheckJobText,
  smsCheckPhoneOrdersText,
  smsCheckStateCookie,
  SMS_CHECK_NOT_FOUND_TEXT,
  titleMatchesJobNumber,
  twimlMessage,
} from "./sms-status-check.ts";

test("CHECK opens the menu, any case, with or without punctuation", () => {
  for (const body of ["CHECK", "check", " Check ", "Check.", "check -"]) {
    assert.deepEqual(parseSmsCheck(body, null), { kind: "menu" }, body);
  }
});

test("menu choices only count while the menu is open", () => {
  assert.deepEqual(parseSmsCheck("1", "menu"), { kind: "by_phone" });
  assert.deepEqual(parseSmsCheck("2", "menu"), { kind: "ask_job" });
  // Without an open menu, a bare 1/2 stays a normal reply (warehouse stock replies use 1/2/3).
  assert.deepEqual(parseSmsCheck("1", null), { kind: "none" });
  assert.deepEqual(parseSmsCheck("2", null), { kind: "none" });
  assert.deepEqual(parseSmsCheck("thanks!", "menu"), { kind: "none" });
});

test("job step takes the number, or asks again", () => {
  assert.deepEqual(parseSmsCheck("15683-2", "job"), { kind: "job", jobNumber: "15683-2" });
  assert.deepEqual(parseSmsCheck("#15683", "job"), { kind: "job", jobNumber: "15683" });
  assert.deepEqual(parseSmsCheck("bz-623", "job"), { kind: "job", jobNumber: "BZ-623" });
  assert.deepEqual(parseSmsCheck("hello there", "job"), { kind: "bad_job" });
});

test("one-message shortcuts", () => {
  assert.deepEqual(parseSmsCheck("CHECK 1", null), { kind: "by_phone" });
  assert.deepEqual(parseSmsCheck("check 2", null), { kind: "ask_job" });
  assert.deepEqual(parseSmsCheck("check 2 15683-1", null), { kind: "job", jobNumber: "15683-1" });
  assert.deepEqual(parseSmsCheck("check #15683", null), { kind: "job", jobNumber: "15683" });
  // "checking" is not the keyword
  assert.deepEqual(parseSmsCheck("checking in on my order", null), { kind: "none" });
});

test("normalizeJobNumber keeps only safe tokens", () => {
  assert.equal(normalizeJobNumber(" 15683 - 2 "), "15683-2");
  assert.equal(normalizeJobNumber("abc"), null);
  assert.equal(normalizeJobNumber("15683,title.eq.x"), null);
  assert.equal(normalizeJobNumber(""), null);
});

test("cookie round trip", () => {
  assert.equal(readSmsCheckState(`a=b; ${smsCheckStateCookie("job").split(";")[0]}`), "job");
  assert.equal(readSmsCheckState("pp_sms_check=menu"), "menu");
  assert.equal(readSmsCheckState("pp_sms_check="), null);
  assert.equal(readSmsCheckState(null), null);
  assert.match(smsCheckStateCookie(null), /Max-Age=0/);
});

test("columns map to client-friendly statuses", () => {
  const cases: [string, string][] = [
    ["Start (Create Order)", "In design"],
    ["Hold", "In design"],
    ["Arsen", "In design"],
    ["Customer Replied", "In design"],
    ["Missing Info / Changes", "Waiting for information from you"],
    ["Waiting Approval", "Waiting for your approval"],
    ["Ready for Prod", "Preparing for production"],
    ["Prepress", "Preparing for production"],
    ["In Production", "In production"],
    ["Apparel In Production", "In production"],
    ["Finishing / Converting", "In production"],
    ["Production Completed", "In production"],
    ["Outsource", "In production"],
    ["Boyd Received", "In production"],
    ["In the application", "In production"],
    ["🫡 Ready to Ship", "Ready to ship"],
    ["To be Shipped ", "Ready to ship"],
    ["Pickups ", "Ready for pickup"],
    ["🚫📦 Not Picked Up", "Ready for pickup"],
    ["Shipped Customer", "Shipped"],
    ["Finished: Review Request", "Completed"],
    ["Finished: No Review Request", "Completed"],
  ];
  for (const [col, want] of cases) assert.equal(clientStatusForColumn(col), want, col);
  assert.equal(isClosedClientStatus("Shipped"), true);
  assert.equal(isClosedClientStatus("In production"), false);
});

test("job number matches group parts and linked numbers", () => {
  assert.equal(titleMatchesJobNumber({ title: "15683-2" }, "15683"), true);
  assert.equal(titleMatchesJobNumber({ title: "15683-2" }, "15683-2"), true);
  assert.equal(titleMatchesJobNumber({ title: "15683-2" }, "15683-1"), false);
  assert.equal(titleMatchesJobNumber({ title: "156830" }, "15683"), false);
  assert.equal(
    titleMatchesJobNumber({ title: "BZ-623", crmOrderNumber: "ORD-2026-15824" }, "15824"),
    true
  );
  assert.equal(titleMatchesJobNumber({ title: "x", webhookOrderNumber: "BZ-623" }, "BZ-623"), true);
});

test("reply texts", () => {
  assert.equal(smsCheckJobText([]), SMS_CHECK_NOT_FOUND_TEXT);
  assert.equal(
    smsCheckJobText([{ number: "15683-2", status: "In production" }]),
    "Job status:\n#15683-2 — In production"
  );
  assert.match(smsCheckPhoneOrdersText([]), /could not find open orders/);
  assert.equal(
    smsCheckPhoneOrdersText([
      { number: "1", status: "A" },
      { number: "2", status: "B" },
    ]),
    "Your open orders:\n#1 — A\n#2 — B"
  );
  assert.equal(
    twimlMessage("a < b & c"),
    '<?xml version="1.0" encoding="UTF-8"?><Response><Message>a &lt; b &amp; c</Message></Response>'
  );
});
