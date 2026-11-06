import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { parseDieInput } from "@/lib/dies";
import { createDie, listDies } from "@/lib/dies.server";
import { canViewDieOrder } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

/** GET: the shop's die library. */
export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await listDies(await createClient(), ctx.tenant.id);
  return NextResponse.json(result);
}

/** POST: "+ Add Die". The Template ID (DIE-00001) is created here. */
export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewDieOrder(ctx.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseDieInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const result = await createDie(await createClient(), {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    input: parsed.value,
    actor: { id: ctx.userId, name: ctx.fullName || ctx.email },
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
