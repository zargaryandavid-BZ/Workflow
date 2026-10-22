import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { orderCardExport, type OrderCardSource } from "./order-card-export.ts";

const base: OrderCardSource = {
  order: { id: "uuid-1", title: "W449-1", due_date: "2026-10-28T00:00:00+00:00" },
  columnName: "Prepress",
  tagName: null,
  specRows: [
    { label: "Category", value: "Posters" },
    { label: "Product", value: "Premium Posters" },
    { label: "Materials", value: "8mil Photo Paper (Matte)" },
    { label: "Width", value: "17" },
    { label: "Height", value: "24" },
    { label: "Finishing", value: "Matte Lamination" },
    { label: "Sides", value: "Single-sided" },
    { label: "Customer Email", value: "a@b.com" },
    { label: "Unit Price ($)", value: "1.20" },
    { label: "Customer phone", value: "555" },
  ],
  skuRows: [
    { index: 1, name: "Poster A", qty: 10, imageLinks: ["https://x/y.png", "javascript:bad"] },
  ],
  totalQty: 10,
  customerName: "chris ford",
  ownerName: null,
  designerName: "Har Unusyan",
  product: "Premium Posters",
  die: "",
  artworkLink: "",
  designTask: "",
  dueDateFormatted: "Oct 28, 2026",
  productionDateFormatted: null,
  applicationEnabled: false,
  priority: "Normal",
};

describe("order card export", () => {
  it("carries the card's spec fields, SKUs, owner/designer and due date", () => {
    const c = orderCardExport(base);
    assert.equal(c.order_number, "W449-1");
    assert.equal(c.due_date, "2026-10-28");
    assert.equal(c.designer, "Har Unusyan");
    assert.equal(c.owner, null);
    assert.equal(c.priority, "Normal");
    assert.equal(c.total_qty, 10);
    assert.deepEqual(
      c.spec_rows.map((r) => r.label),
      ["Category", "Product", "Materials", "Width", "Height", "Finishing", "Sides"]
    );
    assert.deepEqual(c.skus, [
      { index: 1, name: "Poster A", qty: 10, image_links: ["https://x/y.png"] },
    ]);
  });

  it("never leaks customer contact details or pricing", () => {
    const json = JSON.stringify(orderCardExport(base));
    assert.ok(!/a@b\.com|555|1\.20|Unit Price|Email/i.test(json));
  });

  it("turns blank / placeholder values into null", () => {
    const c = orderCardExport({ ...base, customerName: "—", priority: "  ", die: "", product: "order" });
    assert.equal(c.customer_name, null);
    assert.equal(c.product, null);
    assert.equal(c.priority, null);
    assert.equal(c.die, null);
  });
});
