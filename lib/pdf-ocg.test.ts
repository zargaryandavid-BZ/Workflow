import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectLayerIds,
  layersFromOptionalContent,
  parsePdfOcgs,
} from "./pdf-ocg.ts";

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

test("collectLayerIds de-dupes reverse nested Order and normalizes refs", () => {
  assert.deepEqual(
    collectLayerIds(["10R", "11R", ["11 0 R", "10 0 R"]]),
    ["10R", "11R"]
  );
});

test("layersFromOptionalContent does not append reverse group-map copies", () => {
  const names: Record<string, string> = {
    "10R": "Dieline",
    "11R": "ART WORK",
    "10": "Dieline",
    "11": "ART WORK",
  };
  const oc = {
    getOrder: () => ["10R", "11R"],
    getGroup: (id: string) => ({ name: names[id] }),
    serializable: {
      data: {
        groups: {
          "11": { name: "ART WORK" },
          "10": { name: "Dieline" },
        },
      },
    },
  };
  const layers = layersFromOptionalContent(oc);
  assert.deepEqual(
    layers.map((l) => l.name),
    ["Dieline", "ART WORK"]
  );
});
