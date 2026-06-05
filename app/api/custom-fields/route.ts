import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    fieldType?: string;
    options?: string[];
    required?: boolean;
  };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("custom_fields")
    .select("position")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("custom_fields")
    .insert({
      tenant_id: ctx.tenant.id,
      name: body.name.trim(),
      field_type: body.fieldType ?? "text",
      options: body.options ?? [],
      required: body.required ?? false,
      position,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ field: data });
}
