import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ARTWORK_FIELD_NAME } from "@/lib/constants";
import { respondUrl } from "@/lib/notification-messages";
import {
  designFolderFromSpecs,
  filterOriginalCards,
  httpUrl,
  pickReorderApprovalRound,
  pickReorderSourceCard,
  reorderCardTitleCandidates,
  reorderOrderNumberVariants,
  type ApprovalRow,
  type ReorderSourceCard,
  type ReorderSourceInfo,
} from "@/lib/reorder-source";

type Client = SupabaseClient;

/**
 * READ-ONLY: every live card of the ORIGINAL order a reorder points at.
 * Matches the original's order number in any spelling (see
 * reorderOrderNumberVariants) and never returns the reorder's own cards.
 */
export async function loadReorderOriginalCards(
  client: Client,
  tenantId: string,
  reorderRef: string,
  newOrderNumber: string
): Promise<ReorderSourceCard[]> {
  const variants = reorderOrderNumberVariants(reorderRef);
  if (variants.length === 0) return [];
  const titles = reorderCardTitleCandidates(reorderRef);
  const [byNumber, byTitle] = await Promise.all([
    client
      .from("orders")
      .select("id, title, specs")
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .in("specs->>webhook_order_number", variants),
    client
      .from("orders")
      .select("id, title, specs")
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .in("title", titles),
  ]);
  const rows = [...(byNumber.data ?? []), ...(byTitle.data ?? [])].map((r) => ({
    id: r.id as string,
    title: (r.title as string) ?? "",
    specs: ((r.specs as Record<string, unknown> | null) ?? {}) as Record<string, unknown>,
  }));
  return filterOriginalCards(rows, reorderRef, newOrderNumber);
}

/** READ-ONLY: the card's "Artwork (GDrive link)" value — the Final production folder. */
async function readArtworkLink(
  client: Client,
  tenantId: string,
  orderId: string
): Promise<string | null> {
  const { data: field } = await client
    .from("custom_fields")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", ARTWORK_FIELD_NAME)
    .maybeSingle();
  const fieldId = (field as { id: string } | null)?.id;
  if (!fieldId) return null;
  const { data: row } = await client
    .from("custom_field_values")
    .select("value")
    .eq("order_id", orderId)
    .eq("custom_field_id", fieldId)
    .maybeSingle();
  return httpUrl((row as { value?: unknown } | null)?.value);
}

/**
 * READ-ONLY: designer folder, Final production folder and approval link of the
 * original card for reorder line `itemIndex`. Returns null when the original card
 * can't be identified (several lines and no index/title match) — callers then
 * fall back to sender-supplied links only.
 */
export async function resolveReorderSourceForLine(
  client: Client,
  tenantId: string,
  args: {
    reorderRef: string;
    cards: ReorderSourceCard[];
    itemIndex: number;
    itemTitle?: string | null;
  }
): Promise<ReorderSourceInfo | null> {
  const card = pickReorderSourceCard(args.cards, {
    itemIndex: args.itemIndex,
    itemTitle: args.itemTitle,
  });
  if (!card) return null;

  const [finalUrl, approvals] = await Promise.all([
    readArtworkLink(client, tenantId, card.id).catch(() => null),
    client
      .from("job_notifications")
      .select("token, status, customer_response, channel, token_expires_at, created_at")
      .eq("tenant_id", tenantId)
      .eq("order_id", card.id)
      .eq("type", "customer_approval")
      .order("created_at", { ascending: false })
      .limit(25)
      .then((r) => (r.data ?? []) as ApprovalRow[], () => [] as ApprovalRow[]),
  ]);
  const round = pickReorderApprovalRound(approvals);
  const design = designFolderFromSpecs(card.specs);
  const rawIdx = card.specs?.webhook_item_index;
  const idx =
    typeof rawIdx === "number" ? rawIdx : Number.parseInt(String(rawIdx ?? ""), 10);

  return {
    order_ref: args.reorderRef,
    order_id: card.id,
    title: card.title || null,
    item_index: Number.isInteger(idx) && idx >= 0 ? idx : args.cards.length === 1 ? 0 : args.itemIndex,
    design_folder_url: design,
    final_folder_url: finalUrl,
    approval_url: round ? respondUrl(round.token) : null,
    approval_status: round?.status ?? null,
  };
}
