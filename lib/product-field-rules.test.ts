import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFormQuestions,
  customFieldDisplay,
  filterPickerProducts,
  findCatalogProductInfo,
  orderedProductQuestions,
  productLineRules,
  questionHandledByCustomField,
  questionLabel,
  sortCategoriesWebsiteOrder,
  type CatalogProductInfo,
} from "./product-field-rules.ts";
import { catalogV2ProductFromInfo } from "./crm-create-product.ts";
import { buildCrmSnapshot } from "./crm-catalog-v2.ts";
import {
  buildCustomFieldPayload,
  resolveOrderFormFields,
} from "./order-form.ts";
import type { CustomField } from "./types.ts";

const f = (spec: string) =>
  spec.split(",").map((p) => {
    const [key, type] = p.split(":");
    return { key: key!, type: type! };
  });

// Shapes copied from the live CRM v1 catalog (catalog_cache, Bazaar).
const ROLL_LABELS: CatalogProductInfo = {
  id: "roll-labels",
  name: "Roll Labels",
  category: "Labels & Stickers",
  fields: f(
    "CUSTOM_SIZE:dimensions,MATERIAL:select,DIE:select,SET_SIZE:select,QUANTITY:number,FINISHING:select,DESIGN_JOB_POSSIBLE:boolean,ROLL_DIRECTION:select,COLOR_MODE:select,DESIGN_SERVICE:boolean,CUTTING:select,SPECIAL_EFFECTS:multi_select",
  ),
  hiddenFields: ["color_mode", "sides"],
  fieldLabels: { width: "Width", height: "Height", material: "Label Material" },
  fieldOrder: [],
  fieldOptions: { CUTTING: [{ label: "Die", value: "Die" }] },
  materials: ["Clear BOPP", "White BOPP"],
  finishing: ["Gloss Lamination"],
  specialEffects: ["Foil"],
};

const POUCH: CatalogProductInfo = {
  id: "stand-up-pouches",
  name: "Stand Up Pouches",
  category: "Bags & Pouches",
  fields: f(
    "ZIPPER:select,SEAL_SIDES:select,CORNERS:select,GUSSET_SIZE:select,TEAR_NOTCH:boolean,DOUBLE_SIDED:boolean,SET_SIZE:select,CUSTOM_SIZE:dimensions,MATERIAL:select,FINISHING:select,QUANTITY:number,DESIGN_JOB_POSSIBLE:boolean,SPECIAL_EFFECTS:multi_select,GUSSET:boolean",
  ),
  hiddenFields: ["color_mode", "sides", "roll_direction", "die_cut", "perforation"],
  fieldLabels: { material: "Film Material" },
  materials: ["Clear PET", "Silver Virgin"],
  finishing: ["Matte Lamination"],
};

const BOX: CatalogProductInfo = {
  id: "mini-tuck-end-box",
  name: "Mini Tuck End Box",
  category: "Packaging & Boxes",
  fields: f(
    "CUSTOM_SIZE_3:dimensions,SET_SIZE_3:select,MATERIAL:select,FINISHING:select,CUSTOM_SIZE:dimensions,DIE:select,CONTAINER:select,DESIGN_JOB_POSSIBLE:boolean,SPECIAL_EFFECTS:multi_select,DOUBLE_SIDED:boolean,QUANTITY:number",
  ),
  hiddenFields: ["color_mode", "sides", "roll_direction", "perforation", "height"],
  fieldLabels: { width: "L × W × H", material: "Board Stock" },
  materials: ["18pt C1S"],
};

const BUSINESS_CARDS: CatalogProductInfo = {
  id: "business-cards",
  name: "Business Cards",
  category: "Marketing Materials",
  fields: f(
    "SET_SIZE:select,CUSTOM_SIZE:dimensions,MATERIAL:select,FINISHING:select,DOUBLE_SIDED:boolean,SPECIAL_EFFECTS:multi_select,DESIGN_JOB_POSSIBLE:boolean,QUANTITY:number,ROUND_CORNERS:boolean",
  ),
  hiddenFields: ["roll_direction", "perforation"],
  fieldLabels: { material: "Paper Stock" },
  materials: ["16pt Cardstock"],
};

const TEE: CatalogProductInfo = {
  id: "tee",
  name: "Classic Tee",
  category: "Tees & Polos",
  fields: f("MATERIAL:select,COLOR:select,QUANTITY:number"),
  materials: ["Cotton"],
};

describe("productLineRules (port of CRM builderLineRules)", () => {
  it("roll labels: roll direction + color mode asked, sides hidden, cutting on", () => {
    const r = productLineRules(ROLL_LABELS);
    assert.ok(r.isLabels);
    assert.ok(r.showCutting);
    assert.ok(!r.hiddenFields.includes("roll_direction"));
    assert.ok(!r.hiddenFields.includes("color_mode"));
    assert.ok(r.hiddenFields.includes("sides"));
    assert.ok(r.hiddenFields.includes("perforation"));
    assert.deepEqual(r.requiredFields, [
      "material",
      "width",
      "height",
      "quantity",
      "unit_price",
      "cutting_type",
    ]);
  });

  it("pouch: no roll direction / color mode / cutting / die cut / perforation", () => {
    const r = productLineRules(POUCH);
    assert.ok(r.isPouch);
    assert.equal(r.showCutting, false);
    for (const k of ["roll_direction", "color_mode", "cutting_type", "die_cut", "perforation"]) {
      assert.ok(r.hiddenFields.includes(k), k);
    }
    // DOUBLE_SIDED keeps Workflow's single Sides field.
    assert.ok(!r.hiddenFields.includes("sides"));
  });

  it("box: sheet cutting, 3D size keeps width/height, no roll direction", () => {
    const r = productLineRules(BOX);
    assert.ok(r.isBoxes && r.showCutting && r.isSheetCutting);
    assert.ok(!r.hiddenFields.includes("width"));
    assert.ok(r.hiddenFields.includes("roll_direction"));
    assert.ok(r.hiddenFields.includes("color_mode"));
  });

  it("business cards: sides asked (DOUBLE_SIDED), no roll direction / color mode", () => {
    const r = productLineRules(BUSINESS_CARDS);
    assert.ok(!r.hiddenFields.includes("sides"));
    assert.ok(r.hiddenFields.includes("roll_direction"));
    assert.ok(r.hiddenFields.includes("color_mode"));
    assert.ok(r.showCutting);
  });

  it("apparel hides print-size questions like the CRM", () => {
    const r = productLineRules(TEE);
    assert.ok(r.isApparel);
    for (const k of ["material", "lamination", "width", "height", "roll_direction", "sides"]) {
      assert.ok(r.hiddenFields.includes(k), k);
    }
  });

  it("no fields list → falls back to materials / finishing / toggles", () => {
    const r = productLineRules({ name: "X", materials: [], finishing: [] });
    assert.ok(r.hiddenFields.includes("material"));
    assert.ok(r.hiddenFields.includes("lamination"));
    assert.ok(r.hiddenFields.includes("roll_direction"));
    assert.ok(!r.requiredFields.includes("material"));
  });
});

describe("orderedProductQuestions", () => {
  it("uses CRM default order when field_order is empty, drops internal keys", () => {
    const keys = orderedProductQuestions(POUCH).map((q) => q.key);
    assert.deepEqual(keys.slice(0, 5), ["GUSSET", "TEAR_NOTCH", "MATERIAL", "FINISHING", "SPECIAL_EFFECTS"]);
    assert.ok(!keys.includes("DESIGN_JOB_POSSIBLE"));
    // Not in the default order → keep catalog order at the end.
    assert.deepEqual(keys.slice(-5), ["ZIPPER", "SEAL_SIDES", "CORNERS", "GUSSET_SIZE", "CUSTOM_SIZE"]);
  });

  it("follows the product's own field_order", () => {
    const keys = orderedProductQuestions({
      ...BOX,
      fieldOrder: ["MATERIAL", "QUANTITY", "DIE"],
    }).map((q) => q.key);
    assert.deepEqual(keys.slice(0, 3), ["MATERIAL", "QUANTITY", "DIE"]);
  });

  it("labels come from CRM field_labels (any key case)", () => {
    assert.equal(questionLabel(ROLL_LABELS, "MATERIAL"), "Label Material");
    assert.equal(questionLabel(POUCH, "material"), "Film Material");
    assert.equal(questionLabel(POUCH, "SEAL_SIDES"), "Seal sides");
  });
});

describe("customFieldDisplay", () => {
  const box = productLineRules(BOX);
  const roll = productLineRules(ROLL_LABELS);

  it("roll direction no longer forced on every card", () => {
    assert.equal(
      customFieldDisplay({ fieldName: "Roll Direction", value: null, rules: box, family: "box", hideEmpty: false }),
      "hide",
    );
    assert.equal(
      customFieldDisplay({ fieldName: "Roll Direction", value: null, rules: roll, family: "roll_label", hideEmpty: false }),
      "show",
    );
  });

  it("a stored value the product does not ask is kept visible as 'saved'", () => {
    assert.equal(
      customFieldDisplay({ fieldName: "Roll Direction", value: "3-Right", rules: box, family: "box", hideEmpty: true }),
      "saved",
    );
    assert.equal(
      customFieldDisplay({ fieldName: "Sides", value: "Single-sided", rules: roll, family: "roll_label", hideEmpty: true }),
      "saved",
    );
  });

  it("placeholder values ('None', 0, unchecked) on hidden fields stay hidden", () => {
    for (const value of ["None", 0, "0", false, ""]) {
      assert.equal(
        customFieldDisplay({ fieldName: "Perforation", value, rules: productLineRules(POUCH), family: "pouch", hideEmpty: false }),
        "hide",
      );
    }
    assert.equal(
      customFieldDisplay({ fieldName: "Width", value: 0, rules: roll, family: "roll_label", hideEmpty: true }),
      "hide",
    );
  });

  it("unknown product (no rules) → family check only", () => {
    assert.equal(
      customFieldDisplay({ fieldName: "Roll Direction", value: null, rules: null, family: "unknown", hideEmpty: false }),
      "show",
    );
    assert.equal(
      customFieldDisplay({ fieldName: "Materials", value: "Gloss", rules: null, family: null, hideEmpty: true }),
      "show",
    );
  });
});

describe("existing cards keep their values", () => {
  const field = (id: string, name: string, type = "select"): CustomField => ({
    id,
    tenant_id: "t",
    name,
    field_type: type as CustomField["field_type"],
    options: [],
    position: 0,
    required: false,
  });
  const fields = [
    field("p", "Product"),
    field("m", "Materials"),
    field("s", "Sides"),
    field("r", "Roll Direction"),
    field("c", "Color Mode"),
    field("pf", "Perforation", "checkbox"),
    field("w", "Width", "text"),
    field("h", "Height", "text"),
  ];
  // A box card that (wrongly) carries roll-label values from an old import.
  const stored: Record<string, unknown> = {
    p: "Mini Tuck End Box",
    m: "18pt C1S",
    s: "Single-sided",
    r: "3-Right",
    c: "CMYK",
    pf: false,
    w: "4",
    h: "6",
  };

  it("save payload re-sends every stored value, hidden or not", () => {
    const resolved = resolveOrderFormFields(fields);
    const payload = buildCustomFieldPayload(resolved, stored, [], "", "");
    const byId = Object.fromEntries(payload.map((r) => [r.customFieldId, r.value]));
    for (const [id, value] of Object.entries(stored)) {
      assert.deepEqual(byId[id], value, `field ${id}`);
    }
  });

  it("every stored real value is visible (show or saved), never dropped", () => {
    const rules = productLineRules(BOX);
    for (const fld of fields) {
      const value = stored[fld.id];
      const d = customFieldDisplay({ fieldName: fld.name, value, rules, family: "box", hideEmpty: true });
      if (value === false) assert.equal(d, "hide");
      else assert.notEqual(d, "hide", fld.name);
    }
  });
});

describe("helpers", () => {
  it("questionHandledByCustomField", () => {
    const names = ["Materials", "Sides", "Width", "Height", "Die", "Finishing"];
    assert.ok(questionHandledByCustomField("QUANTITY", []));
    assert.ok(questionHandledByCustomField("DOUBLE_SIDED", names));
    assert.ok(questionHandledByCustomField("CUSTOM_SIZE", names));
    assert.ok(!questionHandledByCustomField("ZIPPER", names));
    assert.ok(!questionHandledByCustomField("SET_SIZE_3", names));
  });

  it("website category order", () => {
    assert.deepEqual(
      sortCategoriesWebsiteOrder(["More", "Combos", "Bags & Pouches", "Labels & Stickers", "Packaging & Boxes"]),
      ["Labels & Stickers", "Packaging & Boxes", "Bags & Pouches", "Combos", "More"],
    );
  });

  it("picker filters by category and search", () => {
    const all = [ROLL_LABELS, POUCH, BOX, BUSINESS_CARDS];
    assert.deepEqual(
      filterPickerProducts(all, { category: "Bags & Pouches" }).map((p) => p.name),
      ["Stand Up Pouches"],
    );
    assert.deepEqual(
      filterPickerProducts(all, { search: "box" }).map((p) => p.name),
      ["Mini Tuck End Box"],
    );
    assert.equal(findCatalogProductInfo(all, " roll labels ")?.id, "roll-labels");
    assert.equal(findCatalogProductInfo(all, "Custom Tissue Paper"), null);
  });
});

describe("admin create questions", () => {
  it("pouch asks only its questions, CRM labels, materials from the product", () => {
    const qs = createFormQuestions(POUCH);
    const keys = qs.map((q) => q.key);
    assert.ok(!keys.includes("QUANTITY"));
    assert.ok(!keys.includes("DESIGN_JOB_POSSIBLE"));
    assert.ok(keys.includes("ZIPPER"));
    const v2 = catalogV2ProductFromInfo(POUCH)!;
    const mat = v2.specifications.find((s) => s.key === "MATERIAL")!;
    assert.equal(mat.label, "Film Material");
    assert.deepEqual(mat.options?.map((o) => o.label), ["Clear PET", "Silver Virgin"]);
  });

  it("roll labels hide Sides; snapshot keeps the old crm_snapshot shape", () => {
    const keys = createFormQuestions(ROLL_LABELS).map((q) => q.key);
    assert.ok(keys.includes("ROLL_DIRECTION"));
    const v2 = catalogV2ProductFromInfo(ROLL_LABELS)!;
    assert.equal(v2.id, "roll-labels");
    const snap = buildCrmSnapshot(v2, {
      MATERIAL: { display_value: "Clear BOPP", value: "Clear BOPP" },
    });
    assert.equal(snap.line_items!.length, 1);
    assert.equal(snap.line_items![0]!.product_name, "Roll Labels");
    const mat = snap.line_items![0]!.specifications!.find((s) => s.key === "MATERIAL")!;
    assert.equal(mat.display_value, "Clear BOPP");
  });
});
