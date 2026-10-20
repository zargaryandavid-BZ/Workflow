import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySkuPaste,
  parseDesignLine,
  parseSkuPasteLine,
  parseSkuPasteText,
  sanitizeSkuText,
  serializeSkuRows,
  skuTextMatchesRows,
  summarizeSkuPaste,
} from "./sku-paste.ts";

const pick = (raw: string) => {
  const r = parseSkuPasteLine(raw);
  return [r.name, r.qty, r.status];
};

describe("parseDesignLine — identical to CRM / portal shared parser", () => {
  // Same cases as bazaar-website packages/api/src/__tests__/designListSkus.test.ts
  const cases: [string, string, string][] = [
    ["Adrenal Support 2oz 300", "Adrenal Support 2oz", "300"],
    ["Green Tea 10:1 2oz 300", "Green Tea 10:1 2oz", "300"],
    ["Mullein 2oz 2500", "Mullein 2oz", "2500"],
    ["Bachata 3000", "Bachata", "3000"],
    ["Bachata, 3000", "Bachata", "3000"],
    ["Bachata - 3,000", "Bachata", "3000"],
    ["Bachata 3000 pcs", "Bachata", "3000"],
    ["Bachata\t500", "Bachata", "500"],
    ["Adrenal Support 4oz", "Adrenal Support 4oz", ""],
    ["Vitamin B12", "Vitamin B12", ""],
    ["Green Tea 10:1", "Green Tea 10:1", ""],
    ["Vitamin D 1000 300", "Vitamin D 1000", "300"],
  ];
  for (const [raw, name, qty] of cases) {
    it(`${JSON.stringify(raw)} → ${name} / ${qty}`, () => {
      assert.deepEqual(parseDesignLine(raw), { name, qty });
    });
  }
});

describe("parseSkuPasteLine — formats staff paste", () => {
  const cases: [string, string, number | null, string][] = [
    ["Mango 1200", "Mango", 1200, "ok"],
    ["Grape - 2,000", "Grape", 2000, "ok"],
    ["Lemon x 500", "Lemon", 500, "ok"],
    ["Lemon x500", "Lemon", 500, "ok"],
    ["Lemon × 500", "Lemon", 500, "ok"],
    ["Lemon = 500", "Lemon", 500, "ok"],
    ["Lemon (500)", "Lemon", 500, "ok"],
    ["Lemon qty: 500", "Lemon", 500, "ok"],
    ["Lemon: 500", "Lemon", 500, "ok"],
    ["Lemon; 500", "Lemon", 500, "ok"],
    ["Mango,1200", "Mango", 1200, "ok"],
    ['"Mango, Ripe",1200', "Mango, Ripe", 1200, "ok"],
    ["Mango\t1200", "Mango", 1200, "ok"],
    ["1200\tMango", "Mango", 1200, "ok"],
    ["Mango\tSweet\t1,200", "Mango Sweet", 1200, "ok"],
    ["Mango\t\t1200\t", "Mango", 1200, "ok"],
    ["Mango 1,200 labels", "Mango", 1200, "ok"],
    ["Mango 1.200", "Mango", 1200, "ok"],
    ["Mango 1 200", "Mango", 1200, "ok"],
    ["- Mango 1200", "Mango", 1200, "ok"],
    ["• Mango 1200", "Mango", 1200, "ok"],
    ["1. Mango 1200", "Mango", 1200, "ok"],
    ["2) Grape 300", "Grape", 300, "ok"],
    ["Vitamin B12", "Vitamin B12", null, "no_qty"],
    ["Green Tea 10:1", "Green Tea 10:1", null, "no_qty"],
    ["Box 6x9", "Box 6x9", null, "no_qty"],
    ["6 flavors, 1200 each", "6 flavors, 1200 each", null, "no_qty"],
    ["Mango 0", "Mango", null, "no_qty"],
    ["1200", "", 1200, "no_name"],
    ["-", "", null, "no_name"],
    ["SKU\tQty", "", null, "header"],
    ["Name, Quantity", "", null, "header"],
    ["Flavor qty", "", null, "header"],
  ];
  for (const [raw, name, qty, status] of cases) {
    it(`${JSON.stringify(raw)}`, () => {
      assert.deepEqual(pick(raw), [name, qty, status]);
    });
  }
});

describe("parseSkuPasteText / summarizeSkuPaste", () => {
  it("keeps line numbers, skips blank lines, handles CRLF", () => {
    const lines = parseSkuPasteText("SKU\tQty\r\nMango\t1200\r\n\r\nGrape\t\r\n1200\n");
    assert.deepEqual(
      lines.map((l) => [l.lineNo, l.name, l.qty, l.status]),
      [
        [1, "", null, "header"],
        [2, "Mango", 1200, "ok"],
        [4, "Grape", null, "no_qty"],
        [5, "", 1200, "no_name"],
      ]
    );
    assert.deepEqual(summarizeSkuPaste(lines), {
      rows: 2,
      withQty: 1,
      missingQty: 1,
      unparsed: 1,
      headers: 1,
      total: 1200,
    });
  });
  it("empty / non-string text → no lines", () => {
    assert.deepEqual(parseSkuPasteText(""), []);
    assert.deepEqual(parseSkuPasteText(null), []);
  });
});

describe("text ↔ rows sync", () => {
  const rows = [
    { id: "a", name: "Mango", qty: 1200 },
    { id: "b", name: "Grape", qty: null },
  ];
  it("serializeSkuRows writes the CRM/portal 'Name Qty' format", () => {
    assert.equal(serializeSkuRows(rows), "Mango 1200\nGrape");
    assert.equal(serializeSkuRows([{ name: " ", qty: null }]), "");
  });
  it("serialized rows parse back to the same rows (round trip)", () => {
    assert.equal(skuTextMatchesRows(serializeSkuRows(rows), rows), true);
  });
  it("different spellings of the same list still match", () => {
    assert.equal(skuTextMatchesRows("Mango x 1,200\nGrape", rows), true);
  });
  it("mismatch on qty, order, extra line or blank text", () => {
    assert.equal(skuTextMatchesRows("Mango 1000\nGrape", rows), false);
    assert.equal(skuTextMatchesRows("Grape\nMango 1200", rows), false);
    assert.equal(skuTextMatchesRows("Mango 1200\nGrape\nLemon 5", rows), false);
    assert.equal(skuTextMatchesRows("", rows), false);
    assert.equal(skuTextMatchesRows("", []), true);
  });
  it("header / unreadable lines do not break a match", () => {
    assert.equal(skuTextMatchesRows("Name\tQty\nMango\t1200\nGrape\n999", rows), true);
  });
});

describe("applySkuPaste", () => {
  let n = 0;
  const newId = () => `new${++n}`;
  const current = [
    { id: "a", name: "Mango", qty: 100 },
    { id: "b", name: "Grape", qty: 200 },
  ];
  it("replace: reuses ids by name, then by same position (artwork stays linked)", () => {
    n = 0;
    const lines = parseSkuPasteText("Grape 2000\nKiwi 50\nLemon 5");
    const out = applySkuPaste(current, lines, { mode: "replace", newId });
    // Grape keeps b by name; Kiwi's position (1) is taken by Grape → new id.
    assert.deepEqual(out, [
      { id: "b", name: "Grape", qty: 2000 },
      { id: "new1", name: "Kiwi", qty: 50 },
      { id: "new2", name: "Lemon", qty: 5 },
    ]);
    n = 0;
    const renamed = applySkuPaste(current, parseSkuPasteText("Mango Ripe 100\nGrape 200"), {
      mode: "replace",
      newId,
    });
    assert.deepEqual(renamed.map((r) => r.id), ["a", "b"]);
  });
  it("replace: skips unticked, header and unreadable lines; blank qty stays blank", () => {
    n = 0;
    const lines = parseSkuPasteText("SKU Qty\nMango\n1200\nNote line 6 flavors\nGrape 3");
    const out = applySkuPaste(current, lines, {
      mode: "replace",
      newId,
      skip: new Set([4]),
    });
    assert.deepEqual(out, [
      { id: "a", name: "Mango", qty: null },
      { id: "b", name: "Grape", qty: 3 },
    ]);
  });
  it("append: keeps current rows (minus blank ones) and adds new ids", () => {
    n = 0;
    const out = applySkuPaste(
      [...current, { id: "c", name: "", qty: null }],
      parseSkuPasteText("Lemon x 500"),
      { mode: "append", newId }
    );
    assert.deepEqual(out, [...current, { id: "new1", name: "Lemon", qty: 500 }]);
  });
});

describe("sanitizeSkuText", () => {
  it("keeps raw text, trims trailing whitespace, empties → null, caps length", () => {
    assert.equal(sanitizeSkuText("6 flavors, 1200 each\n\n"), "6 flavors, 1200 each");
    assert.equal(sanitizeSkuText("   \n"), null);
    assert.equal(sanitizeSkuText(42), null);
    assert.equal(sanitizeSkuText("x".repeat(30000))?.length, 20000);
  });
});
