import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  customerReplyToAddress,
  encodeGmailRawMessage,
  gmailFromAddress,
} from "./gmail-send.ts";

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

describe("gmail reply-to (replies go to info@, not the sending mailbox)", () => {
  it("adds Reply-To when given", () => {
    const raw = encodeGmailRawMessage({
      from: "Bazaar Printing <noreply@bazaarprinting.com>",
      to: "ada@example.com",
      subject: "x",
      html: "<p>x</p>",
      replyTo: customerReplyToAddress(),
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    assert.match(decoded, /Reply-To: info@bazaarprinting.com/);
  });
  it("can be turned off with CUSTOMER_REPLY_TO_EMAIL=none", () => {
    const prev = process.env.CUSTOMER_REPLY_TO_EMAIL;
    try {
      process.env.CUSTOMER_REPLY_TO_EMAIL = "none";
      assert.equal(customerReplyToAddress(), null);
    } finally {
      if (prev !== undefined) process.env.CUSTOMER_REPLY_TO_EMAIL = prev;
      else delete process.env.CUSTOMER_REPLY_TO_EMAIL;
    }
  });
});
