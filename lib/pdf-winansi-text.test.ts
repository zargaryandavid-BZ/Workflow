import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pdfWinAnsiText } from "./pdf-winansi-text.ts";

describe("pdfWinAnsiText", () => {
  it("strips the label emoji that printed as Ø<ß÷þ on job tickets", () => {
    assert.equal(pdfWinAnsiText("🏷️ Labels & Stickers"), "Labels & Stickers");
  });

  it("keeps ordinary ticket text", () => {
    assert.equal(pdfWinAnsiText("STATIC ROOM VALIDS"), "STATIC ROOM VALIDS");
  });

  it("keeps digits used on tickets (order number, qty, size, dates)", () => {
    assert.equal(pdfWinAnsiText("15219-1"), "15219-1");
    assert.equal(pdfWinAnsiText("3-pass raised UV"), "3-pass raised UV");
    assert.equal(pdfWinAnsiText("0.9 x 0.9"), "0.9 x 0.9");
    assert.equal(pdfWinAnsiText("1,000"), "1,000");
    assert.equal(pdfWinAnsiText("Sep 18, 2026"), "Sep 18, 2026");
  });
});
