import assert from "node:assert/strict";
import { test } from "node:test";
import { collectLayerIds, parsePdfOcgs } from "./pdf-ocg.ts";

test("collectLayerIds walks nested order objects", () => {
  assert.deepEqual(
    collectLayerIds([
      { name: "Print", order: ["12R", "13R"] },
      "14R",
    ]),
    ["12R", "13R", "14R"]
  );
});

test("parsePdfOcgs reads Type/OCG Name literals", () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /OCG /Name (UV Layer) >>
endobj
2 0 obj
<< /Type /OCG /Name (Die) >>
endobj
`;
  const buf = new TextEncoder().encode(pdf).buffer;
  const layers = parsePdfOcgs(buf);
  assert.equal(layers.length, 2);
  assert.equal(layers[0]?.name, "UV Layer");
  assert.equal(layers[0]?.id, "1R");
  assert.equal(layers[1]?.name, "Die");
});
