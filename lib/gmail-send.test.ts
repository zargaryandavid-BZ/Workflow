import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeGmailRawMessage, gmailFromAddress } from "./gmail-send.ts";

describe("gmail raw message", () => {
  it("encodes from, to, subject, and html", () => {
    const raw = encodeGmailRawMessage({
      from: "Bazaar Printing <noreply@bazaarprinting.com>",
      to: "ada@example.com",
      subject: "Missing files: 15196-1",
      html: "<p>Please upload files</p>",
      text: "Please upload files",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    assert.match(decoded, /From: Bazaar Printing <noreply@bazaarprinting.com>/);
    assert.match(decoded, /To: ada@example.com/);
    assert.match(decoded, /Subject: Missing files: 15196-1/);
    const htmlB64 = Buffer.from("<p>Please upload files</p>", "utf8").toString(
      "base64"
    );
    assert.match(decoded, new RegExp(htmlB64.replace(/[+]/g, "\\+")));
  });
});

describe("gmail from address", () => {
  it("defaults to noreply@bazaarprinting.com", () => {
    const prev = process.env.GMAIL_FROM_EMAIL;
    try {
      delete process.env.GMAIL_FROM_EMAIL;
      assert.equal(gmailFromAddress(), "noreply@bazaarprinting.com");
    } finally {
      if (prev !== undefined) process.env.GMAIL_FROM_EMAIL = prev;
      else delete process.env.GMAIL_FROM_EMAIL;
    }
  });
});
