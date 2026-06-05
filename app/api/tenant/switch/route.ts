import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireTenantMember } from "@/lib/auth";
import { TENANT_COOKIE } from "@/lib/constants";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    tenantId?: string;
  };
  const tenantId = body.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId required" }, { status: 400 });
  }

  try {
    await requireTenantMember(tenantId);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cookieStore = await cookies();
  cookieStore.set(TENANT_COOKIE, tenantId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  return NextResponse.json({ ok: true });
}
