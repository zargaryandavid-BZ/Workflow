import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FieldLinkMapping } from "@/lib/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { id: linkId } = await params;
  if (!linkId) {
    return NextResponse.json({ error: "Missing link id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    source_value?: string;
    target_value?: string;
  };
  const sourceValue = body.source_value?.trim() ?? "";
  const targetValue = body.target_value?.trim() ?? "";
  if (!sourceValue || !targetValue) {
    return NextResponse.json(
      { error: "source_value and target_value are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data: link, error: linkError } = await supabase
    .from("field_links")
    .select("id")
    .eq("id", linkId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (linkError) {
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }
  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("field_link_mappings")
    .insert({
      link_id: linkId,
      source_value: sourceValue,
      target_value: targetValue,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This mapping already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data as FieldLinkMapping, { status: 201 });
}
