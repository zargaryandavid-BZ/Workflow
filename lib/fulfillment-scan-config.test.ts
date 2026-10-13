import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultScanButtons,
  findScanButton,
  moveScanButton,
  normalizeScanButtons,
  parseScanStation,
  scanButtonsForStation,
  serializeScanButtons,
} from "./fulfillment-scan-config.ts";

describe("normalizeScanButtons", () => {
  it("returns the default five buttons for empty config", () => {
    const buttons = normalizeScanButtons({});
    assert.deepEqual(
      buttons.map((b) => b.id),
      ["received", "delivered", "shipped", "finished", "finished_reviewed"]
    );
    assert.equal(buttons.every((b) => b.columnId === null), true);
  });

  it("maps a legacy action → column object", () => {
    const buttons = normalizeScanButtons({
      received: "col-a",
      delivered: null,
      shipped: "col-b",
      finished: "col-c",
      finished_reviewed: "col-d",
    });
    assert.equal(findScanButton(buttons, "received")?.columnId, "col-a");
    assert.equal(findScanButton(buttons, "delivered")?.columnId, null);
    assert.equal(findScanButton(buttons, "shipped")?.label, "Shipped");
  });

  it("reads the buttons array and preserves order", () => {
    const buttons = normalizeScanButtons({
      buttons: [
        { id: "b2", label: "Ship", column_id: "c2" },
        { id: "b1", label: "Recv", column_id: "c1" },
      ],
    });
    assert.deepEqual(
      buttons.map((b) => b.id),
      ["b2", "b1"]
    );
    assert.equal(buttons[0].label, "Ship");
    assert.equal(buttons[0].receiver, true);
    assert.equal(buttons[0].sender, false);
  });

  it("reads receiver/sender flags and defaults missing ones to receiver", () => {
    const buttons = normalizeScanButtons({
      buttons: [
        { id: "a", label: "Recv", column_id: "c1", receiver: true, sender: true },
        { id: "b", label: "Ship", column_id: "c2", sender: true },
      ],
    });
    assert.equal(buttons[0].receiver, true);
    assert.equal(buttons[0].sender, true);
    assert.equal(buttons[1].receiver, false);
    assert.equal(buttons[1].sender, true);
  });

  it("allows an empty buttons list after the user removes all", () => {
    assert.deepEqual(normalizeScanButtons({ buttons: [] }), []);
  });

  it("accepts a bare buttons array", () => {
    const buttons = normalizeScanButtons([
      { id: "a", label: "Go", columnId: "c1" },
    ]);
    assert.equal(buttons[0].columnId, "c1");
  });
});

describe("serializeScanButtons", () => {
  it("writes snake_case column_id", () => {
    const stored = serializeScanButtons([
      {
        id: "x",
        label: "  Received  ",
        columnId: "col-1",
        receiver: true,
        sender: false,
      },
    ]);
    assert.deepEqual(stored, {
      buttons: [
        {
          id: "x",
          label: "Received",
          column_id: "col-1",
          receiver: true,
          sender: false,
        },
      ],
    });
  });
});

describe("scanButtonsForStation", () => {
  it("defaults the station to receiver", () => {
    assert.equal(parseScanStation(null), "receiver");
    assert.equal(parseScanStation("sender"), "sender");
  });

  it("filters buttons for the selected station", () => {
    const buttons = normalizeScanButtons({
      buttons: [
        { id: "r", label: "Recv", column_id: "c1", receiver: true, sender: false },
        { id: "s", label: "Ship", column_id: "c2", receiver: false, sender: true },
        { id: "b", label: "Both", column_id: "c3", receiver: true, sender: true },
      ],
    });
    assert.deepEqual(
      scanButtonsForStation(buttons, "receiver").map((b) => b.id),
      ["r", "b"]
    );
    assert.deepEqual(
      scanButtonsForStation(buttons, "sender").map((b) => b.id),
      ["s", "b"]
    );
  });
});

describe("moveScanButton", () => {
  it("reorders within bounds", () => {
    const start = defaultScanButtons();
    const down = moveScanButton(start, 0, 1);
    assert.equal(down[0].id, "delivered");
    assert.equal(down[1].id, "received");
    const up = moveScanButton(down, 1, -1);
    assert.equal(up[0].id, "received");
  });

  it("no-ops at the edges", () => {
    const start = defaultScanButtons();
    assert.equal(moveScanButton(start, 0, -1), start);
    assert.equal(moveScanButton(start, start.length - 1, 1), start);
  });
});
