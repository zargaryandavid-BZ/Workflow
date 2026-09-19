import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import { nextAvailableBoxNumbers } from "@/lib/fulfillment-box-numbers";
import { compactOpenFulfillmentBoxes } from "@/lib/fulfillment-compact-boxes";

export async function GET() {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const supabase = await createClient();
  await compactOpenFulfillmentBoxes(supabase, ctx.tenant.id);

  type BoxListRow = {
    id: string;
    box_number: string;
    status: string;
    sent_at: string | null;
    received_at: string | null;
    created_at: string;
    receive_status: string | null;
    receive_comment: string | null;
  };

  let boxData: BoxListRow[] | null = null;
  let error: { message: string } | null = null;

  const full = await supabase
    .from("fulfillment_boxes")
    .select(
      "id, box_number, status, sent_at, received_at, created_at, receive_status, receive_comment"
    )
    .eq("tenant_id", ctx.tenant.id)
    .order("created_at", { ascending: false });

  if (full.error && /receive_status|receive_comment/.test(full.error.message)) {
    const fallback = await supabase
      .from("fulfillment_boxes")
      .select("id, box_number, status, sent_at, received_at, created_at")
      .eq("tenant_id", ctx.tenant.id)
      .order("created_at", { ascending: false });
    error = fallback.error;
    boxData = (fallback.data ?? []).map((row) => ({
      ...row,
      receive_status: null,
      receive_comment: null,
    }));
  } else {
    error = full.error;
    boxData = (full.data ?? []) as BoxListRow[];
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const boxes = boxData ?? [];
  if (boxes.length === 0) return NextResponse.json([]);

  // Get order counts per box
  const boxIds = boxes.map((b) => b.id);
  const { data: countData } = await supabase
    .from("fulfillment_box_orders")
    .select("box_id")
    .in("box_id", boxIds)
    .eq("tenant_id", ctx.tenant.id);

  const countMap: Record<string, number> = {};
  for (const row of countData ?? []) {
    countMap[row.box_id] = (countMap[row.box_id] ?? 0) + 1;
  }

  return NextResponse.json(
    boxes.map((b) => ({ ...b, order_count: countMap[b.id] ?? 0 }))
  );
}

export async function POST(request: Request) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = (await request.json().catch(() => ({}))) as {
    box_number?: string;
    count?: number | string;
    add?: number | string;
  };

  const supabase = await createClient();

  const addN = Math.floor(Number(body.add));
  const rawCount = body.count ?? body.box_number;
  const count = Math.floor(Number(rawCount));
  const wantedCount =
    Number.isFinite(addN) && addN >= 1
      ? addN
      : Number.isFinite(count) && count >= 1
        ? count
        : NaN;

  if (!Number.isFinite(wantedCount) || wantedCount < 1 || wantedCount > 24) {
    return NextResponse.json(
      { error: "Enter how many boxes (1–24)" },
      { status: 400 }
    );
  }

  const { data: openBoxes, error: listErr } = await supabase
    .from("fulfillment_boxes")
    .select("box_number")
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "open");
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  async function insertWithTaken(taken: string[]) {
    const wanted = nextAvailableBoxNumbers(taken, wantedCount);
    return supabase
      .from("fulfillment_boxes")
      .insert(
        wanted.map((box_number) => ({
          tenant_id: ctx.tenant.id,
          box_number,
          status: "open" as const,
        }))
      )
      .select("id, box_number");
  }

  let { data: created, error } = await insertWithTaken(
    (openBoxes ?? []).map((b) => b.box_number)
  );

  if (error?.code === "23505") {
    const { data: allBoxes } = await supabase
      .from("fulfillment_boxes")
      .select("box_number")
      .eq("tenant_id", ctx.tenant.id);
    const retry = await insertWithTaken(
      (allBoxes ?? []).map((b) => b.box_number)
    );
    created = retry.data;
    error = retry.error;
  }

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A box with that number already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = created ?? [];
  await compactOpenFulfillmentBoxes(supabase, ctx.tenant.id);

  return NextResponse.json(
    {
      count: rows.length,
      created: rows.length,
      ids: rows.map((r) => r.id),
      box_numbers: rows.map((r) => r.box_number),
    },
    { status: 201 }
  );
}
