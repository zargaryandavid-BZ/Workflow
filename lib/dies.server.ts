import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import { formatShortOrderNumber } from "@/lib/board-order-filters";
import {
  DIE_PDF_MIGRATION_HINT,
  DIES_MIGRATION_HINT,
  isMissingDiesTable,
  mapDieRow,
  nextDieCode,
  reorderOrderedAt,
  dieUseBlocker,
  DIE_EVENT_KINDS,
  type Die,
  type DieEvent,
  type DieEventKind,
  type DieInput,
  type DieShopStatus,
} from "@/lib/dies";

/** Who did something to a die (for its history). */
export type DieActor = { id: string | null; name: string | null };

export const DIE_USAGE_MIGRATION_HINT =
  "Run migration 0096_die_usage_history.sql in Supabase, then try again.";

/** Before migration 0096 there is no usage / history. */
function isMissing0096(message: string | null | undefined): boolean {
  return /max_uses|use_count|last_used_at|checked_out|on_order|die_events|out_of_order/i.test(
    message ?? ""
  );
}

/** Add a line to a die's history. Never fails the action it records. */
export async function logDieEvent(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    dieId: string;
    kind: DieEventKind;
    actor?: DieActor | null;
    note?: string | null;
    meta?: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await supabase.from("die_events").insert({
    tenant_id: args.tenantId,
    die_id: args.dieId,
    kind: args.kind,
    actor_id: args.actor?.id ?? null,
    actor_name: args.actor?.name ?? null,
    note: args.note ?? null,
    meta: args.meta ?? {},
  });
  if (error && !isMissing0096(error.message)) {
    console.error("[dies] history event failed", args.kind, error.message);
  }
}

const DIE_SELECT =
  "*, order:orders(title, customer:customers(name)), manufacturer:die_manufacturers(full_name)";

export type DiesLoad = { dies: Die[]; migrationMissing: boolean };

export async function listDies(
  supabase: SupabaseClient,
  tenantId: string
): Promise<DiesLoad> {
  let { data, error } = await supabase
    .from("dies")
    .select(DIE_SELECT)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error && /deleted_at/i.test(error.message)) {
    // Before migration 0094.
    ({ data, error } = await supabase
      .from("dies")
      .select(DIE_SELECT)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(500));
  }
  if (error) {
    if (isMissingDiesTable(error.message)) return { dies: [], migrationMissing: true };
    throw new Error(error.message);
  }
  return {
    dies: ((data ?? []) as Record<string, unknown>[]).map(mapDieRow),
    migrationMissing: false,
  };
}

/** Before migration 0095 the dies table has no manufacturer / PDF columns. */
function isMissing0095(message: string | null | undefined): boolean {
  return /manufacturer_id|pdf_path|pdf_name|pdf_size/i.test(message ?? "");
}

async function checkManufacturer(
  supabase: SupabaseClient,
  tenantId: string,
  manufacturerId: string | null
): Promise<string | null> {
  if (!manufacturerId) return null;
  const { data } = await supabase
    .from("die_manufacturers")
    .select("id")
    .eq("id", manufacturerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data ? null : "Die manufacturer not found.";
}

/** The order must be one of this shop's cards. */
async function checkOrder(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string | null
): Promise<string | null> {
  if (!orderId) return null;
  const { data } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data ? null : "Order not found.";
}

type Result = { die: Die; warning?: string | null } | { error: string; status: number };

const LOCATION_NOT_SAVED =
  "The shelf location wasn't saved: run migration 0097_die_location.sql in Supabase.";

function dbError(message: string): { error: string; status: number } {
  return {
    error: isMissingDiesTable(message) ? DIES_MIGRATION_HINT : message,
    status: 400,
  };
}

/** The Template ID the next "+ Add Die" will get (deleted dies' codes count as used). */
export async function peekNextDieCode(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ code: string } | { error: string; status: number }> {
  const { data, error } = await supabase
    .from("dies")
    .select("template_code")
    .eq("tenant_id", tenantId);
  if (error) return dbError(error.message);
  return {
    code: nextDieCode(
      ((data ?? []) as { template_code: string }[]).map((r) => r.template_code)
    ),
  };
}

export async function createDie(
  supabase: SupabaseClient,
  args: { tenantId: string; userId: string | null; input: DieInput; actor?: DieActor }
): Promise<Result> {
  const orderError =
    (await checkOrder(supabase, args.tenantId, args.input.order_id)) ??
    (await checkManufacturer(supabase, args.tenantId, args.input.manufacturer_id));
  if (orderError) return { error: orderError, status: 404 };
  let input: Partial<DieInput> = args.input;
  let droppedLocation = false;

  // Codes are per shop and never reused; retry if two people add at once.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: codes, error: codesError } = await supabase
      .from("dies")
      .select("template_code")
      .eq("tenant_id", args.tenantId);
    if (codesError) return dbError(codesError.message);
    const templateCode = nextDieCode(
      ((codes ?? []) as { template_code: string }[]).map((r) => r.template_code)
    );

    const { data, error } = await supabase
      .from("dies")
      .insert({
        tenant_id: args.tenantId,
        ...input,
        template_code: templateCode,
        created_by: args.userId,
      })
      .select(DIE_SELECT)
      .single();
    if (!error && data) {
      const die = mapDieRow(data as Record<string, unknown>);
      await logDieEvent(supabase, {
        tenantId: args.tenantId,
        dieId: die.id,
        kind: "added",
        actor: args.actor,
      });
      return { die, warning: droppedLocation ? LOCATION_NOT_SAVED : null };
    }
    if (error?.code === "23505") continue; // unique (tenant_id, template_code)
    if (error && /location/i.test(error.message) && "location" in input) {
      // Before migration 0097: save the rest, and say the location was lost.
      const { location: _dropLocation, ...rest } = input;
      droppedLocation = Boolean(_dropLocation);
      input = rest;
      continue;
    }
    if (error && isMissing0096(error.message) && "max_uses" in input) {
      const { max_uses: _dropUses, ...rest } = input;
      void _dropUses;
      input = rest;
      continue;
    }
    if (error && isMissing0095(error.message) && "manufacturer_id" in input) {
      const { manufacturer_id: _drop, ...rest } = input;
      void _drop;
      input = rest;
      continue;
    }
    return dbError(error?.message ?? "Failed to save die");
  }
  return { error: "Could not create a unique Template ID. Try again.", status: 409 };
}

export async function updateDie(
  supabase: SupabaseClient,
  args: { tenantId: string; id: string; input: DieInput; actor?: DieActor }
): Promise<Result> {
  const orderError =
    (await checkOrder(supabase, args.tenantId, args.input.order_id)) ??
    (await checkManufacturer(supabase, args.tenantId, args.input.manufacturer_id));
  if (orderError) return { error: orderError, status: 404 };
  const run = (input: Partial<DieInput>) =>
    supabase
      .from("dies")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", args.id)
      .eq("tenant_id", args.tenantId)
      .is("deleted_at", null)
      .select(DIE_SELECT)
      .maybeSingle();
  let { data, error } = await run(args.input);
  let droppedLocation = false;
  if (error && /location/i.test(error.message)) {
    // Before migration 0097: save the rest, and say the location was lost.
    const { location: _dropLocation, ...rest } = args.input;
    droppedLocation = Boolean(_dropLocation);
    ({ data, error } = await run(rest));
  }
  if (error && isMissing0096(error.message)) {
    const { max_uses: _dropUses, ...rest } = args.input;
    void _dropUses;
    ({ data, error } = await run(rest));
  }
  if (error && isMissing0095(error.message)) {
    const { manufacturer_id: _drop, max_uses: _dropUses, ...rest } = args.input;
    void _drop;
    void _dropUses;
    ({ data, error } = await run(rest));
  }
  if (error) return dbError(error.message);
  if (!data) return { error: "Die not found.", status: 404 };
  await logDieEvent(supabase, {
    tenantId: args.tenantId,
    dieId: args.id,
    kind: "edited",
    actor: args.actor,
  });
  return {
    die: mapDieRow(data as Record<string, unknown>),
    warning: droppedLocation ? LOCATION_NOT_SAVED : null,
  };
}

/** Status change or reorder from the Dies table. Does not email anyone. */
export async function updateDieShop(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    id: string;
    shopStatus: DieShopStatus | null;
    reorder: boolean;
    actor?: DieActor;
  }
): Promise<Result> {
  const patch: Record<string, string> = { updated_at: new Date().toISOString() };
  if (args.shopStatus) patch.shop_status = args.shopStatus;
  if (args.reorder) patch.ordered_at = reorderOrderedAt(new Date());
  const { data, error } = await supabase
    .from("dies")
    .update(patch)
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId)
    .is("deleted_at", null)
    .select(DIE_SELECT)
    .maybeSingle();
  if (error) {
    if (/out_of_order/i.test(error.message) || error.code === "23514") {
      return { error: DIE_USAGE_MIGRATION_HINT, status: 400 };
    }
    if (/shop_status|ordered_at/i.test(error.message)) {
      return {
        error: "Run migration 20261105225910_die_shop_status.sql in Supabase, then try again.",
        status: 400,
      };
    }
    return dbError(error.message);
  }
  if (!data) return { error: "Die not found or deleted.", status: 404 };
  if (args.shopStatus) {
    await logDieEvent(supabase, {
      tenantId: args.tenantId,
      dieId: args.id,
      kind: "status",
      actor: args.actor,
      meta: { to: args.shopStatus },
    });
  }
  if (args.reorder) {
    await logDieEvent(supabase, {
      tenantId: args.tenantId,
      dieId: args.id,
      kind: "reorder",
      actor: args.actor,
    });
  }
  return { die: mapDieRow(data as Record<string, unknown>) };
}

export async function getDie(
  supabase: SupabaseClient,
  tenantId: string,
  id: string
): Promise<Die | null> {
  const { data } = await supabase
    .from("dies")
    .select(DIE_SELECT)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data ? mapDieRow(data as Record<string, unknown>) : null;
}

/**
 * Delete a die: hidden from the list, but the row stays so its Template ID is
 * never reused (migration 0094). Before 0094 the row is removed instead.
 * Quote requests already sent for it are kept.
 */
export async function deleteDie(
  supabase: SupabaseClient,
  tenantId: string,
  id: string,
  actor?: DieActor
): Promise<{ ok: true; template_code: string } | { error: string; status: number }> {
  let { data, error } = await supabase
    .from("dies")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .select("template_code")
    .maybeSingle();
  if (error && /deleted_at/i.test(error.message)) {
    ({ data, error } = await supabase
      .from("dies")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("template_code")
      .maybeSingle());
  }
  if (error) return dbError(error.message);
  if (!data) return { error: "Die not found.", status: 404 };
  await logDieEvent(supabase, { tenantId, dieId: id, kind: "deleted", actor });
  return { ok: true, template_code: String((data as { template_code: string }).template_code) };
}

/** Upload (or replace) the die PDF. Storage: order-assets/<tenant>/dies/<die>/… */
export async function saveDiePdf(
  supabase: SupabaseClient,
  args: { tenantId: string; id: string; file: File }
): Promise<Result> {
  const die = await supabase
    .from("dies")
    .select("id, pdf_path")
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (die.error) {
    return isMissing0095(die.error.message)
      ? { error: DIE_PDF_MIGRATION_HINT, status: 400 }
      : dbError(die.error.message);
  }
  if (!die.data) return { error: "Die not found.", status: 404 };

  const safe = args.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "die.pdf";
  const path = `${args.tenantId}/dies/${args.id}/${Date.now()}-${safe}`;
  const { error: uploadError } = await supabase.storage
    .from(ORDER_ASSETS_BUCKET)
    .upload(path, args.file, { contentType: "application/pdf", upsert: false });
  if (uploadError) return { error: uploadError.message, status: 500 };

  const { data, error } = await supabase
    .from("dies")
    .update({
      pdf_path: path,
      pdf_name: args.file.name.slice(0, 200),
      pdf_size: args.file.size,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId)
    .select(DIE_SELECT)
    .maybeSingle();
  if (error || !data) {
    await supabase.storage.from(ORDER_ASSETS_BUCKET).remove([path]);
    return error ? dbError(error.message) : { error: "Die not found.", status: 404 };
  }
  // Quote requests keep pointing at the old file, so it is only removed when
  // no request uses it.
  const oldPath = (die.data as { pdf_path?: string | null }).pdf_path;
  if (oldPath && oldPath !== path) {
    const { count } = await supabase
      .from("die_requests")
      .select("id", { count: "exact", head: true })
      .eq("file_path", oldPath);
    if (!count) await supabase.storage.from(ORDER_ASSETS_BUCKET).remove([oldPath]);
  }
  return { die: mapDieRow(data as Record<string, unknown>) };
}

/** Storage path + name of a die's PDF, for downloads and for quote requests. */
export async function diePdfRef(
  supabase: SupabaseClient,
  tenantId: string,
  id: string
): Promise<{ path: string; name: string } | null> {
  const { data, error } = await supabase
    .from("dies")
    .select("pdf_path, pdf_name")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { pdf_path?: string | null; pdf_name?: string | null };
  return row.pdf_path ? { path: row.pdf_path, name: row.pdf_name || "die.pdf" } : null;
}

export async function getDieByCode(
  supabase: SupabaseClient,
  tenantId: string,
  code: string
): Promise<Die | null> {
  const { data } = await supabase
    .from("dies")
    .select(DIE_SELECT)
    .eq("tenant_id", tenantId)
    .ilike("template_code", code)
    .maybeSingle();
  return data ? mapDieRow(data as Record<string, unknown>) : null;
}

/**
 * Use die / Return die. Use: the die must be Working and not with someone
 * else; adds one use. Return: anyone can hand it back.
 */
export async function useOrReturnDie(
  supabase: SupabaseClient,
  args: {
    tenantId: string;
    id: string;
    action: "use" | "return";
    actor: DieActor;
    note?: string | null;
    /** Use: how many uses to add (default 1). */
    uses?: number;
    /** Use: the order the die is used for, and its total qty. */
    orderId?: string | null;
    qty?: number | null;
  }
): Promise<Result> {
  const current = await getDie(supabase, args.tenantId, args.id);
  if (!current) return { error: "Die not found.", status: 404 };
  if (current.deleted_at) return { error: "This die was deleted.", status: 409 };
  const now = new Date().toISOString();

  if (args.action === "use") {
    const blocker = dieUseBlocker(current);
    if (blocker) return { error: blocker, status: 409 };
    const uses = Math.max(1, Math.floor(args.uses ?? 1));
    let orderNumber: string | null = null;
    if (args.orderId) {
      const { data: order } = await supabase
        .from("orders")
        .select("id, title")
        .eq("id", args.orderId)
        .eq("tenant_id", args.tenantId)
        .maybeSingle();
      if (!order) return { error: "Order not found.", status: 404 };
      orderNumber = formatShortOrderNumber(String((order as { title: string }).title)) || null;
    }
    const useNumber = current.use_count + uses;
    const { data, error } = await supabase
      .from("dies")
      .update({
        use_count: useNumber,
        last_used_at: now,
        checked_out_by: args.actor.id,
        checked_out_by_name: args.actor.name,
        checked_out_at: now,
        updated_at: now,
      })
      .eq("id", args.id)
      .eq("tenant_id", args.tenantId)
      // Two people pressing Use at once: only the first one wins.
      .is("checked_out_at", null)
      .eq("use_count", current.use_count)
      .select(DIE_SELECT)
      .maybeSingle();
    if (error) {
      return isMissing0096(error.message)
        ? { error: DIE_USAGE_MIGRATION_HINT, status: 400 }
        : dbError(error.message);
    }
    if (!data) {
      return { error: "Someone else just took this die. Refresh and try again.", status: 409 };
    }
    await logDieEvent(supabase, {
      tenantId: args.tenantId,
      dieId: args.id,
      kind: "used",
      actor: args.actor,
      note: args.note,
      meta: {
        use_number: useNumber,
        uses_added: uses,
        max_uses: current.max_uses,
        order_id: args.orderId ?? null,
        order_number: orderNumber,
        qty: args.qty ?? null,
      },
    });
    return { die: mapDieRow(data as Record<string, unknown>) };
  }

  if (!current.checked_out_at) {
    return { error: "This die isn't checked out.", status: 409 };
  }
  const { data, error } = await supabase
    .from("dies")
    .update({
      checked_out_by: null,
      checked_out_by_name: null,
      checked_out_at: null,
      updated_at: now,
    })
    .eq("id", args.id)
    .eq("tenant_id", args.tenantId)
    .not("checked_out_at", "is", null)
    .select(DIE_SELECT)
    .maybeSingle();
  if (error) {
    return isMissing0096(error.message)
      ? { error: DIE_USAGE_MIGRATION_HINT, status: 400 }
      : dbError(error.message);
  }
  if (!data) return { error: "This die was already returned.", status: 409 };
  const minutes = Math.max(
    0,
    Math.round((Date.parse(now) - Date.parse(current.checked_out_at)) / 60000)
  );
  await logDieEvent(supabase, {
    tenantId: args.tenantId,
    dieId: args.id,
    kind: "returned",
    actor: args.actor,
    note: args.note,
    meta: { taken_by: current.checked_out_by_name, minutes },
  });
  return { die: mapDieRow(data as Record<string, unknown>) };
}

export type DieOrderHistoryRow = {
  id: string;
  status: string;
  manufacturer_name: string | null;
  quoted_price: number | null;
  time_estimate: string | null;
  required_date: string | null;
  confirmed_due_date: string | null;
  sent_at: string | null;
  quoted_at: string | null;
  ordered_at: string | null;
  received_at: string | null;
};

/** History page: usage / status events, plus every quote request for the die. */
export async function loadDieHistory(
  supabase: SupabaseClient,
  tenantId: string,
  dieId: string
): Promise<{ events: DieEvent[]; orders: DieOrderHistoryRow[]; migrationMissing: boolean }> {
  const [eventsRes, ordersRes] = await Promise.all([
    supabase
      .from("die_events")
      .select("id, kind, actor_name, note, meta, created_at")
      .eq("tenant_id", tenantId)
      .eq("die_id", dieId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("die_requests")
      .select(
        "id, status, quoted_price, time_estimate, required_date, confirmed_due_date, sent_at, quoted_at, ordered_at, received_at, manufacturer:die_manufacturers(full_name)"
      )
      .eq("tenant_id", tenantId)
      .eq("die_id", dieId)
      .order("sent_at", { ascending: false }),
  ]);
  const events = ((eventsRes.data ?? []) as Record<string, unknown>[])
    .filter((row) => DIE_EVENT_KINDS.includes(row.kind as DieEventKind))
    .map((row) => ({
      id: String(row.id),
      kind: row.kind as DieEventKind,
      actor_name: row.actor_name ? String(row.actor_name) : null,
      note: row.note ? String(row.note) : null,
      meta:
        row.meta && typeof row.meta === "object" ? (row.meta as Record<string, unknown>) : {},
      created_at: String(row.created_at),
    }));
  const orders = ((ordersRes.data ?? []) as Record<string, unknown>[]).map((row) => {
    const mfg = row.manufacturer as { full_name?: string } | { full_name?: string }[] | null;
    const m = Array.isArray(mfg) ? mfg[0] : mfg;
    const str = (v: unknown) => (v == null ? null : String(v));
    return {
      id: String(row.id),
      status: String(row.status),
      manufacturer_name: m?.full_name?.trim() || null,
      quoted_price: row.quoted_price == null ? null : Number(row.quoted_price),
      time_estimate: str(row.time_estimate),
      required_date: str(row.required_date)?.slice(0, 10) ?? null,
      confirmed_due_date: str(row.confirmed_due_date)?.slice(0, 10) ?? null,
      sent_at: str(row.sent_at),
      quoted_at: str(row.quoted_at),
      ordered_at: str(row.ordered_at),
      received_at: str(row.received_at),
    };
  });
  return {
    events,
    orders,
    migrationMissing: Boolean(eventsRes.error && isMissing0096(eventsRes.error.message)),
  };
}

/** Request marked received: the ordered die joins the Dies tab. */
export async function markOrderedDieReceived(
  supabase: SupabaseClient,
  args: { tenantId: string; dieId: string; actor?: DieActor; undo?: boolean }
): Promise<void> {
  const { error } = await supabase
    .from("dies")
    .update({ on_order: args.undo ? true : false, updated_at: new Date().toISOString() })
    .eq("id", args.dieId)
    .eq("tenant_id", args.tenantId);
  if (error) {
    if (!isMissing0096(error.message)) console.error("[dies] received flag failed", error.message);
    return;
  }
  if (!args.undo) {
    await logDieEvent(supabase, {
      tenantId: args.tenantId,
      dieId: args.dieId,
      kind: "received",
      actor: args.actor,
    });
  }
}

/** New die sent as an order: keep it off the Dies tab until it arrives. */
export async function markDieOnOrder(
  supabase: SupabaseClient,
  args: { tenantId: string; dieId: string; actor?: DieActor; manufacturerName: string | null; newDie: boolean }
): Promise<void> {
  if (args.newDie) {
    const { error } = await supabase
      .from("dies")
      .update({ on_order: true })
      .eq("id", args.dieId)
      .eq("tenant_id", args.tenantId);
    if (error && !isMissing0096(error.message)) {
      console.error("[dies] on_order flag failed", error.message);
    }
  }
  await logDieEvent(supabase, {
    tenantId: args.tenantId,
    dieId: args.dieId,
    kind: "ordered",
    actor: args.actor,
    meta: { manufacturer: args.manufacturerName },
  });
}
