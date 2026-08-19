import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBooleanDisplay,
  formatDimensionsDisplay,
  getDisplaySpecs,
  specLabelFromSnapshot,
} from "./connected-specs.ts";
import {
  CRM_V2_SCHEMA_ERROR,
  catalogProductCount,
  findCatalogProduct,
  hasCatalogV2Schema,
  parseCatalogV2,
} from "./crm-catalog-v2.ts";

const snapshot = {
  line_items: [
    {
      product_id: "prod_roll",
      product_name: "Roll Labels",
      specifications: [
        {
          key: "ROLL_DIRECTION",
          label: "Roll direction",
          type: "select" as const,
          display_value: "Inside Left",
          value: { option_id: "opt_rd_inside_left", label: "Inside Left" },
        },
        {
          key: "LAMINATION",
          label: "Lamination",
          type: "select" as const,
          display_value: "Matte",
          value: { option_id: "opt_matte", label: "Matte" },
        },
        {
          key: "NOTES",
          label: "Notes",
          type: "text" as const,
          display_value: "",
          value: "",
        },
      ],
    },
  ],
};

describe("getDisplaySpecs", () => {
  it("returns snapshot values with overridden false when no overrides", () => {
    const specs = getDisplaySpecs({ crm_snapshot: snapshot, user_overrides: {} });
    assert.equal(specs.length, 2);
    assert.equal(specs[0].key, "ROLL_DIRECTION");
    assert.equal(specs[0].display_value, "Inside Left");
    assert.equal(specs[0].overridden, false);
    assert.equal(specs[1].key, "LAMINATION");
  });

  it("lets user_overrides win and marks overridden", () => {
    const specs = getDisplaySpecs({
      crm_snapshot: snapshot,
      user_overrides: {
        ROLL_DIRECTION: {
          display_value: "Outside Right",
          value: { option_id: "opt_rd_outside_right", label: "Outside Right" },
        },
      },
    });
    const roll = specs.find((s) => s.key === "ROLL_DIRECTION");
    assert.equal(roll?.display_value, "Outside Right");
    assert.equal(roll?.overridden, true);
    const lam = specs.find((s) => s.key === "LAMINATION");
    assert.equal(lam?.overridden, false);
    assert.equal(lam?.display_value, "Matte");
  });

  it("skips empty display_value", () => {
    const specs = getDisplaySpecs({ crm_snapshot: snapshot });
    assert.equal(specs.some((s) => s.key === "NOTES"), false);
  });

  it("returns [] when snapshot has no line items", () => {
    assert.deepEqual(getDisplaySpecs({ crm_snapshot: { line_items: [] } }), []);
    assert.deepEqual(getDisplaySpecs({}), []);
  });
});

describe("specLabelFromSnapshot", () => {
  it("uses the snapshot label", () => {
    assert.equal(
      specLabelFromSnapshot(snapshot, "ROLL_DIRECTION"),
      "Roll direction"
    );
  });
});

describe("format helpers", () => {
  it("formats dimensions", () => {
    assert.equal(formatDimensionsDisplay(4, 3, "in"), "4 × 3 in");
    assert.equal(formatDimensionsDisplay("", "", "in"), "");
  });

  it("formats booleans", () => {
    assert.equal(formatBooleanDisplay(true), "Yes");
    assert.equal(formatBooleanDisplay(false), "No");
  });
});

describe("parseCatalogV2", () => {
  it("rejects version 1 catalogs", () => {
    assert.equal(hasCatalogV2Schema({ version: 1, products: [] }), false);
    assert.throws(
      () => parseCatalogV2({ version: 1, products: [{ name: "x" }] }),
      (err: unknown) =>
        err instanceof Error && err.message === CRM_V2_SCHEMA_ERROR
    );
  });

  it("normalizes products and specification objects", () => {
    const parsed = parseCatalogV2({
      schema_version: 2,
      products: [
        {
          id: "p1",
          name: "Roll Labels",
          specifications: [
            {
              key: "ROLL_DIRECTION",
              label: "Roll direction",
              type: "select",
              options: [{ option_id: "opt_a", label: "Inside Left" }],
            },
          ],
        },
      ],
    });
    assert.equal(parsed.schema_version, 2);
    assert.equal(parsed.products.length, 1);
    assert.equal(parsed.products[0].specifications[0].options?.[0].label, "Inside Left");
    assert.equal(catalogProductCount({ schema_version: 2, products: parsed.products }), 1);
    assert.equal(findCatalogProduct(parsed, "p1", null)?.name, "Roll Labels");
  });

  it("maps spec_fields when specifications is missing", () => {
    const parsed = parseCatalogV2({
      schema_version: 2,
      products: [
        {
          id: "p2",
          name: "Cards",
          spec_fields: [{ key: "SIDES", label: "Sides", type: "select" }],
        },
      ],
    });
    assert.equal(parsed.products[0].specifications[0].key, "SIDES");
  });
});
