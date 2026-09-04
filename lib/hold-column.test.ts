import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  holdNotificationRecipientIds,
  isHoldColumn,
  isHoldWatchTeammateName,
} from "./hold-column.ts";

describe("hold column", () => {
  it("matches Hold / On Hold names", () => {
    assert.equal(isHoldColumn({ name: "Hold" }), true);
    assert.equal(isHoldColumn({ name: "On Hold" }), true);
    assert.equal(isHoldColumn({ name: "Missing Info" }), false);
  });

  it("matches Rafayel in a display name", () => {
    assert.equal(isHoldWatchTeammateName("Rafayel"), true);
    assert.equal(isHoldWatchTeammateName("Rafayel Sargsyan"), true);
    assert.equal(isHoldWatchTeammateName("Maria"), false);
  });

  it("notifies owner and the watcher without duplicates", () => {
    assert.deepEqual(
      holdNotificationRecipientIds("owner-1", ["rafayel-1", "owner-1"]),
      ["owner-1", "rafayel-1"]
    );
  });

  it("does not ping the person who moved the card", () => {
    assert.deepEqual(
      holdNotificationRecipientIds("owner-1", ["rafayel-1"], "owner-1"),
      ["rafayel-1"]
    );
  });
});
