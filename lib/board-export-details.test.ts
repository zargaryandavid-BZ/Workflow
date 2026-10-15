import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boardExportDetails } from "./board-export-details.ts";

const respond = (t: string) => `https://wf.example/respond/${t}`;

describe("board export per-card details", () => {
  it("maps line, folder, notes, approval and reorder fields", () => {
    const d = boardExportDetails(
      {
        webhook_item_index: 1,
        webhook_item_title: "Pouches",
        design_task: "https://drive.google.com/drive/folders/X",
        production_notes: "Matte",
        is_reorder: true,
        reorder_of: "ORD-2026-15108",
      },
      [{ token: "t1", status: "responded", customer_response: "approved", created_at: "2026-10-01T00:00:00Z" }],
      respond,
      Date.parse("2026-10-14T00:00:00Z")
    );
    assert.deepEqual(d, {
      item_index: 1,
      item_title: "Pouches",
      design_folder_url: "https://drive.google.com/drive/folders/X",
      production_notes: "Matte",
      approval_url: "https://wf.example/respond/t1",
      approval_status: "approved",
      is_reorder: true,
      reorder_of: "ORD-2026-15108",
    });
  });
  it("is all-null for a bare card (export stays backwards compatible)", () => {
    assert.deepEqual(boardExportDetails(null, [], respond), {
      item_index: null,
      item_title: null,
      design_folder_url: null,
      production_notes: null,
      approval_url: null,
      approval_status: null,
      is_reorder: false,
      reorder_of: null,
    });
  });
});
