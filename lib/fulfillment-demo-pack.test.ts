import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FULFILLMENT_DEMO_OPEN_BOX_COUNT,
  FULFILLMENT_DEMO_PACKS,
  demoReceiveBoxStatus,
  demoReceiveLineStatus,
  fulfillmentReceivedPreviewBoxes,
  padFulfillmentOpenDemoBoxes,
  padFulfillmentReceiveDemoBoxes,
} from "./fulfillment-demo-pack.ts";

describe("padFulfillmentOpenDemoBoxes", () => {
  it("pads empty packing to 8 sample boxes", () => {
    const padded = padFulfillmentOpenDemoBoxes([]);
    assert.equal(padded.length, FULFILLMENT_DEMO_OPEN_BOX_COUNT);
    assert.equal(padded[0]?.box_number, "01");
    assert.equal(padded[7]?.box_number, "08");
  });

  it("does not append samples when real open boxes exist", () => {
    const padded = padFulfillmentOpenDemoBoxes([
      { id: "a", box_number: "01" },
      { id: "b", box_number: "02" },
    ]);
    assert.equal(padded.length, 2);
    assert.equal(padded[0]?.id, "a");
    assert.equal(padded[1]?.id, "b");
  });
});

describe("FULFILLMENT_DEMO_PACKS", () => {
  it("has eight distinct packing lists", () => {
    assert.equal(FULFILLMENT_DEMO_PACKS.length, 8);
  });
});

describe("fulfillmentReceivedPreviewBoxes", () => {
  it("has 2 incoming and 6 checked-in boxes across 3 days", () => {
    const now = new Date("2026-09-18T18:00:00.000Z");
    const boxes = fulfillmentReceivedPreviewBoxes(now);
    assert.equal(boxes.length, 8);
    assert.equal(boxes.filter((b) => b.status === "sent").length, 2);
    const received = boxes.filter((b) => b.status === "received");
    assert.equal(received.length, 6);
    const days = new Set(received.map((b) => b.received_at?.slice(0, 10)));
    assert.equal(days.size, 3);
  });
});

describe("padFulfillmentReceiveDemoBoxes", () => {
  it("fills an empty received list with the sample boxes", () => {
    const padded = padFulfillmentReceiveDemoBoxes([]);
    assert.equal(padded.length, 8);
  });

  it("still adds checked-in samples when many sent boxes already exist", () => {
    const sent = Array.from({ length: 8 }, (_, i) => ({
      id: `real-${i}`,
      status: "sent",
    }));
    const padded = padFulfillmentReceiveDemoBoxes(sent);
    assert.equal(padded.filter((b) => b.status === "received").length, 6);
    assert.equal(padded.filter((b) => b.status === "sent").length, 8);
  });
});

describe("demoReceiveBoxStatus", () => {
  it("cycles counted, missing, and received per box", () => {
    assert.equal(demoReceiveBoxStatus(0), "counted");
    assert.equal(demoReceiveBoxStatus(1), "missing");
    assert.equal(demoReceiveBoxStatus(2), "received");
  });
});

describe("demoReceiveLineStatus", () => {
  it("cycles counted, missing, and received", () => {
    assert.equal(demoReceiveLineStatus(0).receive_status, "counted");
    assert.equal(demoReceiveLineStatus(1).receive_status, "missing");
    assert.equal(demoReceiveLineStatus(2).receive_status, "received");
    assert.equal(demoReceiveLineStatus(1).quantity_received(100), 75);
  });
});
