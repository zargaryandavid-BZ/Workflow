import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { TENANT_COOKIE } from "@/lib/constants";
import { seedDefaultPrintFields } from "@/lib/print-fields";

function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;

  const { data, error } = await supabase.rpc("create_tenant", {
    p_name: name,
    p_slug: slug,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const tenant = data as { id: string };

  // Seed the default print-production intake fields for the new workspace.
  try {
    await seedDefaultPrintFields(supabase, tenant.id);
  } catch {
    // Non-fatal: the admin can add them later from Custom Fields settings.
  }

  const cookieStore = await cookies();
  cookieStore.set(TENANT_COOKIE, tenant.id, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  return NextResponse.json({ tenant: data });
}
