import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveNoteEntryId,
  guardNoteHistoryPatch,
  mergeWebhookDesignerNotes,
  noteEntriesWithIds,
  parseNoteHistory,
  parseNoteHistoryWithIds,
  serializeNoteHistory,
  upsertCrmSeedNote,
} from "./note-history.ts";
import {
  applyNoteFlagAction,
  hiddenNoteEntries,
  isProductionNotesColumn,
  isProductionNotesView,
  noteFlagKey,
  parseNoteFlags,
  showCustomerNoteFor,
  visibleNoteEntries,
  type NoteFlags,
} from "./note-visibility.ts";

const A = { author: "Anna", date: "2026-11-01T10:00:00.000Z", text: "Use gloss" };
const B = { author: "Hrach", date: "2026-11-02T10:00:00.000Z", text: "Die 12 ok" };
const C = { author: "CRM", date: "2026-11-03T10:00:00.000Z", text: "Rush" };

describe("note ids", () => {
  it("derives the same id for the same stored entry, every time", () => {
    const raw = JSON.stringify([A, B]);
    const one = parseNoteHistoryWithIds(raw).map((e) => e.id);
    const two = parseNoteHistoryWithIds(raw).map((e) => e.id);
    assert.deepEqual(one, two);
    assert.equal(one[0], deriveNoteEntryId(A));
    assert.notEqual(one[0], one[1]);
  });

  it("does not add ids to old notes when re-saved (format unchanged)", () => {
    const raw = JSON.stringify([A, B]);
    assert.equal(serializeNoteHistory(parseNoteHistory(raw)), raw);
  });

  it("keeps a stored id", () => {
    const raw = JSON.stringify([{ ...A, id: "fixed-1" }]);
    assert.equal(parseNoteHistoryWithIds(raw)[0]!.id, "fixed-1");
    assert.match(serializeNoteHistory(parseNoteHistory(raw))!, /fixed-1/);
  });

  it("gives exact duplicates distinct ids", () => {
    const ids = parseNoteHistoryWithIds(JSON.stringify([A, A])).map((e) => e.id);
    assert.equal(ids[1], `${ids[0]}~2`);
  });

  it("legacy plain text gets a stable id that survives a save", () => {
    const first = parseNoteHistoryWithIds("old plain note");
    const second = parseNoteHistoryWithIds("old plain note");
    assert.equal(first[0]!.id, second[0]!.id);
    const resaved = serializeNoteHistory(parseNoteHistory("old plain note"));
    assert.equal(parseNoteHistoryWithIds(resaved)[0]!.id, first[0]!.id);
  });

  it("entry with no date gets a stable id", () => {
    const raw = JSON.stringify([{ author: "X", text: "no date" }]);
    const id1 = parseNoteHistoryWithIds(raw)[0]!.id;
    const resaved = serializeNoteHistory(parseNoteHistory(raw));
    assert.equal(parseNoteHistoryWithIds(resaved)[0]!.id, id1);
  });
});

describe("CRM re-sync keeps hidden notes hidden", () => {
  it("keeps the CRM entry id when the CRM text changes", () => {
    const raw = JSON.stringify([C, A]);
    const crmId = parseNoteHistoryWithIds(raw)[0]!.id;
    const next = upsertCrmSeedNote(raw, "Rush — ship Friday");
    const entries = parseNoteHistoryWithIds(next);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.text, "Rush — ship Friday");
    assert.equal(entries[0]!.id, crmId);
    // staff entry id unchanged
    assert.equal(entries[1]!.id, deriveNoteEntryId(A));
  });

  it("does not duplicate a hidden note on re-fire with the same text", () => {
    const raw = JSON.stringify([C]);
    const flags: NoteFlags = {
      hidden: [noteFlagKey("production", parseNoteHistoryWithIds(raw)[0]!.id)],
      production: [],
    };
    const next = upsertCrmSeedNote(raw, "Rush");
    const entries = parseNoteHistoryWithIds(next);
    assert.equal(entries.length, 1);
    assert.equal(
      visibleNoteEntries(entries, "production", flags, { role: "admin", columnName: "Hold" }).length,
      0
    );
  });

  it("designer merge keeps id stable", () => {
    const first = mergeWebhookDesignerNotes(null, "Use matte foil");
    const id = parseNoteHistoryWithIds(first)[0]!.id;
    const second = mergeWebhookDesignerNotes(first, "Use soft-touch");
    assert.equal(parseNoteHistoryWithIds(second)[0]!.id, id);
  });
});

describe("PATCH notes guard", () => {
  const prev = JSON.stringify([A, B]);

  it("append passes through unchanged", () => {
    const next = JSON.stringify([A, B, C]);
    const out = guardNoteHistoryPatch(prev, next, { allowEdits: false });
    assert.equal(out.raw, next);
    assert.equal(out.merged, false);
  });

  it("non-admin removal is ignored; new entries still appended", () => {
    const next = JSON.stringify([B, C]);
    const out = guardNoteHistoryPatch(prev, next, { allowEdits: false });
    assert.equal(out.merged, true);
    assert.deepEqual(
      parseNoteHistory(out.raw).map((e) => e.text),
      ["Use gloss", "Die 12 ok", "Rush"]
    );
  });

  it("non-admin text edit keeps the original and appends the edited copy", () => {
    const next = JSON.stringify([{ ...A, text: "changed" }, B]);
    const out = guardNoteHistoryPatch(prev, next, { allowEdits: false });
    assert.deepEqual(
      parseNoteHistory(out.raw).map((e) => e.text),
      ["Use gloss", "Die 12 ok", "changed"]
    );
  });

  it("stale tab (missing a note added meanwhile) does not drop it", () => {
    const stale = JSON.stringify([A, C]);
    const out = guardNoteHistoryPatch(prev, stale, { allowEdits: false });
    assert.deepEqual(
      parseNoteHistory(out.raw).map((e) => e.text),
      ["Use gloss", "Die 12 ok", "Rush"]
    );
  });

  it("admin edit is accepted and the removed entry is reported", () => {
    const next = JSON.stringify([B]);
    const out = guardNoteHistoryPatch(prev, next, { allowEdits: true });
    assert.equal(out.raw, next);
    assert.deepEqual(out.removed.map((e) => e.text), ["Use gloss"]);
  });

  it("legacy plain text → JSON append is not a removal", () => {
    const client = serializeNoteHistory([
      ...parseNoteHistory("old plain"),
      { author: "Anna", date: "2026-11-05T00:00:00.000Z", text: "new" },
    ]);
    const out = guardNoteHistoryPatch("old plain", client, { allowEdits: false });
    assert.equal(out.merged, false);
    assert.equal(out.raw, client);
  });
});

describe("flags", () => {
  it("parses junk safely", () => {
    assert.deepEqual(parseNoteFlags(null), { hidden: [], production: [] });
    assert.deepEqual(parseNoteFlags({ hidden: ["a", 3, "a", " "] }), {
      hidden: ["a"],
      production: [],
    });
  });

  it("hide / unhide / mark round-trip", () => {
    let f: NoteFlags = { hidden: [], production: [] };
    f = applyNoteFlagAction(f, "internal:x", "hide");
    assert.deepEqual(f.hidden, ["internal:x"]);
    assert.equal(applyNoteFlagAction(f, "internal:x", "hide"), f);
    f = applyNoteFlagAction(f, "internal:x", "mark_production");
    assert.deepEqual(f.production, ["internal:x"]);
    f = applyNoteFlagAction(f, "internal:x", "unhide");
    f = applyNoteFlagAction(f, "internal:x", "unmark_production");
    assert.deepEqual(f, { hidden: [], production: [] });
  });
});

describe("visibility by role + column", () => {
  const entries = noteEntriesWithIds([A, B, C]);
  const [a, b, c] = entries;
  const flags: NoteFlags = {
    hidden: [noteFlagKey("internal", b!.id)],
    production: [noteFlagKey("internal", c!.id)],
  };

  it("production column list is defined by name, case/spacing tolerant", () => {
    assert.equal(isProductionNotesColumn("In Production"), true);
    assert.equal(isProductionNotesColumn("finishing / converting"), true);
    assert.equal(isProductionNotesColumn("Production Completed"), true);
    assert.equal(isProductionNotesColumn("Outsource"), true);
    assert.equal(isProductionNotesColumn("Prepress"), false);
    assert.equal(isProductionNotesColumn("Ready for Prod"), false);
    assert.equal(isProductionNotesColumn("Shipped Customer"), false);
    assert.equal(isProductionNotesColumn(null), false);
  });

  it("only prepress in a production column gets the trimmed view", () => {
    assert.equal(isProductionNotesView({ role: "prepress", columnName: "In Production" }), true);
    assert.equal(isProductionNotesView({ role: "prepress", columnName: "Prepress" }), false);
    assert.equal(isProductionNotesView({ role: "admin", columnName: "In Production" }), false);
    assert.equal(isProductionNotesView({ role: "account_manager", columnName: "In Production" }), false);
    assert.equal(isProductionNotesView({ role: "designer", columnName: "Outsource" }), false);
  });

  it("admin: everything except hidden", () => {
    const v = visibleNoteEntries(entries, "internal", flags, { role: "admin", columnName: "In Production" });
    assert.deepEqual(v.map((e) => e.id), [a!.id, c!.id]);
    assert.deepEqual(hiddenNoteEntries(entries, "internal", flags).map((e) => e.id), [b!.id]);
  });

  it("prepress before production: everything except hidden", () => {
    const v = visibleNoteEntries(entries, "internal", flags, { role: "prepress", columnName: "Prepress" });
    assert.deepEqual(v.map((e) => e.id), [a!.id, c!.id]);
    assert.equal(showCustomerNoteFor({ role: "prepress", columnName: "Prepress" }), true);
  });

  it("prepress in production: internal/designer only marked-for-production; production thread in full", () => {
    const viewer = { role: "prepress" as const, columnName: "Finishing / Converting" };
    assert.deepEqual(
      visibleNoteEntries(entries, "internal", flags, viewer).map((e) => e.id),
      [c!.id]
    );
    assert.deepEqual(visibleNoteEntries(entries, "designer", flags, viewer), []);
    assert.deepEqual(
      visibleNoteEntries(entries, "production", flags, viewer).map((e) => e.id),
      [a!.id, b!.id, c!.id]
    );
    assert.equal(showCustomerNoteFor(viewer), false);
  });

  it("hidden production note is hidden from prepress too", () => {
    const f: NoteFlags = { hidden: [noteFlagKey("production", a!.id)], production: [] };
    const v = visibleNoteEntries(entries, "production", f, { role: "prepress", columnName: "In Production" });
    assert.deepEqual(v.map((e) => e.id), [b!.id, c!.id]);
  });
});
