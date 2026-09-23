import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatReadyToShipGroupLabel,
  formatReadyToShipNotifyLabel,
} from "./ready-to-ship-group.ts";

const RTS = "rts-col";
const OTHER = "other-col";

function member(
  title: string,
  column_id: string,
  webhook = "ORD-2026-0712"
) {
  return {
    title,
    column_id,
    specs: { webhook_order_number: webhook },
  };
}

describe("formatReadyToShipNotifyLabel", () => {
  it("lists every part when the whole group is in Ready to Ship", () => {
    const members = [
      member("0712-1", RTS),
      member("0712-2", RTS),
      member("0712-3", RTS),
    ];
    assert.equal(
      formatReadyToShipNotifyLabel(members, RTS),
      formatReadyToShipGroupLabel(members)
    );
    assert.match(
      formatReadyToShipNotifyLabel(members, RTS),
      /0712-1, 0712-2, 0712-3/
    );
  });

  it("does not name unready siblings on a partial notify", () => {
    const members = [
      member("0712-1", RTS),
      member("0712-2", OTHER),
      member("0712-3", OTHER),
    ];
    const label = formatReadyToShipNotifyLabel(members, RTS);
    assert.equal(
      label,
      "ORD-2026-0712 (1 of 3 parts: 0712-1)"
    );
    assert.doesNotMatch(label, /0712-2/);
    assert.doesNotMatch(label, /0712-3/);
  });

  it("lists only the two parts that are in the column", () => {
    const members = [
      member("0712-1", RTS),
      member("0712-2", RTS),
      member("0712-3", OTHER),
    ];
    const label = formatReadyToShipNotifyLabel(members, RTS);
    assert.equal(
      label,
      "ORD-2026-0712 (2 of 3 parts: 0712-1, 0712-2)"
    );
    assert.doesNotMatch(label, /0712-3/);
  });
});
