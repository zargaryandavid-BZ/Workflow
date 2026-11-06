import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { parseDieInput, parseDieShopPatch } from "@/lib/dies";
import { deleteDie, updateDie, updateDieShop } from "@/lib/dies.server";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

/** PATCH: edit a die. The Template ID never changes. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const shop = parseDieShopPatch(body);
  if (shop.kind === "error") {
    return NextResponse.json({ error: shop.error }, { status: 422 });
  }
  // Any staff member can mark a die Out of order / Working (they find the
  // broken die). Reorder and full edits stay with Die Order roles.
  const statusOnly = shop.kind === "shop" && !shop.reorder;
  if (!statusOnly && !canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (shop.kind === "shop") {
    const result = await updateDieShop(await createClient(), {
      tenantId: ctx.tenant.id,
      id,
      shopStatus: shop.shopStatus,
      reorder: shop.reorder,
      actor: { id: ctx.userId, name: ctx.fullName || ctx.email },
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  }
  const parsed = parseDieInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const result = await updateDie(await createClient(), {
    tenantId: ctx.tenant.id,
    id,
    input: parsed.value,
    actor: { id: ctx.userId, name: ctx.fullName || ctx.email },
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}

/** DELETE: remove a die from the library. Sent quote requests are kept. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const result = await deleteDie(await createClient(), ctx.tenant.id, id, {
    id: ctx.userId,
    name: ctx.fullName || ctx.email,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
