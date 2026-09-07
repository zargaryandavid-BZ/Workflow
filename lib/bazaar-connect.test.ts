import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BazaarConnectError,
  isAllowedBazaarConnectUrl,
  parseBrokerId,
  parseConnectIntent,
  parseConnectMode,
  removePartnerKey,
  resolveConnectTenant,
  upsertPartnerKeyMap,
} from "./bazaar-connect-core.ts";

describe("bazaar-connect parse", () => {
  it("requires intent workflow", () => {
    assert.throws(
      () => parseConnectIntent({ intent: "price" }),
      (err: unknown) =>
        err instanceof BazaarConnectError && err.code === "invalid_intent"
    );
    assert.equal(parseConnectIntent({ intent: "workflow" }), "workflow");
  });

  it("requires mode on begin/complete", () => {
    assert.throws(
      () => parseConnectMode({ intent: "workflow" }),
      (err: unknown) =>
        err instanceof BazaarConnectError && err.code === "invalid_mode"
    );
    assert.equal(
      parseConnectMode({ mode: "receive_only" }),
      "receive_only"
    );
  });

  it("reads brokerId", () => {
    assert.equal(parseBrokerId({ brokerId: " clbroker1 " }), "clbroker1");
    assert.equal(parseBrokerId({}), "");
  });
});

describe("bazaar-connect url", () => {
  it("accepts https and localhost http", () => {
    assert.equal(isAllowedBazaarConnectUrl("https://api.bazaarprinting.com"), true);
    assert.equal(isAllowedBazaarConnectUrl("http://localhost:3002"), true);
    assert.equal(isAllowedBazaarConnectUrl("http://127.0.0.1:3002"), true);
    assert.equal(isAllowedBazaarConnectUrl("http://evil.example"), false);
    assert.equal(isAllowedBazaarConnectUrl("not-a-url"), false);
  });
});

describe("bazaar-connect tenant resolve", () => {
  const tenants = [
    { id: "t1", name: "Main" },
    { id: "t2", name: "Other" },
  ];

  it("matches a unique per-tenant secret", () => {
    const r = resolveConnectTenant({
      providedSecret: "board-secret",
      tenantSecrets: [
        { tenantId: "t1", secret: "board-secret" },
        { tenantId: "t2", secret: "other" },
      ],
      envSecret: "env-secret",
      tenants,
    });
    assert.deepEqual(r, { kind: "tenant", tenantId: "t1" });
  });

  it("rejects two tenants with the same stored secret", () => {
    const r = resolveConnectTenant({
      providedSecret: "dup",
      tenantSecrets: [
        { tenantId: "t1", secret: "dup" },
        { tenantId: "t2", secret: "dup" },
      ],
      envSecret: null,
      tenants,
    });
    assert.equal(r.kind, "unauthorized");
  });

  it("uses env secret + single tenant", () => {
    const r = resolveConnectTenant({
      providedSecret: "env-secret",
      tenantSecrets: [{ tenantId: "t1", secret: null }],
      envSecret: "env-secret",
      tenants: [{ id: "t1", name: "Main" }],
    });
    assert.deepEqual(r, { kind: "tenant", tenantId: "t1" });
  });

  it("returns a picker when env secret matches many tenants", () => {
    const r = resolveConnectTenant({
      providedSecret: "env-secret",
      tenantSecrets: [],
      envSecret: "env-secret",
      tenants,
    });
    assert.equal(r.kind, "picker");
    if (r.kind === "picker") {
      assert.equal(r.tenants.length, 2);
    }
  });

  it("rejects a wrong secret", () => {
    const r = resolveConnectTenant({
      providedSecret: "nope",
      tenantSecrets: [{ tenantId: "t1", secret: "board-secret" }],
      envSecret: "env-secret",
      tenants,
    });
    assert.equal(r.kind, "unauthorized");
  });
});

describe("bazaar-connect key map", () => {
  it("upserts one broker and leaves the other", () => {
    const next = upsertPartnerKeyMap(
      { a: { osk: "osk_old", label: "A" } },
      "b",
      "osk_new",
      "B"
    );
    assert.equal(next.a.osk, "osk_old");
    assert.equal(next.b.osk, "osk_new");
    assert.equal(next.b.label, "B");
  });

  it("overwrites only that broker", () => {
    const next = upsertPartnerKeyMap(
      { a: { osk: "osk_a", label: "A" }, b: { osk: "osk_b", label: "B" } },
      "b",
      "osk_rotated",
      "B2"
    );
    assert.equal(next.a.osk, "osk_a");
    assert.equal(next.b.osk, "osk_rotated");
    assert.equal(next.b.label, "B2");
  });

  it("stores connect mode on the new partner only", () => {
    const next = upsertPartnerKeyMap(
      { a: { osk: "osk_a", label: "A", mode: "send_receive" } },
      "b",
      "osk_b",
      "B",
      "receive_only"
    );
    assert.equal(next.a.mode, "send_receive");
    assert.equal(next.b.mode, "receive_only");
  });

  it("removes one key and reports empty", () => {
    const { next, empty } = removePartnerKey(
      { a: { osk: "osk_a", label: "A" } },
      "a"
    );
    assert.equal(empty, true);
    assert.deepEqual(next, {});
  });

  it("unknown broker is a no-op", () => {
    const { next, empty } = removePartnerKey(
      { a: { osk: "osk_a", label: "A" } },
      "missing"
    );
    assert.equal(empty, false);
    assert.equal(next.a.osk, "osk_a");
  });
});
