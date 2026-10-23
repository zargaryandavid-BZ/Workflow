import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBazaarPortalStatusPayload,
  pickActiveApprovalToken,
  sanitizeApprovalStatus,
  sanitizeApprovalUrl,
} from "./bazaar-portal-status-payload.ts";

describe("buildBazaarPortalStatusPayload", () => {
  it("includes order_number, column_name and the given moved_at", () => {
    const payload = buildBazaarPortalStatusPayload({
      orderNumber: "BZ-123",
      columnName: "Printing",
      movedAt: "2026-10-08T12:00:00.000Z",
    });
    assert.equal(payload.order_number, "BZ-123");
    assert.equal(payload.column_name, "Printing");
    assert.equal(payload.moved_at, "2026-10-08T12:00:00.000Z");
    assert.equal(payload.event, "job_status_update");
  });

  it("carries the line-suffixed order number through unchanged", () => {
    const payload = buildBazaarPortalStatusPayload({
      orderNumber: "BZ-acme-2",
      columnName: "Shipping",
      movedAt: "2026-10-08T12:00:00.000Z",
    });
    assert.equal(payload.order_number, "BZ-acme-2");
    assert.equal(payload.column_name, "Shipping");
  });

  it("defaults moved_at to a valid ISO timestamp when omitted", () => {
    const before = Date.now();
    const payload = buildBazaarPortalStatusPayload({
      orderNumber: "BZ-1",
      columnName: "Start",
    });
    const after = Date.now();
    const ms = Date.parse(payload.moved_at);
    assert.ok(!Number.isNaN(ms), "moved_at should parse as a date");
    assert.equal(payload.moved_at, new Date(ms).toISOString());
    assert.ok(ms >= before && ms <= after, "moved_at should be ~now");
  });

  it("only ever emits the four contract fields", () => {
    const payload = buildBazaarPortalStatusPayload({
      orderNumber: "BZ-9",
      columnName: "QC",
      movedAt: "2026-10-08T00:00:00.000Z",
    });
    assert.deepEqual(Object.keys(payload).sort(), [
      "column_name",
      "event",
      "moved_at",
      "order_number",
    ]);
  });
});

describe("buildBazaarPortalStatusPayload approval_url (additive)", () => {
  it("includes approval_url only when a valid http(s) link is given", () => {
    const payload = buildBazaarPortalStatusPayload({
      orderNumber: "BZ-123",
      columnName: "Waiting Approval",
      movedAt: "2026-10-08T12:00:00.000Z",
      approvalUrl: "https://workflow-rho-one.vercel.app/l/AbC2345",
    });
    assert.equal(
      payload.approval_url,
      "https://workflow-rho-one.vercel.app/l/AbC2345"
    );
    assert.deepEqual(Object.keys(payload).sort(), [
      "approval_url",
      "column_name",
      "event",
      "moved_at",
      "order_number",
    ]);
  });

  it("omits the approval_url key for null / empty / unsafe values", () => {
    for (const approvalUrl of [
      null,
      undefined,
      "",
      "   ",
      "javascript:alert(1)",
      "data:text/html,hi",
      "/respond/abc",
      "not a url",
    ]) {
      const payload = buildBazaarPortalStatusPayload({
        orderNumber: "BZ-1",
        columnName: "Start",
        movedAt: "2026-10-08T00:00:00.000Z",
        approvalUrl,
      });
      assert.ok(!("approval_url" in payload), `should omit for ${approvalUrl}`);
    }
  });
});

describe("sanitizeApprovalUrl", () => {
  it("accepts and trims absolute http(s) URLs", () => {
    assert.equal(
      sanitizeApprovalUrl("  http://example.com/respond/g/abc?item=1  "),
      "http://example.com/respond/g/abc?item=1"
    );
    assert.equal(sanitizeApprovalUrl(42), null);
  });
});

describe("pickActiveApprovalToken", () => {
  const now = Date.parse("2026-10-08T12:00:00.000Z");
  const future = "2026-11-01T00:00:00.000Z";
  const past = "2026-10-01T00:00:00.000Z";

  it("returns the newest live round (sent beats older sent)", () => {
    const token = pickActiveApprovalToken(
      [
        {
          token: "old",
          status: "sent",
          channel: "email",
          token_expires_at: future,
          created_at: "2026-10-07T00:00:00.000Z",
        },
        {
          token: "new",
          status: "sent",
          channel: "sms",
          token_expires_at: future,
          created_at: "2026-10-08T00:00:00.000Z",
        },
      ],
      now
    );
    assert.equal(token, "new");
  });

  it("treats pending+manual as live (staff hands the link over)", () => {
    const token = pickActiveApprovalToken(
      [
        {
          token: "manual",
          status: "pending",
          channel: "manual",
          token_expires_at: future,
          created_at: "2026-10-08T00:00:00.000Z",
        },
      ],
      now
    );
    assert.equal(token, "manual");
  });

  it("ignores queued/failed sends, skipped sends, expired and responded rounds", () => {
    const token = pickActiveApprovalToken(
      [
        {
          token: "queued",
          status: "pending",
          channel: "email",
          token_expires_at: future,
          created_at: "2026-10-08T01:00:00.000Z",
        },
        {
          token: "skipped",
          status: "pending",
          channel: "none",
          token_expires_at: future,
          created_at: "2026-10-08T02:00:00.000Z",
        },
        {
          token: "expired-sent",
          status: "sent",
          channel: "email",
          token_expires_at: past,
          created_at: "2026-10-08T03:00:00.000Z",
        },
        {
          token: "responded",
          status: "responded",
          channel: "email",
          token_expires_at: future,
          created_at: "2026-10-08T04:00:00.000Z",
        },
      ],
      now
    );
    assert.equal(token, null);
  });

  it("returns null for no rows and treats a null expiry as non-expiring", () => {
    assert.equal(pickActiveApprovalToken([], now), null);
    assert.equal(
      pickActiveApprovalToken(
        [
          {
            token: "no-expiry",
            status: "sent",
            channel: "email",
            token_expires_at: null,
            created_at: null,
          },
        ],
        now
      ),
      "no-expiry"
    );
  });
});

describe("buildBazaarPortalStatusPayload approval_status (additive)", () => {
  it("carries the decision alongside the move + link", () => {
    const payload = buildBazaarPortalStatusPayload({
      orderNumber: "BZ-123",
      columnName: "Prepress",
      movedAt: "2026-10-08T12:00:00.000Z",
      approvalUrl: "https://workflow-rho-one.vercel.app/l/AbC2345",
      approvalStatus: "approved",
    });
    assert.equal(payload.approval_status, "approved");
    assert.equal(payload.column_name, "Prepress");
    assert.equal(
      payload.approval_url,
      "https://workflow-rho-one.vercel.app/l/AbC2345"
    );
    assert.deepEqual(Object.keys(payload).sort(), [
      "approval_status",
      "approval_url",
      "column_name",
      "event",
      "moved_at",
      "order_number",
    ]);
  });

  it("maps changes_requested (Not approved) to rejected", () => {
    const payload = buildBazaarPortalStatusPayload({
      orderNumber: "BZ-1",
      columnName: "Start (Create Order)",
      approvalStatus: "changes_requested",
    });
    assert.equal(payload.approval_status, "rejected");
  });

  it("can mark a new round as pending", () => {
    const payload = buildBazaarPortalStatusPayload({
      orderNumber: "BZ-1",
      columnName: "Waiting Approval",
      approvalStatus: "pending",
    });
    assert.equal(payload.approval_status, "pending");
  });

  it("omits the approval_status key when absent or unrecognised (payload unchanged)", () => {
    for (const approvalStatus of [undefined, null, "", "  ", "maybe", 1]) {
      const payload = buildBazaarPortalStatusPayload({
        orderNumber: "BZ-1",
        columnName: "Start",
        movedAt: "2026-10-08T00:00:00.000Z",
        approvalStatus: approvalStatus as string | null | undefined,
      });
      assert.ok(
        !("approval_status" in payload),
        `should omit for ${String(approvalStatus)}`
      );
    }
  });
});

describe("sanitizeApprovalStatus", () => {
  it("normalizes case/whitespace and the Workflow's own vocabulary", () => {
    assert.equal(sanitizeApprovalStatus(" Approved "), "approved");
    assert.equal(sanitizeApprovalStatus("REJECTED"), "rejected");
    assert.equal(sanitizeApprovalStatus("changes_requested"), "rejected");
    assert.equal(sanitizeApprovalStatus("pending"), "pending");
    assert.equal(sanitizeApprovalStatus("info_submitted"), null);
    assert.equal(sanitizeApprovalStatus(undefined), null);
  });
});

describe("pickActiveApprovalToken includeResponded (decision callbacks)", () => {
  const now = Date.parse("2026-10-08T12:00:00.000Z");
  const future = "2026-11-01T00:00:00.000Z";
  const past = "2026-10-01T00:00:00.000Z";

  it("still ignores responded rounds by default", () => {
    const rows = [
      {
        token: "answered",
        status: "responded",
        channel: "email",
        token_expires_at: future,
        created_at: "2026-10-08T04:00:00.000Z",
      },
    ];
    assert.equal(pickActiveApprovalToken(rows, now), null);
  });

  it("returns the answered round when asked, even past its calendar expiry", () => {
    const rows = [
      {
        token: "answered",
        status: "responded",
        channel: "email",
        token_expires_at: past,
        created_at: "2026-10-08T04:00:00.000Z",
      },
    ];
    assert.equal(
      pickActiveApprovalToken(rows, now, { includeResponded: true }),
      "answered"
    );
  });

  it("newest round wins and skips queued sends", () => {
    const rows = [
      {
        token: "older-answered",
        status: "responded",
        channel: "email",
        token_expires_at: future,
        created_at: "2026-10-07T00:00:00.000Z",
      },
      {
        token: "newer-answered",
        status: "responded",
        channel: "sms",
        token_expires_at: future,
        created_at: "2026-10-08T00:00:00.000Z",
      },
      {
        token: "queued-newest",
        status: "pending",
        channel: "email",
        token_expires_at: future,
        created_at: "2026-10-09T00:00:00.000Z",
      },
    ];
    assert.equal(
      pickActiveApprovalToken(rows, now, { includeResponded: true }),
      "newer-answered"
    );
  });
});

it("hold_reason: sent (trimmed, collapsed) only when given", () => {
  const p = buildBazaarPortalStatusPayload({
    orderNumber: "BZ-452",
    columnName: "Hold",
    movedAt: "2026-10-23T18:27:02.000Z",
    holdReason: "  please specify skus\n and qty for each ",
  });
  assert.equal(p.hold_reason, "please specify skus and qty for each");
  const q = buildBazaarPortalStatusPayload({ orderNumber: "BZ-452", columnName: "Prepress" });
  assert.equal("hold_reason" in q, false);
});
