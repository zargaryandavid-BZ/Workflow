import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectPdf, pdfPrintSpecValid } from "./pdf-print-spec.ts";

function latin1(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test("inspectPdf accepts linearized PDF with OCProperties", () => {
  const pdf = `%PDF-1.6
1 0 obj
<< /Linearized 1.0 /L 12345 >>
endobj
2 0 obj
<< /Type /Catalog /OCProperties << /OCGs [3 0 R] >> >>
endobj
`;
  const result = inspectPdf(latin1(pdf));
  assert.equal(result.isLinearized, true);
  assert.equal(result.hasLayers, true);
  assert.equal(pdfPrintSpecValid(result), true);
});

test("inspectPdf rejects missing Fast Web View", () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /OCProperties << /OCGs [2 0 R] >> >>
endobj
`;
  const result = inspectPdf(latin1(pdf));
  assert.equal(result.isLinearized, false);
  assert.equal(result.hasLayers, true);
  assert.equal(pdfPrintSpecValid(result), false);
});

test("inspectPdf rejects missing OCG layers", () => {
  const pdf = `%PDF-1.6
1 0 obj
<< /Linearized 1 /N 1 >>
endobj
2 0 obj
<< /Type /Catalog /Pages 3 0 R >>
endobj
`;
  const result = inspectPdf(latin1(pdf));
  assert.equal(result.isLinearized, true);
  assert.equal(result.hasLayers, false);
  assert.equal(pdfPrintSpecValid(result), false);
});

test("inspectPdf only looks at the first 1024 bytes for /Linearized", () => {
  const pad = "x".repeat(1024);
  const pdf = `%PDF-1.4\n${pad}/Linearized 1\n/OCProperties << >>\n`;
  const result = inspectPdf(latin1(pdf));
  assert.equal(result.isLinearized, false);
  assert.equal(result.hasLayers, true);
});
