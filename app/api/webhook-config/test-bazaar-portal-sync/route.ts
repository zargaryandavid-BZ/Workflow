import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { testBazaarPortalSyncConnection } from "@/lib/bazaar-portal-sync";

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    bazaar_api_url?: string;
    osk_key?: string;
  };

  const result = await testBazaarPortalSyncConnection({
    bazaarApiUrl: body.bazaar_api_url ?? "",
    oskKey: body.osk_key ?? "",
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
