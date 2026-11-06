import assert from "node:assert/strict";
import test from "node:test";
import {
  diePdfError,
  formatDieCode,
  dieShowsInLibrary,
  formatDieLwh,
  isMissingDiesTable,
  parseDieShopPatch,
  parseDieShopStatus,
  reorderOrderedAt,
  nextDieCode,
  normalizeDieLink,
  parseDieInput,
  dieUsageLevel,
  dieUseBlocker,
  formatDieUses,
  parseDieCodeInput,
  dieQrPath,
  dieEventLabel,
} from "./dies.ts";

test("an ordered die stays off the Dies tab until it is received", () => {
  assert.equal(dieShowsInLibrary({ on_order: false }), true);
  assert.equal(dieShowsInLibrary({ on_order: true }), false);
});

test("usage: near at 90%, over at the max, Use blocked when out of order or taken", () => {
  assert.equal(dieUsageLevel({ use_count: 5, max_uses: null }), "none");
  assert.equal(dieUsageLevel({ use_count: 89, max_uses: 100 }), "ok");
  assert.equal(dieUsageLevel({ use_count: 90, max_uses: 100 }), "near");
  assert.equal(dieUsageLevel({ use_count: 100, max_uses: 100 }), "over");
  assert.equal(formatDieUses({ use_count: 1200, max_uses: 5000 }), "1,200 / 5,000");
  const free = {
    shop_status: "working" as const,
    checked_out_at: null,
    checked_out_by_name: null,
    on_order: false,
  };
  assert.equal(dieUseBlocker(free), null);
  assert.match(dieUseBlocker({ ...free, shop_status: "out_of_order" }) ?? "", /out of order/);
  assert.match(
    dieUseBlocker({ ...free, checked_out_at: "2026-11-05T20:00:00Z", checked_out_by_name: "Ani" }) ?? "",
    /Ani already has this die/
  );
  assert.match(dieUseBlocker({ ...free, on_order: true }) ?? "", /received/);
});

test("old Problem status reads as Out of order; QR text finds the die", () => {
  assert.equal(parseDieShopStatus("problem"), "out_of_order");
  assert.equal(parseDieShopStatus("out_of_order"), "out_of_order");
  assert.equal(parseDieCodeInput("die-00042"), "DIE-00042");
  assert.equal(
    parseDieCodeInput("https://workflow-rho-one.vercel.app/dies/DIE-00007"),
    "DIE-00007"
  );
  assert.equal(parseDieCodeInput("mailer box"), null);
  assert.equal(dieQrPath("DIE-00007"), "/dies/DIE-00007");
  const parsed = parseDieInput({ name: "x", die_type: "box", shape: "square", max_uses: "500" });
  assert.ok(parsed.ok && parsed.value.max_uses === 500);
  assert.equal(
    parseDieInput({ name: "x", die_type: "box", shape: "square", max_uses: "2.5" }).ok,
    false
  );
});

test("Template IDs count up and never reuse", () => {
  assert.equal(formatDieCode(1), "DIE-00001");
  assert.equal(nextDieCode([]), "DIE-00001");
  assert.equal(nextDieCode(["DIE-00001", "DIE-00007", "junk"]), "DIE-00008");
  assert.equal(nextDieCode(["DIE-99999"]), "DIE-100000");
});

test("parseDieInput validates the popup", () => {
  const ok = parseDieInput({
    name: " Mailer box ",
    die_type: "box",
    shape: "round",
    length: "9",
    width: "",
    height: 2,
    rounded_corner: true,
    perforation: "false",
    pacdora_link: "pacdora.com/models/123",
    order_id: "",
  });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.name, "Mailer box");
    assert.equal(ok.value.length, 9);
    assert.equal(ok.value.width, null);
    assert.equal(ok.value.height, 2);
    assert.equal(ok.value.rounded_corner, true);
    assert.equal(ok.value.perforation, false);
    assert.equal(ok.value.pacdora_link, "https://pacdora.com/models/123");
    assert.equal(ok.value.order_id, null);
  }
  assert.deepEqual(parseDieInput({ name: "", die_type: "box", shape: "square" }), {
    ok: false,
    error: "Die name is required.",
  });
  assert.equal(parseDieInput({ name: "x", die_type: "sticker", shape: "square" }).ok, false);
  assert.equal(parseDieInput({ name: "x", die_type: "box", shape: "oval" }).ok, false);
  assert.equal(
    parseDieInput({ name: "x", die_type: "box", shape: "square", length: "-1" }).ok,
    false
  );
});

test("links must be web addresses", () => {
  assert.equal(normalizeDieLink(""), null);
  assert.equal(normalizeDieLink("javascript:alert(1)"), "invalid");
  assert.equal(normalizeDieLink("https://www.pacdora.com/x"), "https://www.pacdora.com/x");
});

test("shop status is Working or Out of order, and reorder is its own save", () => {
  assert.equal(parseDieShopStatus("working"), "working");
  assert.equal(parseDieShopStatus("problem"), "out_of_order");
  assert.equal(parseDieShopStatus("ordered"), null);
  assert.deepEqual(parseDieShopPatch({ shop_status: "out_of_order" }), {
    kind: "shop",
    shopStatus: "out_of_order",
    reorder: false,
  });
  assert.deepEqual(parseDieShopPatch({ reorder: true }), {
    kind: "shop",
    shopStatus: null,
    reorder: true,
  });
  assert.equal(parseDieShopPatch({ shop_status: "quoted" }).kind, "error");
  assert.equal(parseDieShopPatch({ name: "Mailer", shop_status: "working" }).kind, "form");
  assert.equal(
    reorderOrderedAt(new Date("2026-11-05T18:04:00.000Z")),
    "2026-11-05T18:04:00.000Z"
  );
});

test("helpers", () => {
  assert.equal(formatDieLwh({ length: 9, width: 6, height: null }), "9 × 6 × —");
  assert.equal(formatDieLwh({ length: null, width: null, height: null }), "—");
  assert.ok(isMissingDiesTable("Could not find the table 'public.dies' in the schema cache"));
  assert.ok(!isMissingDiesTable("permission denied for table orders"));
});

test("die PDF must be a PDF under 50 MB", () => {
  assert.equal(diePdfError({ name: "a.pdf", type: "application/pdf", size: 10 }), null);
  assert.equal(diePdfError({ name: "a.PDF", type: "", size: 10 }), null);
  assert.match(diePdfError({ name: "a.png", type: "image/png", size: 10 }) ?? "", /PDF/);
  assert.match(diePdfError({ name: "a.pdf", type: "application/pdf", size: 0 }) ?? "", /empty/);
  assert.match(
    diePdfError({ name: "a.pdf", type: "application/pdf", size: 51 * 1024 * 1024 }) ?? "",
    /50 MB/
  );
});

test("use history line names the order and the uses added", () => {
  assert.equal(
    dieEventLabel({ kind: "used", meta: { order_number: "15433-3", uses_added: 3, use_number: 12 } }),
    "Used for order 15433-3 · +3 uses · total 12"
  );
  assert.equal(
    dieEventLabel({ kind: "used", meta: { uses_added: 1, use_number: 1 } }),
    "Taken for use · total 1"
  );
});

test("location is optional text", () => {
  const parsed = parseDieInput({ name: "x", die_type: "box", shape: "square", location: "  Shelf B · Bin 4 " });
  assert.ok(parsed.ok && parsed.value.location === "Shelf B · Bin 4");
  const none = parseDieInput({ name: "x", die_type: "box", shape: "square", location: "" });
  assert.ok(none.ok && none.value.location === null);
});
