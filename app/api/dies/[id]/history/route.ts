import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { getDie, loadDieHistory } from "@/lib/dies.server";
import { createClient } from "@/lib/supabase/server";

/** GET: a die's usage / status history and its order requests. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = await createClient();
  const die = await getDie(supabase, ctx.tenant.id, id);
  if (!die) return NextResponse.json({ error: "Die not found" }, { status: 404 });
  const history = await loadDieHistory(supabase, ctx.tenant.id, id);
  return NextResponse.json({ die, ...history });
}
