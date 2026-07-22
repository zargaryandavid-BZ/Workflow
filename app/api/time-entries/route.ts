import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  durationSeconds,
  isActivityType,
  type ActivityType,
  type TimeEntry,
  localDateString,
  localDayEndExclusiveIso,
  localDayStartIso,
} from "@/lib/time-tracking";

type OrderJoin = {
  id: string;
  title: string;
  customer: { name: string } | { name: string }[] | null;
} | null;

type RawEntry = {
  id: string;
  tenant_id: string;
  user_id: string;
  order_id: string | null;
  order_title: string | null;
  custom_task_name: string | null;
  activity_type: string;
  started_at: string;
  ended_at: string | null;
  paused_at: string | null;
  paused_seconds: number;
  notes: string | null;
  created_at: string;
  order?: OrderJoin;
};

function customerNameFromJoin(order: OrderJoin): string | null {
  if (!order?.customer) return null;
  const c = Array.isArray(order.customer) ? order.customer[0] : order.customer;
  return c?.name?.trim() || null;
}

function mapEntry(row: RawEntry, nowMs = Date.now()): TimeEntry {
  const liveTitle = row.order?.title?.trim() || null;
  const pausedSeconds = Number(row.paused_seconds) || 0;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    order_id: row.order_id,
    order_title: row.order_title,
    custom_task_name: row.custom_task_name,
    activity_type: row.activity_type as ActivityType,
    started_at: row.started_at,
    ended_at: row.ended_at,
    paused_at: row.paused_at,
    paused_seconds: pausedSeconds,
    notes: row.notes,
    created_at: row.created_at,
    duration_seconds: durationSeconds(row.started_at, row.ended_at, nowMs, {
      pausedAt: row.paused_at,
      pausedSeconds,
    }),
    job_title: liveTitle ?? row.order_title,
    job_number: liveTitle ?? row.order_title,
    customer_name: customerNameFromJoin(row.order ?? null),
  };
}

const SELECT =
  "id, tenant_id, user_id, order_id, order_title, custom_task_name, activity_type, started_at, ended_at, paused_at, paused_seconds, notes, created_at, order:orders(id, title, customer:customers(name))";

export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const running = searchParams.get("running") === "true";
  const dateParam = searchParams.get("date");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const jobId = searchParams.get("job_id") ?? searchParams.get("order_id");
  const userIdParam = searchParams.get("user_id");

  const isAdmin = ctx.role === "admin";
  let filterUserId = ctx.userId;
  if (userIdParam) {
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    filterUserId = userIdParam;
  }

  const supabase = await createClient();
  let query = supabase
    .from("time_entries")
    .select(SELECT)
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", filterUserId)
    .order("started_at", { ascending: false });

  if (running) {
    query = query.is("ended_at", null);
  }

  if (jobId) {
    query = query.eq("order_id", jobId);
  }

  if (dateParam) {
    query = query
      .gte("started_at", localDayStartIso(dateParam))
      .lt("started_at", localDayEndExclusiveIso(dateParam));
  } else if (fromParam || toParam) {
    if (fromParam) {
      query = query.gte("started_at", localDayStartIso(fromParam));
    }
    if (toParam) {
      query = query.lt("started_at", localDayEndExclusiveIso(toParam));
    }
  } else if (!running && !jobId) {
    // Default: today
    const today = localDateString();
    query = query
      .gte("started_at", localDayStartIso(today))
      .lt("started_at", localDayEndExclusiveIso(today));
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const nowMs = Date.now();
  const entries = ((data ?? []) as unknown as RawEntry[]).map((row) =>
    mapEntry(row, nowMs)
  );

  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    job_id?: string;
    order_id?: string;
    custom_task_name?: string;
    activity_type?: string;
    notes?: string;
  };

  const orderId =
    (typeof body.order_id === "string" && body.order_id.trim()) ||
    (typeof body.job_id === "string" && body.job_id.trim()) ||
    null;
  const customTaskName =
    typeof body.custom_task_name === "string"
      ? body.custom_task_name.trim()
      : "";

  if (!orderId && !customTaskName) {
    return NextResponse.json(
      { error: "Provide order_id (or job_id) or custom_task_name" },
      { status: 400 }
    );
  }

  const activityType: ActivityType = isActivityType(body.activity_type)
    ? body.activity_type
    : "Design";

  const notes =
    typeof body.notes === "string" && body.notes.trim()
      ? body.notes.trim()
      : null;

  const supabase = await createClient();

  let orderTitle: string | null = null;
  if (orderId) {
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, title")
      .eq("id", orderId)
      .eq("tenant_id", ctx.tenant.id)
      .is("removed_at", null)
      .maybeSingle();

    if (orderError) {
      return NextResponse.json({ error: orderError.message }, { status: 500 });
    }
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    orderTitle = (order as { title: string }).title;
  }

  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      tenant_id: ctx.tenant.id,
      user_id: ctx.userId,
      order_id: orderId,
      order_title: orderTitle,
      custom_task_name: customTaskName || null,
      activity_type: activityType,
      notes,
      started_at: new Date().toISOString(),
    })
    .select(SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { entry: mapEntry(data as unknown as RawEntry) },
    { status: 201 }
  );
}
