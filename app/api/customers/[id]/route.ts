import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import {
  listCustomerOrderSummaries,
  updateCustomerByAdmin,
  updateCustomerDefaultPriority,
} from "@/lib/customers";
import { canSetBoardTagAndPriority } from "@/lib/permissions";
import { parsePriorityScore } from "@/lib/order-priority-score";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: customer, error } = await supabase
    .from("customers")
    .select(
      "id, tenant_id, name, email, phone, company, preferred_channel, default_priority_score, created_at, updated_at"
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  try {
    const orders = await listCustomerOrderSummaries(
      supabase,
      ctx.tenant.id,
      id
    );
    return NextResponse.json({ customer, orders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load customer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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
    name?: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
    preferred_channel?: "sms" | "email" | null;
    default_priority_score?: number | string | null;
    /** When true with only priority fields, pre-prod may update priority. */
    priorityOnly?: boolean;
  };

  const supabase = await createClient();
  let syncClient = supabase;
  try {
    syncClient = createAdminClient();
  } catch (err) {
    console.warn(
      "[customers] admin client unavailable for priority sync; using user client",
      err
    );
  }

  const priorityOnly =
    body.priorityOnly === true ||
    (body.name === undefined &&
      body.email === undefined &&
      body.phone === undefined &&
      body.company === undefined &&
      body.preferred_channel === undefined &&
      body.default_priority_score !== undefined);

  try {
    if (priorityOnly) {
      if (!canSetBoardTagAndPriority(ctx.role)) {
        return NextResponse.json(
          { error: "Only admin or pre-production can set customer priority." },
          { status: 403 }
        );
      }
      const score =
        body.default_priority_score === null ||
        body.default_priority_score === ""
          ? null
          : parsePriorityScore(body.default_priority_score);
      if (
        body.default_priority_score !== null &&
        body.default_priority_score !== "" &&
        score == null
      ) {
        return NextResponse.json(
          { error: "Priority must be 1–5 or empty" },
          { status: 400 }
        );
      }
      const { customer, ordersUpdated } = await updateCustomerDefaultPriority(
        supabase,
        ctx.tenant.id,
        id,
        score,
        { syncClient }
      );
      return NextResponse.json({ customer, ordersUpdated });
    }

    if (ctx.role !== "admin") {
      return NextResponse.json(
        { error: "Only admins can edit customers." },
        { status: 403 }
      );
    }

    const priorityScore =
      body.default_priority_score === undefined
        ? undefined
        : body.default_priority_score === null ||
            body.default_priority_score === ""
          ? null
          : parsePriorityScore(body.default_priority_score);
    if (
      body.default_priority_score !== undefined &&
      body.default_priority_score !== null &&
      body.default_priority_score !== "" &&
      priorityScore == null
    ) {
      return NextResponse.json(
        { error: "Priority must be 1–5 or empty" },
        { status: 400 }
      );
    }

    const customer = await updateCustomerByAdmin(
      supabase,
      ctx.tenant.id,
      id,
      {
        name: body.name ?? "",
        email: body.email,
        phone: body.phone,
        company: body.company,
        preferred_channel: body.preferred_channel,
        default_priority_score: priorityScore,
      },
      { syncClient }
    );

    return NextResponse.json({ customer });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    const status =
      message === "Customer not found"
        ? 404
        : message.includes("required") ||
            message.includes("Invalid") ||
            message.includes("already") ||
            message.includes("Priority") ||
            message.includes("order cards")
          ? 400
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(
    { error: "Customers cannot be deleted manually." },
    { status: 403 }
  );
}
