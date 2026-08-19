import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/automation";
import { specLabelFromSnapshot } from "@/lib/connected-specs";
import { loadOrderWithRelations } from "@/lib/orders/load-with-relations";
import type { CrmSnapshot } from "@/lib/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    key?: unknown;
    display_value?: unknown;
    value?: unknown;
  };

  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  if (typeof body.display_value !== "string") {
    return NextResponse.json(
      { error: "display_value must be a string" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: existing } = await supabase
    .from("orders")
    .select("id, integration_mode, crm_snapshot")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (existing.integration_mode !== "connected") {
    return NextResponse.json(
      { error: "Spec overrides are only available in Connected mode" },
      { status: 400 }
    );
  }

  const patch = {
    [key]: { display_value: body.display_value, value: body.value },
  };

  const { data: merged, error: rpcError } = await supabase.rpc(
    "merge_order_user_overrides",
    {
      p_order_id: id,
      p_patch: patch,
    }
  );

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }
  if (merged == null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const label = specLabelFromSnapshot(
    existing.crm_snapshot as CrmSnapshot | null,
    key
  );
  await logActivity(supabase, {
    tenantId,
    orderId: id,
    actor: ctx.userId,
    action: `Spec overridden: ${label} changed to ${body.display_value}`,
    metadata: {
      key,
      label,
      display_value: body.display_value,
    },
  });

  const order = await loadOrderWithRelations(supabase, id, tenantId);
  return NextResponse.json({ order });
}
