import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveWebhookLineFolderUrl } from "./webhook-line-folder.ts";
import {
  crmCustomerFacingNote,
  crmDesignerNote,
  crmLineProductionNote,
  crmOrderIdFromPayload,
  crmOrderProductionNote,
  crmTicketStaffNote,
  parseCrmLabeledNotes,
  webhookPrintQty,
  withOrderQtyDetails,
} from "./webhook-crm-parse.ts";

const FRONT = {
  title: "Front label",
  quantity: 1000,
  order_qty: 1000,
  sku_qty: 1,
  files_url: "https://drive.google.com/drive/folders/ITEM_FOLDER_ID_1",
  item_folder_url: "https://drive.google.com/drive/folders/ITEM_FOLDER_ID_1",
  design_task: "",
  description: "",
  notes: "",
  line_item_comment: "Optional notes for this SKU",
  order_qty_details: "S 200 / M 300 / L 500",
  skus: [{ sku_name: "Front label", quantity: 1000, comment: "" }],
};

const BACK = {
  title: "Back label",
  quantity: 1500,
  order_qty: 1500,
  sku_qty: 2,
  files_url: "https://drive.google.com/drive/folders/ITEM_FOLDER_ID_2",
  item_folder_url: "https://drive.google.com/drive/folders/ITEM_FOLDER_ID_2",
  description: "",
  notes: "",
  line_item_comment: "",
  order_qty_details: "",
  skus: [
    { sku_name: "Cherry", quantity: 750, comment: "" },
    { sku_name: "Grape", quantity: 750, comment: "" },
  ],
};

describe("CRM order webhook payload", () => {
  it("does not treat sku_qty as print quantity", () => {
    assert.equal(webhookPrintQty(FRONT, [{ qty: 1000 }]), 1000);
    assert.equal(FRONT.sku_qty, 1);
    assert.equal(
      webhookPrintQty(BACK, [{ qty: 750 }, { qty: 750 }]),
      1500
    );
    assert.equal(BACK.sku_qty, 2);
  });

  it("keeps explicit print qty when SKU row qtys would sum higher", () => {
    assert.equal(
      webhookPrintQty({ order_qty: 20000, quantity: 20000, sku_qty: 2 }, [
        { qty: 20000 },
        { qty: 20000 },
      ]),
      20000
    );
  });

  it("never uses sku_qty as a fallback print qty", () => {
    assert.equal(webhookPrintQty({ sku_qty: 2 }, []), null);
  });

  it("prefers files_url for the line Drive folder; ignores empty design_task", () => {
    assert.equal(
      resolveWebhookLineFolderUrl(FRONT, { design_task: "" }),
      "https://drive.google.com/drive/folders/ITEM_FOLDER_ID_1"
    );
  });

  it("maps line_item_comment to production notes, not empty item notes", () => {
    assert.equal(
      crmLineProductionNote(FRONT),
      "Optional notes for this SKU"
    );
    assert.equal(crmLineProductionNote(BACK), null);
  });

  it("puts order_qty_details on production notes", () => {
    const notes = withOrderQtyDetails(
      crmLineProductionNote(FRONT),
      FRONT.order_qty_details
    );
    assert.ok(notes?.includes("Optional notes for this SKU"));
    assert.ok(notes?.includes("S 200 / M 300 / L 500"));
  });

  it("maps ticket staff notes from top-level notes", () => {
    assert.equal(
      crmTicketStaffNote({
        notes: "Staff Attention / Internal Notes from the ticket.",
        internal_note: "",
      }),
      "Staff Attention / Internal Notes from the ticket."
    );
  });

  it("maps CRM For Customer / For Designer / For Prod note fields", () => {
    const order = {
      description: "For the customer",
      notes_for_designer: "For the designer",
      notes_for_production: "For production",
      notes: "",
      crm_order_id: "crm-ord-1",
    };
    const item = {
      description: "",
      notes_for_designer: "",
      notes_for_production: "",
    };
    assert.equal(crmCustomerFacingNote(order, item), "For the customer");
    assert.equal(crmDesignerNote(order), "For the designer");
    assert.equal(
      crmLineProductionNote({
        ...item,
        notes_for_production: order.notes_for_production,
      }),
      "For production"
    );
    assert.equal(crmOrderIdFromPayload(order), "crm-ord-1");
  });

  it("splits a mashed For Prod notes blob onto production, not internal", () => {
    const blob = "For Prod:\nPICK PREVIOUS JOB TO MAKE 1LB BAGS";
    const labeled = parseCrmLabeledNotes(blob);
    assert.equal(labeled.production, "PICK PREVIOUS JOB TO MAKE 1LB BAGS");
    assert.equal(labeled.designer, null);
    assert.equal(labeled.remainder, null);
    assert.equal(crmTicketStaffNote({ notes: blob }), null);
    assert.equal(
      crmOrderProductionNote({ notes: blob }),
      "PICK PREVIOUS JOB TO MAKE 1LB BAGS"
    );
  });

  it("splits For Designer out of a combined notes blob", () => {
    const blob =
      "For Designer:\nMatch prior batch\n\nFor Prod:\nRewind 1-Top";
    assert.equal(
      crmDesignerNote({ notes: blob }),
      "Match prior batch"
    );
    assert.equal(
      crmOrderProductionNote({ notes: blob }),
      "Rewind 1-Top"
    );
    assert.equal(crmTicketStaffNote({ notes: blob }), null);
  });

  it("does not treat empty CRM notes as a value", () => {
    assert.equal(crmCustomerFacingNote({ description: "" }), null);
    assert.equal(crmDesignerNote({ notes_for_designer: "   " }), null);
    assert.equal(crmLineProductionNote({ notes_for_production: "" }), null);
    assert.equal(crmTicketStaffNote({ notes: "" }), null);
  });
});
