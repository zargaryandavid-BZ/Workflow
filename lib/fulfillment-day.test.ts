import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boxesForReceiveDay,
  ddmmyy,
  fulfillmentBoxLabel,
  fulfillmentDateTimeLabel,
  localDayKey,
  localDayLabel,
  multiitemBoxName,
  multiitemBoxNameFromIsoDate,
  savedMultiitemDayKeys,
  boxesForSavedMultiitemDay,
  receivedDayKeys,
} from "./fulfillment-day.ts";

describe("multiitemBoxName", () => {
  it("is BX + daily number + MMDDYY", () => {
    assert.equal(multiitemBoxName(1, new Date(2026, 8, 29)), "BX1092926");
    assert.equal(multiitemBoxNameFromIsoDate(2, "2026-09-29"), "BX2092926");
  });
});

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
  const receivedA = new Date(2026, 8, 18, 10).toISOString();
  const receivedB = new Date(2026, 8, 16, 10).toISOString();
  const boxes = [
    { id: "s", status: "sent", received_at: null },
    {
      id: "a",
      status: "received",
      received_at: receivedA,
    },
    {
      id: "b",
      status: "received",
      received_at: receivedB,
    },
  ];

  it("null day is delivered waiting check-in", () => {
    assert.deepEqual(
      boxesForReceiveDay(boxes, null).map((b) => b.id),
      ["s"]
    );
  });

  it("a date shows only boxes received that day", () => {
    const day = localDayKey(receivedA);
    assert.deepEqual(
      boxesForReceiveDay(boxes, day).map((b) => b.id),
      ["a"]
    );
  });
});

describe("savedMultiitemDayKeys", () => {
  it("lists newest saved days first", () => {
    const boxes = [
      {
        status: "saved" as const,
        saved_at: new Date(2026, 8, 28, 10).toISOString(),
      },
      {
        status: "saved" as const,
        saved_at: new Date(2026, 8, 29, 10).toISOString(),
      },
      { status: "open" as const, saved_at: null },
    ];
    assert.deepEqual(savedMultiitemDayKeys(boxes), ["2026-09-29", "2026-09-28"]);
  });
});

describe("boxesForSavedMultiitemDay", () => {
  const boxes = [
    { id: "open", status: "open", saved_at: null },
    {
      id: "a",
      status: "saved",
      saved_at: new Date(2026, 8, 29, 15).toISOString(),
    },
    {
      id: "b",
      status: "saved",
      saved_at: new Date(2026, 8, 28, 15).toISOString(),
    },
  ];

  it("null day is open boxes being packed", () => {
    assert.deepEqual(
      boxesForSavedMultiitemDay(boxes, null).map((b) => b.id),
      ["open"]
    );
  });

  it("a date shows only boxes saved that day", () => {
    assert.deepEqual(
      boxesForSavedMultiitemDay(boxes, "2026-09-29").map((b) => b.id),
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
