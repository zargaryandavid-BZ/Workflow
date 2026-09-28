import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterButtonsForColumn,
  withPrintShippingSlipButtons,
} from "./print-shipping-slip-buttons.ts";
import type { ButtonAutomation } from "./types.ts";

function button(
  partial: Partial<ButtonAutomation> & Pick<ButtonAutomation, "id" | "action_type">
): ButtonAutomation {
  return {
    tenant_id: "t",
    name: partial.name ?? partial.action_type,
    icon: null,
    config: {},
    column_ids: [],
    enabled: true,
    position: 0,
    created_at: "2026-09-28T00:00:00.000Z",
    updated_at: "2026-09-28T00:00:00.000Z",
    ...partial,
  };
}

describe("withPrintShippingSlipButtons", () => {
  it("adds Print shipping slip after Generate Packing Slip", () => {
    const slip = button({
      id: "slip-1",
      action_type: "generate_packing_slip",
      name: "Shipping Slip",
    });
    const next = withPrintShippingSlipButtons([slip]);
    assert.equal(next.length, 2);
    assert.equal(next[1].action_type, "print_packing_slip");
    assert.equal(next[1].name, "Print shipping slip");
    assert.equal(next[1].id, "slip-1");
  });

  it("does not duplicate when a print button already exists", () => {
    const next = withPrintShippingSlipButtons([
      button({ id: "a", action_type: "generate_packing_slip" }),
      button({ id: "b", action_type: "print_packing_slip", name: "Print" }),
    ]);
    assert.equal(
      next.filter((b) => b.action_type === "print_packing_slip").length,
      1
    );
  });
});

describe("filterButtonsForColumn", () => {
  it("injects print next to packing slip in the column", () => {
    const filtered = filterButtonsForColumn(
      [
        button({
          id: "slip-1",
          action_type: "generate_packing_slip",
          name: "Shipping Slip",
          column_ids: ["col-a"],
        }),
      ],
      "col-a"
    );
    assert.deepEqual(
      filtered.map((b) => b.action_type),
      ["generate_packing_slip", "print_packing_slip"]
    );
  });
});
