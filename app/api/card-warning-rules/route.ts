import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { isCardWarningColor } from "@/lib/card-warning-rules";
import {
  cardWarningRulesMigrationMessage,
  loadCardWarningRulesWithStatus,
} from "@/lib/card-warning-rules.server";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { rules, migrationRequired } = await loadCardWarningRulesWithStatus(
    supabase,
    ctx.tenant.id
  );

  if (migrationRequired) {
    return NextResponse.json({ rules: [], migrationRequired: true });
  }
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
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

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Rule name is required" }, { status: 422 });
  }
  const thresholdDays = Number(body.threshold_days ?? 3);
  if (!Number.isInteger(thresholdDays) || thresholdDays < 1) {
    return NextResponse.json(
      { error: "Threshold must be a whole number ≥ 1" },
      { status: 422 }
    );
  }

  const supabase = await createClient();
  const { migrationRequired } = await loadCardWarningRulesWithStatus(
    supabase,
    ctx.tenant.id
  );
  if (migrationRequired) {
    return NextResponse.json(
      { error: cardWarningRulesMigrationMessage() },
      { status: 503 }
    );
  }

  const color = isCardWarningColor(body.color) ? body.color : "amber";

  const { data: last } = await supabase
    .from("card_warning_rules")
    .select("position")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("card_warning_rules")
    .insert({
      tenant_id: ctx.tenant.id,
      name: body.name.trim(),
      threshold_days: thresholdDays,
      color,
      apply_to_columns: body.apply_to_columns ?? [],
      enabled: body.enabled ?? true,
      position: ((last as { position: number } | null)?.position ?? -1) + 1,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}
