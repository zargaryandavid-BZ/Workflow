import assert from "node:assert/strict";
import { test } from "node:test";
import { proofLayerStyleForName } from "./proof-layer-style.ts";

test("proofLayerStyleForName matches common OCG names", () => {
  assert.equal(proofLayerStyleForName("UV Layer")?.label, "UV layer");
  assert.equal(proofLayerStyleForName("Die")?.label, "Cut line");
  assert.equal(proofLayerStyleForName("Dieline")?.label, "Cut line");
  assert.equal(proofLayerStyleForName("White")?.label, "White layer");
  assert.equal(proofLayerStyleForName("Foil")?.label, "Foil layer");
  assert.equal(proofLayerStyleForName("Safe zone")?.label, "Safe zone");
  assert.equal(proofLayerStyleForName("Perforation")?.label, "Perforation");
  assert.equal(proofLayerStyleForName("ART WORK"), null);
});
