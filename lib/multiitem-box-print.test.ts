import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBoxSlipAssignments,
  buildBoxSlipAssignmentsFromPallets,
  partitionBoxesForSlip,
} from "./multiitem-box-print.ts";

test("partitionBoxesForSlip excludes empty boxes from generation", () => {
  const boxes = [
    { id: "a", name: "Box 1", items: [{ orderId: "one" }] },
    { id: "b", name: "Box 2", items: [] },
    { id: "c", name: "Box 3", items: [{ orderId: "two" }] },
  ];

  const result = partitionBoxesForSlip(boxes);
  assert.deepEqual(
    result.printable.map((box) => box.id),
    ["a", "c"]
  );
  assert.deepEqual(
    result.empty.map((box) => box.id),
    ["b"]
  );
});

test("partitionBoxesForSlip reports an all-empty request", () => {
  const result = partitionBoxesForSlip([
    { id: "a", name: "Box 1", items: [] },
    { id: "b", name: "Box 2", items: [] },
  ]);
  assert.equal(result.printable.length, 0);
  assert.equal(result.empty.length, 2);
});

test("buildBoxSlipAssignments numbers loose shipment boxes", () => {
  const assignments = buildBoxSlipAssignments(["a", "b"], null);
  assert.deepEqual(
    assignments.map((row) => [
      row.shipmentBoxNumber,
      row.shipmentBoxCount,
      row.palletNumber,
    ]),
    [
      [1, 2, null],
      [2, 2, null],
    ]
  );
});

test("buildBoxSlipAssignments balances boxes across pallets", () => {
  const assignments = buildBoxSlipAssignments(["a", "b", "c", "d", "e"], 2);
  assert.deepEqual(
    assignments.map((row) => [
      row.palletNumber,
      row.palletBoxNumber,
      row.palletBoxCount,
    ]),
    [
      [1, 1, 3],
      [1, 2, 3],
      [1, 3, 3],
      [2, 1, 2],
      [2, 2, 2],
    ]
  );
});

test("buildBoxSlipAssignmentsFromPallets follows a manual box move", () => {
  const assignments = buildBoxSlipAssignmentsFromPallets([
    ["a"],
    ["b", "c"],
  ]);
  assert.deepEqual(
    assignments.map((row) => [
      row.boxId,
      row.palletNumber,
      row.palletBoxNumber,
      row.palletBoxCount,
      row.shipmentBoxNumber,
    ]),
    [
      ["a", 1, 1, 1, 1],
      ["b", 2, 1, 2, 2],
      ["c", 2, 2, 2, 3],
    ]
  );
});
