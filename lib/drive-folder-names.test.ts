import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDriveFolderPlan,
  compactFinalProdLabel,
  shortDriveOrderCode,
} from "./drive-folder-names.ts";

describe("drive folder names", () => {
  it("drops the year from CRM and short order codes", () => {
    assert.equal(shortDriveOrderCode("ORD-2026-0269"), "0269");
    assert.equal(shortDriveOrderCode("26-0269"), "0269");
    assert.equal(shortDriveOrderCode("0269"), "0269");
    assert.equal(shortDriveOrderCode("ORD-2026-0098"), "0098");
  });

  it("compacts Final for Prod to FinalProd", () => {
    assert.equal(compactFinalProdLabel("Final for Prod"), "FinalProd");
    assert.equal(compactFinalProdLabel("FinalProd"), "FinalProd");
    assert.equal(compactFinalProdLabel(""), "FinalProd");
  });

  it("names the Dessertz order and final-prod folders", () => {
    const plan = buildDriveFolderPlan({
      orderKey: "ORD-2026-0269",
      customerName: "Dessertz",
      itemIndex: 1,
      finalFolderName: "Final for Prod",
    });
    assert.equal(plan.designerName, "0269_Dessertz");
    assert.equal(plan.itemName, "0269_Dessertz_1");
    assert.equal(plan.finalName, "0269_Dessertz_1_FinalProd");
    assert.ok(plan.designerAliases.includes("26-0269_Dessertz"));
    assert.ok(plan.itemAliases.includes("26-0269_Dessertz_1"));
    assert.ok(plan.finalAliases.includes("Final for Prod_1"));
    assert.ok(plan.finalAliases.includes("26-0269_Final for Prod_1"));
  });

  it("keeps the customer+_Y folder even when a product title exists", () => {
    const plan = buildDriveFolderPlan({
      orderKey: "ORD-2026-0269",
      customerName: "Dessertz",
      itemIndex: 1,
      itemTitle: "Stickers — PO 1",
    });
    assert.equal(plan.itemName, "0269_Dessertz_1");
    assert.equal(plan.finalName, "0269_Dessertz_1_FinalProd");
  });
});
