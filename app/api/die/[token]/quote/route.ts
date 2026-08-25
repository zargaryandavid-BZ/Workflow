import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 422 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    price?: string | number;
    timeEstimate?: string;
    confirmedDueDate?: string;
    note?: string;
    clientNote?: string;
  };

  const price = Number(body.price);
  const timeEstimate = String(body.timeEstimate ?? "").trim();
  const confirmedDueDate = String(body.confirmedDueDate ?? "").trim();
  const note = String(
    body.clientNote ?? body.note ?? ""
  ).trim() || null;

  if (!Number.isFinite(price) || price < 0 || price > 99_999.99) {
    return NextResponse.json(
      { error: "Enter a price up to 5 digits." },
      { status: 422 }
    );
  }
  if (!timeEstimate) {
    return NextResponse.json(
      { error: "Enter a time estimate." },
      { status: 422 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmedDueDate)) {
    return NextResponse.json(
      { error: "Confirm the due date." },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  let existing:
    | {
        id: string;
        status: string;
        required_date?: string;
        allow_own_date?: boolean | null;
      }
    | null = null;

  const withFlag = await admin
    .from("die_requests")
    .select("id, status, required_date, allow_own_date")
    .eq("token", token)
    .maybeSingle();

  if (withFlag.error && /allow_own_date/i.test(withFlag.error.message)) {
    const fallback = await admin
      .from("die_requests")
      .select("id, status, required_date")
      .eq("token", token)
      .maybeSingle();
    existing = fallback.data;
    if (fallback.error || !existing) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }
  } else if (withFlag.error || !withFlag.data) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  } else {
    existing = withFlag.data;
  }

  if (existing.status === "ordered") {
    return NextResponse.json(
      { error: "This die was already ordered." },
      { status: 409 }
    );
  }

  const requiredDate = String(existing.required_date ?? "").slice(0, 10);
  const allowOwnDate = Boolean(existing.allow_own_date);
  if (!allowOwnDate && confirmedDueDate !== requiredDate) {
    return NextResponse.json(
      { error: "This request does not allow a different due date." },
      { status: 422 }
    );
  }

  const { error: updateError } = await admin
    .from("die_requests")
    .update({
      status: "quoted",
      quoted_price: price,
      time_estimate: timeEstimate,
      confirmed_due_date: confirmedDueDate,
      client_note: note,
      quoted_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
