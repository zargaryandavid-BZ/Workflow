import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fulfillment_settings")
    .select("send_column_id, receive_column_id, counted_column_id, missing_column_id")
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    data ?? {
      send_column_id: null,
      receive_column_id: null,
      counted_column_id: null,
      missing_column_id: null,
    }
  );
}

export async function PATCH(request: Request) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = await request.json().catch(() => ({})) as {
    send_column_id?: string | null;
    receive_column_id?: string | null;
    counted_column_id?: string | null;
    missing_column_id?: string | null;
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fulfillment_settings")
    .upsert(
      {
        tenant_id: ctx.tenant.id,
        ...(body.send_column_id !== undefined ? { send_column_id: body.send_column_id } : {}),
        ...(body.receive_column_id !== undefined ? { receive_column_id: body.receive_column_id } : {}),
        ...(body.counted_column_id !== undefined ? { counted_column_id: body.counted_column_id } : {}),
        ...(body.missing_column_id !== undefined ? { missing_column_id: body.missing_column_id } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" }
    )
    .select("send_column_id, receive_column_id, counted_column_id, missing_column_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
