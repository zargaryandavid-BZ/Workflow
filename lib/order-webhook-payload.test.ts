import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFullOrderWebhookPayload,
  isPulseJobWebhookUrl,
  preserveRenderedCustomFields,
} from "./order-webhook-payload.ts";
import type { OrderExportData } from "./button-automation-order-data.ts";
import type { CustomField } from "./types.ts";

function field(id: string, name: string, position: number): CustomField {
  return {
    id,
    tenant_id: "tenant",
    name,
    field_type: "text",
    options: [],
    position,
    required: false,
  };
}

test("Pulse receives the complete card payload", () => {
  const customFields = [
    field("customer", "Customer Name", 1),
    field("product", "Product", 2),
    field("category", "Category", 3),
    field("materials", "Materials", 4),
    field("finishing", "Finishing", 5),
    field("sides", "Sides", 6),
    field("die", "Die", 7),
    field("width", "Width", 8),
    field("height", "Height", 9),
    field("color", "Color Mode", 10),
    field("artwork", "Artwork (GDrive link)", 11),
  ];
  const data = {
    order: {
      id: "order-uuid",
      title: "15483-1",
      due_date: "2026-10-28T12:00:00.000Z",
      priority: "rush",
      internal_note: null,
      specs: {
        production_notes: "Handle carefully",
        webhook_item_title: "Jar labels",
      },
    },
    columnName: "Prepress",
    fieldValues: {
      customer: "Opal & Oak",
      product: "Roll Labels",
      category: "Labels",
      materials: "White BOPP",
      finishing: "Matte Lamination",
      sides: "Single-sided",
      die: "Jar label",
      width: 4,
      height: 6,
      color: "CMYK",
      artwork: "https://drive.google.com/drive/folders/artwork",
    },
    customFields,
    skuRows: [
      {
        id: "sku-1",
        index: 0,
        name: "Standard label",
        qty: 600,
        imageLinks: ["https://example.com/sku-1.png"],
        imageFiles: [],
      },
      {
        id: "sku-2",
        index: 1,
        name: "Top label",
        qty: 400,
        imageLinks: ["https://example.com/sku-2.png"],
        imageFiles: [],
      },
    ],
    totalQty: 1000,
    customerName: "Opal & Oak",
    product: "Roll Labels",
    die: "Jar label",
    orderNumber: "15483-1",
    tenantName: "BazaarPrinting",
    ownerName: "Maria",
    designerName: "Marianna",
    designTask: "https://drive.google.com/drive/folders/design",
    artworkLink: "https://drive.google.com/drive/folders/artwork",
    priority: "rush",
  } as unknown as OrderExportData;

  const payload = buildFullOrderWebhookPayload(data);
  assert.equal(payload.customer, "Opal & Oak");
  assert.equal(payload.workflowOrderNumber, "15483-1");
  assert.equal(payload.product, "Roll Labels");
  assert.equal(payload.category, "Labels");
  assert.equal(payload.materials, "White BOPP");
  assert.equal(payload.finishing, "Matte Lamination");
  assert.equal(payload.sides, "Single-sided");
  assert.equal(payload.die, "Jar label");
  assert.equal(payload.sizeWidth, 4);
  assert.equal(payload.sizeHeight, 6);
  assert.equal(payload.color, "CMYK");
  assert.equal(payload.accountManager, "Maria");
  assert.equal(payload.designer, "Marianna");
  assert.equal(payload.priority, "Rush");
  assert.equal(payload.dueDate, "2026-10-28");
  assert.equal(payload.totalQuantity, 1000);
  assert.equal(payload.productionNotes, "Handle carefully");
  assert.equal(payload.facility, "16th-street");
  assert.deepEqual(
    (payload.skus as { name: string; quantity: number; artworkUrl: string }[]).map(
      ({ name, quantity, artworkUrl }) => ({ name, quantity, artworkUrl })
    ),
    [
      {
        name: "Standard label",
        quantity: 600,
        artworkUrl: "https://example.com/sku-1.png",
      },
      {
        name: "Top label",
        quantity: 400,
        artworkUrl: "https://example.com/sku-2.png",
      },
    ]
  );
});

test("Pulse URL always uses full payload while preserving legacy customFields", () => {
  assert.equal(
    isPulseJobWebhookUrl(
      "https://gkyupebgulpgwugsbvny.supabase.co/functions/v1/receive-job-webhook"
    ),
    true
  );
  assert.equal(
    isPulseJobWebhookUrl("https://example.com/functions/v1/receive-job-webhook"),
    false
  );

  const customFields = {
    "CRM Order #": "ORD-2026-15483",
    "Approval URL": "https://example.com/approval",
    "Approval Status": "approved",
    "Workflow Column": "Prepress",
    "Workflow Card Title": "15483-1",
  };
  const merged = preserveRenderedCustomFields(
    { customer: "Opal & Oak", customFields: { Other: "value" } },
    JSON.stringify({ customer: "wrong value", customFields })
  );
  assert.equal(merged.customer, "Opal & Oak");
  assert.deepEqual(merged.customFields, customFields);
});

test("Pulse production notes fall back to the card internal notes", () => {
  const payload = buildFullOrderWebhookPayload({
    order: {
      id: "order-uuid",
      title: "15479-1",
      priority: "normal",
      due_date: null,
      internal_note: "Need hanging hole.",
      specs: {},
    },
    columnName: "Prepress",
    fieldValues: {},
    customFields: [],
    skuRows: [],
    totalQty: 0,
    customerName: "Safe Care Packaging",
    product: "Lay Flat Pouches",
    die: "",
    orderNumber: "15479-1",
    tenantName: "BazaarPrinting",
    ownerName: "Maria",
    designerName: "Marianna",
    designTask: "",
    artworkLink: "",
    priority: "normal",
  } as unknown as OrderExportData);

  assert.equal(payload.productionNotes, "Need hanging hole.");
});

test("Pulse uses null for unknown sides, color, and SKU artwork", () => {
  const payload = buildFullOrderWebhookPayload({
    order: {
      id: "order-uuid",
      title: "15479-1",
      priority: "normal",
      due_date: null,
      internal_note: null,
      specs: {},
    },
    columnName: "Prepress",
    fieldValues: {},
    customFields: [],
    skuRows: [
      {
        id: "sku-1",
        index: 0,
        name: "Lay Flat Pouches",
        qty: 5000,
        imageLinks: [],
        imageFiles: [],
      },
    ],
    totalQty: 5000,
    customerName: "Safe Care Packaging",
    product: "Lay Flat Pouches",
    die: "",
    orderNumber: "15479-1",
    tenantName: "BazaarPrinting",
    ownerName: "",
    designerName: "",
    designTask: "",
    artworkLink: "",
    priority: "normal",
  } as unknown as OrderExportData);

  assert.equal(payload.sides, null);
  assert.equal(payload.color, null);
  assert.equal(
    (payload.skus as { artworkUrl: string | null }[])[0]?.artworkUrl,
    null
  );
});

test("Pulse keeps real artwork URLs and aligns stale SKU finishing to the card", () => {
  const finishingField = field("finishing", "Finishing", 1);
  const payload = buildFullOrderWebhookPayload({
    order: {
      id: "order-uuid",
      title: "15479-1",
      priority: "normal",
      due_date: null,
      internal_note: null,
      specs: {},
    },
    columnName: "Prepress",
    fieldValues: { finishing: "Matte Lamination" },
    customFields: [finishingField],
    skuRows: [
      {
        id: "sku-1",
        index: 0,
        name: "Lay Flat Pouches – MET PET – Gloss Lamination",
        qty: 5000,
        imageLinks: ["https://example.com/signed-final.pdf"],
        imageFiles: [],
      },
    ],
    totalQty: 5000,
    customerName: "Safe Care Packaging",
    product: "Lay Flat Pouches",
    die: "",
    orderNumber: "15479-1",
    tenantName: "BazaarPrinting",
    ownerName: "",
    designerName: "",
    designTask: "",
    artworkLink: "",
    priority: "normal",
  } as unknown as OrderExportData);

  assert.equal(payload.finishing, "Matte Lamination");
  assert.equal(
    (payload.skus as { name: string }[])[0]?.name,
    "Lay Flat Pouches – MET PET – Matte Lamination"
  );
  assert.equal(
    (payload.skus as { artworkUrl: string | null }[])[0]?.artworkUrl,
    "https://example.com/signed-final.pdf"
  );
});
