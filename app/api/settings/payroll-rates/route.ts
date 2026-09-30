import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function parseRates(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key) continue;
    const n =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number.parseFloat(value)
          : Number.NaN;
    if (Number.isFinite(n) && n >= 0) out[key] = n;
  }
  return out;
}

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("payroll_rates")
    .eq("id", ctx.tenant.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    rates: parseRates(data?.payroll_rates),
  });
}

export async function PATCH(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { rates?: unknown };
  const incoming = parseRates(body.rates);
  if (Object.keys(incoming).length === 0 && body.rates === undefined) {
    return NextResponse.json({ error: "rates required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("tenants")
    .select("payroll_rates")
    .eq("id", ctx.tenant.id)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  const rates = { ...parseRates(existing?.payroll_rates), ...incoming };
  const { error } = await supabase
    .from("tenants")
    .update({ payroll_rates: rates })
    .eq("id", ctx.tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rates });
}
