import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ensureShortCustomerUrl, normalizeTargetPath } from "@/lib/short-link";

/** Staff UI: turn a customer portal path into the short `/l/…` URL. */
export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { path?: unknown };
  const path =
    typeof body.path === "string" ? normalizeTargetPath(body.path) : null;
  if (!path) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const url = await ensureShortCustomerUrl(supabase, ctx.tenant.id, path);
  return NextResponse.json({ url });
}
