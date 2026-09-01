import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeSourceChannel,
  shouldApplyMissingInfoFallback,
  sourceChannelDisplay,
} from "./source-channel.ts";

test("persists a known source_channel", () => {
  assert.equal(normalizeSourceChannel("email"), "email");
  assert.equal(normalizeSourceChannel(" Email "), "email");
  assert.equal(normalizeSourceChannel("IG_DM"), "ig_dm");
});

test("empty or omitted source_channel is null and does not throw", () => {
  assert.equal(normalizeSourceChannel(""), null);
  assert.equal(normalizeSourceChannel("   "), null);
  assert.equal(normalizeSourceChannel(undefined), null);
  assert.equal(normalizeSourceChannel(null), null);
});

test("unknown source_channel is null", () => {
  assert.equal(normalizeSourceChannel("fax"), null);
  assert.equal(normalizeSourceChannel("crm"), null);
});

test("sourceChannelDisplay hides empty/unknown and labels email", () => {
  assert.equal(sourceChannelDisplay(""), null);
  assert.equal(sourceChannelDisplay(undefined), null);
  assert.deepEqual(sourceChannelDisplay("email")?.label, "Email");
});

test("missing-info fallback is skipped when initial_column is named", () => {
  assert.equal(
    shouldApplyMissingInfoFallback({
      initialColumn: "Missing Info",
      designSource: "files_coming",
      needsCustomerFiles: true,
    }),
    false
  );
  assert.equal(
    shouldApplyMissingInfoFallback({
      initialColumn: "Typo Column",
      designSource: "files_coming",
      needsCustomerFiles: true,
    }),
    false
  );
});

test("missing-info fallback uses files_coming or needs_customer_files", () => {
  assert.equal(
    shouldApplyMissingInfoFallback({
      initialColumn: "",
      designSource: "files_coming",
      needsCustomerFiles: false,
    }),
    true
  );
  assert.equal(
    shouldApplyMissingInfoFallback({
      initialColumn: null,
      designSource: "has_files",
      needsCustomerFiles: true,
    }),
    true
  );
  assert.equal(
    shouldApplyMissingInfoFallback({
      initialColumn: undefined,
      designSource: "has_files",
      needsCustomerFiles: false,
    }),
    false
  );
});
