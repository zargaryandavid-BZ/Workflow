import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  automaticNotifyChannels,
  defaultSendChannels,
  isExplicitPreferredChannel,
  normalizePreferredChannel,
  preferredChannelFallbackNote,
  preferredChannelFromSelection,
  preferredChannelLabel,
  rerequestChannel,
  resolvePreferredNotifyChannel,
  toggleSendChannelSelection,
} from "./preferred-channel.ts";

const both = { email: "a@b.com", phone: "+15551212" };

describe("defaultSendChannels", () => {
  it("selects SMS when that is the customer default", () => {
    assert.deepEqual(defaultSendChannels(both, "sms", true), ["sms"]);
  });

  it("selects Email when that is the customer default", () => {
    assert.deepEqual(defaultSendChannels(both, "email", true), ["email"]);
  });

  it("falls back to email if SMS is preferred but there is no phone", () => {
    assert.deepEqual(
      defaultSendChannels({ email: "a@b.com", phone: null }, "sms", true),
      ["email"]
    );
  });
});

describe("toggleSendChannelSelection", () => {
  it("adds the other channel without dropping the first", () => {
    assert.deepEqual(toggleSendChannelSelection(["sms"], "email"), [
      "sms",
      "email",
    ]);
  });

  it("will not leave zero channels selected", () => {
    assert.deepEqual(toggleSendChannelSelection(["sms"], "sms"), ["sms"]);
  });
});

describe("preferredChannelFromSelection", () => {
  it("maps a selection to Email, SMS or Both", () => {
    assert.equal(preferredChannelFromSelection(["sms"]), "sms");
    assert.equal(preferredChannelFromSelection(["email"]), "email");
    assert.equal(preferredChannelFromSelection(["email", "sms"]), "both");
    assert.equal(preferredChannelFromSelection([]), null);
  });
});

describe("Both preference", () => {
  it("normalizes and labels both", () => {
    assert.equal(normalizePreferredChannel("both"), "both");
    assert.equal(normalizePreferredChannel(undefined), "sms");
    assert.equal(preferredChannelLabel("both"), "Email + SMS");
  });

  it("selects Email and SMS when the customer default is Both", () => {
    assert.deepEqual(defaultSendChannels(both, "both", true), ["email", "sms"]);
    assert.equal(resolvePreferredNotifyChannel(both, "both", true), "both");
  });

  it("falls back to the available channel when Both lacks a contact", () => {
    assert.deepEqual(
      defaultSendChannels({ email: "a@b.com", phone: null }, "both", true),
      ["email"]
    );
    assert.deepEqual(
      defaultSendChannels({ email: null, phone: "+15551212" }, "both", true),
      ["sms"]
    );
  });
});

describe("regression: card customer missing preferred_channel", () => {
  // 15504-1: customer saved Email, but the card's customer join had no
  // preferred_channel, so the panel saw undefined and defaulted to SMS.
  it("undefined preference defaults to SMS (why the join must include it)", () => {
    assert.deepEqual(defaultSendChannels(both, undefined, true), ["sms"]);
    assert.deepEqual(defaultSendChannels(both, "email", true), ["email"]);
  });
});

describe("isExplicitPreferredChannel", () => {
  it("treats the DB default sms as not chosen", () => {
    assert.equal(isExplicitPreferredChannel({ preferred_channel: "sms" }), false);
    assert.equal(
      isExplicitPreferredChannel({
        preferred_channel: "sms",
        preferred_channel_set_at: "2026-10-20T00:00:00Z",
      }),
      true
    );
    assert.equal(isExplicitPreferredChannel({ preferred_channel: "email" }), true);
    assert.equal(isExplicitPreferredChannel({ preferred_channel: "both" }), true);
    assert.equal(isExplicitPreferredChannel(null), false);
  });
});

describe("automaticNotifyChannels", () => {
  const contact = { email: "a@b.com", phone: "+15551212" };
  it("keeps every contact when the customer never chose", () => {
    assert.deepEqual(
      automaticNotifyChannels({ ...contact, preferred: "sms", explicit: false }),
      { email: true, sms: true }
    );
  });
  it("honors an explicit Email / SMS / Both default", () => {
    assert.deepEqual(
      automaticNotifyChannels({ ...contact, preferred: "email", explicit: true }),
      { email: true, sms: false }
    );
    assert.deepEqual(
      automaticNotifyChannels({ ...contact, preferred: "sms", explicit: true }),
      { email: false, sms: true }
    );
    assert.deepEqual(
      automaticNotifyChannels({ ...contact, preferred: "both", explicit: true }),
      { email: true, sms: true }
    );
  });
  it("falls back so the customer still hears", () => {
    assert.deepEqual(
      automaticNotifyChannels({
        email: null,
        phone: "+15551212",
        preferred: "email",
        explicit: true,
      }),
      { email: false, sms: true }
    );
  });
});

describe("rerequestChannel (batch re-request of stale requests)", () => {
  it("uses the saved Email default instead of the last SMS send", () => {
    // Safe Care Packaging: saved Email, earlier sends went out by SMS.
    assert.equal(
      rerequestChannel({
        previous: "sms",
        email: "safecarepackaging@gmail.com",
        phone: "+18188569944",
        preferred: "email",
        explicit: true,
      }),
      "email"
    );
  });

  it("keeps the last channel when the customer never chose", () => {
    assert.equal(
      rerequestChannel({
        previous: "both",
        email: "a@b.com",
        phone: "+15551212",
        preferred: "sms",
        explicit: false,
      }),
      "both"
    );
  });

  it("falls back to the other method when the preferred contact is missing", () => {
    assert.equal(
      rerequestChannel({
        previous: "email",
        email: null,
        phone: "+15551212",
        preferred: "email",
        explicit: true,
      }),
      "sms"
    );
  });

  it("treats an unknown previous channel as email", () => {
    assert.equal(
      rerequestChannel({
        previous: "manual",
        email: "a@b.com",
        phone: null,
        preferred: "sms",
        explicit: false,
      }),
      "email"
    );
  });
});

describe("preferredChannelFallbackNote", () => {
  it("explains why SMS is selected for an Email customer with no email", () => {
    // Duplicate "Safe Care Packaging" record bf256e64: Email, phone only.
    assert.match(
      preferredChannelFallbackNote(
        { email: null, phone: "+14243660000" },
        "email"
      ) ?? "",
      /no email address, so SMS/
    );
  });

  it("is silent when the saved default can be used", () => {
    assert.equal(preferredChannelFallbackNote(both, "email"), null);
    assert.equal(preferredChannelFallbackNote(both, "sms"), null);
    assert.equal(preferredChannelFallbackNote(both, "both"), null);
  });

  it("is silent when there is no contact at all", () => {
    assert.equal(
      preferredChannelFallbackNote({ email: null, phone: null }, "email"),
      null
    );
  });
});
