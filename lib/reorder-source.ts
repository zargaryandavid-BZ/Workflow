/**
 * Reorder (reprint) → original card helpers. PURE (no DB, no "@/" imports) so
 * they run under `node --test`.
 *
 * Owner rules (Hayk 2026-10-14):
 *  - A reorder prints from the ORIGINAL order's Final production folder and links
 *    the original designer folder. Reorder line i ↔ original line i (or the line
 *    the sender named via `reorder_of_item_index`).
 *  - The original approval link stays reachable on the reorder card.
 *  - Every reorder shows "Reorder of #<original>".
 *
 * Everything here only READS the original card. The reorder card gets NEW spec
 * keys (`reorder_source`, `reorder_links`); no existing card is touched.
 */

export type ReorderSourceCard = {
  id: string;
  title: string;
  specs: Record<string, unknown>;
};

export type ReorderLink = {
  kind: "approval" | "final" | "design" | "original_card";
  label: string;
  url: string;
};

export type ReorderSourceInfo = {
  /** Original order number as the sender referenced it (e.g. "211", "ORD-2026-15108"). */
  order_ref: string;
  /** Original Workflow card (null when only sender-supplied links are known). */
  order_id: string | null;
  title: string | null;
  item_index: number | null;
  design_folder_url: string | null;
  final_folder_url: string | null;
  approval_url: string | null;
  approval_status: "approved" | "rejected" | "pending" | null;
};

export type ApprovalRow = {
  token: string | null;
  status: string | null;
  customer_response?: string | null;
  channel?: string | null;
  token_expires_at?: string | null;
  created_at?: string | null;
};

export function httpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? t : null;
  } catch {
    return null;
  }
}

/** Clean a sender's original-order reference ("#211 " → "211"). Empty → "". */
export function cleanReorderRef(raw: unknown): string {
  if (raw == null) return "";
  return String(raw).trim().replace(/^#+/, "").trim();
}

/**
 * Every spelling the ORIGINAL order number may have on its Workflow cards:
 *   CRM     "ORD-2026-15108" ↔ titles "15108" / "15108-1"
 *   website "211"            ↔ titles "W211" / "W211-1"
 *   portal  "BZ-323"         ↔ titles "BZ-323" / "BZ-323-1"
 */
export function reorderOrderNumberVariants(rawRef: unknown): string[] {
  const ref = cleanReorderRef(rawRef);
  if (!ref) return [];
  const out = new Set<string>([ref]);
  const ord = /^ord-\d{4}-(.+)$/i.exec(ref);
  if (ord?.[1]) out.add(ord[1].trim());
  // Bazaar order numbers: the same Bazaar order N reaches Workflow as "N"/"W N"
  // (website lane) or "BZ-N" (portal Order Sync lane), so all three are one order.
  const w = /^(?:w|bz-)(\d+)$/i.exec(ref);
  const n = w?.[1] ?? (/^\d+$/.test(ref) ? ref : null);
  if (n) {
    out.add(n);
    out.add(`W${n}`);
    out.add(`BZ-${n}`);
  }
  return [...out].filter(Boolean);
}

/** Card titles an original order's cards can carry (base + `-1..-N`). */
export function reorderCardTitleCandidates(rawRef: unknown, maxLines = 30): string[] {
  const bases = new Set<string>();
  for (const v of reorderOrderNumberVariants(rawRef)) {
    bases.add(v);
    if (/^\d+$/.test(v)) bases.add(`W${v}`);
  }
  const out: string[] = [];
  for (const b of bases) {
    out.push(b);
    for (let i = 1; i <= maxLines; i++) out.push(`${b}-${i}`);
  }
  return out;
}

function cardItemIndex(card: ReorderSourceCard): number | null {
  const raw = card.specs?.webhook_item_index;
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (Number.isInteger(n) && n >= 0) return n;
  const m = /-(\d+)$/.exec(card.title ?? "");
  // Only "<base>-N" multi-item titles; "BZ-323" alone has no line suffix
  // when it is the whole title, so require a dash AFTER a base with a dash/digit.
  if (m?.[1]) {
    const base = card.title.slice(0, card.title.length - m[0].length);
    if (base && !/^(bz|ord)$/i.test(base)) return Number.parseInt(m[1], 10) - 1;
  }
  return null;
}

/**
 * The original card for reorder line `itemIndex` (0-based):
 *  1. same `webhook_item_index` / title line number,
 *  2. a single-card original → that card,
 *  3. same line title (case-insensitive),
 *  else null (never guess between several lines).
 */
export function pickReorderSourceCard(
  cards: ReorderSourceCard[],
  opts: { itemIndex: number; itemTitle?: string | null }
): ReorderSourceCard | null {
  if (!cards.length) return null;
  const byIndex = cards.filter((c) => cardItemIndex(c) === opts.itemIndex);
  if (byIndex.length === 1) return byIndex[0]!;
  if (cards.length === 1) return cards[0]!;
  const wantTitle = (opts.itemTitle ?? "").trim().toLowerCase();
  if (wantTitle) {
    const byTitle = cards.filter(
      (c) =>
        typeof c.specs?.webhook_item_title === "string" &&
        c.specs.webhook_item_title.trim().toLowerCase() === wantTitle
    );
    if (byTitle.length === 1) return byTitle[0]!;
  }
  return null;
}

/** Keep only cards that really belong to the original order (not the reorder itself). */
export function filterOriginalCards(
  cards: ReorderSourceCard[],
  rawRef: unknown,
  excludeOrderNumber?: string | null
): ReorderSourceCard[] {
  const variants = new Set(reorderOrderNumberVariants(rawRef).map((v) => v.toLowerCase()));
  const titles = new Set(reorderCardTitleCandidates(rawRef).map((t) => t.toLowerCase()));
  const exclude = (excludeOrderNumber ?? "").trim().toLowerCase();
  const seen = new Set<string>();
  const out: ReorderSourceCard[] = [];
  for (const c of cards) {
    if (seen.has(c.id)) continue;
    const won =
      typeof c.specs?.webhook_order_number === "string"
        ? c.specs.webhook_order_number.trim().toLowerCase()
        : "";
    if (exclude && won === exclude) continue;
    const hit =
      (won && variants.has(won)) || titles.has((c.title ?? "").trim().toLowerCase());
    if (!hit) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/** Designer / job folder of a card (Design files). */
export function designFolderFromSpecs(specs: Record<string, unknown> | null | undefined): string | null {
  if (!specs) return null;
  return httpUrl(specs.design_task) ?? httpUrl(specs.gdrive_item_folder_url);
}

function approvalStatusOf(row: ApprovalRow): "approved" | "rejected" | "pending" | null {
  if (row.status === "responded") {
    if (row.customer_response === "approved") return "approved";
    if (row.customer_response === "changes_requested") return "rejected";
    return null;
  }
  if (row.status === "sent" || row.status === "pending") return "pending";
  return null;
}

function newestFirst(rows: ApprovalRow[]): ApprovalRow[] {
  return [...rows].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });
}

function isLiveRound(row: ApprovalRow, nowMs: number): boolean {
  const live = row.status === "sent" || (row.status === "pending" && row.channel === "manual");
  if (!live) return false;
  if (row.token_expires_at) {
    const exp = Date.parse(row.token_expires_at);
    if (!Number.isNaN(exp) && exp <= nowMs) return false;
  }
  return true;
}

/**
 * The approval round a REORDER should point back to: the newest APPROVED round
 * (the proof that authorized the print files), else the newest answered round,
 * else the newest live round. `/respond/{token}` renders a recorded decision even
 * after the link's expiry date, so an approved round stays viewable.
 */
export function pickReorderApprovalRound(
  rows: ApprovalRow[],
  nowMs: number = Date.now()
): { token: string; status: "approved" | "rejected" | "pending" | null } | null {
  const sorted = newestFirst(rows).filter((r) => r.token);
  const approved = sorted.find((r) => r.status === "responded" && r.customer_response === "approved");
  if (approved) return { token: approved.token!, status: "approved" };
  const answered = sorted.find((r) => r.status === "responded");
  if (answered) return { token: answered.token!, status: approvalStatusOf(answered) };
  const live = sorted.find((r) => isLiveRound(r, nowMs));
  if (live) return { token: live.token!, status: "pending" };
  return null;
}

/**
 * Newest NON-expired customer_approval round of a card (board export):
 * answered rounds count, expired / superseded ones don't.
 */
export function pickNewestLiveApprovalRound(
  rows: ApprovalRow[],
  nowMs: number = Date.now()
): { token: string; status: "approved" | "rejected" | "pending" | null } | null {
  for (const r of newestFirst(rows)) {
    if (!r.token) continue;
    if (r.status === "responded") return { token: r.token, status: approvalStatusOf(r) };
    if (isLiveRound(r, nowMs)) return { token: r.token, status: "pending" };
  }
  return null;
}

/** Links shown in the reorder card's "Reorder of #X" box (order matters: approval first). */
export function buildReorderLinks(src: ReorderSourceInfo): ReorderLink[] {
  const ref = cleanReorderRef(src.order_ref);
  const tag = ref ? ` (order #${ref})` : "";
  const out: ReorderLink[] = [];
  if (src.approval_url) {
    out.push({ kind: "approval", label: `Original approval${tag}`, url: src.approval_url });
  }
  if (src.final_folder_url) {
    out.push({ kind: "final", label: `Original final production files${tag}`, url: src.final_folder_url });
  }
  if (src.design_folder_url && src.design_folder_url !== src.final_folder_url) {
    out.push({ kind: "design", label: `Original designer folder${tag}`, url: src.design_folder_url });
  }
  return out;
}

/** Read `reorder_links` back off card specs (defensive — specs is free JSON). */
export function reorderLinksFromSpecs(specs: Record<string, unknown> | null | undefined): ReorderLink[] {
  const raw = specs?.reorder_links;
  if (!Array.isArray(raw)) return [];
  const out: ReorderLink[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const url = httpUrl(o.url);
    const label = typeof o.label === "string" ? o.label.trim() : "";
    const kind = o.kind;
    if (!url || !label) continue;
    if (kind !== "approval" && kind !== "final" && kind !== "design" && kind !== "original_card") continue;
    out.push({ kind, label, url });
  }
  return out;
}

/** 0-based original line a reorder line points at (sender override, else same position). */
export function reorderTargetItemIndex(item: Record<string, unknown> | null | undefined, fallback: number): number {
  const raw = item?.reorder_of_item_index;
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Sender-supplied original links on a line (or order) — used before any DB lookup. */
export function senderReorderLinks(
  item: Record<string, unknown> | null | undefined,
  order: Record<string, unknown> | null | undefined
): { design: string | null; final: string | null; approval: string | null } {
  const pick = (key: string) => httpUrl(item?.[key]) ?? httpUrl(order?.[key]);
  return {
    design: pick("reorder_source_design_folder_url"),
    final: pick("reorder_source_final_folder_url"),
    approval: pick("reorder_source_approval_url"),
  };
}
