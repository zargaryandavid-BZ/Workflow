import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  exactSelectOption,
  isAdminCatalogLine,
  isAdminIdentitySelectField,
  mapWebhookSelectValue,
  resolveLineSpecSelections,
} from "./webhook-admin-catalog.ts";

const PRODUCT_OPTIONS = [
  "Labels (Roll)",
  "Labels (Sheet)",
  "Folding Cartons / Boxes",
  "Business Cards",
  "Pouches Combo",
];

const MATERIAL_OPTIONS = [
  "White BOPP",
  "Clear BOPP",
  "White Vinyl",
  "White Vinyl - Aggressive Glue",
  "Holo BOPP",
];

describe("isAdminCatalogLine", () => {
  it("is true when bazaar_item_id is a finite number > 0", () => {
    assert.equal(
      isAdminCatalogLine({ spec_selections: { bazaar_item_id: 23 } }),
      true
    );
  });

  it("accepts a numeric string bazaar_item_id", () => {
    assert.equal(
      isAdminCatalogLine({ spec_selections: { bazaar_item_id: "23" } }),
      true
    );
  });

  it("is false for 0, negative, NaN, or missing id", () => {
    assert.equal(
      isAdminCatalogLine({ spec_selections: { bazaar_item_id: 0 } }),
      false
    );
    assert.equal(
      isAdminCatalogLine({ spec_selections: { bazaar_item_id: -1 } }),
      false
    );
    assert.equal(
      isAdminCatalogLine({ spec_selections: { bazaar_item_id: "abc" } }),
      false
    );
    assert.equal(isAdminCatalogLine({ product: "Roll Labels" }), false);
  });

  it("does not treat order-level catalog_source alone as Admin-shaped", () => {
    assert.equal(
      isAdminCatalogLine(
        { product: "Roll Labels" },
        { catalog_source: "admin" }
      ),
      false
    );
  });
});

describe("A) Admin Product Roll Labels skips catalog/alias/fuzzy", () => {
  it('stores "Roll Labels" even when options include "Labels (Roll)"', () => {
    const stored = mapWebhookSelectValue({
      field: "product",
      value: "Roll Labels",
      options: PRODUCT_OPTIONS,
      adminIdentity: true,
    });
    assert.equal(stored, "Roll Labels");
    assert.notEqual(stored, "Labels (Roll)");
  });

  it("exact option match is case/whitespace insensitive", () => {
    assert.equal(
      exactSelectOption("  roll   labels  ", ["Roll Labels", "Labels (Roll)"]),
      "Roll Labels"
    );
    assert.equal(
      mapWebhookSelectValue({
        field: "product",
        value: "roll labels",
        options: ["Roll Labels", "Labels (Roll)"],
        adminIdentity: true,
      }),
      "Roll Labels"
    );
  });
});

describe("B) Admin Product Mini Tuck End Box", () => {
  it("does not remap to Folding Cartons / Boxes", () => {
    const stored = mapWebhookSelectValue({
      field: "product",
      value: "Mini Tuck End Box",
      options: PRODUCT_OPTIONS,
      adminIdentity: true,
    });
    assert.equal(stored, "Mini Tuck End Box");
    assert.notEqual(stored, "Folding Cartons / Boxes");
  });
});

describe("C) Admin Materials skips fuzzy Vinyl trap", () => {
  it('stores "White BOPP (Aggressive Glue)" without alias or Vinyl fuzzy', () => {
    const stored = mapWebhookSelectValue({
      field: "materials",
      value: "White BOPP (Aggressive Glue)",
      options: MATERIAL_OPTIONS,
      adminIdentity: true,
    });
    assert.equal(stored, "White BOPP (Aggressive Glue)");
    assert.notEqual(stored, "White Vinyl - Aggressive Glue");
    assert.notEqual(stored, "White BOPP");
  });
});

describe("D) Legacy Product still aliases", () => {
  it('maps "Roll Labels" → "Labels (Roll)" when adminIdentity is false', () => {
    const stored = mapWebhookSelectValue({
      field: "product",
      value: "Roll Labels",
      options: PRODUCT_OPTIONS,
      adminIdentity: false,
    });
    assert.equal(stored, "Labels (Roll)");
  });
});

describe("E) Die text stored as-is", () => {
  it("persists Admin die name without select remapping", () => {
    assert.equal(isAdminIdentitySelectField("die"), false);
    const stored = mapWebhookSelectValue({
      field: "die",
      value: "Stizzy 1g preroll DIELINE",
      options: ["Standard Die", "Circle"],
      adminIdentity: true,
    });
    assert.equal(stored, "Stizzy 1g preroll DIELINE");
  });
});

describe("F) SET_SIZE persist; no Finished Size alias rewrite", () => {
  it("keeps SET_SIZE on spec_selections", () => {
    const sel = resolveLineSpecSelections({
      spec_selections: {
        bazaar_item_id: 23,
        SET_SIZE: "2.65x2.9",
        BAZAAR_DIE_ID: 44,
      },
    });
    assert.equal(sel?.SET_SIZE, "2.65x2.9");
    assert.equal(sel?.bazaar_item_id, 23);
    assert.equal(sel?.BAZAAR_DIE_ID, 44);
  });

  it("does not alias finished_size into another select option", () => {
    const stored = mapWebhookSelectValue({
      field: "finished_size",
      value: "2.65x2.9",
      options: ["2 x 3 in", "4 x 3 in", "2.65 x 2.9 in"],
      adminIdentity: true,
    });
    assert.equal(stored, "2.65x2.9");
  });
});

describe("G) refreshPortalOrdersFromWebhook uses the same helper", () => {
  it("create and portal re-fire both call isAdminCatalogLine / mapWebhookSelectValue", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "webhook-order.ts"),
      "utf8"
    );
    const refreshStart = src.indexOf(
      "async function refreshPortalOrdersFromWebhook"
    );
    const createStart = src.indexOf("async function createSingleWebhookJob");
    assert.ok(refreshStart >= 0, "refreshPortalOrdersFromWebhook missing");
    assert.ok(createStart >= 0, "createSingleWebhookJob missing");

    const refresh = src.slice(refreshStart, createStart);
    const create = src.slice(
      createStart,
      src.indexOf("export async function createOrderFromWebhook")
    );

    assert.ok(
      refresh.includes("isAdminCatalogLine"),
      "portal re-fire must detect Admin lines"
    );
    assert.ok(
      refresh.includes("mapWebhookSelectValue") ||
        refresh.includes("buildCustomFieldValues"),
      "portal re-fire must use the shared select mapper"
    );
    assert.ok(
      create.includes("isAdminCatalogLine"),
      "create must detect Admin lines"
    );
    assert.ok(
      create.includes("mapWebhookSelectValue") ||
        create.includes("buildCustomFieldValues"),
      "create must use the shared select mapper"
    );
    assert.ok(src.includes("mapWebhookSelectValue("));
  });
});

describe("H) Mixed cart — per-line identity", () => {
  it("Admin line keeps identity; legacy sibling still aliases", () => {
    const items = [
      {
        product: "Roll Labels",
        spec_selections: { bazaar_item_id: 23, SET_SIZE: "2.65x2.9" },
      },
      { product: "Roll Labels" },
    ];
    const body = {
      catalog_source: "admin",
      items,
    };

    assert.equal(isAdminCatalogLine(items[0], body), true);
    assert.equal(isAdminCatalogLine(items[1], body), false);

    assert.equal(
      mapWebhookSelectValue({
        field: "product",
        value: items[0]!.product,
        options: PRODUCT_OPTIONS,
        adminIdentity: isAdminCatalogLine(items[0], body),
      }),
      "Roll Labels"
    );
    assert.equal(
      mapWebhookSelectValue({
        field: "product",
        value: items[1]!.product,
        options: PRODUCT_OPTIONS,
        adminIdentity: isAdminCatalogLine(items[1], body),
      }),
      "Labels (Roll)"
    );
  });

  it("does not inherit order-level spec_selections onto a legacy sibling", () => {
    const legacy = { product: "Pouches Combo" };
    const body = {
      catalog_source: "admin",
      spec_selections: { bazaar_item_id: 23 },
      items: [
        { spec_selections: { bazaar_item_id: 23 } },
        legacy,
      ],
    };
    assert.equal(isAdminCatalogLine(legacy, body), false);
    assert.equal(resolveLineSpecSelections(legacy, body), null);
  });
});

describe("flat payload spec_selections", () => {
  it("detects and persists spec_selections from the body when the item has none", () => {
    const body = {
      spec_selections: { bazaar_item_id: 23, SET_SIZE: "2.65x2.9" },
    };
    assert.equal(isAdminCatalogLine({}, body), true);
    const sel = resolveLineSpecSelections({}, body);
    assert.equal(sel?.SET_SIZE, "2.65x2.9");
    assert.equal(sel?.bazaar_item_id, 23);
  });

  it("Q9 TEST-MAP-ROLL-23 flat portal body is Admin-shaped and keeps Roll Labels", () => {
    const body = {
      source: "portal",
      catalog_source: "admin",
      order_number: "TEST-MAP-ROLL-23",
      product: "Roll Labels",
      materials: "White BOPP",
      finished_size: "2.65 x 2.9 in",
      die: "Stizzy 1g preroll DIELINE",
      spec_selections: {
        bazaar_item_id: 23,
        SET_SIZE: "2.65x2.9",
        DIE_NAME: "Stizzy 1g preroll DIELINE",
        BAZAAR_DIE_ID: 44,
      },
    };
    assert.equal(isAdminCatalogLine({}, body), true);
    assert.equal(
      mapWebhookSelectValue({
        field: "product",
        value: "Roll Labels",
        options: PRODUCT_OPTIONS,
        adminIdentity: isAdminCatalogLine({}, body),
      }),
      "Roll Labels"
    );
    assert.equal(
      mapWebhookSelectValue({
        field: "die",
        value: "Stizzy 1g preroll DIELINE",
        options: ["Standard Die"],
        adminIdentity: true,
      }),
      "Stizzy 1g preroll DIELINE"
    );
    assert.equal(resolveLineSpecSelections({}, body)?.SET_SIZE, "2.65x2.9");
  });
});

describe("Q5 other selects stay on alias/fuzzy for Admin lines", () => {
  it("still aliases lamination on an Admin-shaped line", () => {
    assert.equal(
      mapWebhookSelectValue({
        field: "lamination",
        value: "Matte Lamination",
        options: ["Matte", "Gloss"],
        adminIdentity: true,
      }),
      "Matte"
    );
  });
});
