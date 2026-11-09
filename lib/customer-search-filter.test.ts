import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { customerSearchOrFilter } from "./customer-search-filter.ts";

describe("customerSearchOrFilter", () => {
  it("searches name, company, email and phone", () => {
    const f = customerSearchOrFilter("acme")!;
    for (const col of ["name", "company", "email", "phone"]) {
      assert.ok(f.includes(`${col}.ilike."%acme%"`), col);
    }
  });

  it("formatted phone matches any stored shape", () => {
    const f = customerSearchOrFilter("(323) 555-1234")!;
    assert.ok(f.includes(`phone.ilike."%3%2%3%5%5%5%1%2%3%4%"`));
  });

  it("drops leading US 1", () => {
    const f = customerSearchOrFilter("+1 323 555 1234")!;
    assert.ok(f.includes(`phone.ilike."%3%2%3%5%5%5%1%2%3%4%"`));
  });

  it("no digit pattern for mostly-text queries", () => {
    assert.ok(!customerSearchOrFilter("Unit 12 Bakery")!.includes("%1%2%"));
  });

  it("strips characters that break the filter; empty → null", () => {
    assert.ok(!customerSearchOrFilter('a,b"c')!.includes(","+"b"));
    assert.equal(customerSearchOrFilter("   "), null);
  });
});
