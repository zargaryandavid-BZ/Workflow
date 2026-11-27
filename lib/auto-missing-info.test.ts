import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTO_MISSING_INFO_GRACE_MS,
  AUTO_MISSING_INFO_MAX_AGE_MS,
  AUTO_MISSING_INFO_SPEC_KEY,
  autoMissingInfoAllowed,
  autoMissingInfoChannel,
  autoMissingInfoTiming,
  buildAutoMissingInfoMarker,
  driveListingHasFiles,
  orderArrivedWithoutFiles,
  readAutoMissingInfoMarker,
} from "./auto-missing-info.ts";

const base = {
  enabled: true,
  incomingHasArtwork: false,
  isReorder: false,
  designSource: null as string | null,
};

test("new no-file order may land in Missing Info", () => {
  assert.equal(autoMissingInfoAllowed(base), true);
  assert.equal(autoMissingInfoAllowed({ ...base, designSource: "files_coming" }), true);
});

test("never when switched off, files came with the order, reorder, or design order", () => {
  assert.equal(autoMissingInfoAllowed({ ...base, enabled: false }), false);
  assert.equal(autoMissingInfoAllowed({ ...base, incomingHasArtwork: true }), false);
  assert.equal(autoMissingInfoAllowed({ ...base, isReorder: true }), false);
  assert.equal(autoMissingInfoAllowed({ ...base, designSource: "needs_design" }), false);
  assert.equal(autoMissingInfoAllowed({ ...base, designSource: " Needs_Design " }), false);
});

test("arrived without files: needs_customer_files or files_coming, never with artwork", () => {
  assert.equal(
    orderArrivedWithoutFiles({ needsCustomerFiles: true, designSource: null, incomingHasArtwork: false }),
    true
  );
  assert.equal(
    orderArrivedWithoutFiles({ needsCustomerFiles: false, designSource: "files_coming", incomingHasArtwork: false }),
    true
  );
  assert.equal(
    orderArrivedWithoutFiles({ needsCustomerFiles: false, designSource: "has_files", incomingHasArtwork: false }),
    false
  );
  assert.equal(
    orderArrivedWithoutFiles({ needsCustomerFiles: false, designSource: null, incomingHasArtwork: false }),
    false
  );
  assert.equal(
    orderArrivedWithoutFiles({ needsCustomerFiles: true, designSource: "files_coming", incomingHasArtwork: true }),
    false
  );
});

test("marker round-trips through specs and rejects junk", () => {
  const now = new Date("2026-11-26T18:00:00.000Z");
  const marker = buildAutoMissingInfoMarker(now);
  assert.deepEqual(marker, { at: "2026-11-26T18:00:00.000Z", reason: "no_files" });
  assert.deepEqual(readAutoMissingInfoMarker({ [AUTO_MISSING_INFO_SPEC_KEY]: marker }), marker);
  assert.equal(readAutoMissingInfoMarker(null), null);
  assert.equal(readAutoMissingInfoMarker({}), null);
  assert.equal(readAutoMissingInfoMarker({ [AUTO_MISSING_INFO_SPEC_KEY]: true }), null);
  assert.equal(readAutoMissingInfoMarker({ [AUTO_MISSING_INFO_SPEC_KEY]: { at: "nope" } }), null);
});

test("timing: wait during grace, due after, too old after max age", () => {
  const at = "2026-11-26T18:00:00.000Z";
  const t0 = new Date(at).getTime();
  assert.equal(autoMissingInfoTiming(at, t0), "wait");
  assert.equal(autoMissingInfoTiming(at, t0 + AUTO_MISSING_INFO_GRACE_MS - 1), "wait");
  assert.equal(autoMissingInfoTiming(at, t0 + AUTO_MISSING_INFO_GRACE_MS), "due");
  assert.equal(autoMissingInfoTiming(at, t0 + AUTO_MISSING_INFO_MAX_AGE_MS), "due");
  assert.equal(autoMissingInfoTiming(at, t0 + AUTO_MISSING_INFO_MAX_AGE_MS + 1), "too_old");
  assert.equal(autoMissingInfoTiming("garbage", t0), "too_old");
});

test("channel: saved default wins; none saved → email; no contact → null", () => {
  const both = { email: "a@b.co", phone: "+15555550100", smsConfigured: true };
  // Never chose (DB default 'sms' without set_at) → email.
  assert.equal(autoMissingInfoChannel({ ...both, preferred: "sms", explicit: false }), "email");
  // Saved defaults.
  assert.equal(autoMissingInfoChannel({ ...both, preferred: "sms", explicit: true }), "sms");
  assert.equal(autoMissingInfoChannel({ ...both, preferred: "both", explicit: true }), "both");
  assert.equal(autoMissingInfoChannel({ ...both, preferred: "email", explicit: true }), "email");
  // Saved SMS but SMS not configured → email.
  assert.equal(
    autoMissingInfoChannel({ ...both, smsConfigured: false, preferred: "sms", explicit: true }),
    "email"
  );
  // No email on file → SMS fallback.
  assert.equal(
    autoMissingInfoChannel({ email: null, phone: "+15555550100", smsConfigured: true, preferred: null, explicit: false }),
    "sms"
  );
  assert.equal(
    autoMissingInfoChannel({ email: "", phone: "", smsConfigured: true, preferred: "both", explicit: true }),
    null
  );
});

test("drive listing: only real files count, folders do not", () => {
  assert.equal(driveListingHasFiles([]), false);
  assert.equal(
    driveListingHasFiles([{ mimeType: "application/vnd.google-apps.folder" }]),
    false
  );
  assert.equal(
    driveListingHasFiles([
      { mimeType: "application/vnd.google-apps.folder" },
      { mimeType: "application/pdf" },
    ]),
    true
  );
});
