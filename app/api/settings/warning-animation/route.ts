import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizeWorkingDays } from "@/lib/card-warning-rules";

export async function PATCH(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin")
    return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    warning_opacity?: number;
    warning_speed_ms?: number;
    warning_spread_px?: number;
    warning_working_days?: number[];
  };

  const patch: Record<string, number | number[]> = {};

  if (body.warning_opacity !== undefined) {
    const v = Math.round(body.warning_opacity);
    if (v < 5 || v > 100)
      return NextResponse.json({ error: "opacity must be 5–100" }, { status: 400 });
    patch.warning_opacity = v;
  }
  if (body.warning_speed_ms !== undefined) {
    const v = Math.round(body.warning_speed_ms);
    if (v < 500 || v > 8000)
      return NextResponse.json(
        { error: "speed_ms must be 500–8000" },
        { status: 400 }
      );
    patch.warning_speed_ms = v;
  }
  if (body.warning_spread_px !== undefined) {
    const v = Math.round(body.warning_spread_px);
    if (v < 1 || v > 20)
      return NextResponse.json(
        { error: "spread_px must be 1–20" },
        { status: 400 }
      );
    patch.warning_spread_px = v;
  }
  if (body.warning_working_days !== undefined) {
    if (!Array.isArray(body.warning_working_days)) {
      return NextResponse.json(
        { error: "warning_working_days must be an array" },
        { status: 400 }
      );
    }
    const raw = body.warning_working_days.map((d) => Math.round(Number(d)));
    if (raw.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return NextResponse.json(
        { error: "working days must be integers 0–6 (Sun–Sat)" },
        { status: 400 }
      );
    }
    const unique = [...new Set(raw)].sort((a, b) => a - b);
    if (unique.length === 0) {
      return NextResponse.json(
        { error: "Select at least one working day" },
        { status: 400 }
      );
    }
    patch.warning_working_days = normalizeWorkingDays(unique);
  }

  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update(patch)
    .eq("id", ctx.tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
