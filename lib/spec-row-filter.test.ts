import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanSpecRow,
  cleanSpecRows,
  humanSpecLabel,
  isCustomFieldRelevant,
  isEmptySpecValue,
  isJunkSpecValue,
  isPricingOrInternalSpecKey,
  productFamily,
} from "./spec-row-filter.ts";
import { buildJobTicketSpecRows } from "./job-ticket-spec-rows.ts";
import {
  floorSpecDisplayRows,
  webhookSpecRowsForJobTicket,
} from "./product-spec-options.ts";
import type { CustomField } from "./types.ts";

function field(
  id: string,
  name: string,
  field_type: CustomField["field_type"] = "text",
  position = 0,
): CustomField {
  return {
    id,
    tenant_id: "tenant",
    name,
    field_type,
    options: [],
    position,
    required: false,
  };
}

const pairs = (rows: { label: string; value: string }[]) =>
  rows.map((r) => `${r.label}: ${r.value}`);

describe("pricing / internal keys", () => {
  it("blocks money, links, CRM bookkeeping and ids", () => {
    for (const key of [
      "pricePerSheet",
      "Pricepersheet",
      "lineTotal",
      "Linetotal",
      "dieFee",
      "BREAKDOWN",
      "billedSheets",
      "Unit Price ($)",
      "approvalUrl",
      "Approvaldecision",
      "approvalDecidedAt",
      "crmLineName",
      "designerFolderUrl",
      "bazaar_item_id",
      "skus_inbound_fingerprint",
      "NOTES",
      "DESIGN_LIST",
      "markup",
      "discount",
    ]) {
      assert.equal(isPricingOrInternalSpecKey(key), true, key);
    }
  });

  it("keeps real production keys", () => {
    for (const key of [
      "SET_SIZE",
      "LABEL_CORNERS",
      "ROLL_DIRECTION",
      "FILE_SETUP",
      "BOARD",
      "ZIPPER",
      "CUSTOM_BOX",
      "Die",
      "Folding / Gluing",
      "Special effects",
    ]) {
      assert.equal(isPricingOrInternalSpecKey(key), false, key);
    }
  });
});

describe("values", () => {
  it("treats None / N/A / 0 / 0x0 / empty / No as empty", () => {
    for (const v of [
      "",
      " ",
      "None",
      "none",
      "N/A",
      "0",
      "0.00",
      "0x0",
      "0 × 0",
      "No",
      "false",
    ]) {
      assert.equal(isEmptySpecValue(v), true, JSON.stringify(v));
    }
    for (const v of ["3-Right", "4x2", "10200", "Rounded"]) {
      assert.equal(isEmptySpecValue(v), false, v);
    }
  });

  it("flags $ amounts, URLs and ISO timestamps", () => {
    assert.equal(isJunkSpecValue("Base — 14pt SBS (1,001–2,500): $0.88"), true);
    assert.equal(
      isJunkSpecValue("https://workflow-rho-one.vercel.app/respond/fa1f5069"),
      true,
    );
    assert.equal(isJunkSpecValue("2026-11-05T21:54:55.089Z"), true);
    assert.equal(isJunkSpecValue("4.7x3x9"), false);
  });
});

describe("labels", () => {
  it("unifies corners, roll direction, finishing", () => {
    assert.equal(humanSpecLabel("LABEL_CORNERS", "Label corners"), "Corners");
    assert.equal(humanSpecLabel("ROUNDED_CORNERS"), "Corners");
    assert.equal(
      humanSpecLabel("ROLL_DIRECTION", "Roll direction"),
      "Roll Direction",
    );
    assert.equal(humanSpecLabel("LAMINATION"), "Finishing");
    assert.equal(humanSpecLabel("CONTAINER_NAME"), "Container");
    assert.equal(humanSpecLabel("HANDLE_COLOR"), "Handle color");
    assert.equal(humanSpecLabel("someCamelKey"), "Some camel key");
  });

  it("old 'Rounded Corners: Yes' reads as 'Corners: Rounded'", () => {
    assert.deepEqual(
      cleanSpecRow({
        key: "ROUNDED_CORNERS",
        label: "Rounded Corners",
        value: "Yes",
      }),
      {
        key: "ROUNDED_CORNERS",
        label: "Corners",
        value: "Rounded",
      },
    );
    assert.equal(cleanSpecRow({ key: "ROUNDED_CORNERS", value: "No" }), null);
  });

  it("finishing and day wording", () => {
    assert.equal(
      cleanSpecRow({ key: "Finishing", value: "Soft Touch" })?.value,
      "Soft Touch Lamination",
    );
    assert.equal(
      cleanSpecRow({ key: "LAMINATION", value: "Gloss" })?.value,
      "Gloss Lamination",
    );
    assert.equal(
      cleanSpecRow({ key: "LAMINATION", value: "Front: Matte" })?.value,
      "Front: Matte",
    );
    assert.equal(
      cleanSpecRow({ key: "Due", value: "5 working days after approval" })
        ?.value,
      "5 business days after approval",
    );
  });

  it("category slug reads as words", () => {
    assert.equal(
      cleanSpecRow({ key: "Category", value: "bags-flexible-packaging" })
        ?.value,
      "Bags flexible packaging",
    );
  });
});

describe("product family", () => {
  it("derives the family from product, then category", () => {
    assert.equal(productFamily({ product: "Roll Labels" }), "roll_label");
    assert.equal(productFamily({ product: "Labels (Roll)" }), "roll_label");
    assert.equal(productFamily({ product: "Tuck end box" }), "box");
    assert.equal(
      productFamily({ product: "Thumb-Cut Tall Tuck End Box" }),
      "box",
    );
    assert.equal(
      productFamily({ product: "Custom Packaging Tape" }),
      "packaging_resale",
    );
    assert.equal(
      productFamily({ product: "Custom Gift Bags" }),
      "packaging_resale",
    );
    assert.equal(
      productFamily({ product: "Custom Tissue Paper" }),
      "packaging_resale",
    );
    assert.equal(
      productFamily({ product: "Custom Wrapping Paper Rolls" }),
      "packaging_resale",
    );
    assert.equal(productFamily({ product: "Stand Up Pouches" }), "pouch");
    assert.equal(productFamily({ product: "4x5 Bag + Label Combo" }), "combo");
    assert.equal(productFamily({ product: "Diecut Stickers" }), "sheet_label");
    assert.equal(
      productFamily({ product: "Premium Trading Cards (Scodix)" }),
      "marketing",
    );
    assert.equal(productFamily({ category: "📑 Packaging & Boxes" }), "box");
    assert.equal(
      productFamily({ category: "bags-flexible-packaging" }),
      "pouch",
    );
    // A label category alone could be roll or sheet: stay unknown (show all).
    assert.equal(
      productFamily({ category: "🏷️ Labels & Stickers" }),
      "unknown",
    );
    assert.equal(productFamily({}), "unknown");
  });

  it("roll rows only on roll labels; Sides not on tape / gift bags", () => {
    assert.equal(
      isCustomFieldRelevant("Roll Direction", "3-Right", "roll_label"),
      true,
    );
    assert.equal(
      isCustomFieldRelevant("Roll Direction", "3-Right", "box"),
      false,
    );
    assert.equal(
      isCustomFieldRelevant("Roll Direction", "3-Right", "unknown"),
      true,
    );
    assert.equal(isCustomFieldRelevant("QTY_PER_ROLL", "1000", "pouch"), false);
    assert.equal(
      isCustomFieldRelevant("Sides", "Single-sided", "packaging_resale"),
      false,
    );
    assert.equal(
      isCustomFieldRelevant("Sides", "Double-sided", "marketing"),
      true,
    );
    assert.equal(isCustomFieldRelevant("Width", 0, "packaging_resale"), false);
    assert.equal(isCustomFieldRelevant("Width", "0", "roll_label"), false);
  });
});

describe("real cards (audit 2026-11-26)", () => {
  it("BZ-695: File Setup price becomes a design count; corners and turnaround clean", () => {
    const rows = cleanSpecRows([
      { key: "SET_SIZE", label: "Size", value: "3.9648x1.3613" },
      { key: "LABEL_CORNERS", label: "Corners", value: "Rounded" },
      {
        key: "FILE_SETUP",
        label: "File Setup",
        value: "6 extra designs × $5 = $30.00 (first 2 included)",
      },
      {
        key: "ROLL_DIRECTION",
        label: "Roll direction",
        value: "3 · Right of Copy",
      },
      { key: "TURNAROUND", label: "Turnaround", value: "Standard" },
    ]);
    assert.deepEqual(pairs(rows), [
      "Size: 3.9648x1.3613",
      "Corners: Rounded",
      "Designs: 8 designs",
      "Roll Direction: 3 · Right of Copy",
    ]);
    assert.equal(
      rows.some((r) => r.value.includes("$")),
      false,
    );
  });

  it("BZ-563: sheet breakdown, line total and multipliers are dropped", () => {
    const rows = webhookSpecRowsForJobTicket({
      spec_display: [
        { key: "BOARD", label: "Board", value: "14pt" },
        { key: "SIDES", label: "Sides", value: "44" },
        { key: "dieFee", label: "Diefee", value: "0" },
        {
          key: "BREAKDOWN",
          label: "Breakdown",
          value:
            "Base — 14pt SBS (1,001–2,500): $0.88 | Back side printing (4/4): + $0.26",
        },
        { key: "lineTotal", label: "Linetotal", value: "4315.2" },
        { key: "LAMINATION", label: "Lamination", value: "1.2" },
        { key: "billedSheets", label: "Billedsheets", value: "1200" },
        { key: "pricePerSheet", label: "Pricepersheet", value: "3.6" },
        { key: "backLamination", label: "Backlamination", value: "1.2" },
        { key: "enteredQuantity", label: "Enteredquantity", value: "1200" },
      ],
    });
    assert.deepEqual(pairs(rows), ["Board: 14pt", "Sides: Double-sided (4/4)"]);
  });

  it("W505-1: approval URL, CRM line name, decision stamps and NOTES echo are dropped", () => {
    const rows = webhookSpecRowsForJobTicket({
      spec_selections: {
        NOTES:
          "Box: 4.70 × 3.00 × 9.00 in (L×W×H) · Flat dieline: 16.01 × 16.12 in · Sides: 1 Side",
        SET_SIZE: "16.01x16.12",
        CUSTOM_BOX: "4.7x3x9",
        approvalUrl:
          "https://workflow-rho-one.vercel.app/respond/fa1f5069-92fc-4361-ada6-9a222ddfd3a9",
        crmLineName: "Tuck end box — 4.70 × 3.00 × 9.00 in (L×W×H)",
        bazaar_item_id: 195,
        approvalDecision: "rejected",
        approvalDecidedAt: "2026-11-05T21:54:55.089Z",
        designerFolderUrl:
          "https://drive.google.com/drive/folders/1HXTYLR_tHdqghMonX2oz4HdG2hmgGr4c",
      },
    });
    assert.deepEqual(pairs(rows), [
      "Size: 16.01x16.12",
      "Box size (L×W×H): 4.7x3x9",
    ]);
  });

  it("0466-1: 'Roll Direction: None' and unchecked boxes are not printed on a box ticket", () => {
    const customFields = [
      field("cat", "Category", "select", 1),
      field("product", "Product", "select", 2),
      field("materials", "Materials", "select", 3),
      field("finishing", "Finishing", "select", 4),
      field("roll", "Roll Direction", "select", 5),
      field("diecut", "Die Cut", "checkbox", 6),
      field("app", "Application", "checkbox", 7),
      field("qty", "Quantity", "number", 8),
    ];
    const rows = buildJobTicketSpecRows({
      customFields,
      fieldValues: {
        cat: "📑 Packaging & Boxes",
        product: "Tuck end box",
        materials: "18pt Cardstock",
        finishing: "Gloss Lamination",
        roll: "None",
        diecut: false,
        app: false,
        qty: 640,
      },
      specs: {},
    });
    const labels = rows.map((r) => r.label);
    assert.equal(labels.includes("Roll Direction"), false);
    assert.equal(labels.includes("Die Cut"), false);
    assert.equal(labels.includes("Application"), false);
    assert.ok(pairs(rows).includes("Product: Tuck end box"));
  });

  it("roll direction on a box is hidden even with a real value", () => {
    const rows = buildJobTicketSpecRows({
      customFields: [
        field("product", "Product", "select", 1),
        field("roll", "Roll Direction", "select", 2),
      ],
      fieldValues: { product: "Tuck end box", roll: "3-Right" },
      specs: {},
    });
    assert.equal(
      rows.some((r) => r.label === "Roll Direction"),
      false,
    );
  });

  it("W502-1: tape has no Sides and no 0 × 0 size; the real size shows", () => {
    const rows = buildJobTicketSpecRows({
      customFields: [
        field("product", "Product", "select", 1),
        field("sides", "Sides", "select", 2),
        field("width", "Width", "text", 3),
        field("height", "Height", "text", 4),
        field("price", "Unit Price ($)", "number", 5),
        field("qty", "Quantity", "number", 6),
      ],
      fieldValues: {
        product: "Custom Packaging Tape",
        sides: "Single-sided",
        width: 0,
        height: 0,
        price: 18,
        qty: 1,
      },
      specs: { spec_selections: { SET_SIZE: '2"x50ft', bazaar_item_id: 58 } },
    });
    assert.deepEqual(pairs(rows), [
      "Product: Custom Packaging Tape",
      'Size: 2"x50ft',
      "Quantity: 1",
    ]);
  });

  it("roll labels keep roll direction and labels-per-roll rows", () => {
    const rows = buildJobTicketSpecRows({
      customFields: [
        field("product", "Product", "select", 1),
        field("roll", "Roll Direction", "select", 2),
      ],
      fieldValues: { product: "Roll Labels", roll: "3-Right" },
      specs: {
        spec_display: [
          { key: "QTY_PER_ROLL", label: "Qty Per Roll", value: "1000" },
          {
            key: "ROLL_DIRECTION",
            label: "Roll direction",
            value: "3 · Right of Copy",
          },
        ],
      },
    });
    assert.deepEqual(pairs(rows), [
      "Product: Roll Labels",
      "Roll Direction: 3-Right",
      "Labels per roll: 1000",
    ]);
  });
});

describe("card floor rows", () => {
  it("spec_display on the card drops pricing and unifies labels", () => {
    const rows = floorSpecDisplayRows([
      { key: "LABEL_CORNERS", label: "Label corners", value: "Rounded" },
      {
        key: "FILE_SETUP",
        label: "File Setup",
        value: "55 extra designs × $5 = $275.00",
      },
      {
        key: "Approvalurl",
        label: "Approvalurl",
        value: "https://x.example/respond/1",
      },
      { key: "TURNAROUND", label: "Turnaround", value: "Rush" },
    ]);
    assert.deepEqual(pairs(rows), [
      "Corners: Rounded",
      "Designs: 55 extra designs",
      "Turnaround: Rush",
    ]);
  });
});
