import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity } from "@/lib/automation";
import { parseNoteHistoryWithIds } from "@/lib/note-history";
import {
  applyNoteFlagAction,
  canManageNoteFlags,
  isNoteFlagAction,
  isNoteThread,
  noteFlagKey,
  parseNoteFlags,
  type NoteFlagAction,
  type NoteThread,
} from "@/lib/note-visibility";

/**
 * Per-note admin flags for a card (hide / unhide, mark for production).
 *
 * GET  → { flags: { hidden, production }, available }
 * POST { thread, noteId, action } → { flags }   (admin only)
 *
 * Flags live in `orders.note_flags` (jsonb). Until that column's migration is
 * run, GET answers `available: false` with empty flags and POST returns 503 —
 * the card keeps working exactly as before.
 */

/** Postgres "undefined column" (migration not run yet). */
function isMissingColumn(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    (/note_flags/.test(error.message ?? "") &&
      /column/i.test(error.message ?? ""))
  );
}

const MISSING_MSG =
  "Hiding notes is not switched on yet (database update pending).";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, note_flags")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (isMissingColumn(error)) {
    return NextResponse.json({ flags: parseNoteFlags(null), available: false });
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    flags: parseNoteFlags((data as { note_flags?: unknown }).note_flags),
    available: true,
  });
}

const ACTIVITY_ACTION: Record<NoteFlagAction, string> = {
  hide: "note_hidden",
  unhide: "note_unhidden",
  mark_production: "note_marked_production",
  unmark_production: "note_unmarked_production",
};

function threadRaw(
  thread: NoteThread,
  order: { internal_note?: string | null; specs?: Record<string, unknown> | null }
): string | null {
  if (thread === "internal") {
    return typeof order.internal_note === "string" ? order.internal_note : null;
  }
  const key = thread === "production" ? "production_notes" : "designer_notes";
  const v = order.specs?.[key];
  return typeof v === "string" ? v : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageNoteFlags(ctx.role)) {
    return NextResponse.json(
      { error: "Only admins can hide notes or mark them for production." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    thread?: unknown;
    noteId?: unknown;
    action?: unknown;
  };
  if (!isNoteThread(body.thread) || !isNoteFlagAction(body.action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const noteId = typeof body.noteId === "string" ? body.noteId.trim() : "";
  if (!noteId) {
    return NextResponse.json({ error: "Missing note" }, { status: 400 });
  }
  const thread = body.thread;
  const action = body.action;

  const supabase = await createClient();
  const { data: order, error: loadError } = await supabase
    .from("orders")
    .select("id, internal_note, specs, note_flags")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (isMissingColumn(loadError)) {
    return NextResponse.json({ error: MISSING_MSG }, { status: 503 });
  }
  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const row = order as {
    internal_note?: string | null;
    specs?: Record<string, unknown> | null;
    note_flags?: unknown;
  };
  const entry = parseNoteHistoryWithIds(threadRaw(thread, row)).find(
    (e) => e.id === noteId
  );
  const key = noteFlagKey(thread, noteId);
  const current = parseNoteFlags(row.note_flags);
  // Unhide / unmark must work even if the note text later changed; hide /
  // mark need the note to exist so we never store flags for nothing.
  if (!entry && (action === "hide" || action === "mark_production")) {
    return NextResponse.json(
      { error: "That note was not found — reload the card and try again." },
      { status: 404 }
    );
  }

  const next = applyNoteFlagAction(current, key, action);
  if (next === current) {
    return NextResponse.json({ flags: current });
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({ note_flags: next })
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    actor: ctx.userId,
    action: ACTIVITY_ACTION[action],
    metadata: {
      thread,
      noteId,
      ...(entry
        ? {
            author: entry.author,
            date: entry.date,
            text: entry.text.length > 300 ? `${entry.text.slice(0, 297)}...` : entry.text,
          }
        : {}),
    },
  });

  return NextResponse.json({ flags: next });
}
