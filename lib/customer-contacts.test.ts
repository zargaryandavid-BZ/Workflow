import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PRIMARY_CONTACT_ID,
  buildNotifyDestinations,
  extraSmsPhonesExcludingPrimary,
  uniqueSmsPhones,
} from "./customer-contacts.ts";

describe("buildNotifyDestinations", () => {
  it("uses the primary contact as toEmail/toPhone and extras as CC/SMS", () => {
    const dest = buildNotifyDestinations(
      [
        {
          id: PRIMARY_CONTACT_ID,
          name: "Alex",
          email: "alex@co.com",
          phone: "+18185550111",
        },
        {
          id: "c2",
          name: "Jordan",
          email: "jordan@co.com",
          phone: "+18185550222",
        },
      ],
      [PRIMARY_CONTACT_ID, "c2"]
    );
    assert.equal(dest.toEmail, "alex@co.com");
    assert.deepEqual(dest.ccEmails, ["jordan@co.com"]);
    assert.equal(dest.toPhone, "+18185550111");
    assert.deepEqual(dest.extraSmsPhones, ["+18185550222"]);
  });

  it("skips a member who is not checked", () => {
    const dest = buildNotifyDestinations(
      [
        {
          id: PRIMARY_CONTACT_ID,
          name: "Alex",
          email: "alex@co.com",
          phone: null,
        },
        {
          id: "c2",
          name: "Jordan",
          email: "jordan@co.com",
          phone: null,
        },
      ],
      [PRIMARY_CONTACT_ID]
    );
    assert.equal(dest.toEmail, "alex@co.com");
    assert.deepEqual(dest.ccEmails, []);
  });
});

describe("uniqueSmsPhones", () => {
  it("dedupes the same number in different formats", () => {
    assert.deepEqual(
      uniqueSmsPhones(["818-555-0111", "+1 818 555 0111", "8185550111"]),
      ["818-555-0111"]
    );
  });
});

describe("extraSmsPhonesExcludingPrimary", () => {
  it("drops the primary number from extras", () => {
    assert.deepEqual(
      extraSmsPhonesExcludingPrimary(
        ["+18185550111", "+18185550222"],
        "818-555-0111"
      ),
      ["+18185550222"]
    );
  });
});
