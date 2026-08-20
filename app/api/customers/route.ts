import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import {
  createCustomerManually,
  CUSTOMERS_PAGE_SIZE,
  listCustomersPage,
} from "@/lib/customers";
import { parsePriorityScore } from "@/lib/order-priority-score";
import { canEditManualOrders } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get("page") ?? "1");
  const limit = Number(searchParams.get("limit") ?? CUSTOMERS_PAGE_SIZE);
  const q = searchParams.get("q")?.trim() ?? "";

  try {
    const supabase = await createClient();
    const result = await listCustomersPage(supabase, ctx.tenant.id, {
      page: Number.isFinite(page) ? page : 1,
      limit: Number.isFinite(limit) ? limit : CUSTOMERS_PAGE_SIZE,
      q,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load customers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canEditManualOrders(ctx.role)) {
    return NextResponse.json(
      { error: "You do not have permission to add customers." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
    preferred_channel?: "sms" | "email" | null;
    default_priority_score?: number | string | null;
  };

  const priorityScore =
    body.default_priority_score == null || body.default_priority_score === ""
      ? null
      : parsePriorityScore(body.default_priority_score);
  if (
    body.default_priority_score != null &&
    body.default_priority_score !== "" &&
    priorityScore == null
  ) {
    return NextResponse.json(
      { error: "Priority must be 1–5 or empty" },
      { status: 400 }
    );
  }

  try {
    const supabase = await createClient();
    const customer = await createCustomerManually(supabase, ctx.tenant.id, {
      name: body.name ?? "",
      email: body.email,
      phone: body.phone,
      company: body.company,
      preferred_channel: body.preferred_channel,
      default_priority_score: priorityScore,
    });
    return NextResponse.json({ customer }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Create failed";
    const status =
      message.includes("already") ||
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("Priority")
        ? 400
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
