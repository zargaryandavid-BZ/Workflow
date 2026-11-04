import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSentHistoryShareToken,
  verifySentHistoryShareToken,
} from "./sent-history-share.ts";

describe("sent history share token", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");

  it("round-trips the tenant until it expires", () => {
    const token = createSentHistoryShareToken("tenant-1", "secret", now, 90);
    assert.equal(verifySentHistoryShareToken(token, "secret", now), "tenant-1");
    assert.equal(
      verifySentHistoryShareToken(token, "secret", now + 91 * 24 * 60 * 60 * 1000),
      null
    );
  });

  it("rejects a tampered token or the wrong secret", () => {
    const token = createSentHistoryShareToken("tenant-1", "secret", now);
    const [payload, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ t: "tenant-2", e: now + 1e9 })).toString("base64url")}.${sig}`;
    assert.equal(verifySentHistoryShareToken(forged, "secret", now), null);
    assert.equal(verifySentHistoryShareToken(token, "other", now), null);
    assert.equal(verifySentHistoryShareToken(`${payload}`, "secret", now), null);
  });
});
