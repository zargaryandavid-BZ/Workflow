import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPoEmailHtml,
  buildPoEmailText,
  defaultPoItems,
  orderFolderUrl,
  poNumberForOrder,
  poTotal,
  sanitizePoItems,
} from "./purchase-order.ts";

test("pre-fills one line for a wrap-roll card (live W504-2 shape)", () => {
  const items = defaultPoItems({
    fields: { Product: "Custom Wrapping Paper Rolls", Sides: "Single-sided", Quantity: 5, Width: 0, Height: 0 },
    specs: {
      spec_selections: { SET_SIZE: '7 ft (29" wide)' },
      skus: [{ id: "a", name: "Custom Wrapping Paper Rolls", qty: 5 }],
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.description, "Custom Wrapping Paper Rolls");
  assert.equal(items[0]!.qty, 5);
  assert.match(items[0]!.specs, /Size: 7 ft \(29" wide\)/);
  assert.doesNotMatch(items[0]!.specs, /Width/);
});

test("one PO line per SKU with its quantity", () => {
  const items = defaultPoItems({
    fields: { Product: "Gift Bags", Quantity: 300 },
    specs: { skus: [{ id: "a", name: "Red", qty: 100 }, { id: "b", name: "Blue", qty: 200 }] },
  });
  assert.deepEqual(items.map((i) => [i.description, i.qty]), [["Gift Bags — Red", 100], ["Gift Bags — Blue", 200]]);
});

test("totals, sanitizing, numbering, folder link", () => {
  const items = sanitizePoItems([
    { description: "A", qty: "10", unit_cost: "1.25" },
    { description: "", specs: "", qty: "" },
    { description: "B", qty: 2, unit_cost: -3 },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[1]!.unit_cost, null);
  assert.equal(poTotal(items), 12.5);
  assert.equal(poNumberForOrder("W504-2", 0), "PO-W504-2");
  assert.equal(poNumberForOrder("W504-2", 1), "PO-W504-2-2");
  assert.equal(
    orderFolderUrl({ "Artwork (GDrive link)": "https://drive.google.com/x" }, {}),
    "https://drive.google.com/x"
  );
  assert.equal(orderFolderUrl({}, { files_url: "https://d/y" }), "https://d/y");
});

test("emails escape vendor-facing text and include folder + vendor links", () => {
  const input = {
    poNumber: "PO-1",
    vendorContact: "Sam",
    items: [{ description: "<b>x</b>", specs: "", qty: 1, unit_cost: 2 }],
    shipTo: "306 Boyd St",
    dueDate: "Nov 20, 2026",
    notes: null,
    folderUrl: "https://drive.google.com/f",
    vendorUrl: "https://w/po/t",
    fromName: "Hayk",
  };
  const html = buildPoEmailHtml(input);
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(html.includes("https://drive.google.com/f"));
  const text = buildPoEmailText(input);
  assert.ok(text.includes("https://w/po/t"));
  assert.ok(text.includes("Total: $2.00"));
});
