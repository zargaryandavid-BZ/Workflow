import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dieOrderAutofill } from "./die-order-autofill.ts";
import { formatDieSize } from "./die-request.ts";

const fields = [
  { id: "p", name: "Product", field_type: "select" as const },
  { id: "w", name: "Width", field_type: "text" as const },
  { id: "h", name: "Height", field_type: "text" as const },
  { id: "d", name: "Depth", field_type: "text" as const },
  { id: "fs", name: "Finished Size", field_type: "text" as const },
];

describe("dieOrderAutofill", () => {
  it("reads product name and three dimension fields", () => {
    assert.deepEqual(
      dieOrderAutofill({
        customFields: fields,
        fieldValues: {
          p: "Folding carton",
          w: "4 in",
          h: "6",
          d: "2.5",
        },
      }),
      {
        productName: "Folding carton",
        width: "4",
        height: "6",
        depth: "2.5",
      }
    );
  });

  it("parses 3D finished size when width/height/depth are empty", () => {
    assert.deepEqual(
      dieOrderAutofill({
        customFields: fields,
        fieldValues: { p: "Box", fs: "4 x 6 x 2 in" },
      }),
      {
        productName: "Box",
        width: "4",
        height: "6",
        depth: "2",
      }
    );
  });

  it("uses connected SET_SIZE_3 and snapshot product name", () => {
    assert.deepEqual(
      dieOrderAutofill({
        customFields: fields,
        fieldValues: {},
        crmSnapshot: {
          line_items: [
            {
              product_name: "Rigid box",
              specifications: [
                {
                  key: "SET_SIZE_3",
                  label: "Size",
                  type: "select",
                  display_value: "5x7x3",
                  value: "5x7x3",
                },
              ],
            },
          ],
        },
      }),
      {
        productName: "Rigid box",
        width: "5",
        height: "7",
        depth: "3",
      }
    );
  });
});

describe("formatDieSize", () => {
  it("joins present dimensions", () => {
    assert.equal(formatDieSize(4, 6, 2), "4 × 6 × 2");
    assert.equal(formatDieSize(4, 6, null), "4 × 6");
    assert.equal(formatDieSize(null, null, null), "—");
  });
});
