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
    trigger?: string;
    fromColumn?: string | null;
    toColumn?: string | null;
    config?: Record<string, unknown>;
  };

  // Notify rules don't require a target column (movement on a customer
  // approval reuses the on_approval_result rules).
  const isNotify = (body.config as { action?: string })?.action === "notify";
  const isProductCreate =
    body.trigger === "on_job_created" &&
    typeof (body.config as { product?: unknown })?.product === "string" &&
    Boolean(
      String((body.config as { product?: string }).product ?? "").trim()
    );
  const isColumnIdle = body.trigger === "on_column_idle";

  if (!body.trigger || (!body.toColumn && !isNotify)) {
    return NextResponse.json(
      { error: "trigger and toColumn are required" },
      { status: 400 }
    );
  }

  if (body.trigger === "on_job_created" && !isProductCreate) {
    return NextResponse.json(
      { error: "product is required for create-by-product rules" },
      { status: 400 }
    );
  }

  if (isColumnIdle) {
    if (!body.fromColumn) {
      return NextResponse.json(
        { error: "fromColumn is required for idle auto-move rules" },
        { status: 400 }
      );
    }
    const idleValue = Number((body.config as { idle_value?: unknown })?.idle_value);
    const idleUnit = (body.config as { idle_unit?: unknown })?.idle_unit;
    if (!Number.isFinite(idleValue) || idleValue < 1) {
      return NextResponse.json(
        { error: "idle_value must be a positive number" },
        { status: 400 }
      );
    }
    if (
      idleUnit !== "hours" &&
      idleUnit !== "days" &&
      idleUnit !== "working_days"
    ) {
      return NextResponse.json(
        { error: "idle_unit must be hours, days, or working_days" },
        { status: 400 }
      );
    }
  }

  const config = { ...(body.config ?? {}) };
  if (body.trigger === "on_job_created") {
    config.product = String(
      (body.config as { product?: string }).product ?? ""
    ).trim();
  }
  if (isColumnIdle) {
    config.idle_value = Math.min(
      365,
      Math.round(Number((body.config as { idle_value?: number }).idle_value))
    );
    config.idle_unit = (body.config as { idle_unit?: string }).idle_unit;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_rules")
    .insert({
      tenant_id: ctx.tenant.id,
      trigger: body.trigger,
      from_column:
        body.trigger === "on_enter_column" || isColumnIdle
          ? body.fromColumn || null
          : null,
      to_column: body.toColumn,
      config,
      enabled: true,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ rule: data });
}
