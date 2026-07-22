import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { FieldLink } from "@/lib/types";

function formatSchemaError(message: string): string {
  if (
    message.includes("field_links") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  ) {
    return "Linked dropdowns require migration 0054_linked_dropdowns.sql (run supabase db push).";
  }
  return message;
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("field_links")
    .select("*, field_link_mappings(*)")
    .eq("tenant_id", ctx.tenant.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: formatSchemaError(error.message) },
      { status: 500 }
    );
  }

  const links = ((data ?? []) as FieldLink[]).map((link) => ({
    ...link,
    field_link_mappings: link.field_link_mappings ?? [],
  }));

  return NextResponse.json(links);
}

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    source_field_id?: string;
    target_field_id?: string;
  };
  const sourceFieldId = body.source_field_id?.trim() ?? "";
  const targetFieldId = body.target_field_id?.trim() ?? "";

  if (!sourceFieldId || !targetFieldId) {
    return NextResponse.json(
      { error: "source_field_id and target_field_id are required" },
      { status: 400 }
    );
  }
  if (sourceFieldId === targetFieldId) {
    return NextResponse.json(
      { error: "Source and target fields must be different" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data: fields, error: fieldsError } = await supabase
    .from("custom_fields")
    .select("id, field_type, tenant_id")
    .eq("tenant_id", ctx.tenant.id)
    .in("id", [sourceFieldId, targetFieldId]);

  if (fieldsError) {
    return NextResponse.json({ error: fieldsError.message }, { status: 500 });
  }

  const byId = new Map(
    (fields ?? []).map((f) => [f.id as string, f as { id: string; field_type: string }])
  );
  const source = byId.get(sourceFieldId);
  const target = byId.get(targetFieldId);
  if (!source || !target) {
    return NextResponse.json(
      { error: "Both fields must belong to this tenant" },
      { status: 400 }
    );
  }
  if (source.field_type !== "select" || target.field_type !== "select") {
    return NextResponse.json(
      { error: "Only dropdown (select) fields can be linked" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("field_links")
    .insert({
      tenant_id: ctx.tenant.id,
      source_field_id: sourceFieldId,
      target_field_id: targetFieldId,
    })
    .select("*, field_link_mappings(*)")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "These fields are already linked" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: formatSchemaError(error.message) },
      { status: 500 }
    );
  }

  const link = data as FieldLink;
  return NextResponse.json(
    { ...link, field_link_mappings: link.field_link_mappings ?? [] },
    { status: 201 }
  );
}
