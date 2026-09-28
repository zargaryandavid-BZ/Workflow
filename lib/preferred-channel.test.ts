import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultSendChannels,
  preferredChannelFromSelection,
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
  it("saves exclusive SMS or Email, not both", () => {
    assert.equal(preferredChannelFromSelection(["sms"]), "sms");
    assert.equal(preferredChannelFromSelection(["email"]), "email");
    assert.equal(preferredChannelFromSelection(["email", "sms"]), null);
  });
});
