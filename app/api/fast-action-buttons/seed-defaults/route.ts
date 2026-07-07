import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import type { FastActionButtonColor } from "@/lib/types";

// Buttons to seed — column names must match exactly what is in board_columns.
const SEED_BUTTONS: { name: string; columnName: string; color: FastActionButtonColor }[] = [
  { name: "Start",            columnName: "Start (Create Order)",       color: "blue"   },
  { name: "In Progress",      columnName: "In Progress",                color: "green"  },
  { name: "Hold",             columnName: "Hold",                       color: "orange" },
  { name: "Customer Replied", columnName: "Customer Replied",           color: "green"  },
  { name: "In Production",    columnName: "In Production",              color: "blue"   },
  { name: "Boyd Received",    columnName: "Boyd Received",              color: "purple" },
  { name: "In Application",   columnName: "In the application",         color: "gray"   },
  { name: "Ready to Ship",    columnName: "(Boyd Only) Ready to Ship",  color: "yellow" },
  { name: "Shipped Customer", columnName: "Shipped Customer",           color: "red"    },
  { name: "Finished",         columnName: "Finished: Fulfilled",        color: "gray"   },
];

export async function POST() {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  // Fetch all columns for this tenant.
  const { data: columns, error: colErr } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId);

  if (colErr) {
    return NextResponse.json({ error: colErr.message }, { status: 500 });
  }

  const columnByName = new Map<string, string>(
    (columns ?? []).map((c: { id: string; name: string }) => [c.name, c.id])
  );

  // Fetch existing buttons to avoid duplicating by destination column.
  const { data: existing } = await supabase
    .from("fast_action_buttons")
    .select("destination_column_id, position")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: false });

  const existingTargets = new Set(
    (existing ?? [])
      .map((b: { destination_column_id: string | null }) => b.destination_column_id)
      .filter(Boolean)
  );

  const maxPosition =
    (existing as { position: number }[] | null)?.[0]?.position ?? -1;

  const toInsert: {
    tenant_id: string;
    name: string;
    color: FastActionButtonColor;
    destination_column_id: string;
    show_in_columns: string[];
    visible_to_roles: string[];
    visibility_mode: string;
    visibility_roles: string[];
    visibility_users: string[];
    enabled: boolean;
    position: number;
  }[] = [];

  const skipped: string[] = [];
  const missing: string[] = [];

  let posOffset = 0;

  for (const btn of SEED_BUTTONS) {
    const colId = columnByName.get(btn.columnName);
    if (!colId) {
      missing.push(btn.columnName);
      continue;
    }
    if (existingTargets.has(colId)) {
      skipped.push(btn.name);
      continue;
    }
    toInsert.push({
      tenant_id: tenantId,
      name: btn.name,
      color: btn.color,
      destination_column_id: colId,
      show_in_columns: [],       // empty = show in all columns
      visible_to_roles: [],      // legacy: empty = all roles
      visibility_mode: "all",    // new unified: all users
      visibility_roles: [],
      visibility_users: [],
      enabled: true,
      position: maxPosition + 1 + posOffset,
    });
    posOffset++;
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ added: 0, skipped, missing });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("fast_action_buttons")
    .insert(toInsert)
    .select("name");

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    added: inserted?.length ?? 0,
    skipped,
    missing,
    buttons: inserted?.map((b: { name: string }) => b.name),
  });
}
