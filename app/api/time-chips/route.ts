import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { listTimeChips } from "@/lib/time-chips.server";
import { isTimeChipIcon } from "@/lib/time-chips";

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  try {
    const chips = await listTimeChips(supabase, ctx.tenant.id);
    return NextResponse.json({ chips });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    icon?: string;
    visible_all?: boolean;
    visible_column_ids?: string[];
    stamp_on_column_id?: string | null;
    enabled?: boolean;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 422 });
  }
  if (!body.stamp_on_column_id) {
    return NextResponse.json(
      { error: "Pick a column that stamps this date when the card enters it" },
      { status: 422 }
    );
  }

  const icon =
    body.icon && isTimeChipIcon(body.icon) ? body.icon : "clock";

  const supabase = await createClient();
  await listTimeChips(supabase, ctx.tenant.id);

  const { data: last } = await supabase
    .from("time_chips")
    .select("position")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const visibleAll = Boolean(body.visible_all);
  const visibleIds = Array.isArray(body.visible_column_ids)
    ? body.visible_column_ids.filter((id) => typeof id === "string")
    : [];

  const { data, error } = await supabase
    .from("time_chips")
    .insert({
      tenant_id: ctx.tenant.id,
      kind: "custom",
      system_key: null,
      name: body.name.trim(),
      icon,
      enabled: body.enabled !== false,
      visible_all: visibleAll,
      visible_column_ids: visibleAll ? [] : visibleIds,
      stamp_on_column_id: body.stamp_on_column_id,
      position: ((last as { position: number } | null)?.position ?? 99) + 1,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ chip: data });
}
