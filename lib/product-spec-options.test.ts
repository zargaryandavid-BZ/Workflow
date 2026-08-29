import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSetSizeValue,
  isSetSizeKey,
  nestedFieldOptions,
  normalizeSpecSelectOptions,
  parseSetSizeValue,
  productCatalogAliases,
  lookupCatalogMap,
  preferLinkedCatalogName,
  findMatchingSetSizeOption,
  specKeyCoveredByCustomFields,
  sentenceCaseSpecLabel,
  visibleCatalogToggles,
} from "./product-spec-options.ts";

describe("set size helpers", () => {
  it("recognizes SET_SIZE keys", () => {
    assert.equal(isSetSizeKey("SET_SIZE"), true);
    assert.equal(isSetSizeKey("SET_SIZE_3"), true);
    assert.equal(isSetSizeKey("SET SIZE"), true);
    assert.equal(isSetSizeKey("set-size"), true);
    assert.equal(isSetSizeKey("LABEL_SIZE"), true);
    assert.equal(isSetSizeKey("Label Size"), true);
    assert.equal(isSetSizeKey("ROLL_DIRECTION"), false);
    assert.equal(isSetSizeKey("FONT_SIZE"), false);
  });

  it("formats and parses WxH", () => {
    assert.equal(formatSetSizeValue("2", "4.5"), "2x4.5");
    assert.equal(formatSetSizeValue("5.375 in", "2.3 in"), "5.375x2.3");
    assert.deepEqual(parseSetSizeValue("2x4.5"), {
      width: "2",
      height: "4.5",
    });
    assert.deepEqual(parseSetSizeValue("2 × 4.5"), {
      width: "2",
      height: "4.5",
    });
    assert.deepEqual(parseSetSizeValue("4.75x4.75 in"), {
      width: "4.75",
      height: "4.75",
    });
    assert.deepEqual(parseSetSizeValue("4x6x2"), {
      width: "4",
      height: "6",
      depth: "2",
    });
    assert.equal(parseSetSizeValue(""), null);
  });

  it("normalizes CRM option shapes", () => {
    assert.deepEqual(
      normalizeSpecSelectOptions([
        { value: "2x3.65", label: "2x3.65" },
        "4x2.75",
        { name: "2.5x3.5" },
      ]),
      [
        { value: "2x3.65", label: "2x3.65" },
        { value: "4x2.75", label: "4x2.75" },
        { value: "2.5x3.5", label: "2.5x3.5" },
      ]
    );
    assert.deepEqual(normalizeSpecSelectOptions(null), []);
    assert.deepEqual(normalizeSpecSelectOptions({ value: "x" }), []);
  });

  it("reads field_options from v1 or nested v2 options", () => {
    assert.deepEqual(
      nestedFieldOptions({ field_options: { SET_SIZE: [1] } }),
      { SET_SIZE: [1] }
    );
    assert.deepEqual(
      nestedFieldOptions({
        options: { field_options: { SET_SIZE: [{ value: "2x3" }] } },
      }),
      { SET_SIZE: [{ value: "2x3" }] }
    );
    assert.equal(nestedFieldOptions({ name: "Roll Labels" }), null);
  });

  it("aliases Labels (Roll) to Roll Labels", () => {
    assert.deepEqual(productCatalogAliases("Labels (Roll)"), [
      "labels (roll)",
      "roll labels",
    ]);
    assert.deepEqual(productCatalogAliases("Roll Labels"), [
      "roll labels",
      "labels (roll)",
    ]);
    const map = { "Roll Labels": { SET_SIZE: [1] } };
    assert.deepEqual(lookupCatalogMap(map, "Labels (Roll)"), {
      SET_SIZE: [1],
    });
    assert.equal(lookupCatalogMap(map, "Vinyl Labels / 54'' Rolls"), null);
    assert.deepEqual(lookupCatalogMap(map, "🏷️ Roll Labels"), {
      SET_SIZE: [1],
    });
    assert.equal(
      preferLinkedCatalogName("Labels (Roll)", ["Roll Labels", "Labels (Sheet)"]),
      "Roll Labels"
    );
    assert.equal(
      preferLinkedCatalogName("Labels (Roll)", [
        "Labels (Roll)",
        "Roll Labels",
      ]),
      "Roll Labels"
    );
    assert.equal(
      preferLinkedCatalogName("Business Cards", ["Business Cards", "Roll Labels"]),
      "Business Cards"
    );
    assert.deepEqual(
      findMatchingSetSizeOption(
        [
          { value: "4.75x4.75 in", label: "4.75x4.75 in" },
          { value: "2x3.65", label: "2x3.65" },
        ],
        "4.75x4.75"
      )?.value,
      "4.75x4.75 in"
    );
    assert.equal(
      findMatchingSetSizeOption(
        [
          { value: "2x3.65", label: "2x3.65" },
          { value: "2.5x3.5", label: "2.5x3.5" },
        ],
        "2.50 x 3.50"
      )?.value,
      "2.5x3.5"
    );
  });
});

describe("spec key vs custom fields", () => {
  it("hides CRM spec keys already shown as custom fields", () => {
    const names = ["Color Mode", "Roll Direction", "Width", "Height"];
    assert.equal(specKeyCoveredByCustomFields("COLOR_MODE", names), true);
    assert.equal(specKeyCoveredByCustomFields("ROLL_DIRECTION", names), true);
    assert.equal(specKeyCoveredByCustomFields("SET_SIZE", names), true);
    assert.equal(specKeyCoveredByCustomFields("DIE_NAME", names), false);
    assert.equal(specKeyCoveredByCustomFields("DIE_METHOD", ["Die"]), true);
  });
});

describe("visibleCatalogToggles", () => {
  const toggles = [
    { key: "DOUBLE_SIDED", label: "Double-sided" },
    { key: "DESIGN_SERVICE", label: "Design service" },
    { key: "WINDOW", label: "Window" },
  ];

  it("shows every catalog toggle when hide-empty is off", () => {
    assert.deepEqual(
      visibleCatalogToggles(toggles, [], false).map((t) => t.label),
      ["Double-sided", "Window"]
    );
  });

  it("hides catalog toggles already shown as custom fields", () => {
    assert.deepEqual(
      visibleCatalogToggles(
        [{ key: "ROLL_DIRECTION", label: "Roll direction" }],
        ["Roll direction"],
        false,
        { customFieldNames: ["Roll Direction"], hideCovered: true }
      ),
      []
    );
  });

  it("hides unselected toggles when hide-empty is on", () => {
    assert.deepEqual(
      visibleCatalogToggles(toggles, [], true),
      []
    );
    assert.deepEqual(
      visibleCatalogToggles(toggles, ["Window"], true).map((t) => t.label),
      ["Window"]
    );
  });
});

describe("sentenceCaseSpecLabel", () => {
  it("uses Product-style sentence case, not ALL CAPS", () => {
    assert.equal(
      sentenceCaseSpecLabel("APPAREL_CLIENT_PROVIDED"),
      "Apparel client provided"
    );
    assert.equal(sentenceCaseSpecLabel("SET_SIZE_3"), "Set size 3");
  });
});
