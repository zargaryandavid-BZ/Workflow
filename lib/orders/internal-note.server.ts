import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/automation";
import {
  appendNoteEntry,
  parseNoteHistory,
  serializeNoteHistory,
} from "@/lib/note-history";
import { notifyMentionedInNotes } from "@/lib/user-notifications";

export type AppendInternalNoteParams = {
  tenantId: string;
  orderId: string;
  /** Staff user id; null for integrations (e.g. Pulse), which skip @mention notifications. */
  actorUserId: string | null;
  /** Name shown on the note ("Anna Smith"). */
  author: string;
  text: string;
  /** ISO time shown on the note; defaults to now. */
  date?: string;
  /** Activity-log action + metadata recorded with the note (e.g. "hold_reason"). */
  activity?: { action: string; metadata?: Record<string, unknown> };
};

export type AppendInternalNoteResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Append one entry (author + datetime) to a card's Internal notes and log the activity —
 * the same record the staff "Hold reason" popup writes.
 */
export async function appendInternalNote(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  params: AppendInternalNoteParams
): Promise<AppendInternalNoteResult> {
  const { tenantId, orderId, actorUserId, author, text, date, activity } = params;

  const { data: order, error: loadError } = await supabase
    .from("orders")
    .select("id, title, internal_note, specs")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (loadError) return { ok: false, status: 500, error: loadError.message };
  if (!order) return { ok: false, status: 404, error: "Not found" };

  const previousInternal =
    typeof (order as { internal_note?: string | null }).internal_note === "string"
      ? (order as { internal_note: string }).internal_note
      : null;
  const nextInternal = serializeNoteHistory(
    appendNoteEntry(parseNoteHistory(previousInternal), text, author, date)
  );

  const { error: updateError } = await supabase
    .from("orders")
    .update({ internal_note: nextInternal })
    .eq("id", orderId)
    .eq("tenant_id", tenantId);
  if (updateError) return { ok: false, status: 500, error: updateError.message };

  if (activity) {
    await logActivity(supabase, {
      tenantId,
      orderId,
      actor: actorUserId,
      action: activity.action,
      metadata: activity.metadata ?? {},
    });
  }

  if (actorUserId) {
    const specs =
      order.specs && typeof order.specs === "object" && !Array.isArray(order.specs)
        ? (order.specs as Record<string, unknown>)
        : {};
    try {
      await notifyMentionedInNotes({
        client: supabase,
        tenantId,
        orderId,
        orderTitle: String((order as { title?: unknown }).title ?? "order"),
        actorId: actorUserId,
        actorName: author,
        previousInternalNote: previousInternal,
        nextInternalNote: nextInternal,
        previousSpecs: specs,
        nextSpecs: specs,
      });
    } catch (err) {
      console.error("[internal-note] mention notify", err);
    }
  }

  return { ok: true };
}
