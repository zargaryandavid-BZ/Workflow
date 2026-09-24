import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatReadyToShipGroupLabel,
  formatReadyToShipNotifyLabel,
  formatGroupPartLocations,
  shortPartColumnName,
  isReadyToShipNotifyColumn,
  isCompleteGroupInColumn,
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

describe("formatGroupPartLocations", () => {
  it("lists each part with its column", () => {
    assert.equal(
      formatGroupPartLocations([
        { title: "15168-1", columnName: "In Production" },
        { title: "15168-2", columnName: "(Boyd Only) Ready to Ship" },
      ]),
      "Part 1- In Production, Part 2- Boyd Only"
    );
  });

  it("shortens Boyd Only column names", () => {
    assert.equal(shortPartColumnName("(Boyd Only) Ready to Ship"), "Boyd Only");
    assert.equal(shortPartColumnName("In Production"), "In Production");
  });
});

describe("complete group in Ready to Ship", () => {
  it("matches Boyd Ready to Ship columns", () => {
    assert.equal(
      isReadyToShipNotifyColumn({
        kind: "ready_to_ship",
        name: "(Boyd Only) Ready to Ship",
      }),
      true
    );
    assert.equal(
      isReadyToShipNotifyColumn({ kind: "normal", name: "In Production" }),
      false
    );
  });

  it("requires every part of the group in this column", () => {
    assert.equal(isCompleteGroupInColumn(2, 2), true);
    assert.equal(isCompleteGroupInColumn(1, 2), false);
    assert.equal(isCompleteGroupInColumn(1, 1), false);
  });
});
