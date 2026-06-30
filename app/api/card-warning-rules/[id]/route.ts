import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { isCardWarningColor } from "@/lib/card-warning-rules";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    threshold_days?: number;
    color?: string;
    apply_to_columns?: string[];
    enabled?: boolean;
  };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("card_warning_rules")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json({ error: "Rule name is required" }, { status: 422 });
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.threshold_days !== undefined) {
    const d = Number(body.threshold_days);
    if (!Number.isInteger(d) || d < 1) {
      return NextResponse.json(
        { error: "Threshold must be a whole number ≥ 1" },
        { status: 422 }
      );
    }
    updates.threshold_days = d;
  }
  if (body.color !== undefined) {
    updates.color = isCardWarningColor(body.color)
      ? body.color
      : existing.color;
  }
  if (body.apply_to_columns !== undefined) {
    updates.apply_to_columns = body.apply_to_columns;
  }
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  const { data, error } = await supabase
    .from("card_warning_rules")
    .update(updates)
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ rule: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("card_warning_rules")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
