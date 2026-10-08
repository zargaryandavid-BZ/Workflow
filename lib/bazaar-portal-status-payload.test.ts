import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBazaarPortalStatusPayload } from "./bazaar-portal-status-payload.ts";

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
