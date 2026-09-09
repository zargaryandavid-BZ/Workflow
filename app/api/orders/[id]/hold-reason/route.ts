import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity } from "@/lib/automation";
import {
  appendNoteEntry,
  parseNoteHistory,
  serializeNoteHistory,
} from "@/lib/note-history";
import { notifyMentionedInNotes } from "@/lib/user-notifications";

/**
 * Record WHY a card was put on hold.
 * Appends Internal notes (author + datetime) and logs `hold_reason` activity.
 *
 * POST { reason, columnName? }  ->  { ok }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    reason?: unknown;
    columnName?: unknown;
  };
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!reason) {
    return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  }
  const columnName =
    typeof body.columnName === "string" ? body.columnName.trim().slice(0, 120) : "";

  const supabase = await createClient();

  const { data: order, error: loadError } = await supabase
    .from("orders")
    .select("id, title, internal_note, specs")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const author = ctx.fullName?.trim() || ctx.email?.trim() || "Someone";
  const noteText = columnName ? `Hold (${columnName}): ${reason}` : `Hold: ${reason}`;
  const previousInternal =
    typeof (order as { internal_note?: string | null }).internal_note === "string"
      ? (order as { internal_note: string }).internal_note
      : null;
  const nextInternal = serializeNoteHistory(
    appendNoteEntry(parseNoteHistory(previousInternal), noteText, author)
  );

  const { error: updateError } = await supabase
    .from("orders")
    .update({ internal_note: nextInternal })
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId,
    actor: ctx.userId,
    action: "hold_reason",
    metadata: { reason, ...(columnName ? { columnName } : {}) },
  });

  const specs =
    order.specs && typeof order.specs === "object" && !Array.isArray(order.specs)
      ? (order.specs as Record<string, unknown>)
      : {};
  try {
    await notifyMentionedInNotes({
      client: supabase,
      tenantId: ctx.tenant.id,
      orderId,
      orderTitle: String(order.title ?? "order"),
      actorId: ctx.userId,
      actorName: author,
      previousInternalNote: previousInternal,
      nextInternalNote: nextInternal,
      previousSpecs: specs,
      nextSpecs: specs,
    });
  } catch (err) {
    console.error("[hold-reason] mention notify", err);
  }

  return NextResponse.json({ ok: true });
}
