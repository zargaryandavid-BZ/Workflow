import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  durationSeconds,
  isActivityType,
  type ActivityType,
  type TimeEntry,
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

const SELECT =
  "id, tenant_id, user_id, order_id, order_title, custom_task_name, activity_type, started_at, ended_at, paused_at, paused_seconds, notes, created_at, order:orders(id, title, customer:customers(name))";

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    ended_at?: string | null;
    started_at?: string;
    activity_type?: string;
    notes?: string | null;
    custom_task_name?: string | null;
    /** "pause" | "resume" */
    action?: string;
  };

  const supabase = await createClient();

  const { data: existing, error: loadError } = await supabase
    .from("time_entries")
    .select("id, user_id, tenant_id, started_at, ended_at, paused_at, paused_seconds")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if ((existing as { user_id: string }).user_id !== ctx.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = existing as {
    started_at: string;
    ended_at: string | null;
    paused_at: string | null;
    paused_seconds: number;
  };

  const patch: Record<string, unknown> = {};
  const action = typeof body.action === "string" ? body.action.trim() : "";

  if (action === "pause") {
    if (row.ended_at) {
      return NextResponse.json(
        { error: "Cannot pause a stopped timer" },
        { status: 400 }
      );
    }
    if (row.paused_at) {
      return NextResponse.json({ error: "Timer is already paused" }, { status: 400 });
    }
    patch.paused_at = new Date().toISOString();
  } else if (action === "resume") {
    if (row.ended_at) {
      return NextResponse.json(
        { error: "Cannot resume a stopped timer" },
        { status: 400 }
      );
    }
    if (!row.paused_at) {
      return NextResponse.json({ error: "Timer is not paused" }, { status: 400 });
    }
    const pausedAtMs = new Date(row.paused_at).getTime();
    const addSec = Math.max(
      0,
      Math.floor((Date.now() - pausedAtMs) / 1000)
    );
    patch.paused_seconds = (Number(row.paused_seconds) || 0) + addSec;
    patch.paused_at = null;
  }

      if (body.ended_at !== undefined) {
        if (body.ended_at === null) {
          patch.ended_at = null;
        } else {
          const ended = new Date(body.ended_at);
          if (Number.isNaN(ended.getTime())) {
            return NextResponse.json(
              { error: "Invalid ended_at" },
              { status: 400 }
            );
          }
          // Stopping while paused: end at the pause moment so pause time isn't counted.
          if (row.paused_at && patch.paused_at === undefined) {
            patch.ended_at = row.paused_at;
            patch.paused_at = null;
          } else {
            patch.ended_at = ended.toISOString();
          }
        }
      }

  if (typeof body.started_at === "string") {
    const started = new Date(body.started_at);
    if (Number.isNaN(started.getTime())) {
      return NextResponse.json({ error: "Invalid started_at" }, { status: 400 });
    }
    patch.started_at = started.toISOString();
  }

  if (body.activity_type !== undefined) {
    if (!isActivityType(body.activity_type)) {
      return NextResponse.json(
        { error: "Invalid activity_type" },
        { status: 400 }
      );
    }
    patch.activity_type = body.activity_type;
  }

  if (body.notes !== undefined) {
    patch.notes =
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim()
        : null;
  }

  if (body.custom_task_name !== undefined) {
    const name =
      typeof body.custom_task_name === "string"
        ? body.custom_task_name.trim()
        : "";
    patch.custom_task_name = name || null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  // Validate start/end ordering with merged values
  const nextStart =
    (patch.started_at as string | undefined) ?? row.started_at;
  const nextEnd =
    patch.ended_at !== undefined
      ? (patch.ended_at as string | null)
      : row.ended_at;
  if (nextEnd && new Date(nextEnd).getTime() < new Date(nextStart).getTime()) {
    return NextResponse.json(
      { error: "ended_at must be after started_at" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("time_entries")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.userId)
    .select(SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entry: mapEntry(data as unknown as RawEntry) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data: existing, error: loadError } = await supabase
    .from("time_entries")
    .select("id, user_id")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if ((existing as { user_id: string }).user_id !== ctx.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("time_entries")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
