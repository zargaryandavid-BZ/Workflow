import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReorderLinks,
  cleanReorderRef,
  filterOriginalCards,
  pickNewestLiveApprovalRound,
  pickReorderApprovalRound,
  pickReorderSourceCard,
  reorderCardTitleCandidates,
  reorderLinksFromSpecs,
  reorderOrderNumberVariants,
  reorderTargetItemIndex,
  senderReorderLinks,
  type ReorderSourceCard,
} from "./reorder-source.ts";

const card = (id: string, title: string, specs: Record<string, unknown>): ReorderSourceCard => ({
  id,
  title,
  specs,
});

describe("reorder → original order number spellings", () => {
  it("covers CRM, website and portal numbers", () => {
    assert.deepEqual(reorderOrderNumberVariants("ORD-2026-15108"), ["ORD-2026-15108", "15108"]);
    assert.deepEqual(reorderOrderNumberVariants("211"), ["211", "W211"]);
    assert.deepEqual(reorderOrderNumberVariants("W211"), ["W211", "211"]);
    assert.deepEqual(reorderOrderNumberVariants("BZ-323"), ["BZ-323"]);
    assert.deepEqual(reorderOrderNumberVariants(" #182 "), ["182", "W182"]);
    assert.deepEqual(reorderOrderNumberVariants(""), []);
    assert.equal(cleanReorderRef(null), "");
  });

  it("builds card title candidates with line suffixes", () => {
    const t = reorderCardTitleCandidates("211", 3);
    assert.ok(t.includes("W211"));
    assert.ok(t.includes("W211-1"));
    assert.ok(t.includes("211-3"));
    const c = reorderCardTitleCandidates("ORD-2026-15108", 2);
    assert.ok(c.includes("15108-2"));
  });
});

describe("filterOriginalCards", () => {
  it("keeps only the original order's cards, never the reorder's own", () => {
    const cards = [
      card("a", "W211-1", { webhook_order_number: "211" }),
      card("b", "W212-1", { webhook_order_number: "212", reorder_of: "211" }),
      card("c", "15108-2", { webhook_order_number: "ORD-2026-15108" }),
    ];
    assert.deepEqual(
      filterOriginalCards(cards, "211", "212").map((c) => c.id),
      ["a"]
    );
    assert.deepEqual(
      filterOriginalCards(cards, "ORD-2026-15108", "ORD-2026-15436").map((c) => c.id),
      ["c"]
    );
  });
});

describe("pickReorderSourceCard", () => {
  const multi = [
    card("l1", "15108-1", { webhook_item_index: 0, webhook_item_title: "Master box for pouches" }),
    card("l2", "15108-2", { webhook_item_index: 1, webhook_item_title: "Pouches" }),
    card("l3", "15108-3", { webhook_item_index: 2, webhook_item_title: "Design Correction 1" }),
  ];
  it("matches line i to original line i", () => {
    assert.equal(pickReorderSourceCard(multi, { itemIndex: 1 })?.id, "l2");
    assert.equal(pickReorderSourceCard(multi, { itemIndex: 0 })?.id, "l1");
  });
  it("uses the title-suffix line when the index spec is missing", () => {
    const portal = [card("p1", "BZ-323-1", {}), card("p2", "BZ-323-2", {})];
    assert.equal(pickReorderSourceCard(portal, { itemIndex: 1 })?.id, "p2");
  });
  it("single-card original → that card", () => {
    assert.equal(
      pickReorderSourceCard([card("w", "W211-1", {})], { itemIndex: 0 })?.id,
      "w"
    );
  });
  it("falls back to an exact line title, else refuses to guess", () => {
    assert.equal(
      pickReorderSourceCard(multi, { itemIndex: 9, itemTitle: "pouches" })?.id,
      "l2"
    );
    assert.equal(pickReorderSourceCard(multi, { itemIndex: 9, itemTitle: "Other" }), null);
    assert.equal(pickReorderSourceCard([], { itemIndex: 0 }), null);
  });
});

describe("approval round for a reorder", () => {
  const now = Date.parse("2026-10-14T00:00:00Z");
  it("prefers the newest APPROVED round even after its link date passed", () => {
    const r = pickReorderApprovalRound(
      [
        { token: "old", status: "responded", customer_response: "approved", created_at: "2026-09-05T00:00:00Z", token_expires_at: "2026-10-05T00:00:00Z" },
        { token: "new", status: "responded", customer_response: "approved", created_at: "2026-09-09T00:00:00Z", token_expires_at: "2026-10-09T00:00:00Z" },
        { token: "live", status: "sent", created_at: "2026-09-10T00:00:00Z", token_expires_at: "2026-11-11T00:00:00Z" },
        { token: "x", status: "expired", created_at: "2026-09-11T00:00:00Z" },
      ],
      now
    );
    assert.deepEqual(r, { token: "new", status: "approved" });
  });
  it("falls back to answered, then live; expired rounds never count", () => {
    assert.deepEqual(
      pickReorderApprovalRound(
        [{ token: "c", status: "responded", customer_response: "changes_requested", created_at: "2026-09-01T00:00:00Z" }],
        now
      ),
      { token: "c", status: "rejected" }
    );
    assert.deepEqual(
      pickReorderApprovalRound(
        [
          { token: "s", status: "sent", created_at: "2026-09-01T00:00:00Z", token_expires_at: "2026-11-01T00:00:00Z" },
          { token: "gone", status: "sent", created_at: "2026-09-02T00:00:00Z", token_expires_at: "2026-10-01T00:00:00Z" },
        ],
        now
      ),
      { token: "s", status: "pending" }
    );
    assert.equal(pickReorderApprovalRound([{ token: "e", status: "expired" }], now), null);
  });
  it("board export uses the newest non-expired round", () => {
    assert.deepEqual(
      pickNewestLiveApprovalRound(
        [
          { token: "a", status: "responded", customer_response: "approved", created_at: "2026-09-05T00:00:00Z" },
          { token: "b", status: "sent", created_at: "2026-09-09T00:00:00Z", token_expires_at: "2026-11-11T00:00:00Z" },
        ],
        now
      ),
      { token: "b", status: "pending" }
    );
  });
});

describe("reorder links", () => {
  it("labels the original approval with the original order number", () => {
    const links = buildReorderLinks({
      order_ref: "211",
      order_id: "a",
      title: "W211-1",
      item_index: 0,
      design_folder_url: "https://drive.google.com/drive/folders/D",
      final_folder_url: "https://drive.google.com/drive/folders/F",
      approval_url: "https://wf.example/respond/t",
      approval_status: "approved",
    });
    assert.deepEqual(links.map((l) => l.label), [
      "Original approval (order #211)",
      "Original final production files (order #211)",
      "Original designer folder (order #211)",
    ]);
    assert.deepEqual(reorderLinksFromSpecs({ reorder_links: links }), links);
    assert.deepEqual(reorderLinksFromSpecs({ reorder_links: [{ kind: "x", label: "y", url: "javascript:1" }] }), []);
  });
  it("reads sender links and the target original line", () => {
    assert.deepEqual(
      senderReorderLinks(
        { reorder_source_final_folder_url: "https://d/F" },
        { reorder_source_approval_url: "https://a/x", reorder_source_design_folder_url: "nope" }
      ),
      { design: null, final: "https://d/F", approval: "https://a/x" }
    );
    assert.equal(reorderTargetItemIndex({ reorder_of_item_index: 2 }, 0), 2);
    assert.equal(reorderTargetItemIndex({ reorder_of_item_index: "1" }, 0), 1);
    assert.equal(reorderTargetItemIndex({}, 3), 3);
  });
});
