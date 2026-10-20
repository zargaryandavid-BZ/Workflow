import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ROLL_INBOUND_FINGERPRINT_KEY,
  ROLL_STAFF_EDITED_AT_KEY,
  ROLL_STAFF_EDITED_BY_KEY,
  applyStaffRollEdit,
  describeRollActivityChanges,
  isRollLabelCard,
  resolveInboundRollResync,
  rollFingerprint,
  rollValuesFromSpecs,
  rollValuesProblem,
  setRollSpecValue,
  withRollValues,
} from "./roll-options.ts";

const NOW = new Date("2026-10-20T12:00:00.000Z");
const portalSpecs = () => ({
  spec_selections: {
    bazaar_item_id: 12,
    QTY_PER_ROLL: "1000",
    QTY_PER_ROLL_MODE: "At least",
    MIN_LABELS_PER_ROLL: "250",
  },
  spec_display: [
    { key: "SIZE", label: "Size", value: "2x3" },
    { key: "QTY_PER_ROLL", label: "Qty Per Roll", value: "1000" },
    { key: "QTY_PER_ROLL_MODE", label: "Qty Per Roll Mode", value: "At least" },
    { key: "MIN_LABELS_PER_ROLL", label: "Min labels per roll", value: "250" },
  ],
});

describe("rollValuesFromSpecs", () => {
  it("reads the portal / CRM keys", () => {
    assert.deepEqual(rollValuesFromSpecs(portalSpecs()), {
      QTY_PER_ROLL: "1000",
      QTY_PER_ROLL_MODE: "At least",
      MIN_LABELS_PER_ROLL: "250",
      MAX_LABELS_PER_ROLL: "",
    });
  });
  it("falls back to spec_display rows by key or label", () => {
    const v = rollValuesFromSpecs({
      spec_display: [
        { label: "Max labels per roll", value: "600" },
        { key: "qty_per_roll", label: "x", value: "500" },
      ],
    });
    assert.equal(v.MAX_LABELS_PER_ROLL, "600");
    assert.equal(v.QTY_PER_ROLL, "500");
  });
});

describe("setRollSpecValue / withRollValues", () => {
  it("updates selections and the display row in place; other rows untouched", () => {
    const out = setRollSpecValue(portalSpecs(), "QTY_PER_ROLL", "1,500");
    const sel = out.spec_selections as Record<string, unknown>;
    assert.equal(sel.QTY_PER_ROLL, "1500");
    assert.equal(sel.bazaar_item_id, 12);
    const disp = out.spec_display as { key: string; value: string }[];
    assert.equal(disp.length, 4);
    assert.deepEqual(disp[0], { key: "SIZE", label: "Size", value: "2x3" });
    assert.equal(disp.find((r) => r.key === "QTY_PER_ROLL")?.value, "1500");
  });
  it("adds Max (selection + display row) and clearing Min drops both", () => {
    let out = setRollSpecValue(portalSpecs(), "MAX_LABELS_PER_ROLL", "500");
    out = setRollSpecValue(out, "MIN_LABELS_PER_ROLL", "");
    const sel = out.spec_selections as Record<string, unknown>;
    assert.equal(sel.MAX_LABELS_PER_ROLL, "500");
    assert.equal("MIN_LABELS_PER_ROLL" in sel, false);
    const disp = out.spec_display as { key: string; label: string }[];
    assert.ok(disp.some((r) => r.key === "MAX_LABELS_PER_ROLL" && r.label === "Max labels per roll"));
    assert.ok(!disp.some((r) => r.key === "MIN_LABELS_PER_ROLL"));
  });
  it("entering Qty per roll on a card without a mode sets 'At least'", () => {
    const out = setRollSpecValue({}, "QTY_PER_ROLL", "800");
    assert.deepEqual(out.spec_selections, { QTY_PER_ROLL: "800", QTY_PER_ROLL_MODE: "At least" });
    assert.equal((out.spec_display as unknown[]).length, 2);
  });
  it("mode keeps the stored production text", () => {
    const out = setRollSpecValue(portalSpecs(), "QTY_PER_ROLL_MODE", "Up to (max)");
    assert.equal((out.spec_selections as Record<string, unknown>).QTY_PER_ROLL_MODE, "Up to (max)");
  });
  it("does not create spec_display when nothing to show", () => {
    const out = withRollValues({ spec_selections: {} }, { MIN_LABELS_PER_ROLL: "" });
    assert.equal("spec_display" in out, false);
  });
});

describe("rollValuesProblem", () => {
  const v = (q: string, mode = "At least", min = "", max = "") => ({
    QTY_PER_ROLL: q,
    QTY_PER_ROLL_MODE: mode,
    MIN_LABELS_PER_ROLL: min,
    MAX_LABELS_PER_ROLL: max,
  });
  it("flags per-roll above order qty (except Up to) and min > max", () => {
    assert.match(rollValuesProblem(v("5000"), 1000), /more than the order quantity/);
    assert.equal(rollValuesProblem(v("5000", "Up to (max)"), 1000), "");
    assert.match(rollValuesProblem(v("", "", "600", "500"), null), /Min labels per roll/);
    assert.equal(rollValuesProblem(v("500", "Exactly", "100", "500"), 1000), "");
  });
});

describe("isRollLabelCard", () => {
  it("true with roll values, roll direction, or a 'roll' product", () => {
    assert.equal(isRollLabelCard({ specs: portalSpecs() }), true);
    assert.equal(isRollLabelCard({ specs: { spec_selections: { ROLL_DIRECTION: "1" } } }), true);
    assert.equal(
      isRollLabelCard({ specs: { spec_display: [{ label: "Roll direction", value: "#3" }] } }),
      true
    );
    assert.equal(isRollLabelCard({ specs: {}, productName: "Roll Labels" }), true);
    assert.equal(isRollLabelCard({ specs: {}, rollDirectionValue: "Unwind 2" }), true);
  });
  it("false for sheets / boxes", () => {
    assert.equal(isRollLabelCard({ specs: {}, productName: "Sheet Stickers" }), false);
    assert.equal(isRollLabelCard({ specs: { spec_selections: { SIZE: "2x2" } }, productName: "Mailer Box" }), false);
  });
});

describe("applyStaffRollEdit", () => {
  it("stamps staff flag + records the pre-edit (source) fingerprint on first edit", () => {
    const existing = portalSpecs();
    const next = setRollSpecValue(existing, "QTY_PER_ROLL", "500");
    const out = applyStaffRollEdit(existing, next, { userId: "u1", now: NOW });
    assert.equal(out[ROLL_STAFF_EDITED_AT_KEY], NOW.toISOString());
    assert.equal(out[ROLL_STAFF_EDITED_BY_KEY], "u1");
    assert.equal(out[ROLL_INBOUND_FINGERPRINT_KEY], rollFingerprint(existing.spec_selections));
  });
  it("no roll change → no stamp; client-sent sync keys are ignored", () => {
    const existing = portalSpecs();
    const out = applyStaffRollEdit(
      existing,
      { ...existing, [ROLL_STAFF_EDITED_AT_KEY]: "forged", notes: "x" },
      { userId: "u1", now: NOW }
    );
    assert.equal(ROLL_STAFF_EDITED_AT_KEY in out, false);
    assert.equal(out.notes, "x");
  });
  it("keeps an existing inbound fingerprint", () => {
    const existing = { ...portalSpecs(), [ROLL_INBOUND_FINGERPRINT_KEY]: "FP" };
    const out = applyStaffRollEdit(existing, setRollSpecValue(existing, "QTY_PER_ROLL", "9"), { now: NOW });
    assert.equal(out[ROLL_INBOUND_FINGERPRINT_KEY], "FP");
    assert.equal(ROLL_STAFF_EDITED_BY_KEY in out, false);
  });
});

describe("resolveInboundRollResync", () => {
  const staffEdited = () => {
    const src = portalSpecs();
    return applyStaffRollEdit(src, setRollSpecValue(src, "QTY_PER_ROLL", "500"), {
      userId: "u1",
      now: NOW,
    });
  };

  it("source re-sends the same roll values → staff edit kept (selections + display)", () => {
    const existing = staffEdited();
    const inbound = portalSpecs();
    const nextSpecs = { ...existing, ...inbound };
    const r = resolveInboundRollResync({
      existingSpecs: existing,
      nextSpecs,
      inboundSelections: inbound.spec_selections,
    });
    assert.equal(r.keptStaffEdit, true);
    const sel = r.specs.spec_selections as Record<string, unknown>;
    assert.equal(sel.QTY_PER_ROLL, "500");
    assert.equal(sel.bazaar_item_id, 12);
    const disp = r.specs.spec_display as { key: string; value: string }[];
    assert.equal(disp.find((d) => d.key === "QTY_PER_ROLL")?.value, "500");
    assert.equal(r.specs[ROLL_STAFF_EDITED_AT_KEY], NOW.toISOString());
  });

  it("source sends different roll values → source wins, staff flag cleared", () => {
    const existing = staffEdited();
    const inbound = portalSpecs();
    inbound.spec_selections.QTY_PER_ROLL = "2000";
    const r = resolveInboundRollResync({
      existingSpecs: existing,
      nextSpecs: { ...existing, ...inbound },
      inboundSelections: inbound.spec_selections,
    });
    assert.equal(r.keptStaffEdit, false);
    assert.equal((r.specs.spec_selections as Record<string, unknown>).QTY_PER_ROLL, "2000");
    assert.equal(ROLL_STAFF_EDITED_AT_KEY in r.specs, false);
    assert.equal(ROLL_STAFF_EDITED_BY_KEY in r.specs, false);
    assert.equal(r.specs[ROLL_INBOUND_FINGERPRINT_KEY], rollFingerprint(inbound.spec_selections));
  });

  it("then a later identical re-fire keeps the source values (no staff flag)", () => {
    const inbound = portalSpecs();
    const existing = { ...inbound, [ROLL_INBOUND_FINGERPRINT_KEY]: rollFingerprint(inbound.spec_selections) };
    const r = resolveInboundRollResync({
      existingSpecs: existing,
      nextSpecs: { ...existing },
      inboundSelections: inbound.spec_selections,
    });
    assert.equal(r.keptStaffEdit, false);
    assert.equal((r.specs.spec_selections as Record<string, unknown>).QTY_PER_ROLL, "1000");
  });

  it("staff added roll values on a card the source never sent them for → kept", () => {
    const src = { spec_selections: { SIZE: "2x2" } };
    const existing = applyStaffRollEdit(src, setRollSpecValue(src, "QTY_PER_ROLL", "750"), { now: NOW });
    const r = resolveInboundRollResync({
      existingSpecs: existing,
      nextSpecs: { ...existing, spec_selections: { SIZE: "2x2" } },
      inboundSelections: { SIZE: "2x2" },
    });
    assert.equal(r.keptStaffEdit, true);
    assert.equal((r.specs.spec_selections as Record<string, unknown>).QTY_PER_ROLL, "750");
  });

  it("legacy staff edit without fingerprint → kept once, fingerprint recorded", () => {
    const existing = { ...portalSpecs(), [ROLL_STAFF_EDITED_AT_KEY]: "2026-10-01T00:00:00Z" };
    (existing.spec_selections as Record<string, unknown>).QTY_PER_ROLL = "300";
    const inbound = portalSpecs();
    const r = resolveInboundRollResync({
      existingSpecs: existing,
      nextSpecs: { ...existing, ...inbound },
      inboundSelections: inbound.spec_selections,
    });
    assert.equal(r.keptStaffEdit, true);
    assert.equal((r.specs.spec_selections as Record<string, unknown>).QTY_PER_ROLL, "300");
    assert.equal(r.specs[ROLL_INBOUND_FINGERPRINT_KEY], rollFingerprint(inbound.spec_selections));
  });

  it("no inbound spec_selections → specs unchanged", () => {
    const existing = staffEdited();
    const r = resolveInboundRollResync({ existingSpecs: existing, nextSpecs: existing, inboundSelections: null });
    assert.equal(r.specs, existing);
  });
});

describe("describeRollActivityChanges", () => {
  it("one line per changed roll field with card labels", () => {
    assert.deepEqual(
      describeRollActivityChanges(
        { QTY_PER_ROLL: "1000", QTY_PER_ROLL_MODE: "At least" },
        { QTY_PER_ROLL: "500", QTY_PER_ROLL_MODE: "At least", MAX_LABELS_PER_ROLL: "600" }
      ),
      [
        { field: "Qty Per Roll", from: "1000", to: "500" },
        { field: "Max labels per roll", from: "(empty)", to: "600" },
      ]
    );
    assert.deepEqual(describeRollActivityChanges({}, {}), []);
  });
});
