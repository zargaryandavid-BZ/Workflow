import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDriveFolderPlan,
  compactFinalProdLabel,
  driveOrderKeyFromTitle,
  isFinalProdFolderName,
  pickFinalProdFolders,
  shortDriveOrderCode,
} from "./drive-folder-names.ts";

describe("drive folder names", () => {
  it("drops the year from CRM and short order codes", () => {
    assert.equal(shortDriveOrderCode("ORD-2026-0269"), "0269");
    assert.equal(shortDriveOrderCode("26-0269"), "0269");
    assert.equal(shortDriveOrderCode("26-3009"), "3009");
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

  it("names Bowboyz folders without a 26- year prefix", () => {
    const plan = buildDriveFolderPlan({
      orderKey: "26-3009",
      customerName: "Bowboyz Ecotics",
      itemIndex: 1,
      finalFolderName: "Final for Prod",
    });
    assert.equal(plan.designerName, "3009_Bowboyz Ecotics");
    assert.equal(plan.itemName, "3009_Bowboyz Ecotics_1");
    assert.equal(plan.finalName, "3009_Bowboyz Ecotics_1_FinalProd");
    assert.ok(plan.designerAliases.includes("26-3009_Bowboyz Ecotics"));
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

  it("does not treat 26-3009 as job 26 + part 3009", () => {
    assert.equal(driveOrderKeyFromTitle("26-3009"), "26-3009");
    assert.equal(driveOrderKeyFromTitle("26-3009-1"), "26-3009");
    assert.equal(driveOrderKeyFromTitle("3009-1"), "3009");
  });
});

describe("isFinalProdFolderName", () => {
  it("recognizes FinalProd, Final for Prod, and Final_<job> folders", () => {
    assert.equal(isFinalProdFolderName("0269_Dessertz_1_FinalProd"), true);
    assert.equal(isFinalProdFolderName("Final for Prod"), true);
    assert.equal(
      isFinalProdFolderName(
        "Final_26-15084_Safe Care Packaging_1_Tom Thompson - Hotbox farms"
      ),
      true
    );
    assert.equal(isFinalProdFolderName("Proofs"), false);
    assert.equal(
      isFinalProdFolderName(
        "26-15084_Safe Care Packaging_1_Tom Thompson - Hotbox farms"
      ),
      false
    );
    assert.equal(
      isFinalProdFolderName("GIORGIO_Final_Premium_Designer_Package"),
      false
    );
    assert.equal(isFinalProdFolderName("job_Final"), true);
    assert.equal(isFinalProdFolderName("Final files"), true);
  });
});

describe("pickFinalProdFolders", () => {
  it("uses the Final folder inside the job even when the name has no order number", () => {
    const kids = [
      { id: "f", name: "NCase Cards- SAMPLE TRADING CARD_Tim Gilmour_1_FinalProd" },
      { id: "p", name: "Proofs" },
    ];
    const picked = pickFinalProdFolders(kids, ["117711- ncase cards"], "inside-job");
    assert.equal(picked.length, 1);
    assert.equal(picked[0]?.id, "f");
  });

  it("does not pick every sibling Final folder when the name does not match", () => {
    const siblings = [
      { id: "a", name: "Final_26-15084_Hotbox" },
      { id: "b", name: "Final_26-15106_Mo" },
    ];
    const picked = pickFinalProdFolders(siblings, ["117711"], "shared");
    assert.equal(picked.length, 0);
  });
});
