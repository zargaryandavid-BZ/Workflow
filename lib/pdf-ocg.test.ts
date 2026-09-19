import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectLayerIds,
  isPdfArtworkLayer,
  isPdfCutLineLayer,
  isUnnamedPdfLayer,
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

test("isUnnamedPdfLayer matches Layer N fallbacks only", () => {
  assert.equal(isUnnamedPdfLayer("Layer 1"), true);
  assert.equal(isUnnamedPdfLayer("layer 2"), true);
  assert.equal(isUnnamedPdfLayer("ARTWORK"), false);
  assert.equal(isUnnamedPdfLayer("Dimensions"), false);
});

test("isPdfArtworkLayer picks ART WORK not dieline", () => {
  assert.equal(isPdfArtworkLayer("ART WORK"), true);
  assert.equal(isPdfArtworkLayer("Artwork"), true);
  assert.equal(isPdfArtworkLayer("Dieline"), false);
  assert.equal(isPdfArtworkLayer("ALL Dieline Artwork"), false);
});

test("isPdfCutLineLayer matches Cut / Dieline plates", () => {
  assert.equal(isPdfCutLineLayer("Cut"), true);
  assert.equal(isPdfCutLineLayer("CUT LINE"), true);
  assert.equal(isPdfCutLineLayer("Dieline"), true);
  assert.equal(isPdfCutLineLayer("Artwork"), false);
  assert.equal(isPdfCutLineLayer("White"), false);
});
