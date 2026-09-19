import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import type { TenantContext } from "@/lib/auth";
import type { Role } from "@/lib/types";

export function canUseFulfillment(role: Role): boolean {
  return role === "admin";
}

/** Send / Received pages — same gate as Settings → Fulfillment. */
export function assertFulfillmentPageAccess(ctx: TenantContext | null): TenantContext {
  if (!ctx) redirect("/login");
  if (!canUseFulfillment(ctx.role)) redirect("/board");
  return ctx;
}

export function requireFulfillmentApi(
  ctx: TenantContext | null
): { ctx: TenantContext } | { error: NextResponse } {
  if (!ctx) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canUseFulfillment(ctx.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ctx };
}
