import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  columnNameIsActiveProduction,
  columnNameIsProduction,
  columnNameIsProductionCompleted,
  computePrepressToProductionHandoffs,
  computeProductionStays,
  medianSeconds,
  moveNamesFromMetadata,
  parseReportKind,
} from "./prepress-production-handoff.ts";

describe("parseReportKind", () => {
  it("defaults to designer", () => {
    assert.equal(parseReportKind(null), "designer");
    assert.equal(parseReportKind("designer"), "designer");
  });
  it("accepts prepress and production", () => {
    assert.equal(parseReportKind("prepress"), "prepress");
    assert.equal(parseReportKind("production"), "production");
  });
});

describe("columnNameIsProduction", () => {
  it("matches In Production and press names", () => {
    assert.equal(columnNameIsProduction("In Production"), true);
    assert.equal(columnNameIsProduction("Hrach"), true);
  });
  it("does not match Prepress or Start", () => {
    assert.equal(columnNameIsProduction("Prepress"), false);
    assert.equal(columnNameIsProduction("Start"), false);
  });
});

describe("moveNamesFromMetadata", () => {
  it("prefers names, then column ids", () => {
    const names = new Map([
      ["a", "Prepress"],
      ["b", "In Production"],
    ]);
    assert.deepEqual(
      moveNamesFromMetadata({ fromName: "Pre-press", toName: "Hrach" }, names),
      { fromName: "Pre-press", toName: "Hrach" }
    );
    assert.deepEqual(moveNamesFromMetadata({ from: "a", to: "b" }, names), {
      fromName: "Prepress",
      toName: "In Production",
    });
  });
});

describe("computePrepressToProductionHandoffs", () => {
  it("uses a direct Prepress → In Production move", () => {
    const rows = computePrepressToProductionHandoffs([
      {
        orderId: "1",
        at: "2026-09-01T10:00:00.000Z",
        fromName: "Prepress",
        toName: "In Production",
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.seconds, 0);
    assert.equal(rows[0]!.orderId, "1");
  });

  it("measures leave Prepress then later enter production", () => {
    const rows = computePrepressToProductionHandoffs([
      {
        orderId: "1",
        at: "2026-09-01T10:00:00.000Z",
        fromName: "Prepress",
        toName: "Done (Ready for Prod)",
      },
      {
        orderId: "1",
        at: "2026-09-01T16:00:00.000Z",
        fromName: "Done (Ready for Prod)",
        toName: "In Production",
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.seconds, 6 * 3600);
  });

  it("ignores jobs that never leave Prepress", () => {
    const rows = computePrepressToProductionHandoffs([
      {
        orderId: "1",
        at: "2026-09-01T10:00:00.000Z",
        fromName: "Start",
        toName: "Prepress",
      },
    ]);
    assert.equal(rows.length, 0);
  });
});

describe("active vs completed production columns", () => {
  it("treats In Production as active and Production Completed as done", () => {
    assert.equal(columnNameIsActiveProduction("In Production"), true);
    assert.equal(columnNameIsActiveProduction("Hrach"), true);
    assert.equal(columnNameIsProductionCompleted("Production Completed"), true);
    assert.equal(
      columnNameIsProductionCompleted("Apparel Prod. Completed"),
      true
    );
    assert.equal(columnNameIsActiveProduction("Production Completed"), false);
  });
});

describe("computeProductionStays", () => {
  it("measures In Production until Production Completed", () => {
    const rows = computeProductionStays([
      {
        orderId: "1",
        at: "2026-09-01T10:00:00.000Z",
        fromName: "Prepress",
        toName: "In Production",
      },
      {
        orderId: "1",
        at: "2026-09-01T14:00:00.000Z",
        fromName: "In Production",
        toName: "Production Completed",
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.seconds, 4 * 3600);
    assert.equal(rows[0]!.completed, true);
  });

  it("does not split a stay when moving Hrach → In Production", () => {
    const rows = computeProductionStays([
      {
        orderId: "1",
        at: "2026-09-01T10:00:00.000Z",
        fromName: "Start",
        toName: "Hrach",
      },
      {
        orderId: "1",
        at: "2026-09-01T11:00:00.000Z",
        fromName: "Hrach",
        toName: "In Production",
      },
      {
        orderId: "1",
        at: "2026-09-01T15:00:00.000Z",
        fromName: "In Production",
        toName: "Production Completed",
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.seconds, 5 * 3600);
  });
});

describe("medianSeconds", () => {
  it("returns 0 for empty", () => {
    assert.equal(medianSeconds([]), 0);
  });
  it("averages the middle pair for even length", () => {
    assert.equal(medianSeconds([10, 20, 30, 40]), 25);
  });
});
