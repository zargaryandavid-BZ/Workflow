import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendedNoteEntries,
  mergeWebhookDesignerNotes,
  parseNoteHistory,
} from "./note-history.ts";

describe("mergeWebhookDesignerNotes", () => {
  it("stores incoming CRM notes as history", () => {
    const raw = mergeWebhookDesignerNotes(null, "Use matte foil");
    const entries = parseNoteHistory(raw);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.author, "CRM");
    assert.equal(entries[0]?.text, "Use matte foil");
  });

  it("does not duplicate the same note on re-fire", () => {
    const first = mergeWebhookDesignerNotes(null, "Use matte foil");
    const second = mergeWebhookDesignerNotes(first, "Use matte foil");
    assert.equal(parseNoteHistory(second).length, 1);
  });

  it("replaces the CRM seed when the text changes", () => {
    const first = mergeWebhookDesignerNotes(null, "Use matte foil");
    const second = mergeWebhookDesignerNotes(first, "Keep die as-is");
    const entries = parseNoteHistory(second);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.author, "CRM");
    assert.equal(entries[0]?.text, "Keep die as-is");
  });

  it("does not overwrite staff-authored notes", () => {
    const staff = JSON.stringify([
      {
        author: "CRM",
        date: "2026-01-01T00:00:00.000Z",
        text: "From CRM",
      },
      {
        author: "Manny",
        date: "2026-01-02T00:00:00.000Z",
        text: "Staff follow-up",
      },
    ]);
    const next = mergeWebhookDesignerNotes(staff, "Updated from CRM");
    const entries = parseNoteHistory(next);
    assert.deepEqual(
      entries.map((e) => [e.author, e.text]),
      [
        ["CRM", "Updated from CRM"],
        ["Manny", "Staff follow-up"],
      ]
    );
  });

  it("empty incoming does not clear existing notes", () => {
    const first = mergeWebhookDesignerNotes(null, "Use matte foil");
    const second = mergeWebhookDesignerNotes(first, "");
    assert.equal(parseNoteHistory(second).length, 1);
    assert.equal(parseNoteHistory(second)[0]?.text, "Use matte foil");
  });
});

describe("appendedNoteEntries", () => {
  it("returns only newly appended notes", () => {
    const first = mergeWebhookDesignerNotes(null, "Use matte foil");
    const withStaff = JSON.stringify([
      ...parseNoteHistory(first),
      {
        author: "Manny",
        date: "2026-01-02T00:00:00.000Z",
        text: "Staff follow-up",
      },
    ]);
    const added = appendedNoteEntries(first, withStaff);
    assert.equal(added.length, 1);
    assert.equal(added[0]?.text, "Staff follow-up");
  });

  it("returns empty when history did not grow", () => {
    const first = mergeWebhookDesignerNotes(null, "Use matte foil");
    assert.deepEqual(appendedNoteEntries(first, first), []);
  });
});
