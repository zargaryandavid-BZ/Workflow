import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boxesForReceiveDay,
  ddmmyy,
  fulfillmentBoxLabel,
  fulfillmentDateTimeLabel,
  localDayKey,
  localDayLabel,
  receivedDayKeys,
} from "./fulfillment-day.ts";

describe("localDayKey", () => {
  it("uses the local calendar date", () => {
    const d = new Date(2026, 8, 18, 22, 0, 0);
    assert.equal(localDayKey(d), "2026-09-18");
  });
});

describe("localDayLabel", () => {
  it("formats month and day", () => {
    assert.match(localDayLabel("2026-09-18"), /Sep/);
    assert.match(localDayLabel("2026-09-18"), /18/);
  });
});

describe("fulfillmentDateTimeLabel", () => {
  it("includes the clock time", () => {
    const label = fulfillmentDateTimeLabel(new Date(2026, 8, 18, 16, 5, 0));
    assert.match(label, /Sep/);
    assert.match(label, /18/);
    assert.match(label, /4:05|16:05/);
  });
});

describe("receivedDayKeys", () => {
  it("lists unique received days newest first", () => {
    const later = new Date(2026, 8, 18, 8).toISOString();
    const earlier = new Date(2026, 8, 16, 12).toISOString();
    const keys = receivedDayKeys([
      { status: "sent", received_at: null },
      { status: "received", received_at: earlier },
      { status: "received", received_at: later },
      { status: "received", received_at: new Date(2026, 8, 18, 20).toISOString() },
    ]);
    assert.deepEqual(keys, ["2026-09-18", "2026-09-16"]);
  });
});

describe("boxesForReceiveDay", () => {
  const boxes = [
    { id: "s", status: "sent", received_at: null },
    {
      id: "a",
      status: "received",
      received_at: new Date(2026, 8, 18, 10).toISOString(),
    },
    {
      id: "b",
      status: "received",
      received_at: new Date(2026, 8, 16, 10).toISOString(),
    },
  ];

  it("null day is delivered waiting check-in", () => {
    assert.deepEqual(
      boxesForReceiveDay(boxes, null).map((b) => b.id),
      ["s"]
    );
  });

  it("a date shows only boxes received that day", () => {
    const day = localDayKey(boxes[1].received_at);
    assert.deepEqual(
      boxesForReceiveDay(boxes, day).map((b) => b.id),
      ["a"]
    );
  });
});

describe("fulfillmentBoxLabel", () => {
  it("is DDMMYY_boxNumber from sent day", () => {
    assert.equal(ddmmyy(new Date(2026, 8, 18)), "180926");
    assert.equal(
      fulfillmentBoxLabel({
        box_number: "01",
        sent_at: new Date(2026, 8, 18, 15).toISOString(),
      }),
      "180926_1"
    );
  });

  it("uses today when the box is still open", () => {
    assert.equal(
      fulfillmentBoxLabel(
        { box_number: "3", created_at: "", sent_at: null },
        new Date(2026, 8, 18)
      ),
      "180926_3"
    );
  });
});
