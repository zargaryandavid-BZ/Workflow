import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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

  it("appends a new distinct note", () => {
    const first = mergeWebhookDesignerNotes(null, "Use matte foil");
    const second = mergeWebhookDesignerNotes(first, "Keep die as-is");
    const texts = parseNoteHistory(second).map((e) => e.text);
    assert.deepEqual(texts, ["Use matte foil", "Keep die as-is"]);
  });
});
