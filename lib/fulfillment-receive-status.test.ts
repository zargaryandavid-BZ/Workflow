import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boxReceiveStatusFromLines,
  columnIdForReceiveStatus,
  defaultBoxReceiveStatus,
  defaultReceiveStatus,
  isFulfillmentReceiveStatus,
} from "./fulfillment-receive-status.ts";

describe("isFulfillmentReceiveStatus", () => {
  it("accepts the three receive outcomes", () => {
    assert.equal(isFulfillmentReceiveStatus("received"), true);
    assert.equal(isFulfillmentReceiveStatus("counted"), true);
    assert.equal(isFulfillmentReceiveStatus("missing"), true);
    assert.equal(isFulfillmentReceiveStatus("sent"), false);
  });
});

describe("defaultReceiveStatus", () => {
  it("counted when qty matches", () => {
    assert.equal(defaultReceiveStatus(250, 250), "counted");
  });
  it("missing when qty differs", () => {
    assert.equal(defaultReceiveStatus(250, 200), "missing");
  });
});

describe("defaultBoxReceiveStatus", () => {
  it("counted when every line qty matches", () => {
    assert.equal(
      defaultBoxReceiveStatus([
        { expected: 100, received: 100 },
        { expected: 50, received: 50 },
      ]),
      "counted"
    );
  });
  it("missing when any line qty differs", () => {
    assert.equal(
      defaultBoxReceiveStatus([
        { expected: 100, received: 100 },
        { expected: 50, received: 40 },
      ]),
      "missing"
    );
  });
});

describe("boxReceiveStatusFromLines", () => {
  it("missing beats counted", () => {
    assert.equal(
      boxReceiveStatusFromLines(["counted", "missing", "received"]),
      "missing"
    );
  });
});

describe("columnIdForReceiveStatus", () => {
  const settings = {
    receive_column_id: "recv",
    counted_column_id: "ok",
    missing_column_id: "miss",
  };

  it("maps each status to its column", () => {
    assert.equal(columnIdForReceiveStatus("received", settings), "recv");
    assert.equal(columnIdForReceiveStatus("counted", settings), "ok");
    assert.equal(columnIdForReceiveStatus("missing", settings), "miss");
  });

  it("falls back to receive column when the specific one is unset", () => {
    assert.equal(
      columnIdForReceiveStatus("counted", {
        receive_column_id: "recv",
        counted_column_id: null,
        missing_column_id: null,
      }),
      "recv"
    );
  });
});
